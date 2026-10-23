"""Хранилище документов бизнеса (ТЗ 16.3) и документы по заявке.

Файлы — в таблице `files` (демо); метаданные — в `documents`. Подписанный договор
кладётся в хранилище автоматически.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, date, datetime

from sqlalchemy.orm import Session

from app.models import Application, Contract, Document, StoredFile

KINDS = {
    "CHARTER": "Устав",
    "MCHD": "МЧД",
    "STATEMENT": "Выписка",
    "CONTRACT": "Договор",
    "CERTIFICATE": "Справка",
    "OTHER": "Прочее",
}
MAX_BYTES = 10 * 1024 * 1024
ALLOWED_TYPES = {
    "application/pdf", "image/jpeg", "image/png", "text/plain", "application/octet-stream",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


class DocumentError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def store(
    session: Session,
    *,
    data: bytes,
    filename: str,
    content_type: str,
    kind: str,
    business_id: str,
    uploaded_by: str | None,
    title: str | None = None,
    valid_to: date | None = None,
    application_id: str | None = None,
    status: str = "STORED",
) -> Document:
    if kind not in KINDS:
        raise DocumentError("UNKNOWN_KIND", "Неизвестный тип документа")
    if not data:
        raise DocumentError("EMPTY_FILE", "Файл пустой")
    if len(data) > MAX_BYTES:
        raise DocumentError("FILE_TOO_LARGE", "Файл больше 10 МБ")
    content_type = (content_type or "application/octet-stream").split(";")[0].strip()
    if content_type not in ALLOWED_TYPES:
        raise DocumentError("UNSUPPORTED_TYPE", "Поддерживаются PDF, JPG, PNG, TXT, DOCX и XLSX")
    file = StoredFile(filename=filename[:255] or "file", content_type=content_type, size=len(data),
                      sha256=hashlib.sha256(data).hexdigest(), data=data)
    session.add(file)
    session.flush()
    doc = Document(application_id=application_id, business_id=business_id, kind=kind,
                   title=(title or filename or KINDS[kind])[:200], file_id=file.id, uploaded_by=uploaded_by,
                   status=status, valid_to=valid_to, created_at=datetime.now(UTC))
    session.add(doc)
    session.flush()
    return doc


def describe(doc: Document, file: StoredFile | None, today: date) -> dict:
    return {
        "id": doc.id,
        "kind": doc.kind,
        "kind_title": KINDS.get(doc.kind, doc.kind),
        "title": doc.title,
        "filename": file.filename if file else None,
        "size": file.size if file else None,
        "application_id": doc.application_id,
        "status": doc.status,
        "valid_to": doc.valid_to.isoformat() if doc.valid_to else None,
        "expired": bool(doc.valid_to and doc.valid_to < today),
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
    }


def store_signed_contract(session: Session, application: Application, contract: Contract) -> Document:
    """Подписанный договор с графиком — в хранилище бизнеса автоматически."""
    text = "\n".join([
        "ДОГОВОР (демо, синтетические данные)",
        f"Заявка: {application.id}",
        f"Продукт: {application.product}",
        f"Сумма: {application.amount_kopecks / 100:,.0f} ₽".replace(",", " "),
        f"Срок: {application.term_months} мес.",
        f"Подписан: {contract.signed_at:%d.%m.%Y %H:%M} кодом",
        "",
        "График платежей:",
        json.dumps(contract.schedule, ensure_ascii=False, indent=1, default=str),
    ])
    return store(session, data=text.encode("utf-8"), filename=f"dogovor-{application.id[:8]}.txt",
                 content_type="text/plain", kind="CONTRACT", business_id=application.business_id,
                 uploaded_by=None, title=f"Договор по заявке {application.id[:8]}",
                 application_id=application.id, status="SIGNED")
