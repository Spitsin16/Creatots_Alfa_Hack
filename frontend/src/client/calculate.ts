import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Offer, request } from '../api'
import { useSession } from '../auth'
import { saveOffer } from './offerStore'
import { Answers } from './Questionnaire'

type ConsentResponse = { business_id: string; kinds: string[]; expires_at: string }

const consentKey = (businessId: string) => `consent:${businessId}`

/**
 * Согласие на БКИ/ФНС, данное в этой вкладке: дата окончания (ISO) или null.
 * Бэк не отдаёт действующие согласия отдельным запросом, поэтому помним ответ POST /consents —
 * второй раз галочку не спрашиваем, а показываем «действует до …» (ТЗ 5.1, п. 3).
 */
export function consentUntil(businessId: string): string | null {
  try {
    const value = sessionStorage.getItem(consentKey(businessId))
    return value && new Date(value) > new Date() ? value : null
  } catch { return null }
}

function rememberConsent(businessId: string, expiresAt: string) {
  try { sessionStorage.setItem(consentKey(businessId), expiresAt) } catch { /* хранилище недоступно — спросим галочку ещё раз */ }
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Расчёт предложения: согласие на БКИ/ФНС (если есть право и оно ещё не дано) → предварительное
 * предложение → его страница. Для расчёта бэку нужно только право FILL; согласие понадобится при отправке заявки.
 * minDuration — сколько минимум показывать экран ожидания (расчёт занимает доли секунды,
 * без паузы пояснение «что сейчас делаем» мелькнёт и пропадёт).
 */
export function useCalculateOffer({ minDuration = 0 }: { minDuration?: number } = {}) {
  const { token, me } = useSession()
  const navigate = useNavigate()
  const business = me.businesses[0]
  return useMutation({
    mutationFn: async (a: Answers) => {
      const pause = wait(minDuration)
      if (business.permissions.includes('CONSENT') && !consentUntil(business.id)) {
        const consent = await request<ConsentResponse>(`/api/v1/businesses/${business.id}/consents`, { method: 'POST', body: JSON.stringify({ kinds: ['BKI', 'FNS'] }) }, token)
        rememberConsent(business.id, consent.expires_at)
      }
      const { amount, ...rest } = a
      const offer = await request<Offer>(`/api/v1/businesses/${business.id}/pre-offers`, { method: 'POST', body: JSON.stringify({ ...rest, amount_kopecks: Math.round(amount * 100) }) }, token)
      await pause
      return offer
    },
    onSuccess: (offer, a) => { saveOffer(offer, a); navigate(`/offer/${offer.id}`) },
  })
}
