import { Offer } from '../api'
import { Answers } from './Questionnaire'

// Предварительное предложение по id бэк не отдаёт, поэтому расчёт и ответы анкеты держим
// во вкладке: страница предложения переживает обновление, а «Рассчитать заново» берёт ответы отсюда.
type Saved = { offer: Offer; answers: Answers }

const key = (id: string) => `offer:${id}`

export function saveOffer(offer: Offer, answers: Answers) {
  try { sessionStorage.setItem(key(offer.id), JSON.stringify({ offer, answers })); sessionStorage.setItem('offer:last', offer.id) } catch { /* хранилище недоступно — страница просто не переживёт обновление */ }
}

export function loadOffer(id: string): Saved | null {
  try { const raw = sessionStorage.getItem(key(id)); return raw ? JSON.parse(raw) as Saved : null } catch { return null }
}

export function lastOfferId(): string | null {
  try { return sessionStorage.getItem('offer:last') } catch { return null }
}
