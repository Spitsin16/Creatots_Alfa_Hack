#!/usr/bin/env python3
"""Export the FastAPI schema and the hand-picked Postman demo collection."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.main import app  # noqa: E402


def test_event(*lines: str) -> list[dict[str, Any]]:
    return [{"listen": "test", "script": {"type": "text/javascript", "exec": list(lines)}}]


def bearer(variable: str) -> dict[str, Any]:
    return {
        "type": "bearer",
        "bearer": [{"key": "token", "value": "{{" + variable + "}}", "type": "string"}],
    }


def request(
    name: str,
    method: str,
    path: str,
    *,
    token: str | None = None,
    body: dict[str, Any] | None = None,
    headers: list[dict[str, str]] | None = None,
    tests: tuple[str, ...] = (),
    description: str | None = None,
    file_body: str | None = None,
) -> dict[str, Any]:
    req: dict[str, Any] = {
        "method": method,
        "header": list(headers or []),
        "url": "{{baseUrl}}" + path,
    }
    if token:
        req["auth"] = bearer(token)
    if body is not None:
        req["header"].append({"key": "Content-Type", "value": "application/json", "type": "text"})
        req["body"] = {
            "mode": "raw",
            "raw": json.dumps(body, ensure_ascii=False, indent=2),
            "options": {"raw": {"language": "json"}},
        }
    if file_body:
        req["header"].append({"key": "Content-Type", "value": "application/octet-stream", "type": "text"})
        req["body"] = {"mode": "file", "file": {"src": file_body}}
    if description:
        req["description"] = description
    item: dict[str, Any] = {"name": name, "request": req}
    if tests:
        item["event"] = test_event(*tests)
    return item


def status_test(code: int) -> str:
    return f'pm.test("HTTP {code}", function () {{ pm.response.to.have.status({code}); }});'


def export_collection() -> dict[str, Any]:
    login_p3b = request(
        "01 — Войти как клиент p3b",
        "POST",
        "/api/v1/auth/login",
        body={"login": "p3b", "password": "demo"},
        tests=(
            status_test(200),
            "const body = pm.response.json();",
            'pm.collectionVariables.set("clientToken", body.access_token);',
        ),
    )
    me_p3b = request(
        "02 — Получить профиль и бизнес",
        "GET",
        "/api/v1/me",
        token="clientToken",
        tests=(
            status_test(200),
            "const body = pm.response.json();",
            'pm.test("Есть доступный бизнес", function () { pm.expect(body.businesses.length).to.be.above(0); });',
            'pm.collectionVariables.set("businessId", body.businesses[0].id);',
        ),
    )
    consent_p3b = request(
        "03 — Дать согласия БКИ и ФНС",
        "POST",
        "/api/v1/businesses/{{businessId}}/consents",
        token="clientToken",
        body={"kinds": ["BKI", "FNS"]},
        tests=(status_test(201),),
    )
    forecast_p3b = request(
        "04 — Получить прогноз кассового разрыва",
        "GET",
        "/api/v1/businesses/{{businessId}}/forecast",
        token="clientToken",
        tests=(status_test(200),),
    )
    offer_p3b = request(
        "05 — Рассчитать предложение на 340 000 ₽",
        "POST",
        "/api/v1/businesses/{{businessId}}/pre-offers",
        token="clientToken",
        body={
            "purpose": "cash_gap",
            "amount_kopecks": 34_000_000,
            "term_months": 12,
            "frequency": "always",
            "urgency": "days",
            "priority": "small_payment",
            "repayment": "equal",
            "assets": ["none"],
        },
        tests=(
            status_test(201),
            "const body = pm.response.json();",
            'pm.collectionVariables.set("preOfferId", body.id);',
            'pm.test("Лимит до выписки — 270 000 ₽", function () { pm.expect(body.limit_kopecks).to.eql(27000000); });',
        ),
    )
    explanation_p3b = request(
        "06 — Получить объяснение предложения",
        "GET",
        "/api/v1/pre-offers/{{preOfferId}}/explanation",
        token="clientToken",
        tests=(status_test(200),),
    )
    statement_p3b = request(
        "07 — Загрузить выписку 1С и пересчитать лимит",
        "POST",
        "/api/v1/pre-offers/{{preOfferId}}/statement",
        token="clientToken",
        file_body="data/statements/p3b_other_bank_1c.txt",
        description=(
            "В Postman при первом запуске выберите локальный файл "
            "data/statements/p3b_other_bank_1c.txt. Тело передаётся как application/octet-stream, не multipart."
        ),
        tests=(
            status_test(201),
            "const body = pm.response.json();",
            'pm.collectionVariables.set("preOfferId", body.pre_offer.id);',
            'pm.test("Лимит после выписки — 360 000 ₽", function () { pm.expect(body.pre_offer.limit_kopecks).to.eql(36000000); });',
        ),
    )
    create_p3b = request(
        "08 — Создать черновик заявки",
        "POST",
        "/api/v1/applications",
        token="clientToken",
        body={"pre_offer_id": "{{preOfferId}}"},
        tests=(
            status_test(201),
            "const body = pm.response.json();",
            'pm.collectionVariables.set("applicationId", body.id);',
            'pm.test("Создан черновик", function () { pm.expect(body.status).to.eql("DRAFT"); });',
        ),
    )
    submit_p3b = request(
        "09 — Отправить заявку",
        "POST",
        "/api/v1/applications/{{applicationId}}/submit",
        token="clientToken",
        headers=[{"key": "Idempotency-Key", "value": "{{applicationId}}", "type": "text"}],
        tests=(status_test(200),),
    )
    wait_p3b = request(
        "10 — Дождаться автоматического решения",
        "GET",
        "/api/v1/applications/{{applicationId}}",
        token="clientToken",
        description="Worker обрабатывает заявку асинхронно. В Collection Runner запрос повторяется до финального решения.",
        tests=(
            status_test(200),
            "const body = pm.response.json();",
            'if (body.status === "APPROVED") {',
            '  pm.test("Заявка одобрена", function () { pm.expect(body.status).to.eql("APPROVED"); });',
            "} else if ([\"REJECTED\", \"COUNTER_OFFER\", \"MANUAL_REVIEW\"].includes(body.status)) {",
            '  throw new Error("Вместо автоматического одобрения получен статус " + body.status);',
            "} else {",
            '  pm.execution.setNextRequest("10 — Дождаться автоматического решения");',
            "}",
        ),
    )
    message_p3b = request(
        "11 — Написать сообщение специалисту",
        "POST",
        "/api/v1/applications/{{applicationId}}/messages",
        token="clientToken",
        body={"text": "Когда деньги поступят на счёт?"},
        tests=(status_test(201),),
    )
    sign_p3b = request(
        "12 — Подписать договор демо-кодом",
        "POST",
        "/api/v1/applications/{{applicationId}}/sign",
        token="clientToken",
        headers=[{"key": "Idempotency-Key", "value": "sign-{{applicationId}}", "type": "text"}],
        body={"code": "0000"},
        tests=(status_test(200),),
    )
    wait_issued = request(
        "13 — Дождаться симулированной выдачи",
        "GET",
        "/api/v1/applications/{{applicationId}}",
        token="clientToken",
        tests=(
            status_test(200),
            "const body = pm.response.json();",
            'if (body.status !== "ISSUED") { pm.execution.setNextRequest("13 — Дождаться симулированной выдачи"); }',
            'else { pm.test("Кредит выдан", function () { pm.expect(body.status).to.eql("ISSUED"); }); }',
        ),
    )
    loan_p3b = request(
        "14 — Открыть кабинет выданного кредита",
        "GET",
        "/api/v1/applications/{{applicationId}}/loan",
        token="clientToken",
        tests=(status_test(200),),
    )
    notifications_p3b = request(
        "15 — Получить уведомления",
        "GET",
        "/api/v1/notifications",
        token="clientToken",
        tests=(status_test(200),),
    )

    login_p3a = request(
        "01 — Войти как директор p3a",
        "POST",
        "/api/v1/auth/login",
        body={"login": "p3a", "password": "demo"},
        tests=(
            status_test(200),
            "const body = pm.response.json();",
            'pm.collectionVariables.set("largeClientToken", body.access_token);',
        ),
    )
    me_p3a = request(
        "02 — Получить бизнес директора",
        "GET",
        "/api/v1/me",
        token="largeClientToken",
        tests=(
            status_test(200),
            "const body = pm.response.json();",
            'pm.collectionVariables.set("largeBusinessId", body.businesses[0].id);',
        ),
    )
    consent_p3a = request(
        "03 — Дать согласия БКИ и ФНС",
        "POST",
        "/api/v1/businesses/{{largeBusinessId}}/consents",
        token="largeClientToken",
        body={"kinds": ["BKI", "FNS"]},
        tests=(status_test(201),),
    )
    offer_p3a = request(
        "04 — Рассчитать предложение на 5,5 млн ₽",
        "POST",
        "/api/v1/businesses/{{largeBusinessId}}/pre-offers",
        token="largeClientToken",
        body={
            "purpose": "refinance",
            "amount_kopecks": 550_000_000,
            "term_months": 48,
            "frequency": "once",
            "urgency": "month",
            "priority": "small_payment",
            "repayment": "seasonal",
            "assets": ["real_estate"],
        },
        tests=(
            status_test(201),
            "const body = pm.response.json();",
            'pm.collectionVariables.set("largePreOfferId", body.id);',
        ),
    )
    create_p3a = request(
        "05 — Создать крупную заявку",
        "POST",
        "/api/v1/applications",
        token="largeClientToken",
        body={"pre_offer_id": "{{largePreOfferId}}"},
        tests=(
            status_test(201),
            "const body = pm.response.json();",
            'pm.collectionVariables.set("largeApplicationId", body.id);',
        ),
    )
    submit_p3a = request(
        "06 — Отправить крупную заявку",
        "POST",
        "/api/v1/applications/{{largeApplicationId}}/submit",
        token="largeClientToken",
        headers=[{"key": "Idempotency-Key", "value": "{{largeApplicationId}}", "type": "text"}],
        tests=(status_test(200),),
    )
    wait_p3a = request(
        "07 — Дождаться ручной проверки",
        "GET",
        "/api/v1/applications/{{largeApplicationId}}",
        token="largeClientToken",
        tests=(
            status_test(200),
            "const body = pm.response.json();",
            'if (body.status !== "MANUAL_REVIEW") { pm.execution.setNextRequest("07 — Дождаться ручной проверки"); }',
            'else { pm.test("Заявка передана в ручную проверку", function () { pm.expect(body.status).to.eql("MANUAL_REVIEW"); }); }',
        ),
    )
    login_uw = request(
        "08 — Войти как андеррайтер uw1",
        "POST",
        "/api/v1/auth/login",
        body={"login": "uw1", "password": "demo"},
        tests=(
            status_test(200),
            "const body = pm.response.json();",
            'pm.collectionVariables.set("underwriterToken", body.access_token);',
        ),
    )
    queue_uw = request(
        "09 — Получить очередь ручной проверки",
        "GET",
        "/api/v1/bank/applications?status=MANUAL_REVIEW",
        token="underwriterToken",
        tests=(status_test(200),),
    )
    card_uw = request(
        "10 — Открыть банковскую карточку заявки",
        "GET",
        "/api/v1/bank/applications/{{largeApplicationId}}",
        token="underwriterToken",
        tests=(status_test(200),),
    )
    assign_uw = request(
        "11 — Взять заявку в работу",
        "POST",
        "/api/v1/bank/applications/{{largeApplicationId}}/assign",
        token="underwriterToken",
        tests=(status_test(200),),
    )
    approve_uw = request(
        "12 — Одобрить как андеррайтер",
        "POST",
        "/api/v1/bank/applications/{{largeApplicationId}}/actions",
        token="underwriterToken",
        body={"action": "APPROVE", "comment": "Документы проверены, параметры подтверждены"},
        tests=(
            status_test(200),
            "const body = pm.response.json();",
            'pm.collectionVariables.set("approvalId", body.approval_id);',
            'pm.test("Требуется риск-менеджер", function () { pm.expect(body.risk_required).to.eql(true); });',
        ),
    )
    login_risk = request(
        "13 — Войти как риск-менеджер risk1",
        "POST",
        "/api/v1/auth/login",
        body={"login": "risk1", "password": "demo"},
        tests=(
            status_test(200),
            "const body = pm.response.json();",
            'pm.collectionVariables.set("riskToken", body.access_token);',
        ),
    )
    approvals_risk = request(
        "14 — Получить очередь вторых одобрений",
        "GET",
        "/api/v1/bank/approvals",
        token="riskToken",
        tests=(status_test(200),),
    )
    approve_risk = request(
        "15 — Дать второе одобрение",
        "POST",
        "/api/v1/bank/approvals/{{approvalId}}",
        token="riskToken",
        body={"action": "APPROVE", "comment": "Лимит риска подтверждён"},
        tests=(
            status_test(200),
            "const body = pm.response.json();",
            'pm.test("Заявка одобрена", function () { pm.expect(body.status).to.eql("APPROVED"); });',
        ),
    )
    audit_risk = request(
        "16 — Проверить журнал аудита",
        "GET",
        "/api/v1/bank/audit?entity_id={{largeApplicationId}}",
        token="riskToken",
        tests=(status_test(200),),
    )

    login_admin = request(
        "01 — Войти как администратор правил",
        "POST",
        "/api/v1/auth/login",
        body={"login": "admin1", "password": "demo"},
        tests=(
            status_test(200),
            "const body = pm.response.json();",
            'pm.collectionVariables.set("adminToken", body.access_token);',
        ),
    )
    rules_admin = request(
        "02 — Получить версии и активные правила",
        "GET",
        "/api/v1/bank/rules",
        token="adminToken",
        tests=(status_test(200),),
    )
    audit_admin = request(
        "03 — Получить общий журнал аудита",
        "GET",
        "/api/v1/bank/audit?page=1&page_size=20",
        token="adminToken",
        tests=(status_test(200),),
    )

    return {
        "info": {
            "_postman_id": "3d74f447-ae54-4db5-8f24-60e229a4d947",
            "name": "Умный кредитный кабинет — основные сценарии",
            "description": (
                "Коллекция для проверки API хакатонного решения. Перед полным прогоном рекомендуется выполнить "
                "`docker compose down -v && docker compose up --build` и дождаться готовности сервисов. "
                "Запросы внутри сценариев выполняются сверху вниз. Collection Runner повторяет запросы ожидания, "
                "пока worker не обработает заявку. Все данные синтетические."
            ),
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        "variable": [
            {"key": "baseUrl", "value": "http://localhost:8000", "type": "string"},
            {"key": "clientToken", "value": "", "type": "string"},
            {"key": "businessId", "value": "", "type": "string"},
            {"key": "preOfferId", "value": "", "type": "string"},
            {"key": "applicationId", "value": "", "type": "string"},
            {"key": "largeClientToken", "value": "", "type": "string"},
            {"key": "largeBusinessId", "value": "", "type": "string"},
            {"key": "largePreOfferId", "value": "", "type": "string"},
            {"key": "largeApplicationId", "value": "", "type": "string"},
            {"key": "underwriterToken", "value": "", "type": "string"},
            {"key": "riskToken", "value": "", "type": "string"},
            {"key": "approvalId", "value": "", "type": "string"},
            {"key": "adminToken", "value": "", "type": "string"},
        ],
        "item": [
            {
                "name": "00 — Проверка стенда",
                "item": [
                    request("Health", "GET", "/health", tests=(status_test(200),)),
                    request("OpenAPI работающего API", "GET", "/openapi.json", tests=(status_test(200),)),
                ],
            },
            {
                "name": "01 — Клиент p3b: предложение → выдача",
                "description": "Главный сценарий кофейни. Запускайте после сброса Docker volume.",
                "item": [
                    login_p3b,
                    me_p3b,
                    consent_p3b,
                    forecast_p3b,
                    offer_p3b,
                    explanation_p3b,
                    statement_p3b,
                    create_p3b,
                    submit_p3b,
                    wait_p3b,
                    message_p3b,
                    sign_p3b,
                    wait_issued,
                    loan_p3b,
                    notifications_p3b,
                ],
            },
            {
                "name": "02 — Крупная заявка: андеррайтер → риск",
                "description": "Сценарий ООО p3a на 5,5 млн ₽ с двумя уровнями одобрения.",
                "item": [
                    login_p3a,
                    me_p3a,
                    consent_p3a,
                    offer_p3a,
                    create_p3a,
                    submit_p3a,
                    wait_p3a,
                    login_uw,
                    queue_uw,
                    card_uw,
                    assign_uw,
                    approve_uw,
                    login_risk,
                    approvals_risk,
                    approve_risk,
                    audit_risk,
                ],
            },
            {
                "name": "03 — Администратор правил",
                "item": [login_admin, rules_admin, audit_admin],
            },
        ],
    }


def main() -> None:
    docs = ROOT / "docs"
    postman = docs / "postman"
    postman.mkdir(parents=True, exist_ok=True)
    (docs / "openapi.json").write_text(
        json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (postman / "Smart_Credit_Cabinet.postman_collection.json").write_text(
        json.dumps(export_collection(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
