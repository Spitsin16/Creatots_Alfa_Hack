import { useEffect, useState } from 'react'
import { Forecast, request, rub } from '../api'

// Прогноз остатка на 30 дней по регулярным платежам и поступлениям (модуль за флагом).
export function ForecastCard({ token, businessId, overdraftKopecks }: { token: string; businessId: string; overdraftKopecks?: number }) {
  const [f, setF] = useState<Forecast | null>(null)
  useEffect(() => {
    const q = overdraftKopecks ? `?overdraft_limit_kopecks=${overdraftKopecks}` : ''
    request<Forecast>(`/api/v1/businesses/${businessId}/forecast${q}`, {}, token).then(setF).catch(() => setF(null))
  }, [businessId, overdraftKopecks, token])
  if (!f) return <div className="forecast"><span>Прогноз на 30 дней</span><p>Считаем…</p></div>
  const values = f.series.map(p => p.balance)
  const max = Math.max(...values, 1), min = Math.min(...values, 0)
  const span = max - min || 1
  return <div className="forecast">
    <span>Прогноз остатка на 30 дней</span>
    <strong className={f.gap ? 'warn' : 'ok'}>{f.headline}</strong>
    {f.details.map(d => <p key={d}>{d}</p>)}
    <div className="balance-chart" aria-label="Остаток по дням">
      {f.series.map(p => <i key={p.date} title={`${p.date}: ${rub(p.balance)}`}
        className={p.balance < 0 ? 'neg' : ''} style={{ height: `${Math.max(4, ((p.balance - min) / span) * 100)}%` }} />)}
    </div>
    {f.suggestion && <p className="suggestion">{f.suggestion}</p>}
  </div>
}
