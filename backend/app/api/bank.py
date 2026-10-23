"""Bank queue, assignment, underwriting, and risk approval endpoints."""

from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, exists, func, select
from sqlalchemy.orm import Session

from app.api.bank_schemas import (
    AssignResponse,
    AuditItem,
    AuditPage,
    BankActionResponse,
    BankApplicationDetail,
    BankApplicationItem,
    BankApplicationPage,
    InternalDecision,
    RiskActionRequest,
    RiskActionResponse,
    RiskApprovalItem,
    UnderwriterActionRequest,
)
from app.api.dependencies import get_current_user, get_session
from app.api.errors import APIError
from app.models import Application, Approval, AuditLog, Business, DataSnapshot, Decision, Message, User
from app.services.application_flow import transition_application
from app.states import InvalidTransition

router = APIRouter(prefix="/api/v1/bank")
BANK_ROLES = {"UNDERWRITER", "RISK_MANAGER", "RULES_ADMIN"}
REJECTION_REASONS = {"LOW_CAPACITY", "CREDIT_HISTORY", "DATA_MISMATCH", "OTHER"}


def _require_role(user: User, *roles: str) -> None:
    if user.role not in roles:
        raise APIError(403, "ROLE_DENIED", "Недостаточно прав для кабинета банка")


def _latest_decision(session: Session, application_id: str) -> Decision | None:
    return session.scalar(
        select(Decision)
        .where(Decision.application_id == application_id)
        .order_by(Decision.created_at.desc(), Decision.id.desc())
    )


def _queue_item(session: Session, application: Application) -> BankApplicationItem:
    business = session.get(Business, application.business_id)
    decision = _latest_decision(session, application.id)
    due = session.scalar(
        select(func.min(Message.answer_due_at)).where(
            Message.application_id == application.id,
            Message.author_side == "CLIENT",
            Message.answered_at.is_(None),
        )
    )
    if due is not None and due.tzinfo is None:
        due = due.replace(tzinfo=UTC)
    return BankApplicationItem(
        id=application.id,
        business_name=business.name,
        inn=business.inn,
        amount_kopecks=application.amount_kopecks,
        product=application.product,
        segment_code=application.segment_code,
        status=application.status,
        decision_class=decision.cls if decision else None,
        score=decision.score if decision else None,
        assignee_id=application.assignee_id,
        created_at=application.created_at,
        open_question_due_at=due,
        question_overdue=bool(due and due < datetime.now(UTC)),
    )


def _clone_decision(
    source: Decision,
    *,
    outcome: str,
    actor_id: str,
    explanation: str,
    amount_kopecks: int | None = None,
    rate: float | None = None,
) -> Decision:
    return Decision(
        application_id=source.application_id,
        rules_version=source.rules_version,
        score=source.score,
        cls=source.cls,
        stop_factors=source.stop_factors,
        factors=source.factors,
        limit_kopecks=amount_kopecks if amount_kopecks is not None else source.limit_kopecks,
        binding_constraint=source.binding_constraint,
        rate=Decimal(str(rate)) if rate is not None else source.rate,
        outcome=outcome,
        what_if=source.what_if,
        explanation_text=explanation,
        explanation_source="TEMPLATE",
        decided_by=actor_id,
        created_at=datetime.now(UTC),
    )


@router.get("/applications", response_model=BankApplicationPage)
def list_applications(
    status: str | None = None,
    segment: str | None = None,
    product: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> BankApplicationPage:
    _require_role(user, *BANK_ROLES)
    filters = []
    if status:
        filters.append(Application.status == status)
    if segment:
        filters.append(Application.segment_code == segment)
    if product:
        filters.append(Application.product == product)
    total = session.scalar(select(func.count()).select_from(Application).where(*filters)) or 0
    overdue_question = exists().where(
        Message.application_id == Application.id,
        Message.author_side == "CLIENT",
        Message.answered_at.is_(None),
        Message.answer_due_at < datetime.now(UTC),
    )
    applications = session.scalars(
        select(Application)
        .where(*filters)
        # просроченный вопрос в чате поднимает заявку наверх очереди (ТЗ 5.3)
        .order_by(case((overdue_question, 0), else_=1), Application.created_at.desc(), Application.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return BankApplicationPage(
        items=[_queue_item(session, item) for item in applications],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/applications/{application_id}", response_model=BankApplicationDetail)
def get_bank_application(
    application_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> BankApplicationDetail:
    _require_role(user, *BANK_ROLES)
    application = session.get(Application, application_id)
    if application is None:
        raise APIError(404, "APPLICATION_NOT_FOUND", "Заявка не найдена")
    base = _queue_item(session, application).model_dump()
    assignee = session.get(User, application.assignee_id) if application.assignee_id else None
    snapshots = session.scalars(select(DataSnapshot).where(DataSnapshot.business_id == application.business_id)).all()
    decisions = session.scalars(
        select(Decision)
        .where(Decision.application_id == application.id)
        .order_by(Decision.created_at.desc(), Decision.id.desc())
    ).all()
    return BankApplicationDetail(
        **base,
        purpose=application.purpose,
        term_months=application.term_months,
        assignee_name=assignee.full_name if assignee else None,
        snapshots={item.source: item.payload for item in snapshots},
        decisions=[
            InternalDecision(
                id=item.id,
                rules_version=item.rules_version,
                score=item.score,
                cls=item.cls,
                factors=item.factors,
                stop_factors=item.stop_factors,
                limit_kopecks=item.limit_kopecks,
                binding_constraint=item.binding_constraint,
                rate=float(item.rate) if item.rate is not None else None,
                outcome=item.outcome,
                explanation=item.explanation_text,
            )
            for item in decisions
        ],
    )


@router.post("/applications/{application_id}/assign", response_model=AssignResponse)
def assign_application(
    application_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AssignResponse:
    _require_role(user, "UNDERWRITER")
    application = session.scalar(
        select(Application).where(Application.id == application_id).with_for_update()
    )
    if application is None:
        raise APIError(404, "APPLICATION_NOT_FOUND", "Заявка не найдена")
    if application.status != "MANUAL_REVIEW":
        raise APIError(409, "APPLICATION_NOT_IN_REVIEW", "Заявка не находится на ручной проверке")
    if application.assignee_id not in {None, user.id}:
        assignee = session.get(User, application.assignee_id)
        raise APIError(409, "APPLICATION_ALREADY_ASSIGNED", "Заявка уже назначена", {"assignee": assignee.full_name})
    if application.assignee_id is None:
        application.assignee_id = user.id
        application.version += 1
        session.add(
            AuditLog(
                actor_id=user.id,
                action="APPLICATION_ASSIGNED",
                entity="application",
                entity_id=application.id,
                before={"assignee_id": None},
                after={"assignee_id": user.id},
            )
        )
        session.commit()
    return AssignResponse(application_id=application.id, assignee_id=user.id, assignee_name=user.full_name)


@router.post("/applications/{application_id}/actions", response_model=BankActionResponse)
def underwriter_action(
    application_id: str,
    payload: UnderwriterActionRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> BankActionResponse:
    _require_role(user, "UNDERWRITER")
    application = session.scalar(
        select(Application).where(Application.id == application_id).with_for_update()
    )
    if application is None:
        raise APIError(404, "APPLICATION_NOT_FOUND", "Заявка не найдена")
    if application.status != "MANUAL_REVIEW":
        raise APIError(409, "APPLICATION_NOT_IN_REVIEW", "Заявка не находится на ручной проверке")
    if application.assignee_id != user.id:
        raise APIError(409, "APPLICATION_NOT_ASSIGNED_TO_USER", "Сначала возьмите заявку в работу")
    source = _latest_decision(session, application.id)
    if source is None:
        raise APIError(409, "DECISION_NOT_FOUND", "Расчёт по заявке отсутствует")
    if payload.action == "REJECT" and payload.reason_code not in REJECTION_REASONS:
        raise APIError(422, "REASON_CODE_REQUIRED", "Для отказа выберите код причины")
    if payload.action == "COUNTER_OFFER" and payload.amount_kopecks is None:
        raise APIError(422, "COUNTER_AMOUNT_REQUIRED", "Укажите сумму контрпредложения")

    outcomes = {
        "APPROVE": "APPROVED",
        "COUNTER_OFFER": "COUNTER_OFFER",
        "REQUEST_INFO": "INFO_REQUESTED",
        "REJECT": "REJECTED",
    }
    outcome = outcomes[payload.action]
    proposed_amount = payload.amount_kopecks or application.amount_kopecks
    risk_required = payload.action in {"APPROVE", "COUNTER_OFFER"} and (
        proposed_amount > 500_000_000
        or (payload.action == "APPROVE" and source.cls in {"D", "E"})
        or (payload.action == "APPROVE" and proposed_amount > source.limit_kopecks)
    )
    decision = _clone_decision(
        source,
        outcome=outcome,
        actor_id=user.id,
        explanation=payload.comment,
        amount_kopecks=payload.amount_kopecks,
        rate=payload.rate,
    )
    session.add(decision)
    session.flush()
    approval = Approval(
        decision_id=decision.id,
        approver_id=user.id,
        level="UNDERWRITER",
        result="PENDING_RISK" if risk_required else outcome,
        comment=payload.comment,
        at=datetime.now(UTC),
    )
    session.add(approval)
    session.flush()
    if not risk_required:
        try:
            transition_application(
                session,
                application,
                outcome,
                actor_id=user.id,
                comment=payload.comment,
            )
        except InvalidTransition as exc:
            raise APIError(409, "INVALID_STATUS_TRANSITION", "Недопустимый переход статуса") from exc
    session.add(
        AuditLog(
            actor_id=user.id,
            action=f"UNDERWRITER_{payload.action}",
            entity="application",
            entity_id=application.id,
            before={"status": "MANUAL_REVIEW"},
            after={
                "status": application.status,
                "decision_id": decision.id,
                "risk_required": risk_required,
                "reason_code": payload.reason_code,
            },
        )
    )
    session.commit()
    return BankActionResponse(
        application_id=application.id,
        status=application.status,
        decision_id=decision.id,
        approval_id=approval.id,
        risk_required=risk_required,
    )


@router.get("/approvals", response_model=list[RiskApprovalItem])
def list_risk_approvals(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[RiskApprovalItem]:
    _require_role(user, "RISK_MANAGER")
    approvals = session.scalars(
        select(Approval)
        .where(Approval.level == "UNDERWRITER", Approval.result == "PENDING_RISK")
        .order_by(Approval.at, Approval.id)
    ).all()
    items = []
    for approval in approvals:
        risk_result = session.scalar(
            select(Approval.id).where(Approval.decision_id == approval.decision_id, Approval.level == "RISK")
        )
        if risk_result is not None:
            continue
        decision = session.get(Decision, approval.decision_id)
        application = session.get(Application, decision.application_id)
        business = session.get(Business, application.business_id)
        items.append(
            RiskApprovalItem(
                approval_id=approval.id,
                application_id=application.id,
                business_name=business.name,
                amount_kopecks=decision.limit_kopecks,
                proposed_outcome=decision.outcome,
                underwriter_comment=approval.comment,
                decision_id=decision.id,
            )
        )
    return items


@router.post("/approvals/{approval_id}", response_model=RiskActionResponse)
def decide_risk_approval(
    approval_id: str,
    payload: RiskActionRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> RiskActionResponse:
    _require_role(user, "RISK_MANAGER")
    underwriter_approval = session.scalar(
        select(Approval).where(Approval.id == approval_id).with_for_update()
    )
    if (
        underwriter_approval is None
        or underwriter_approval.level != "UNDERWRITER"
        or underwriter_approval.result != "PENDING_RISK"
    ):
        raise APIError(404, "RISK_APPROVAL_NOT_FOUND", "Согласование не найдено")
    existing = session.scalar(
        select(Approval).where(Approval.decision_id == underwriter_approval.decision_id, Approval.level == "RISK")
    )
    decision = session.get(Decision, underwriter_approval.decision_id)
    application = session.scalar(
        select(Application).where(Application.id == decision.application_id).with_for_update()
    )
    if existing is not None:
        return RiskActionResponse(application_id=application.id, status=application.status, result=existing.result)

    result = "APPROVED" if payload.action == "APPROVE" else "RETURNED"
    session.add(
        Approval(
            decision_id=decision.id,
            approver_id=user.id,
            level="RISK",
            result=result,
            comment=payload.comment,
            at=datetime.now(UTC),
        )
    )
    if payload.action == "APPROVE":
        try:
            transition_application(
                session,
                application,
                decision.outcome,
                actor_id=user.id,
                comment=payload.comment,
            )
        except InvalidTransition as exc:
            raise APIError(409, "INVALID_STATUS_TRANSITION", "Недопустимый переход статуса") from exc
    else:
        application.assignee_id = None
        application.version += 1
    session.add(
        AuditLog(
            actor_id=user.id,
            action=f"RISK_{payload.action}",
            entity="application",
            entity_id=application.id,
            before={"status": "MANUAL_REVIEW"},
            after={"status": application.status, "decision_id": decision.id},
        )
    )
    session.commit()
    return RiskActionResponse(application_id=application.id, status=application.status, result=result)


@router.get("/audit", response_model=AuditPage)
def list_audit(
    action: str | None = None,
    entity_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AuditPage:
    _require_role(user, *BANK_ROLES)
    filters = []
    if action:
        filters.append(AuditLog.action == action)
    if entity_id:
        filters.append(AuditLog.entity_id == entity_id)
    total = session.scalar(select(func.count()).select_from(AuditLog).where(*filters)) or 0
    records = session.scalars(
        select(AuditLog)
        .where(*filters)
        .order_by(AuditLog.at.desc(), AuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    actor_ids = {item.actor_id for item in records if item.actor_id}
    actors = {
        actor.id: actor.full_name
        for actor in session.scalars(select(User).where(User.id.in_(actor_ids))).all()
    } if actor_ids else {}
    return AuditPage(
        items=[
            AuditItem(
                id=item.id,
                actor_id=item.actor_id,
                actor_name=actors.get(item.actor_id),
                action=item.action,
                entity=item.entity,
                entity_id=item.entity_id,
                before=item.before,
                after=item.after,
                at=item.at,
            )
            for item in records
        ],
        total=total,
        page=page,
        page_size=page_size,
    )
