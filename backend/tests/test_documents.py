"""Хранилище документов, запрос документов банком и автоматическое сохранение договора."""

from urllib.parse import quote

from fastapi.testclient import TestClient

from app.worker import process_one
from tests.test_bank_api import create_manual_review, login

PDF = b"%PDF-1.4 demo"


def business(api: TestClient, headers: dict[str, str]) -> str:
    return api.get("/api/v1/me", headers=headers).json()["businesses"][0]["id"]


def upload(api, url, headers, data=PDF, ctype="application/pdf", name="Устав.pdf", **params):
    return api.post(
        url, headers={**headers, "Content-Type": ctype, "X-Filename": quote(name)}, content=data, params=params
    )


def test_storage_upload_list_download_and_expiry(api: TestClient) -> None:
    h = login(api, "p3b")
    bid = business(api, h)
    r = upload(api, f"/api/v1/businesses/{bid}/documents", h, kind="CHARTER", valid_to="2027-01-01")
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["kind_title"] == "Устав" and doc["filename"] == "Устав.pdf" and not doc["expired"]
    old = upload(
        api, f"/api/v1/businesses/{bid}/documents", h, name="справка.pdf", kind="CERTIFICATE", valid_to="2026-01-01"
    ).json()
    assert old["expired"] is True
    items = api.get(f"/api/v1/businesses/{bid}/documents", headers=h).json()["items"]
    assert {i["id"] for i in items} == {doc["id"], old["id"]}
    file = api.get(f"/api/v1/documents/{doc['id']}/file", headers=h)
    assert file.status_code == 200 and file.content == PDF
    # чужой бизнес и банк не видят документы хранилища
    assert api.get(f"/api/v1/documents/{doc['id']}/file", headers=login(api, "p1a")).status_code == 403
    assert api.get(f"/api/v1/documents/{doc['id']}/file", headers=login(api, "uw1")).status_code == 403


def test_bad_files_rejected(api: TestClient) -> None:
    h = login(api, "p3b")
    bid = business(api, h)
    assert upload(api, f"/api/v1/businesses/{bid}/documents", h, data=b"").json()["code"] == "EMPTY_FILE"
    assert upload(api, f"/api/v1/businesses/{bid}/documents", h, ctype="application/x-msdownload").status_code == 422
    assert upload(api, f"/api/v1/businesses/{bid}/documents", h, kind="PASSPORT").json()["code"] == "UNKNOWN_KIND"


def test_accountant_by_mchd_can_upload(api: TestClient) -> None:
    h = login(api, "p3a_acc")
    assert upload(api, f"/api/v1/businesses/{business(api, h)}/documents", h, kind="MCHD").status_code == 201


def test_requested_documents_return_application_to_underwriter(api: TestClient) -> None:
    application_id, client = create_manual_review(
        api, "p2b", {"purpose": "equipment", "amount_kopecks": 150_000_000, "term_months": 24, "urgency": "planned"}
    )
    uw = login(api, "uw1")
    api.post(f"/api/v1/bank/applications/{application_id}/assign", headers=uw)
    r = api.post(
        f"/api/v1/bank/applications/{application_id}/actions",
        headers=uw,
        json={"action": "REQUEST_INFO", "comment": "Пришлите справку об отсутствии долга"},
    )
    assert r.status_code == 200 and r.json()["status"] == "INFO_REQUESTED"

    bid = business(api, client)
    stored = upload(api, f"/api/v1/businesses/{bid}/documents", client, kind="CERTIFICATE", name="справка.pdf").json()
    r = api.post(
        f"/api/v1/applications/{application_id}/documents/attach", headers=client, json={"document_id": stored["id"]}
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "MANUAL_REVIEW"

    docs = api.get(f"/api/v1/applications/{application_id}/documents", headers=uw).json()["items"]
    assert docs[0]["title"] == "справка.pdf"
    assert api.get(f"/api/v1/documents/{docs[0]['id']}/file", headers=uw).content == PDF
    statuses = [
        t["to_status"] for t in api.get(f"/api/v1/applications/{application_id}", headers=client).json()["timeline"]
    ]
    assert statuses[-3:] == ["INFO_REQUESTED", "SCORING", "MANUAL_REVIEW"]
    titles = [n["title"] for n in api.get("/api/v1/notifications", headers=uw).json()["items"]]
    assert "Клиент приложил документы" in titles


def test_signed_contract_lands_in_storage(api: TestClient) -> None:
    h = login(api, "p3b")
    bid = business(api, h)
    api.post(f"/api/v1/businesses/{bid}/consents", headers=h, json={"kinds": ["BKI", "FNS"]})
    offer = api.post(
        f"/api/v1/businesses/{bid}/pre-offers",
        headers=h,
        json={"purpose": "cash_gap", "amount_kopecks": 24_000_000, "term_months": 12, "frequency": "always"},
    ).json()
    app_id = api.post("/api/v1/applications", headers=h, json={"pre_offer_id": offer["id"]}).json()["id"]
    api.post(f"/api/v1/applications/{app_id}/submit", headers={**h, "Idempotency-Key": app_id})
    with api.app.state.session_factory() as session:
        process_one(session)
    assert api.post(f"/api/v1/applications/{app_id}/sign", headers=h, json={"code": "0000"}).status_code == 200
    with api.app.state.session_factory() as session:
        process_one(session)
    items = api.get(f"/api/v1/businesses/{bid}/documents", headers=h).json()["items"]
    contract = next(i for i in items if i["kind"] == "CONTRACT")
    assert contract["status"] == "SIGNED" and contract["application_id"] == app_id
    r = api.get(f"/api/v1/documents/{contract['id']}/file", headers=h)
    # правка ментора 25.10: договор — HTML-страница с пометкой ДЕМО, открывается в браузере
    assert r.headers["content-type"].startswith("text/html") and r.headers["content-disposition"].startswith("inline")
    assert "ДЕМО" in r.text and "не имеет юридической силы" in r.text and "Овердрафт" in r.text
    assert "<script" not in r.text.lower()  # только кнопка печати, без скриптов
    assert contract["filename"].endswith("-demo.html")


def test_html_upload_is_rejected(api: TestClient) -> None:
    h = login(api, "p3b")
    bid = business(api, h)
    r = upload(api, f"/api/v1/businesses/{bid}/documents", h, data=b"<script>alert(1)</script>",
               ctype="text/html", name="x.html")
    assert r.status_code == 422 and r.json()["code"] == "UNSUPPORTED_TYPE"


def test_annuity_contract_has_schedule() -> None:
    from datetime import UTC, datetime

    from app.services.documents.contract_html import render_contract
    from app.services.seasonal.schedule import annuity_schedule

    sched = annuity_schedule(1_000_000, 20.0, 12, datetime(2026, 11, 1).date())
    html = render_contract(application_id="abc12345-0000", product="WORKING_CAPITAL", purpose="inventory",
                           amount=1_000_000, rate=20.0, term_months=12, signed_at=datetime(2026, 10, 25, 11, 0, tzinfo=UTC),
                           business={"name": "ИП <Тест>", "inn": "123", "type": "IP"}, signer="Иванов И.",
                           schedule=sched, seasonal=False)
    assert html.count("<tr><td>") == 12 and "ИП &lt;Тест&gt;" in html and "14:00 (МСК)" in html
    assert "ДЕМО-2610-ABC123" in html
