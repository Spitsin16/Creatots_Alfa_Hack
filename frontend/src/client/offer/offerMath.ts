import { Explanation, Offer, SeasonalSchedule } from '../../api'
import { formatMoney } from '../../ui'

// Расчёты экрана предложения. Всё считается только из того, что отдал API;
// всё, что посчитано на фронте, в интерфейсе подписано «расчётно» / «пример».

/** Предложение, как его отдаёт POST /pre-offers (в общем типе Offer нет срока действия). */
export type OfferData = Offer & { expires_at?: string; business_id?: string }

/** Ответ /explanation: плюс поле «выписка уже учтена». */
export type OfferExplanation = Explanation & { statement_applied?: boolean }

/** Ответ /seasonal-schedule: плюс сумма и месяцы пика/спада. */
export type SeasonalData = SeasonalSchedule & {
  amount?: number; rate?: number; term_months?: number; peak_months?: number[]; low_months?: number[]
}

/** Ответ POST /pre-offers/{id}/statement */
export type StatementResult = {
  statement: { id: string; period: [string, string] | null; full_months: number; avg_revenue_kopecks: number; warnings: unknown[] }
  previous_limit_kopecks: number
  pre_offer: OfferData
}

export type CounterTerms = NonNullable<Explanation['counter_terms']> & {
  new_payment?: number; old_payment?: number; saving_per_month?: number
}

/** На сколько оформить заявку: как запросили (по умолчанию) или весь одобренный лимит овердрафта. */
export type ApplyTarget = 'requested' | 'limit'

export const isOverdraft = (o: Offer) => o.product === 'OVERDRAFT'

/** Срок действия расчёта прошёл — заявку по нему бэк не создаст (409). */
export const isExpired = (o: OfferData) => !!o.expires_at && new Date(o.expires_at).getTime() < Date.now()

/** Овердрафт, где лимит больше запрошенного: клиент выбирает, на сколько оформить заявку. */
export const hasHeadroom = (o: Offer) => isOverdraft(o) && o.limit_kopecks > o.requested_amount_kopecks && o.requested_amount_kopecks > 0

/** Сумма, на которую оформится заявка: бэк берёт меньшее из запрошенного и лимита. */
export const creditKopecks = (o: Offer) => Math.max(0, Math.min(o.requested_amount_kopecks, o.limit_kopecks))

/** Подпись главной суммы по продукту. */
export const amountLabel = (product: string) => ({
  OVERDRAFT: 'Лимит овердрафта',
  CREDIT_LINE: 'Лимит кредитной линии',
  REFINANCE: 'Сумма рефинансирования',
  WORKING_CAPITAL: 'Сумма кредита',
}[product] ?? 'Сумма')

/**
 * Кредит с ежемесячным платежом: всего к возврату и переплата.
 * Если банк уже посчитал график (сезонный расчёт отдаёт переплату при равных платежах) — берём его цифру,
 * иначе считаем сами: платёж × срок − сумма (в интерфейсе подписано «расчётно»).
 */
export function loanCost(o: Offer, overpaymentRub?: number | null): { principal: number; total: number; interest: number; fromBank: boolean } | null {
  if (!o.payment_kopecks || o.limit_kopecks <= 0 || isOverdraft(o)) return null
  const principal = creditKopecks(o)
  if (overpaymentRub != null && overpaymentRub >= 0) {
    const interest = Math.round(overpaymentRub * 100)
    return { principal, total: principal + interest, interest, fromBank: true }
  }
  const total = o.payment_kopecks * o.term_months
  return { principal, total, interest: Math.max(0, total - principal), fromBank: false }
}

/**
 * Овердрафт: проценты только за дни, когда деньги использованы.
 * Пример 1 — запрошенная сумма на 30 дней; пример 2 — максимум: весь лимит весь срок (лимит × ставка × срок/12).
 */
export function overdraftCost(o: Offer): { exampleKopecks: number; exampleDays: number; exampleInterest: number; maxInterest: number; perDayFullLimit: number } | null {
  if (!isOverdraft(o) || o.rate == null || o.limit_kopecks <= 0) return null
  const rate = o.rate / 100
  const exampleKopecks = creditKopecks(o) || o.limit_kopecks
  const exampleDays = 30
  return {
    exampleKopecks,
    exampleDays,
    exampleInterest: exampleKopecks * rate * exampleDays / 365,
    maxInterest: o.limit_kopecks * rate * o.term_months / 12,
    perDayFullLimit: o.limit_kopecks * rate / 365,
  }
}

const NBSP = '\u00a0'

/** Сумма текстом без переноса перед «₽»: «240 000 ₽» не разорвётся на две строки. */
export const rub = (value: { kopecks: number } | { rubles: number }) => formatMoney(value).replace(/ (?=₽)/g, NBSP)

/**
 * Тексты бэка («до 270 000 ₽», «на 60 мес.»): пробелы внутри чисел и перед единицами — неразрывные,
 * чтобы на телефоне число не переносилось посередине.
 */
export const nb = (s: string) => s
  .replace(/(\d) (?=\d{3}(?!\d))/g, `$1${NBSP}`)
  .replace(/(\d) (?=(₽|%|мес|дн|лет|год|тыс|млн|раз))/g, `$1${NBSP}`)

export const formatRate = (rate: number | null | undefined) =>
  rate == null ? '—' : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(rate)}%`

export const formatDate = (iso: string | null | undefined, withYear = true) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', withYear ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' })
}

export const formatShortDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const monthsGenitive = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']
/** [1, 2] → «январе и феврале» */
export const monthsIn = (months: number[] | undefined) => {
  const names = (months ?? []).filter(m => m >= 1 && m <= 12).map(m => monthsGenitive[m - 1])
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`
}

/** «мес.» с числом: 7 мес. */
export const months = (n: number) => `${n}\u00a0мес.`

/** Совет для экрана: текст из объяснения (если пришло) или из самого предложения. */
export type AdviceItem = { code: string; title: string; effect: string | null; newLimitKopecks: number | null; newRate: number | null; costs?: string }

export function adviceItems(offer: Offer, ex: OfferExplanation | undefined): AdviceItem[] {
  if (ex) {
    return ex.advice.map(a => {
      const [title, ...rest] = a.text.split('. Тогда ')
      return {
        code: a.code, title: title.trim(), effect: rest.length ? `Тогда ${rest.join('. Тогда ')}` : null,
        newLimitKopecks: a.new_limit != null ? Math.round(a.new_limit * 100) : null, newRate: a.new_rate, costs: a.costs,
      }
    })
  }
  return offer.advice.map(a => ({ code: a.code, title: a.text, effect: null, newLimitKopecks: a.new_limit_kopecks, newRate: a.new_rate }))
}
