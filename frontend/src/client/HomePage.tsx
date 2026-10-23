import { Link } from 'react-router'
import { productName, rubles } from '../api'
import { useSession } from '../auth'
import { Bell } from '../common/Bell'
import { Spinner } from '../common/Spinner'
import { statusName } from '../common/status'
import { useApplication, useMyApplications } from '../queries'
import { useCalculateOffer } from './calculate'
import { ForecastCard } from './ForecastCard'
import { lastOfferId, loadOffer } from './offerStore'
import { Questionnaire } from './Questionnaire'

// Главная клиента: активная заявка (если есть), анкета и прогноз остатка.
export function HomePage() {
  const { token, me } = useSession()
  const business = me.businesses[0]
  const calculate = useCalculateOffer()
  const lastId = lastOfferId()
  const last = lastId ? loadOffer(lastId) : null
  return <div className="page"><header><div><span className="eyebrow">{business.name}</span><h1>Добрый день, {me.full_name.split(' ')[1] ?? me.full_name}</h1><p>Подберём финансирование по оборотам вашего бизнеса — без справок и визита в офис.</p></div><Bell /></header>
    <ActiveApplication businessId={business.id} />
    {last && <Link className="notice link-card" to={`/offer/${lastId}`}>Последний расчёт: {productName(last.offer.product)} {last.offer.limit_kopecks > 0 ? `на ${rubles(last.offer.limit_kopecks)}` : ''} — открыть ›</Link>}
    <section className="hero-card"><Questionnaire onSubmit={a => calculate.mutate(a)} busy={calculate.isPending} initial={last?.answers} /><ForecastCard token={token} businessId={business.id} /></section>
    {calculate.error && <div className="error">{calculate.error.message}</div>}
    {calculate.isPending && <div className="loading-card"><Spinner label="Считаем предложение по вашим оборотам…" /></div>}
  </div>
}

function ActiveApplication({ businessId }: { businessId: string }) {
  const apps = useMyApplications(businessId)
  const app = useApplication(apps.data?.active_id ?? undefined)
  if (!app.data) return null
  const a = app.data
  return <Link className="tracker active-application" to={`/applications/${a.id}`}>
    <div><span className="eyebrow">Ваша заявка</span><h2>{statusName[a.status] ?? a.status}</h2>
      <p>{productName(a.product)} · {rubles(a.amount_kopecks)} · {a.term_months} мес.</p></div>
    <span className="secondary as-button">Открыть заявку ›</span>
  </Link>
}
