import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Offer, request } from '../api'
import { useSession } from '../auth'
import { saveOffer } from './offerStore'
import { Answers } from './Questionnaire'

// Расчёт предложения: согласие на БКИ/ФНС (если есть право) → предварительное предложение → его страница.
export function useCalculateOffer() {
  const { token, me } = useSession()
  const navigate = useNavigate()
  const business = me.businesses[0]
  return useMutation({
    mutationFn: async (a: Answers) => {
      if (business.permissions.includes('CONSENT')) {
        await request(`/api/v1/businesses/${business.id}/consents`, { method: 'POST', body: JSON.stringify({ kinds: ['BKI', 'FNS'] }) }, token)
      }
      const { amount, ...rest } = a
      return request<Offer>(`/api/v1/businesses/${business.id}/pre-offers`, { method: 'POST', body: JSON.stringify({ ...rest, amount_kopecks: amount * 100 }) }, token)
    },
    onSuccess: (offer, a) => { saveOffer(offer, a); navigate(`/offer/${offer.id}`) },
  })
}
