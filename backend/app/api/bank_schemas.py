"""Schemas exposed only to authenticated bank employees."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class BankApplicationItem(BaseModel):
    id: str
    business_name: str
    inn: str
    amount_kopecks: int
    product: str
    segment_code: str
    status: str
    decision_class: str | None
    score: int | None
    assignee_id: str | None
    created_at: datetime
    open_question_due_at: datetime | None = None
    question_overdue: bool = False


class BankApplicationPage(BaseModel):
    items: list[BankApplicationItem]
    total: int
    page: int
    page_size: int


class InternalDecision(BaseModel):
    id: str
    rules_version: int
    score: int
    cls: str
    factors: dict
    stop_factors: list
    limit_kopecks: int
    binding_constraint: str | None
    rate: float | None
    outcome: str
    explanation: str | None


class BankApplicationDetail(BankApplicationItem):
    purpose: str
    term_months: int
    assignee_name: str | None
    snapshots: dict[str, dict]
    decisions: list[InternalDecision]


class AssignResponse(BaseModel):
    application_id: str
    assignee_id: str
    assignee_name: str


class UnderwriterActionRequest(BaseModel):
    action: Literal["APPROVE", "COUNTER_OFFER", "REQUEST_INFO", "REJECT"]
    comment: str = Field(min_length=3, max_length=1000)
    reason_code: str | None = Field(default=None, max_length=40)
    amount_kopecks: int | None = Field(default=None, ge=100)
    term_months: int | None = Field(default=None, ge=1, le=120)
    rate: float | None = Field(default=None, ge=0, le=100)


class BankActionResponse(BaseModel):
    application_id: str
    status: str
    decision_id: str
    approval_id: str
    risk_required: bool


class RiskApprovalItem(BaseModel):
    approval_id: str
    application_id: str
    business_name: str
    amount_kopecks: int
    proposed_outcome: str
    underwriter_comment: str
    decision_id: str


class RiskActionRequest(BaseModel):
    action: Literal["APPROVE", "RETURN"]
    comment: str = Field(min_length=3, max_length=1000)


class RiskActionResponse(BaseModel):
    application_id: str
    status: str
    result: str


class AuditItem(BaseModel):
    id: str
    actor_id: str | None
    actor_name: str | None
    action: str
    entity: str
    entity_id: str
    before: dict | None
    after: dict | None
    at: datetime


class AuditPage(BaseModel):
    items: list[AuditItem]
    total: int
    page: int
    page_size: int
