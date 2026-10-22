"""Public request and response schemas."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    login: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class BusinessSummary(BaseModel):
    id: str
    inn: str
    name: str
    type: str
    membership_kind: str
    permissions: list[str]
    valid_to: date | None


class MeResponse(BaseModel):
    id: str
    full_name: str
    login: str
    role: str
    businesses: list[BusinessSummary]


class PreOfferRequest(BaseModel):
    purpose: str = Field(min_length=1, max_length=30)
    amount_kopecks: int = Field(ge=100)
    term_months: int = Field(ge=1, le=120)
    frequency: Literal["once", "sometimes", "always"] = "once"
    urgency: Literal["days", "week", "month", "planned"] = "month"
    priority: Literal["small_payment", "low_overpayment", "speed"] = "small_payment"
    repayment: Literal["equal", "seasonal"] = "equal"
    assets: list[str] = Field(default_factory=lambda: ["none"])


class AdviceResponse(BaseModel):
    code: str
    text: str
    new_limit_kopecks: int
    new_rate: float | None


class PreOfferResponse(BaseModel):
    id: str
    business_id: str
    outcome: str
    product: str
    requested_amount_kopecks: int
    limit_kopecks: int
    rate: float | None
    payment_kopecks: int | None
    term_months: int
    advice: list[AdviceResponse]
    expires_at: datetime


class ConsentRequest(BaseModel):
    kinds: set[Literal["BKI", "FNS"]] = Field(min_length=1)


class ConsentResponse(BaseModel):
    business_id: str
    kinds: list[str]
    expires_at: datetime


class ApplicationCreateRequest(BaseModel):
    pre_offer_id: str


class SignRequest(BaseModel):
    code: str = Field(pattern=r"^\d{4}$")


class ApplicationResponse(BaseModel):
    id: str
    business_id: str
    pre_offer_id: str
    product: str
    amount_kopecks: int
    term_months: int
    purpose: str
    segment_code: str
    status: str
    version: int
    created_at: datetime


class TimelineItem(BaseModel):
    from_status: str | None
    to_status: str
    comment: str | None
    at: datetime


class ClientDecisionResponse(BaseModel):
    outcome: str
    limit_kopecks: int
    rate: float | None
    explanation: str | None
    advice: list[AdviceResponse]


class ApplicationDetailResponse(ApplicationResponse):
    timeline: list[TimelineItem]
    decision: ClientDecisionResponse | None
