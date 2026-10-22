import { ChangeEvent, useEffect, useState } from 'react'
import { Explanation, Offer, SeasonalSchedule, productName, request, rub, rubles } from '../api'

// Предложение: сумма, «почему такая сумма», факторы словами, «как получить больше»,
// загрузка выписки 1С из другого банка (пересчёт) и сезонный график.
export function OfferPanel({ token, offer, onOffer, onContinue, canContinue, repayment }: {
  token: string; offer: Offer; onOffer: (o: Offer) => void; onContinue: () => void; canContinue: boolean; repayment: string
}) {
  const [ex, setEx] = useState<Explanation | null>(null)
  const [schedule, setSchedule] = useState<SeasonalSchedule | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setEx(null); setSchedule(null)
    const fetchEx = () => request<Explanation>(`/api/v1/pre-offers/${offer.id}/explanation`, {}, token).then(setEx).catch(() => undefined)
    void fetchEx()
    const later = setTimeout(fetchEx, 8000)  // текст от LLM (если включена) приходит асинхронно
    if (repayment === 'seasonal') {
      request<SeasonalSchedule>(`/api/v1/pre-offers/${offer.id}/seasonal-schedule`, {}, token).then(setSchedule).catch(() => setSchedule(null))
    }
    return () => clearTimeout(later)
  }, [offer.id, repayment, token])

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setNote('')
    try {
      const res = await request<{ previous_limit_kopecks: number; pre_offer: Offer; statement: { full_months: number } }>(
        `/api/v1/pre-offers/${offer.id}/statement`,
        { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } }, token)
      setNote(`Выписка учтена (${res.statement.full_months} мес.): сумма ${rubles(res.previous_limit_kopecks)} → ${rubles(res.pre_offer.limit_kopecks)}`)
      onOffer(res.pre_offer)
    } catch (err) { setNote((err as Error).message) } finally { setBusy(false); e.target.value = '' }
  }

  const rejected = offer.outcome === 'REJECTED'
  return <section className="offer-card">
    <div>
      <span className="eyebrow">{rejected ? 'Решение' : offer.outcome === 'MANUAL_REVIEW' ? 'Предварительно, решит специалист' : 'Предварительно одобрено'}</span>
      <h2>{rejected || offer.outcome === 'COUNTER_OFFER' ? (ex?.headline ?? productName(offer.product)) : productName(offer.product)}</h2>
      {!rejected && <><strong className="money">{rubles(offer.limit_kopecks)}</strong>
        <p>{productName(offer.product)} · до {offer.term_months} мес. · ставка {offer.rate}% годовых
          {offer.payment_kopecks ? ` · платёж ${rubles(offer.payment_kopecks)}/мес.` : ''}</p>
        <p className="muted">Вы запросили {rubles(offer.requested_amount_kopecks)}{offer.requested_amount_kopecks <= offer.limit_kopecks ? ' — укладываемся' : ''}</p></>}
      {ex?.reason && <div className="callout">{ex.reason}</div>}
      {ex?.counter && <div className="callout">{ex.counter}</div>}
      {ex?.summary && <div className="summary"><p>{ex.summary}</p><small>Сформулировано ИИ по данным расчёта, цифры сверены</small></div>}
      {ex?.why_amount && <><h3>Почему такая сумма</h3><p>{ex.why_amount}</p></>}
      {ex && (ex.strengths.length > 0 || ex.weaknesses.length > 0) && <ul className="factors">
        {ex.strengths.map(s => <li key={s} className="plus">{s}</li>)}
        {ex.weaknesses.map(s => <li key={s} className="minus">{s}</li>)}
      </ul>}
      {schedule && <SeasonalTable s={schedule} />}
    </div>
    <div className="offer-side">
      <h3>{rejected ? 'Что поможет в следующий раз' : 'Как получить больше'}</h3>
      {ex && ex.advice.length === 0 && <p className="muted">{rejected ? 'Устраните причину выше — и подайте заявку снова, данные уже есть в банке.' : 'Это лучшее предложение на ваших данных.'}</p>}
      {(ex?.advice ?? []).map(a => <div className="advice" key={a.code}><span>↗</span><div><b>{a.text}</b>
        {a.costs && <small>{a.costs}</small>}
        {a.code === 'UPLOAD_STATEMENT' && <label className="upload secondary">{busy ? 'Загружаем…' : 'Загрузить выписку 1С'}
          <input type="file" accept=".txt" onChange={upload} disabled={busy} hidden /></label>}
      </div></div>)}
      {note && <div className="notice">{note}</div>}
      {canContinue && !rejected && <button className="primary wide" onClick={onContinue}>Оформить заявку</button>}
    </div>
  </section>
}

function SeasonalTable({ s }: { s: SeasonalSchedule }) {
  const year = s.schedule.slice(0, 12)
  const max = Math.max(...year.map(r => r.payment))
  return <div className="seasonal">
    <h3>Сезонный график: больше в сезон, меньше в межсезонье</h3>
    <p className="muted">Обычный платёж {rub(s.annuity_payment)}; по сезонному — от {rub(s.min_payment)} до {rub(s.max_payment)}.
      Переплата {rub(s.overpayment)} вместо {rub(s.annuity_overpayment)}.</p>
    <div className="season-bars">{year.map(r => <div key={r.date}><i style={{ height: `${(r.payment / max) * 100}%` }} title={rub(r.payment)} />
      <small>{new Date(r.date).toLocaleDateString('ru-RU', { month: 'short' })}</small></div>)}</div>
  </div>
}
