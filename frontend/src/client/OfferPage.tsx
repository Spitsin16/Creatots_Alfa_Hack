import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { Application, request } from '../api'
import { useSession } from '../auth'
import { Bell } from '../common/Bell'
import { Spinner } from '../common/Spinner'
import { keys } from '../queries'
import { useCalculateOffer } from './calculate'
import { ForecastCard } from './ForecastCard'
import { OfferPanel } from './OfferPanel'
import { loadOffer, saveOffer } from './offerStore'

// Предложение банка: сумма, объяснение, «как получить больше» → оформить заявку.
export function OfferPage() {
  const { id = '' } = useParams()
  const { token, me } = useSession()
  const business = me.businesses[0]
  const navigate = useNavigate()
  const client = useQueryClient()
  const calculate = useCalculateOffer()
  const saved = loadOffer(id)
  const create = useMutation({
    mutationFn: () => request<Application>('/api/v1/applications', { method: 'POST', body: JSON.stringify({ pre_offer_id: id }) }, token),
    onSuccess: app => {
      client.setQueryData(keys.application(app.id), app)
      void client.invalidateQueries({ queryKey: keys.myApplications(business.id) })
      navigate(`/applications/${app.id}`)
    },
  })
  if (!saved) return <div className="page"><div className="empty"><b>Расчёт не найден</b><span>Предложение считается заново по свежим данным — это несколько секунд.</span><Link className="primary as-button" to="/">Рассчитать предложение</Link></div></div>
  const { offer, answers } = saved
  const busy = create.isPending || calculate.isPending
  const error = create.error ?? calculate.error
  return <div className="page"><header><div><Link className="link dark" to="/">‹ Изменить ответы</Link><h1>Ваше предложение</h1><p>{business.name}</p></div><Bell /></header>
    {error && <div className="error">{error.message}</div>}
    {busy && <div className="loading-card"><Spinner label={create.isPending ? 'Создаём заявку…' : 'Пересчитываем предложение…'} /></div>}
    <OfferPanel token={token} offer={offer}
      onOffer={o => { saveOffer(o, answers); navigate(`/offer/${o.id}`, { replace: true }) }}
      onContinue={() => create.mutate()}
      onRefinance={(amount, term) => calculate.mutate({ ...answers, purpose: 'refinance', frequency: 'once', term_months: term, amount })}
      canContinue={!busy && business.permissions.includes('FILL')} repayment={answers.repayment} />
    {offer.product === 'OVERDRAFT' && offer.limit_kopecks > 0 && <section className="tracker"><ForecastCard token={token} businessId={business.id} overdraftKopecks={offer.limit_kopecks} /></section>}
  </div>
}
