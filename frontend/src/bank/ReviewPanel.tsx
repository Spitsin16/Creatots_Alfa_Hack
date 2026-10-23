import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { BankItem, DocItem, productName, request, rubles, scoreTone, toneTitle } from '../api'
import { useSession } from '../auth'
import { Spinner } from '../common/Spinner'
import { statusName } from '../common/status'
import { keys } from '../queries'
import { DocList } from '../common/Documents'
import { Chat } from '../common/Chat'

type Detail = BankItem & {
  purpose: string; term_months: number; assignee_name: string | null
  decisions: { id: string; score: number; cls: string; factors: Record<string, number>; stop_factors: string[]; limit_kopecks: number;
    binding_constraint: string | null; rate: number | null; outcome: string; explanation: string | null }[]
}
type RiskItem = { approval_id: string; application_id: string; business_name: string; amount_kopecks: number; proposed_outcome: string; underwriter_comment: string }

const factorName: Record<string, string> = {
  BUSINESS_AGE: 'Срок работы бизнеса', REVENUE_STABILITY: 'Стабильность выручки', DEBT_LOAD: 'Долговая нагрузка',
  CREDIT_HISTORY: 'Кредитная история', ALFA_HISTORY: 'История в Альфе', TAX_DEBT: 'Налоговый долг',
  INDUSTRY_RISK: 'Отраслевой риск', ALFA_SHARE: 'Доля оборотов в Альфе', DATA_QUALITY: 'Полнота данных',
}
const outcomeName: Record<string, string> = { APPROVED: 'одобрено', COUNTER_OFFER: 'контрпредложение', MANUAL_REVIEW: 'ручная проверка', INFO_REQUESTED: 'запрошены документы', REJECTED: 'отказ' }
const bindingName: Record<string, string> = { REVENUE: 'от выручки', CAPACITY: 'по платёжеспособности', REFINANCE_BALANCE: 'остаток долга', PRODUCT_MAX: 'максимум продукта' }
const reasons = [['LOW_CAPACITY', 'Недостаточная платёжеспособность'], ['CREDIT_HISTORY', 'Кредитная история'], ['DATA_MISMATCH', 'Данные не сходятся'], ['OTHER', 'Другое']]

// Карточка андеррайтера: факторы с баллами, ограничение лимита, действия с кодом причины, чат.
export function ReviewPanel({ id }: { id: string }) {
  const { token, me } = useSession()
  const client = useQueryClient()
  const [action, setAction] = useState('APPROVE')
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('LOW_CAPACITY')
  const [amount, setAmount] = useState<number | null>(null)
  const detail = useQuery({ queryKey: keys.bankApplication(id), queryFn: () => request<Detail>(`/api/v1/bank/applications/${id}`, {}, token), refetchInterval: 5000 })
  const docs = useQuery({ queryKey: ['application-documents', id], queryFn: () => request<{ items: DocItem[] }>(`/api/v1/applications/${id}/documents`, {}, token).then(x => x.items).catch(() => []) })
  const changed = () => {
    void client.invalidateQueries({ queryKey: keys.bankApplication(id) })
    void client.invalidateQueries({ queryKey: keys.bankQueue })
    void client.invalidateQueries({ queryKey: keys.approvals })
  }
  const assign = useMutation({ mutationFn: () => request(`/api/v1/bank/applications/${id}/assign`, { method: 'POST' }, token), onSuccess: changed })
  const act = useMutation({
    mutationFn: () => request(`/api/v1/bank/applications/${id}/actions`, { method: 'POST', body: JSON.stringify({
      action, comment, reason_code: action === 'REJECT' ? reason : null,
      amount_kopecks: action === 'COUNTER_OFFER' ? Math.round((amount ?? (d?.amount_kopecks ?? 0) / 100) * 100) : null,
    }) }, token),
    onSuccess: () => { setComment(''); changed() },
  })
  const d = detail.data
  if (detail.isPending) return <aside className="review-card"><Spinner label="Загружаем заявку…" /></aside>
  if (!d) return <aside className="review-card"><div className="error">{detail.error?.message ?? 'Заявка не найдена'}</div></aside>
  const decision = d.decisions[0]
  const mine = d.assignee_id === me.id
  const error = assign.error ?? act.error
  return <aside className="review-card">
    <span className="eyebrow">Заявка {d.id.slice(0, 8)} · {statusName[d.status] ?? d.status}</span><h2>{d.business_name}</h2>
    {decision && <div className={`score tone-${scoreTone(decision.cls, d.status)}`}><span>Скоринговый балл · {toneTitle[scoreTone(decision.cls, d.status)]}</span><b>{decision.score}</b><small>{decision.stop_factors.length ? 'есть стоп-фактор' : outcomeName[decision.outcome] ?? decision.outcome}</small></div>}
    <dl>
      <div><dt>Продукт</dt><dd>{productName(d.product)}</dd></div>
      <div><dt>Сумма заявки</dt><dd>{rubles(d.amount_kopecks)}</dd></div>
      {decision && <div><dt>Макс. лимит по расчёту</dt><dd>{rubles(decision.limit_kopecks)}</dd></div>}
      {decision && <div><dt>Чем ограничен лимит</dt><dd>{bindingName[decision.binding_constraint ?? ''] ?? '—'}</dd></div>}
      {decision?.rate != null && <div><dt>Ставка</dt><dd>{decision.rate}%</dd></div>}
      <div><dt>Исполнитель</dt><dd>{d.assignee_name ?? 'не назначен'}</dd></div>
    </dl>
    {decision && <div className="factor-list">{Object.entries(decision.factors).sort((a, b) => a[1] - b[1]).map(([k, v]) =>
      <div key={k}><span>{factorName[k] ?? k}</span><b className={v > 0 ? 'pos' : v < 0 ? 'neg' : ''}>{v > 0 ? `+${v}` : v}</b></div>)}
      {decision.stop_factors.length > 0 && <div className="callout">Стоп-факторы: {decision.stop_factors.join(', ')}</div>}
      {decision.explanation && <p className="muted">{decision.explanation}</p>}
    </div>}
    {(docs.data?.length ?? 0) > 0 && <><h3>Документы клиента</h3><DocList items={docs.data!} token={token} /></>}
    {error && <div className="error">{error.message}</div>}
    {d.status === 'MANUAL_REVIEW' && me.role === 'UNDERWRITER' && !mine && <button className="primary wide" disabled={assign.isPending} onClick={() => assign.mutate()}>{assign.isPending ? <Spinner label="Назначаем…" light /> : 'Взять в работу'}</button>}
    {d.status === 'MANUAL_REVIEW' && mine && <div className="action-form">
      <div className="chips">{[['APPROVE', 'Одобрить'], ['COUNTER_OFFER', 'Контрпредложение'], ['REQUEST_INFO', 'Запросить документы'], ['REJECT', 'Отказать']].map(([c, l]) =>
        <button key={c} type="button" className={`chip ${action === c ? 'active' : ''}`} onClick={() => setAction(c)}>{l}</button>)}</div>
      {action === 'REJECT' && <select value={reason} onChange={e => setReason(e.target.value)}>{reasons.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>}
      {action === 'COUNTER_OFFER' && <label>Сумма, ₽<input type="number" value={amount ?? d.amount_kopecks / 100} onChange={e => setAmount(Number(e.target.value))} /></label>}
      <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Комментарий (обязательно)" />
      <button className="primary wide" disabled={act.isPending || comment.trim().length < 3} onClick={() => act.mutate()}>{act.isPending ? <Spinner label="Сохраняем…" light /> : 'Сохранить решение'}</button>
    </div>}
    {act.isSuccess && <div className="notice">Решение сохранено</div>}
    {(me.role === 'UNDERWRITER' || me.role === 'RISK_MANAGER') && <Chat token={token} applicationId={d.id} side="BANK" />}
  </aside>
}

// Очередь риск-менеджера: второе одобрение для сумм выше 5 млн и рискованных случаев.
export function RiskQueue() {
  const { token } = useSession()
  const client = useQueryClient()
  const [comments, setComments] = useState<Record<string, string>>({})
  const list = useQuery({ queryKey: keys.approvals, queryFn: () => request<RiskItem[]>('/api/v1/bank/approvals', {}, token), refetchInterval: 5000 })
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => request(`/api/v1/bank/approvals/${id}`, { method: 'POST', body: JSON.stringify({ action, comment: comments[id] ?? '' }) }, token),
    onSuccess: (_, v) => {
      setComments(c => ({ ...c, [v.id]: '' }))
      void client.invalidateQueries({ queryKey: keys.approvals })
      void client.invalidateQueries({ queryKey: keys.bankQueue })
    },
  })
  const items = list.data ?? []
  return <section className="queue risk"><h3>Ждут второго одобрения</h3>
    {list.isPending && <Spinner label="Загружаем…" />}
    {list.error && <div className="error">{list.error.message}</div>}
    {decide.error && <div className="error">{decide.error.message}</div>}
    {decide.isSuccess && <div className="notice">{decide.variables?.action === 'APPROVE' ? 'Одобрено риск-менеджером' : 'Возвращено андеррайтеру'}</div>}
    {list.data && items.length === 0 && <div className="empty"><b>Согласований нет</b><span>Здесь появятся решения андеррайтеров свыше 5 млн ₽ и одобрения вопреки скорингу.</span></div>}
    {items.map(i => { const comment = comments[i.approval_id] ?? ''; return <div key={i.approval_id} className="risk-row">
      <div><Link to={`/bank/applications/${i.application_id}`}><b>{i.business_name}</b></Link><small>{rubles(i.amount_kopecks)} · {outcomeName[i.proposed_outcome] ?? i.proposed_outcome} · «{i.underwriter_comment}»</small></div>
      <input placeholder="Комментарий" value={comment} onChange={e => setComments(c => ({ ...c, [i.approval_id]: e.target.value }))} />
      <button className="primary" disabled={decide.isPending || comment.trim().length < 3} onClick={() => decide.mutate({ id: i.approval_id, action: 'APPROVE' })}>Одобрить</button>
      <button className="secondary" disabled={decide.isPending || comment.trim().length < 3} onClick={() => decide.mutate({ id: i.approval_id, action: 'RETURN' })}>Вернуть</button>
    </div> })}</section>
}
