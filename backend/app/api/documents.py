"""Хранилище документов и документы по заявке.

Файл передаётся телом запроса как есть (`Content-Type` файла), имя — в заголовке
`X-Filename` (URL-кодирование для кириллицы), тип и срок — в параметрах запроса.
"""

import os
from datetime import date
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_session, require_membership
from app.api.errors import APIError
from app.models import Application, AuditLog, Document, StoredFile, User
from app.services.application_flow import transition_application
from app.services.documents.storage import KINDS, MAX_BYTES, DocumentError, describe, store
from app.services.notifications.service import notify_bank_message

router = APIRouter(prefix="/api/v1", tags=["documents"])
BANK_ROLES = {"UNDERWRITER", "RISK_MANAGER"}


def _today() -> date:
    return date.fromisoformat(os.environ.get("DEMO_TODAY", "2026-10-22"))


async def _body(request: Request) -> bytes:
    raw = await request.body()
    if len(raw) > MAX_BYTES:
        raise APIError(413, "FILE_TOO_LARGE", "Файл больше 10 МБ")
    return raw


def _list(session: Session, docs) -> list[dict]:
    files = {f.id: f for f in session.scalars(select(StoredFile).where(StoredFile.id.in_([d.file_id for d in docs if d.file_id])))}
    return [describe(d, files.get(d.file_id), _today()) for d in docs]


def _store(session: Session, user: User, raw: bytes, request: Request, **kw) -> Document:
    try:
        return store(session, data=raw, filename=unquote(request.headers.get("X-Filename", "file")),
                     content_type=request.headers.get("Content-Type", ""), uploaded_by=user.id, **kw)
    except DocumentError as exc:
        raise APIError(422, exc.code, exc.message) from exc


@router.get("/document-kinds")
def document_kinds() -> dict:
    return KINDS


@router.get("/businesses/{business_id}/documents")
def list_business_documents(business_id: str, user: User = Depends(get_current_user),
                            session: Session = Depends(get_session)) -> dict:
    require_membership(session, user, business_id, "VIEW")
    docs = session.scalars(select(Document).where(Document.business_id == business_id)
                           .order_by(Document.created_at.desc(), Document.id)).all()
    return {"items": _list(session, docs)}


@router.post("/businesses/{business_id}/documents", status_code=201)
async def upload_business_document(
    business_id: str,
    request: Request,
    kind: str = Query(default="OTHER"),
    title: str | None = Query(default=None, max_length=200),
    valid_to: date | None = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    require_membership(session, user, business_id, "FILL")
    raw = await _body(request)
    doc = _store(session, user, raw, request, kind=kind, business_id=business_id, title=title, valid_to=valid_to)
    session.add(AuditLog(actor_id=user.id, action="DOCUMENT_UPLOADED", entity="document", entity_id=doc.id,
                         before=None, after={"kind": kind, "business_id": business_id}))
    session.commit()
    return _list(session, [doc])[0]


@router.get("/documents/{document_id}/file")
def download_document(document_id: str, user: User = Depends(get_current_user),
                      session: Session = Depends(get_session)) -> Response:
    doc = session.get(Document, document_id)
    if doc is None:
        raise APIError(404, "DOCUMENT_NOT_FOUND", "Документ не найден")
    if user.role not in BANK_ROLES:
        require_membership(session, user, doc.business_id, "VIEW")
    elif doc.application_id is None:
        raise APIError(403, "DOCUMENT_ACCESS_DENIED", "Банку видны только документы, приложенные к заявке")
    file = session.get(StoredFile, doc.file_id) if doc.file_id else None
    if file is None:
        raise APIError(404, "FILE_NOT_FOUND", "Файл не найден")
    return Response(content=file.data, media_type=file.content_type,
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(file.filename)}"})


class AttachRequest(BaseModel):
    document_id: str


def _application(session: Session, user: User, application_id: str, permission: str) -> Application:
    application = session.get(Application, application_id)
    if application is None:
        raise APIError(404, "APPLICATION_NOT_FOUND", "Заявка не найдена")
    if user.role in BANK_ROLES and permission == "VIEW":
        return application
    require_membership(session, user, application.business_id, permission)
    return application


def _after_client_documents(session: Session, user: User, application: Application, doc: Document) -> None:
    """Если банк запрашивал документы — заявка возвращается специалисту."""
    session.add(AuditLog(actor_id=user.id, action="APPLICATION_DOCUMENT_ADDED", entity="application",
                         entity_id=application.id, before=None, after={"document_id": doc.id, "kind": doc.kind}))
    if application.status == "INFO_REQUESTED":
        transition_application(session, application, "SCORING", actor_id=user.id, comment="Клиент приложил документы",
                               notify=False)
        transition_application(session, application, "MANUAL_REVIEW", actor_id=None,
                               comment="Документы переданы специалисту")
    notify_bank_message(session, application, f"Клиент приложил документ: {doc.title}",
                        title="Клиент приложил документы", kind="DOCUMENT")


@router.get("/applications/{application_id}/documents")
def list_application_documents(application_id: str, user: User = Depends(get_current_user),
                               session: Session = Depends(get_session)) -> dict:
    _application(session, user, application_id, "VIEW")
    docs = session.scalars(select(Document).where(Document.application_id == application_id)
                           .order_by(Document.created_at, Document.id)).all()
    return {"items": _list(session, docs)}


@router.post("/applications/{application_id}/documents", status_code=201)
async def upload_application_document(
    application_id: str,
    request: Request,
    kind: str = Query(default="OTHER"),
    title: str | None = Query(default=None, max_length=200),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    application = _application(session, user, application_id, "FILL")
    raw = await _body(request)
    doc = _store(session, user, raw, request, kind=kind, business_id=application.business_id, title=title,
                 application_id=application.id, status="UPLOADED")
    _after_client_documents(session, user, application, doc)
    session.commit()
    return {"document": _list(session, [doc])[0], "status": application.status}


@router.post("/applications/{application_id}/documents/attach", status_code=201)
def attach_from_storage(application_id: str, payload: AttachRequest, user: User = Depends(get_current_user),
                        session: Session = Depends(get_session)) -> dict:
    """Приложить к заявке документ из хранилища (без повторной загрузки)."""
    application = _application(session, user, application_id, "FILL")
    source = session.get(Document, payload.document_id)
    if source is None or source.business_id != application.business_id:
        raise APIError(404, "DOCUMENT_NOT_FOUND", "Документ не найден в хранилище")
    if source.valid_to and source.valid_to < _today():
        raise APIError(422, "DOCUMENT_EXPIRED", "Срок действия документа истёк — загрузите новый")
    doc = Document(application_id=application.id, business_id=application.business_id, kind=source.kind,
                   title=source.title, file_id=source.file_id, uploaded_by=user.id, status="UPLOADED",
                   valid_to=source.valid_to)
    session.add(doc)
    session.flush()
    _after_client_documents(session, user, application, doc)
    session.commit()
    return {"document": _list(session, [doc])[0], "status": application.status}
