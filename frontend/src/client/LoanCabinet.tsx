import { useEffect, useState } from 'react'
import { productName, request, rub } from '../api'

type Row = { date: string; payment: number; interest: number; principal: number; balance: number }
type Loan = {
  product: string; amount: number; rate: number; term_months: number; seasonal: boolean; schedule: Row[]
  next_payment: Row | null; overpayment: number | null; max_payment?: number; min_payment?: number; tips: string[]
  forecast: { headline: string; suggestion: string | null; gap: { date: string; shortfall: number } | null; series: { date: string; balance: number }[] } | null
}

// Кабинет после выдачи: мой кредит, ближайший платёж, график (сезонный), прогноз разрыва, подсказки.
export function LoanCabinet({ token, applicationId }: { token: string; applicationId: string }) {
  const [loan, setLoan] = useState<Loan | null>(null)
  useEffect(() => { request<Loan>(`/api/v1/applications/${applicationId}/loan`, {}, token).then(setLoan).catch(() => setLoan(null)) }, [applicationId])
  if (!loan) return null
  const year = loan.schedule.slice(0, 12)
  const max = Math.max(...year.map(r => r.payment), 1)
  const values = loan.forecast?.series.map(p => p.balance) ?? []
  const hi = Math.max(...values, 1), lo = Math.min(...values, 0), span = hi - lo || 1
  return <section className="loan-cabinet">
    <div className="section-title"><div><span className="eyebrow">Мой кредит</span><h2>{productName(loan.product)} · {rub(loan.amount)}</h2></div></div>
    <div className="loan-cards">
      <div><small>Ставка</small><b>{loan.rate}%</b></div>
      {loan.product === 'OVERDRAFT'
        ? <><div><small>Лимит</small><b>{rub(loan.amount)}</b></div><div><small>Используется</small><b>0 ₽</b></div></>
        : <><div><small>Ближайший платёж</small><b>{loan.next_payment ? rub(loan.next_payment.payment) : '—'}</b>
            {loan.next_payment && <small>{new Date(loan.next_payment.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</small>}</div>
          <div><small>Срок</small><b>{loan.term_months} мес.</b></div>
          <div><small>Переплата</small><b>{loan.overpayment != null ? rub(loan.overpayment) : '—'}</b></div></>}
    </div>
    <div className="loan-grid">
      {year.length > 0 && <div className="loan-block"><h3>{loan.seasonal ? 'Сезонный график: больше в сезон, меньше в межсезонье' : 'График платежей'}</h3>
        {loan.seasonal && <p className="muted">От {rub(loan.min_payment ?? 0)} до {rub(loan.max_payment ?? 0)} в месяц — платёж следует за выручкой.</p>}
        <div className="season-bars">{year.map(r => <div key={r.date}><i style={{ height: `${(r.payment / max) * 100}%` }} title={rub(r.payment)} />
          <small>{new Date(r.date).toLocaleDateString('ru-RU', { month: 'short' })}</small></div>)}</div></div>}
      {loan.forecast && <div className="loan-block"><h3>Деньги на счёте: прогноз на 30 дней</h3>
        <p className={loan.forecast.gap ? 'warn-text' : 'ok-text'}>{loan.forecast.headline}</p>
        <div className="balance-chart light">{loan.forecast.series.map(p => <i key={p.date} className={p.balance < 0 ? 'neg' : ''} title={`${p.date}: ${rub(p.balance)}`}
          style={{ height: `${Math.max(4, ((p.balance - lo) / span) * 100)}%` }} />)}</div>
        {loan.forecast.suggestion && <p className="muted">{loan.forecast.suggestion}</p>}</div>}
    </div>
    {loan.tips.length > 0 && <div className="loan-tips"><h3>Подсказки</h3><ul>{loan.tips.map(t => <li key={t}>{t}</li>)}</ul></div>}
  </section>
}
