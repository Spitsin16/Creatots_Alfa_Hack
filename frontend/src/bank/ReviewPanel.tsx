import { useEffect, useState } from 'react'
import { BankItem, DocItem, Me, productName, request, rubles } from '../api'
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
const bindingName: Record<string, string> = { REVENUE: 'от выручки', CAPACITY: 'по платёжеспособности', REFINANCE_BALANCE: 'остаток долга', PRODUCT_MAX: 'максимум продукта' }
const reasons = [['LOW_CAPACITY', 'Недостаточная платёжеспособность'], ['CREDIT_HISTORY', 'Кредитная история'], ['DATA_MISMATCH', 'Данные не сходятся'], ['OTHER', 'Другое']]

// Карточка андеррайтера: факторы с баллами, ограничение лимита, действия с кодом причины, чат.
export function ReviewPanel({ token, me, item, onChanged }: { token: string; me: Me; item: BankItem; onChanged: (msg: string) => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [action, setAction] = useState('APPROVE')
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('LOW_CAPACITY')
  const [amount, setAmount] = useState(0)
  const [error, setError] = useState('')
  const [docs, setDocs] = useState<DocItem[]>([])
  const load = () => {
    request<Detail>(`/api/v1/bank/applications/${item.id}`, {}, token).then(x => { setD(x); setAmount(x.amount_kopecks / 100) }).catch(e => setError(e.message))
    request<{ items: DocItem[] }>(`/api/v1/applications/${item.id}/documents`, {}, token).then(x => setDocs(x.items)).catch(() => setDocs([]))
  }
  useEffect(() => { setD(null); setError(''); void load() }, [item.id])
  const run = async (fn: () => Promise<unknown>, ok: string) => { setError(''); try { await fn(); onChanged(ok); void load() } catch (e) { setError((e as Error).message) } }
  const assign = () => run(() => request(`/api/v1/bank/applications/${item.id}/assign`, { method: 'POST' }, token), 'Заявка назначена вам')
  const act = () => run(() => request(`/api/v1/bank/applications/${item.id}/actions`, { method: 'POST', body: JSON.stringify({
    action, comment, reason_code: action === 'REJECT' ? reason : null, amount_kopecks: action === 'COUNTER_OFFER' ? Math.round(amount * 100) : null,
  }) }, token), 'Решение сохранено')
  const decision = d?.decisions[0]
  const mine = d?.assignee_id === me.id
  return <aside className="review-card">
    <span className="eyebrow">Заявка {item.id.slice(0, 8)}</span><h2>{item.business_name}</h2>
    {decision && <div className="score"><span>Класс риска · {decision.outcome}</span><b>{decision.cls}</b><small>{decision.score} баллов</small></div>}
    <dl>
      <div><dt>Продукт</dt><dd>{productName(item.product)}</dd></div>
      <div><dt>Сумма</dt><dd>{rubles(item.amount_kopecks)}</dd></div>
      {decision && <div><dt>Лимит расчёта</dt><dd>{rubles(decision.limit_kopecks)} · {bindingName[decision.binding_constraint ?? ''] ?? '—'}</dd></div>}
      <div><dt>Сегмент</dt><dd>{item.segment_code}</dd></div>
      <div><dt>Исполнитель</dt><dd>{d?.assignee_name ?? 'не назначен'}</dd></div>
    </dl>
    {decision && <div className="factor-list">{Object.entries(decision.factors).sort((a, b) => a[1] - b[1]).map(([k, v]) =>
      <div key={k}><span>{factorName[k] ?? k}</span><b className={v > 0 ? 'pos' : v < 0 ? 'neg' : ''}>{v > 0 ? `+${v}` : v}</b></div>)}
      {decision.stop_factors.length > 0 && <div className="callout">Стоп-факторы: {decision.stop_factors.join(', ')}</div>}
      {decision.explanation && <p className="muted">{decision.explanation}</p>}
    </div>}
    {docs.length > 0 && <><h3>Документы клиента</h3><DocList items={docs} token={token} /></>}
    {error && <div className="error">{error}</div>}
    {item.status === 'MANUAL_REVIEW' && me.role === 'UNDERWRITER' && !mine && <button className="primary wide" onClick={assign}>Взять в работу</button>}
    {item.status === 'MANUAL_REVIEW' && mine && <div className="action-form">
      <div className="chips">{[['APPROVE', 'Одобрить'], ['COUNTER_OFFER', 'Контрпредложение'], ['REQUEST_INFO', 'Запросить документы'], ['REJECT', 'Отказать']].map(([c, l]) =>
        <button key={c} type="button" className={`chip ${action === c ? 'active' : ''}`} onClick={() => setAction(c)}>{l}</button>)}</div>
      {action === 'REJECT' && <select value={reason} onChange={e => setReason(e.target.value)}>{reasons.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>}
      {action === 'COUNTER_OFFER' && <label>Сумма, ₽<input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} /></label>}
      <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Комментарий (обязательно)" />
      <button className="primary wide" disabled={comment.trim().length < 3} onClick={act}>Сохранить решение</button>
    </div>}
    {(me.role === 'UNDERWRITER' || me.role === 'RISK_MANAGER') && <Chat token={token} applicationId={item.id} side="BANK" />}
  </aside>
}

// Очередь риск-менеджера: второе одобрение для сумм выше 5 млн и рискованных случаев.
export function RiskQueue({ token, onChanged }: { token: string; onChanged: (msg: string) => void }) {
  const [items, setItems] = useState<RiskItem[]>([])
  const [comment, setComment] = useState('')
  const load = () => request<RiskItem[]>('/api/v1/bank/approvals', {}, token).then(setItems).catch(() => setItems([]))
  useEffect(() => { void load() }, [])
  const decide = async (id: string, action: string) => {
    try { await request(`/api/v1/bank/approvals/${id}`, { method: 'POST', body: JSON.stringify({ action, comment }) }, token); onChanged(action === 'APPROVE' ? 'Одобрено риск-менеджером' : 'Возвращено андеррайтеру'); void load() }
    catch (e) { onChanged((e as Error).message) }
  }
  if (items.length === 0) return null
  return <section className="queue risk"><h3>Ждут второго одобрения</h3>{items.map(i => <div key={i.approval_id} className="risk-row">
    <div><b>{i.business_name}</b><small>{rubles(i.amount_kopecks)} · {i.proposed_outcome} · «{i.underwriter_comment}»</small></div>
    <input placeholder="Комментарий" value={comment} onChange={e => setComment(e.target.value)} />
    <button className="primary" disabled={comment.trim().length < 3} onClick={() => decide(i.approval_id, 'APPROVE')}>Одобрить</button>
    <button className="secondary" disabled={comment.trim().length < 3} onClick={() => decide(i.approval_id, 'RETURN')}>Вернуть</button>
  </div>)}</section>
}
