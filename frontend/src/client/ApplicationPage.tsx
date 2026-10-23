import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { Application, productName, request, rubles } from '../api'
import { useSession } from '../auth'
import { Bell } from '../common/Bell'
import { Chat } from '../common/Chat'
import { RequestedDocuments } from '../common/Documents'
import { Processing, Spinner } from '../common/Spinner'
import { statusName } from '../common/status'
import { keys, useApplication } from '../queries'

// Трекер заявки: этапы, кто ведёт, решение, подпись кодом, чат с банком.
export function ApplicationPage() {
  const { id = '' } = useParams()
  const { token, me } = useSession()
  const business = me.businesses[0]
  const client = useQueryClient()
  const app = useApplication(id)
  const [code, setCode] = useState('')
  const refresh = () => {
    void client.invalidateQueries({ queryKey: keys.application(id) })
    void client.invalidateQueries({ queryKey: keys.myApplications(business.id) })
  }
  const action = useMutation({
    mutationFn: ({ path, body, headers }: { path: string; body?: unknown; headers?: Record<string, string>; label: string }) =>
      request<Application>(`/api/v1/applications/${id}/${path}`, { method: 'POST', body: JSON.stringify(body ?? {}), headers }, token),
    onSuccess: refresh,
  })
  if (app.isPending) return <div className="page-loading"><Spinner label="Загружаем заявку…" /></div>
  if (app.error || !app.data) return <div className="page"><div className="empty"><b>Заявка не найдена</b><span>{app.error?.message}</span><Link className="primary as-button" to="/applications">К моим заявкам</Link></div></div>
  const a = app.data
  const canSubmit = business.permissions.includes('SUBMIT')
  const busy = action.isPending
  const timeline = a.timeline ?? []
  return <div className="page"><header><div><Link className="link dark" to="/applications">‹ Мои заявки</Link><h1>Заявка {a.id.slice(0, 8)}</h1><p>{productName(a.product)} · {rubles(a.amount_kopecks)} · {a.term_months} мес.</p></div><Bell /></header>
    {busy && <div className="loading-card"><Spinner label={action.variables?.label} /></div>}
    {action.error && <div className="error">{action.error.message}</div>}
    <section className="tracker"><div className="tracker-grid"><div>
      <div className="section-title"><div><span className="eyebrow">Статус</span><h2>{statusName[a.status] ?? a.status}</h2></div><button className="secondary" onClick={refresh}>Обновить</button></div>
      {['MANUAL_REVIEW', 'INFO_REQUESTED', 'COUNTER_OFFER'].includes(a.status) && <div className="assignee">
        <span className="avatar">{(a.assignee_name ?? '…').replace('Андеррайтер ', '')[0]}</span>
        <div><small>{a.assignee_name ? 'Заявку ведёт специалист' : 'Заявка ждёт специалиста'}</small><b>{a.assignee_name?.replace('Андеррайтер ', '') ?? 'Назначим в течение рабочего дня'}</b></div>
        <button className="secondary" onClick={() => { const el = document.getElementById(`chat-${a.id}`) as HTMLInputElement | null; el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus() }}>Написать специалисту</button>
      </div>}
      <div className="timeline">{(timeline.length ? timeline : [{ to_status: a.status, comment: 'Заявка создана', at: '' }]).map((item, index) => <div className="timeline-row" key={`${item.to_status}-${index}`}><span className="timeline-dot">✓</span><div><b>{statusName[item.to_status] ?? item.to_status}</b><small>{item.comment}</small></div></div>)}</div>
      {a.decision && <div className="decision"><span>{a.status === 'INFO_REQUESTED' ? 'Комментарий специалиста' : 'Решение банка'}</span><b>{a.decision.explanation}</b>
        {a.decision.limit_kopecks > 0 && a.status !== 'INFO_REQUESTED' && <small>{rubles(a.decision.limit_kopecks)}{a.decision.rate ? ` · ${a.decision.rate}%` : ''}</small>}</div>}
      {a.status === 'DRAFT' && (canSubmit
        ? <button className="primary" disabled={busy} onClick={() => action.mutate({ path: 'submit', headers: { 'Idempotency-Key': a.id }, label: 'Отправляем заявку в банк…' })}>{busy ? <Spinner label="Отправляем…" light /> : 'Отправить заявку'}</button>
        : <p className="hint">Заявка подготовлена. Отправить её может руководитель.</p>)}
      {a.status === 'COUNTER_OFFER' && <CounterOffer applicationId={a.id} canDecide={canSubmit} onDone={refresh} />}
      {canSubmit && ['DRAFT', 'AWAITING_SIGNATURE', 'SUBMITTED', 'INFO_REQUESTED'].includes(a.status) &&
        <button className="link dark" disabled={busy} onClick={() => action.mutate({ path: 'cancel', label: 'Отменяем заявку…' })}>Отменить заявку</button>}
      {a.status === 'INFO_REQUESTED' && <RequestedDocuments token={token} applicationId={a.id} businessId={business.id} onDone={refresh} />}
      {a.status === 'APPROVED' && <div className="sign"><input value={code} maxLength={6} onChange={e => setCode(e.target.value)} placeholder="Код из SMS (демо: 0000)" />
        <button className="primary" disabled={busy || code.length < 4} onClick={() => action.mutate({ path: 'sign', body: { code }, label: 'Подписываем договор…' })}>{busy ? <Spinner label="Подписываем…" light /> : 'Подписать договор'}</button></div>}
      {['SUBMITTED', 'VALIDATION', 'ENRICHMENT', 'SCORING', 'CONTRACT_SIGNED'].includes(a.status) && <Processing status={a.status} />}
    </div>
    {a.status !== 'DRAFT' && <Chat token={token} applicationId={a.id} side="CLIENT" />}</div></section>
  </div>
}

type Terms = { product: string; amount_kopecks: number; term_months: number; rate: number | null }

function CounterOffer({ applicationId, canDecide, onDone }: { applicationId: string; canDecide: boolean; onDone: () => void }) {
  const { token } = useSession()
  const terms = useQuery({ queryKey: ['counter-offer', applicationId], queryFn: () => request<Terms>(`/api/v1/applications/${applicationId}/counter-offer`, {}, token) })
  const act = useMutation({
    mutationFn: (what: string) => request(`/api/v1/applications/${applicationId}/counter-offer/${what}`, { method: 'POST', body: '{}' }, token),
    onSuccess: onDone,
  })
  const t = terms.data
  return <div className="callout requested"><b>Банк предлагает другие условия</b>
    {t && <p>{productName(t.product)} на {rubles(t.amount_kopecks)} · {t.term_months} мес.{t.rate ? ` · ${t.rate}%` : ''}</p>}
    {canDecide ? <div className="chips"><button className="primary" disabled={act.isPending} onClick={() => act.mutate('accept')}>Принять</button><button className="secondary" disabled={act.isPending} onClick={() => act.mutate('decline')}>Отказаться</button></div>
      : <p className="muted">Решение принимает руководитель.</p>}
    {(terms.error ?? act.error) && <div className="error">{(terms.error ?? act.error)!.message}</div>}</div>
}
