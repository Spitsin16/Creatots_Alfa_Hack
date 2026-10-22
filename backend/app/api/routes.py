"""Client endpoints for login, profile, pre-offers, and draft applications."""

import hmac
import os
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import yaml
from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_session, require_membership
from app.api.errors import APIError
from app.api.schemas import (
    AdviceResponse,
    ApplicationCreateRequest,
    ApplicationDetailResponse,
    ApplicationResponse,
    BusinessSummary,
    ClientDecisionResponse,
    ConsentRequest,
    ConsentResponse,
    LoginRequest,
    MeResponse,
    PreOfferRequest,
    PreOfferResponse,
    SignRequest,
    TimelineItem,
    TokenResponse,
)
from app.models import (
    Application,
    AuditLog,
    Business,
    Consent,
    Contract,
    DataSnapshot,
    Decision,
    Membership,
    Outbox,
    PreOffer,
    Rule,
    Segment,
    StatusHistory,
    User,
)
from app.passwords import verify_password
from app.security import issue_access_token
from app.services.application_flow import transition_application
from app.services.scoring.engine import decide
from app.states import InvalidTransition

router = APIRouter(prefix="/api/v1")


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _application_response(application: Application) -> ApplicationResponse:
    return ApplicationResponse(
        id=application.id,
        business_id=application.business_id,
        pre_offer_id=application.pre_offer_id,
        product=application.product,
        amount_kopecks=application.amount_kopecks,
        term_months=application.term_months,
        purpose=application.purpose,
        segment_code=application.segment_code,
        status=application.status,
        version=application.version,
        created_at=application.created_at,
    )


def _application_for_user(session: Session, user: User, application_id: str) -> tuple[Application, Membership]:
    application = session.get(Application, application_id)
    if application is None:
        raise APIError(404, "APPLICATION_NOT_FOUND", "Заявка не найдена")
    membership = require_membership(session, user, application.business_id, "VIEW")
    return application, membership


@router.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, session: Session = Depends(get_session)) -> TokenResponse:
    user = session.scalar(select(User).where(User.login == payload.login))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise APIError(401, "INVALID_CREDENTIALS", "Неверный логин или пароль")
    token, lifetime = issue_access_token(user.id)
    return TokenResponse(access_token=token, expires_in=lifetime)


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> MeResponse:
    memberships = session.scalars(select(Membership).where(Membership.user_id == user.id)).all()
    businesses = []
    for membership in memberships:
        business = session.get(Business, membership.business_id)
        if business is None:
            continue
        businesses.append(
            BusinessSummary(
                id=business.id,
                inn=business.inn,
                name=business.name,
                type=business.type,
                membership_kind=membership.kind,
                permissions=membership.permissions,
                valid_to=membership.valid_to,
            )
        )
    return MeResponse(
        id=user.id,
        full_name=user.full_name,
        login=user.login,
        role=user.role,
        businesses=businesses,
    )


@router.post("/businesses/{business_id}/consents", response_model=ConsentResponse, status_code=201)
def create_consents(
    business_id: str,
    payload: ConsentRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConsentResponse:
    require_membership(session, user, business_id, "CONSENT")
    expires_at = datetime.now(UTC) + timedelta(days=365)
    for kind in sorted(payload.kinds):
        active = session.scalar(
            select(Consent).where(
                Consent.business_id == business_id,
                Consent.kind == kind,
                Consent.expires_at > datetime.now(UTC),
            )
        )
        if active is None:
            session.add(
                Consent(
                    business_id=business_id,
                    user_id=user.id,
                    kind=kind,
                    expires_at=expires_at,
                )
            )
    session.add(
        AuditLog(
            actor_id=user.id,
            action="CONSENTS_GIVEN",
            entity="business",
            entity_id=business_id,
            before=None,
            after={"kinds": sorted(payload.kinds)},
        )
    )
    session.commit()
    return ConsentResponse(business_id=business_id, kinds=sorted(payload.kinds), expires_at=expires_at)


@router.post("/businesses/{business_id}/pre-offers", response_model=PreOfferResponse, status_code=201)
def create_pre_offer(
    business_id: str,
    payload: PreOfferRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PreOfferResponse:
    require_membership(session, user, business_id, "FILL")
    snapshots = session.scalars(select(DataSnapshot).where(DataSnapshot.business_id == business_id)).all()
    source_data = {snapshot.source.lower(): snapshot.payload for snapshot in snapshots}
    required_sources = {"profile", "alfa", "registry", "fns", "bki"}
    if not required_sources.issubset(source_data):
        raise APIError(409, "DATA_INCOMPLETE", "Для расчёта не хватает данных")

    rule = session.scalar(select(Rule).where(Rule.active.is_(True)).order_by(Rule.version.desc()))
    if rule is None:
        raise APIError(503, "RULES_UNAVAILABLE", "Правила расчёта временно недоступны")
    scenario = {
        "purpose": payload.purpose,
        "amount": payload.amount_kopecks / 100,
        "term_months": payload.term_months,
        "frequency": payload.frequency,
        "urgency": payload.urgency,
        "priority": payload.priority,
        "repayment": payload.repayment,
        "assets": payload.assets,
    }
    fixture = {
        "persona": source_data["profile"],
        "alfa": source_data["alfa"],
        "registry": source_data["registry"],
        "fns": source_data["fns"],
        "bki": source_data["bki"],
    }
    try:
        result = decide(yaml.safe_load(rule.yaml), fixture, scenario=scenario)
    except (KeyError, TypeError, ValueError) as exc:
        raise APIError(422, "UNSUPPORTED_SCENARIO", "Такой сценарий пока не поддерживается") from exc

    advice = [
        AdviceResponse(
            code=item["code"],
            text=item["text"],
            new_limit_kopecks=round(item["new_limit"] * 100),
            new_rate=item.get("new_rate"),
        )
        for item in result.get("advice", [])
    ]
    explanation = {
        "outcome": result["outcome"],
        "advice": [item.model_dump() for item in advice],
        "decision_snapshot": result,
    }
    pre_offer = PreOffer(
        business_id=business_id,
        rules_version=rule.version,
        purpose=payload.purpose,
        amount_kopecks=payload.amount_kopecks,
        term_months=result["term"],
        product=result["product"],
        limit_kopecks=round((result.get("limit") or 0) * 100),
        rate=Decimal(str(result["rate"])) if result.get("rate") is not None else None,
        payment_kopecks=round(result["payment"] * 100) if result.get("payment") is not None else None,
        explanation=explanation,
        expires_at=datetime.now(UTC) + timedelta(days=30),
    )
    session.add(pre_offer)
    session.flush()
    session.add(
        AuditLog(
            actor_id=user.id,
            action="PRE_OFFER_CREATED",
            entity="pre_offer",
            entity_id=pre_offer.id,
            before=None,
            after={"outcome": result["outcome"], "rules_version": rule.version},
        )
    )
    session.commit()
    return PreOfferResponse(
        id=pre_offer.id,
        business_id=pre_offer.business_id,
        outcome=result["outcome"],
        product=pre_offer.product,
        requested_amount_kopecks=pre_offer.amount_kopecks,
        limit_kopecks=pre_offer.limit_kopecks,
        rate=float(pre_offer.rate) if pre_offer.rate is not None else None,
        payment_kopecks=pre_offer.payment_kopecks,
        term_months=pre_offer.term_months,
        advice=advice,
        expires_at=pre_offer.expires_at,
    )


@router.post("/applications", response_model=ApplicationResponse, status_code=201)
def create_application(
    payload: ApplicationCreateRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ApplicationResponse:
    pre_offer = session.get(PreOffer, payload.pre_offer_id)
    if pre_offer is None:
        raise APIError(404, "PRE_OFFER_NOT_FOUND", "Предложение не найдено")
    require_membership(session, user, pre_offer.business_id, "FILL")
    if _utc(pre_offer.expires_at) <= datetime.now(UTC):
        raise APIError(409, "PRE_OFFER_EXPIRED", "Срок предложения истёк")
    if pre_offer.explanation.get("outcome") == "REJECTED" or pre_offer.limit_kopecks <= 0:
        raise APIError(409, "PRE_OFFER_NOT_ELIGIBLE", "По этому предложению нельзя создать заявку")
    segment = session.scalar(
        select(Segment).where(Segment.business_id == pre_offer.business_id).order_by(Segment.detected_at.desc())
    )
    if segment is None:
        raise APIError(409, "SEGMENT_UNAVAILABLE", "Не удалось определить сегмент организации")

    application = Application(
        business_id=pre_offer.business_id,
        pre_offer_id=pre_offer.id,
        created_by=user.id,
        product=pre_offer.product,
        amount_kopecks=min(pre_offer.amount_kopecks, pre_offer.limit_kopecks),
        term_months=pre_offer.term_months,
        purpose=pre_offer.purpose,
        segment_code=segment.code,
        status="DRAFT",
        version=1,
    )
    session.add(application)
    session.flush()
    session.add_all(
        [
            StatusHistory(
                application_id=application.id,
                from_status=None,
                to_status="DRAFT",
                actor_id=user.id,
                comment="Создан черновик заявки",
                at=datetime.now(UTC),
            ),
            AuditLog(
                actor_id=user.id,
                action="APPLICATION_CREATED",
                entity="application",
                entity_id=application.id,
                before=None,
                after={"status": "DRAFT", "version": 1},
            ),
        ]
    )
    session.commit()
    return _application_response(application)


@router.post("/applications/{application_id}/submit", response_model=ApplicationResponse)
def submit_application(
    application_id: str,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ApplicationResponse:
    application = session.get(Application, application_id)
    if application is None:
        raise APIError(404, "APPLICATION_NOT_FOUND", "Заявка не найдена")
    membership = require_membership(session, user, application.business_id, "FILL")
    if application.status not in {"DRAFT", "AWAITING_SIGNATURE"}:
        return _application_response(application)

    if "SUBMIT" not in membership.permissions:
        if application.status == "DRAFT":
            transition_application(
                session,
                application,
                "AWAITING_SIGNATURE",
                actor_id=user.id,
                comment="Ожидается подпись руководителя",
            )
            session.add(
                AuditLog(
                    actor_id=user.id,
                    action="APPLICATION_AWAITS_SIGNATURE",
                    entity="application",
                    entity_id=application.id,
                    before={"status": "DRAFT"},
                    after={"status": "AWAITING_SIGNATURE", "idempotency_key": idempotency_key},
                )
            )
            session.commit()
        return _application_response(application)

    required_consents = {"BKI", "FNS"}
    active_consents = set(
        session.scalars(
            select(Consent.kind).where(
                Consent.business_id == application.business_id,
                Consent.expires_at > datetime.now(UTC),
            )
        ).all()
    )
    missing = sorted(required_consents - active_consents)
    if missing:
        raise APIError(409, "CONSENTS_REQUIRED", "Перед отправкой нужны согласия", {"missing": missing})

    previous = application.status
    try:
        transition_application(
            session,
            application,
            "SUBMITTED",
            actor_id=user.id,
            comment="Заявка отправлена",
        )
    except InvalidTransition as exc:
        raise APIError(409, "INVALID_STATUS_TRANSITION", "Заявку нельзя отправить из текущего статуса") from exc
    session.add_all(
        [
            Outbox(
                event="APPLICATION_SUBMITTED",
                payload={"application_id": application.id, "idempotency_key": idempotency_key},
                status="PENDING",
                attempts=0,
            ),
            AuditLog(
                actor_id=user.id,
                action="APPLICATION_SUBMITTED",
                entity="application",
                entity_id=application.id,
                before={"status": previous},
                after={"status": "SUBMITTED", "idempotency_key": idempotency_key},
            ),
        ]
    )
    session.commit()
    return _application_response(application)


@router.get("/applications/{application_id}", response_model=ApplicationDetailResponse)
def get_application(
    application_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ApplicationDetailResponse:
    application, _ = _application_for_user(session, user, application_id)
    history = session.scalars(
        select(StatusHistory)
        .where(StatusHistory.application_id == application.id)
        .order_by(StatusHistory.at, StatusHistory.id)
    ).all()
    decision = session.scalar(
        select(Decision).where(Decision.application_id == application.id).order_by(Decision.created_at.desc())
    )
    client_decision = None
    if decision is not None:
        client_decision = ClientDecisionResponse(
            outcome=decision.outcome,
            limit_kopecks=decision.limit_kopecks,
            rate=float(decision.rate) if decision.rate is not None else None,
            explanation=decision.explanation_text,
            advice=[
                AdviceResponse(
                    code=item["code"],
                    text=item["text"],
                    new_limit_kopecks=round(item["new_limit"] * 100),
                    new_rate=item.get("new_rate"),
                )
                for item in decision.what_if
            ],
        )
    base = _application_response(application).model_dump()
    return ApplicationDetailResponse(
        **base,
        timeline=[
            TimelineItem(
                from_status=item.from_status,
                to_status=item.to_status,
                comment=item.comment,
                at=item.at,
            )
            for item in history
        ],
        decision=client_decision,
    )


@router.post("/applications/{application_id}/sign", response_model=ApplicationResponse)
def sign_application(
    application_id: str,
    payload: SignRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ApplicationResponse:
    application = session.get(Application, application_id)
    if application is None:
        raise APIError(404, "APPLICATION_NOT_FOUND", "Заявка не найдена")
    require_membership(session, user, application.business_id, "SIGN")
    if application.status in {"CONTRACT_SIGNED", "ISSUED"}:
        return _application_response(application)
    if application.status != "APPROVED":
        raise APIError(409, "INVALID_STATUS_TRANSITION", "Договор пока нельзя подписать")
    if not hmac.compare_digest(payload.code, os.getenv("DEMO_SIGN_CODE", "0000")):
        raise APIError(422, "INVALID_SIGN_CODE", "Неверный код подтверждения")

    decision = session.scalar(
        select(Decision).where(Decision.application_id == application.id).order_by(Decision.created_at.desc())
    )
    schedule = {
        "type": "REVOLVING" if application.product == "OVERDRAFT" else "ANNUITY",
        "amount_kopecks": application.amount_kopecks,
        "term_months": application.term_months,
        "rate": float(decision.rate) if decision and decision.rate is not None else None,
    }
    contract = Contract(
        application_id=application.id,
        signed_by=user.id,
        signed_at=datetime.now(UTC),
        schedule=schedule,
    )
    session.add(contract)
    transition_application(
        session,
        application,
        "CONTRACT_SIGNED",
        actor_id=user.id,
        comment="Договор подписан кодом",
    )
    session.add_all(
        [
            Outbox(
                event="CONTRACT_SIGNED",
                payload={"application_id": application.id, "idempotency_key": idempotency_key},
                status="PENDING",
                attempts=0,
            ),
            AuditLog(
                actor_id=user.id,
                action="CONTRACT_SIGNED",
                entity="application",
                entity_id=application.id,
                before={"status": "APPROVED"},
                after={"status": "CONTRACT_SIGNED", "idempotency_key": idempotency_key},
            ),
        ]
    )
    session.commit()
    return _application_response(application)
