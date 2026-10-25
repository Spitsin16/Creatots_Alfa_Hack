import { Offer } from '../api'
import { Answers } from './Questionnaire'

// Предварительное предложение по id бэк не отдаёт, поэтому расчёт и ответы анкеты держим
// во вкладке: страница предложения переживает обновление, а «Рассчитать заново» берёт ответы отсюда.

/** Откуда взялось это предложение — чтобы показать «было → стало» после перехода на новый расчёт. */
export type OfferContext = {
  /** Пересчёт после загрузки выписки 1С из другого банка */
  statement?: {
    previousLimitKopecks: number
    fullMonths: number
    avgRevenueKopecks: number
    period: [string, string] | null
  }
  /** Пересчёт по встречному предложению «рефинансирование»: платёж сейчас и обещанный платёж */
  refinance?: {
    oldPaymentRub: number
    newPaymentRub: number
    savingPerMonthRub: number
    /** Что клиент просил изначально (новый кредит, который не дали) */
    requestedKopecks: number
  }
}

/** applicationId — заявка, уже созданная из этого расчёта: второй раз не создаём, а ведём в неё. */
type Saved = { offer: Offer; answers: Answers; context?: OfferContext; applicationId?: string }

const key = (id: string) => `offer:${id}`

export function saveOffer(offer: Offer, answers: Answers, context?: OfferContext) {
  try {
    sessionStorage.setItem(key(offer.id), JSON.stringify({ offer, answers, context }))
    sessionStorage.setItem('offer:last', offer.id)
  } catch { /* хранилище недоступно — страница просто не переживёт обновление */ }
}

export function loadOffer(id: string): Saved | null {
  try { const raw = sessionStorage.getItem(key(id)); return raw ? JSON.parse(raw) as Saved : null } catch { return null }
}

/** Запомнить, что по расчёту уже создана заявка (кнопка «назад» не должна создавать дубль). */
export function markApplied(offerId: string, applicationId: string) {
  const saved = loadOffer(offerId)
  if (!saved) return
  try { sessionStorage.setItem(key(offerId), JSON.stringify({ ...saved, applicationId })) } catch { /* хранилище недоступно */ }
}

// Файл выписки 1С держим в памяти вкладки (не в хранилище): им пересчитываем предложение
// «на весь лимит» и после истечения срока — без повторной загрузки. После перезагрузки страницы его нет.
const statementFiles = new Map<string, Blob>()

export function rememberStatementFile(offerId: string, file: Blob) {
  statementFiles.set(offerId, file)
}

export function statementFileFor(offerId: string): Blob | undefined {
  return statementFiles.get(offerId)
}

export function lastOfferId(): string | null {
  try { return sessionStorage.getItem('offer:last') } catch { return null }
}
