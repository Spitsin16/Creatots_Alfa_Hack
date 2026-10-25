import { ReactNode, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AmountInput } from '@alfalab/core-components/amount-input/esm'
import { Button } from '@alfalab/core-components/button/esm'
import { Plate } from '@alfalab/core-components/plate/esm'
import { Radio } from '@alfalab/core-components/radio/esm'
import { RadioGroup } from '@alfalab/core-components/radio-group/esm'
import { Select } from '@alfalab/core-components/select/esm'
import { Textarea } from '@alfalab/core-components/textarea/esm'
import { CheckmarkCircleMIcon } from '@alfalab/icons-glyph/CheckmarkCircleMIcon'
import { ShieldMIcon } from '@alfalab/icons-glyph/ShieldMIcon'
import { request } from '../../api'
import { useSession } from '../../auth'
import { keys } from '../../queries'
import { Card, formatMoney, KeyValue, StatusTag } from '../../ui'
import { BankDetail, InternalDecision, RiskItem, scoringDecision, useRiskApprovals, Workflow } from './data'
import { RiskDecision, RiskResult } from './RiskDecision'
import {
  bankStatusHint, bankStatusName, formatDateTime, outcomeName, pendingRiskReasons, percent, rejectReasonName, rejectReasons, RISK_THRESHOLD_KOPECKS, riskReasons, shortStaffName,
} from './text'
import styles from './DecisionPanel.module.css'

type Action = 'APPROVE' | 'COUNTER_OFFER' | 'REQUEST_INFO' | 'REJECT'
type ActionResponse = { application_id: string; status: string; decision_id: string; approval_id: string; risk_required: boolean }
/**
 * Сообщение о результате действия. Живёт, пока заявка в том статусе, который вернул бэк (status);
 * «отправлено риск-менеджеру» — ещё и пока у заявки прежний исполнитель (вернул риск-менеджер — исполнителя снимают).
 * Иначе плашка висела бы до закрытия, хотя статус давно сменился (заявку подтвердил риск-менеджер, клиент подписал…).
 */
type Notice = { tone: 'positive' | 'attention'; title: string; text: string; status: string; riskPending?: boolean }

const actions: { value: Action; label: string; hint: string; button: string }[] = [
  { value: 'APPROVE', label: 'Одобрить', hint: 'на сумму заявки', button: 'Одобрить заявку' },
  { value: 'COUNTER_OFFER', label: 'Контрпредложение', hint: 'другая сумма', button: 'Отправить контрпредложение' },
  { value: 'REQUEST_INFO', label: 'Запросить документы', hint: 'клиент дозагрузит в заявке', button: 'Запросить документы' },
  { value: 'REJECT', label: 'Отказать', hint: 'с кодом причины', button: 'Отказать' },
]

/** Правая панель карточки: исполнитель, «Взять в работу», решение андеррайтера, второе одобрение риск-менеджера. */
export function DecisionPanel({ detail, workflow }: { detail: BankDetail; workflow: Workflow | null }) {
  const { token, me } = useSession()
  const client = useQueryClient()
  const [notice, setNotice] = useState<Notice | null>(null)
  const isUnderwriter = me.role === 'UNDERWRITER'
  const isRisk = me.role === 'RISK_MANAGER'
  const approvals = useRiskApprovals(isRisk)
  const approval = approvals.data?.find(a => a.application_id === detail.id)
  const scoring = scoringDecision(detail.decisions)
  const manual = detail.status === 'MANUAL_REVIEW'
  const mine = !!detail.assignee_id && detail.assignee_id === me.id
  const pendingRisk = manual && (!!approval || !!workflow?.pendingRisk)
  // Обновляем карточку (вместе с историей), очередь и согласования; промис — когда свежие данные пришли.
  const changed = () => Promise.all([
    client.invalidateQueries({ queryKey: keys.bankApplication(detail.id) }),
    client.invalidateQueries({ queryKey: keys.bankQueue }),
    client.invalidateQueries({ queryKey: keys.approvals }),
  ])
  const [noticeAssignee, setNoticeAssignee] = useState<string | null>(null)
  const shownNotice = notice && notice.status === detail.status && (!notice.riskPending || detail.assignee_id === noticeAssignee) ? notice : null
  const assign = useMutation({
    mutationFn: () => request(`/api/v1/bank/applications/${detail.id}/assign`, { method: 'POST' }, token),
    onSuccess: () => { setNotice(null); void changed() },
  })
  const underwriterDecision = decisionById(detail.decisions, workflow?.lastUnderwriter?.after?.decision_id)

  let body: ReactNode
  if (!manual) {
    body = <Settled detail={detail} workflow={workflow} decision={underwriterDecision} />
  } else if (pendingRisk) {
    body = <>
      <PendingRisk detail={detail} approval={approval} decision={underwriterDecision} workflow={workflow} />
      {isRisk && approval && <RiskDecision approval={approval} accent onDone={r => { void changed().then(() => setNotice(riskNotice(r))) }} />}
      {isRisk && !approval && approvals.isPending && <p className={styles.muted}>Загружаем согласование…</p>}
    </>
  } else if (!detail.assignee_id) {
    body = isUnderwriter
      ? <div className={styles.take}>
        <p className={styles.text}>Заявка ждёт специалиста. Возьмите её в работу — после этого станут доступны решения.</p>
        <Button view="accent" size={48} block loading={assign.isPending} onClick={() => assign.mutate()}>Взять в работу</Button>
        {assign.error && <Plate view="negative" title="Не получилось взять в работу">{assign.error.message}</Plate>}
      </div>
      : <p className={styles.text}>Заявка ждёт андеррайтера: решение примет тот, кто возьмёт её в работу.</p>
  } else if (!mine) {
    body = <p className={styles.text}>Заявку ведёт <b>{shortStaffName(detail.assignee_name) || 'другой специалист'}</b>. Решение может принять только исполнитель.</p>
  } else {
    // плашку показываем, когда карточка уже обновилась: иначе она мигнёт, пока статус в кэше старый
    body = <ActionForm detail={detail} scoring={scoring} onDone={async n => {
      await changed()
      setNoticeAssignee(detail.assignee_id)
      setNotice(n)
    }} />
  }

  return <Card title="Решение по заявке" as="aside" className={styles.panel} id="decision-panel">
    <KeyValue items={[
      { label: 'Статус', value: <StatusTag status={detail.status} size={24}>{bankStatusName[detail.status] ?? detail.status}</StatusTag> },
      { label: 'Исполнитель', value: detail.assignee_id ? (mine ? 'Вы' : shortStaffName(detail.assignee_name) || 'назначен') : <span className={styles.muted}>не назначен</span> },
    ]} className={styles.kv} />

    {manual && detail.amount_kopecks > RISK_THRESHOLD_KOPECKS && !pendingRisk && !mine && <div className={styles.riskBadge}>
      <ShieldMIcon className={styles.riskIcon} aria-hidden />
      <span>Сумма больше 5 млн ₽ — одобрение потребует второго одобрения риск-менеджера</span>
    </div>}

    {shownNotice && <Plate view={shownNotice.tone} title={shownNotice.title} leftAddons={<CheckmarkCircleMIcon className={styles.plateIcon} />} hasCloser onClose={() => setNotice(null)} className={styles.notice}>
      {shownNotice.text}
    </Plate>}

    {manual && workflow?.returned && !detail.assignee_id && !shownNotice && <Plate view="attention" title="Риск-менеджер вернул решение" className={styles.notice}>
      {workflow.returned.actor_name ?? 'Риск-менеджер'} · {formatDateTime(workflow.returned.at)}. Возьмите заявку в работу и примите решение заново.
    </Plate>}

    <div className={styles.body}>{body}</div>
  </Card>
}

function decisionById(decisions: InternalDecision[], id: unknown) {
  return typeof id === 'string' ? decisions.find(d => d.id === id) : undefined
}

const riskNotice = (r: RiskResult): Notice => r.action === 'APPROVE'
  ? { tone: 'positive', title: 'Решение подтверждено', text: `Статус заявки: ${(bankStatusName[r.status] ?? r.status).toLowerCase()}. Клиент получил уведомление.`, status: r.status }
  : { tone: 'attention', title: 'Решение возвращено андеррайтеру', text: 'Заявка снова в очереди на ручной проверке без исполнителя.', status: r.status }

/** Форма решения андеррайтера: исход, сумма / причина, обязательный комментарий. */
function ActionForm({ detail, scoring, onDone }: { detail: BankDetail; scoring: InternalDecision | undefined; onDone: (n: Notice) => Promise<void> }) {
  const { token } = useSession()
  const limit = scoring?.limit_kopecks ?? 0
  const [action, setAction] = useState<Action>('APPROVE')
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState<string | null>(null)
  const [amount, setAmount] = useState<number | null>(limit > 0 && limit < detail.amount_kopecks ? limit : detail.amount_kopecks)
  const [tried, setTried] = useState(false)
  const current = actions.find(a => a.value === action)!
  const proposed = action === 'COUNTER_OFFER' ? amount ?? 0 : detail.amount_kopecks
  const risk = riskReasons(action, proposed, scoring?.cls, scoring?.limit_kopecks)
  const errors = {
    comment: comment.trim().length < 3 ? 'Напишите комментарий — не короче 3 символов' : '',
    reason: action === 'REJECT' && !reason ? 'Выберите причину отказа' : '',
    amount: action === 'COUNTER_OFFER' && (!amount || amount < 100) ? 'Укажите сумму контрпредложения' : '',
  }
  const act = useMutation({
    mutationFn: () => request<ActionResponse>(`/api/v1/bank/applications/${detail.id}/actions`, {
      method: 'POST',
      body: JSON.stringify({
        action,
        comment: comment.trim(),
        reason_code: action === 'REJECT' ? reason : null,
        amount_kopecks: action === 'COUNTER_OFFER' ? amount : null,
      }),
    }, token),
    onSuccess: r => onDone(successNotice(action, r, amount)),
  })
  const submit = () => {
    setTried(true)
    if (errors.comment || errors.reason || errors.amount) return
    act.mutate()
  }
  return <div className={styles.form}>
    <RadioGroup label="Решение" value={action} onChange={(_, { value }) => { setAction(value as Action); setTried(false); act.reset() }} className={styles.radios} name={`action-${detail.id}`}>
      {actions.map(a => <Radio key={a.value} value={a.value} label={a.label} hint={a.hint} size={24} />)}
    </RadioGroup>

    {action === 'APPROVE' && <p className={styles.text}>
      Одобряем {formatMoney({ kopecks: detail.amount_kopecks })} на {detail.term_months} мес.{scoring?.rate != null ? ` по ставке ${percent(scoring.rate)} годовых` : ''}.
    </p>}

    {action === 'COUNTER_OFFER' && <AmountInput
      label="Сумма контрпредложения"
      labelView="outer"
      value={amount}
      onChange={(_, { value }) => setAmount(value)}
      currency="RUB"
      integersOnly
      block
      size={48}
      error={tried && errors.amount ? errors.amount : undefined}
      hint={limit > 0 ? `Расчётный лимит — ${formatMoney({ kopecks: limit })}, клиент просил ${formatMoney({ kopecks: detail.amount_kopecks })}` : undefined}
    />}

    {action === 'REQUEST_INFO' && <p className={styles.text}>Клиент получит уведомление и приложит документы в заявке — тогда она снова пройдёт расчёт и вернётся в очередь. Перечислите в комментарии, что нужно.</p>}

    {action === 'REJECT' && <Select
      label="Код причины отказа"
      labelView="outer"
      placeholder="Выберите причину"
      options={rejectReasons.map(([key, content]) => ({ key, content }))}
      selected={reason}
      onChange={({ selected }) => setReason(selected?.key ?? null)}
      error={tried && errors.reason ? errors.reason : undefined}
      hint="Обязательно: причина уходит в журнал аудита и отчётность"
      block
      size={48}
      optionsListWidth="field"
    />}

    <Textarea
      label="Комментарий"
      labelView="outer"
      placeholder={action === 'REQUEST_INFO' ? 'Например: выписка из другого банка за 6 месяцев' : 'Чем обосновано решение'}
      value={comment}
      onChange={(_, { value }) => setComment(value)}
      error={tried && errors.comment ? errors.comment : undefined}
      hint="Обязательно. Клиент увидит этот текст в решении по заявке."
      minRows={3}
      maxLength={1000}
      showCounter
      autosize
      block
      size={48}
    />

    {risk.length > 0 && <div className={styles.riskBadge}>
      <ShieldMIcon className={styles.riskIcon} aria-hidden />
      <span><b>Нужно второе одобрение риск-менеджера:</b> {risk.join(', ')}. До его решения статус заявки не изменится.</span>
    </div>}

    {act.error && <Plate view="negative" title="Решение не сохранено">{act.error.message}</Plate>}

    <Button view="accent" size={48} block loading={act.isPending} onClick={submit}>
      {risk.length > 0 && (action === 'APPROVE' || action === 'COUNTER_OFFER') ? 'Отправить на согласование' : current.button}
    </Button>
  </div>
}

function successNotice(action: Action, r: ActionResponse, amount: number | null): Notice {
  const status = r.status
  if (r.risk_required) return { tone: 'attention', title: 'Отправлено риск-менеджеру', text: 'Решение вступит в силу после второго одобрения. Заявка останется на ручной проверке.', status, riskPending: true }
  switch (action) {
    case 'APPROVE': return { tone: 'positive', title: 'Заявка одобрена', text: 'Клиент получил уведомление в кабинете.', status }
    case 'COUNTER_OFFER': return { tone: 'positive', title: 'Контрпредложение отправлено', text: `Клиенту предложено ${formatMoney({ kopecks: amount ?? 0 })}. Ждём его ответа.`, status }
    case 'REQUEST_INFO': return { tone: 'positive', title: 'Документы запрошены', text: 'Клиент получил уведомление в кабинете.', status }
    default: return { tone: 'positive', title: 'Отказ оформлен', text: 'Код причины и комментарий записаны в журнал, клиент получил уведомление.', status }
  }
}

/** Решение андеррайтера ждёт риск-менеджера. */
function PendingRisk({ detail, approval, decision, workflow }: { detail: BankDetail; approval: RiskItem | undefined; decision: InternalDecision | undefined; workflow: Workflow | null }) {
  const outcome = approval?.proposed_outcome ?? decision?.outcome
  // У одобрения сумма — сумма заявки; у контрпредложения — сумма из решения.
  const amount = outcome === 'COUNTER_OFFER' ? approval?.amount_kopecks ?? decision?.limit_kopecks : detail.amount_kopecks
  const comment = approval?.underwriter_comment ?? decision?.explanation
  const who = workflow?.lastUnderwriter
  // та же проверка, что в списке согласований и в форме андеррайтера
  const reasons = pendingRiskReasons(outcome, amount, scoringDecision(detail.decisions))
  return <div className={styles.pending}>
    <div className={styles.pendingHead}>
      <ShieldMIcon className={styles.riskIcon} aria-hidden />
      <b>Ждёт второго одобрения риск-менеджера</b>
    </div>
    {reasons.length > 0 && <p className={styles.pendingReason}>Почему нужно: {reasons.join(', ')}</p>}
    <KeyValue items={[
      outcome ? { label: 'Предложено', value: outcomeName[outcome] ?? outcome } : null,
      amount != null ? { label: 'Сумма', value: formatMoney({ kopecks: amount }) } : null,
      who ? { label: 'Андеррайтер', value: shortStaffName(who.actor_name) || '—', hint: formatDateTime(who.at) } : null,
    ]} className={styles.kv} />
    {comment && <blockquote className={styles.quote}>{comment}</blockquote>}
  </div>
}

/** Заявка не на ручной проверке: что с ней происходит и какое решение принято. */
function Settled({ detail, workflow, decision }: { detail: BankDetail; workflow: Workflow | null; decision: InternalDecision | undefined }) {
  const uw = workflow?.lastUnderwriter
  const risk = workflow?.lastRisk
  const reason = typeof uw?.after?.reason_code === 'string' ? rejectReasonName[uw.after.reason_code] ?? uw.after.reason_code : null
  return <div className={styles.settled}>
    <p className={styles.text}>{bankStatusHint[detail.status] ?? 'Заявка не требует действий специалиста.'}</p>
    {uw && decision && <div className={styles.pending}>
      <div className={styles.pendingHead}><b>Решение специалиста: {(outcomeName[decision.outcome] ?? decision.outcome).toLowerCase()}</b></div>
      <KeyValue items={[
        decision.outcome === 'COUNTER_OFFER' ? { label: 'Сумма', value: formatMoney({ kopecks: decision.limit_kopecks }) } : null,
        reason ? { label: 'Причина отказа', value: reason } : null,
        { label: 'Андеррайтер', value: shortStaffName(uw.actor_name) || '—', hint: formatDateTime(uw.at) },
        risk?.action === 'RISK_APPROVE' ? { label: 'Подтвердил', value: shortStaffName(risk.actor_name) || 'риск-менеджер', hint: formatDateTime(risk.at) } : null,
      ]} className={styles.kv} />
      {decision.explanation && <blockquote className={styles.quote}>{decision.explanation}</blockquote>}
    </div>}
  </div>
}
