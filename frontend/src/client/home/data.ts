import { useQuery } from '@tanstack/react-query'
import { Application, Forecast, MyApplicationItem, request } from '../../api'
import { useSession } from '../../auth'

// Данные для карточек главной «Перенесите кредит в Альфу» и «Подсказки для бизнеса».
// Всё берём из API как есть; что считаем сами (разница платежей, дата следующего списания) — помечаем «примерно».

/** Ключи кэша главной (свои, чтобы не мешать общим ключам заявок). */
export const homeKeys = {
  loan: (id: string) => ['home', 'loan', id] as const,
  application: (id: string) => ['home', 'application', id] as const,
}

export type LoanPayment = { date: string; payment: number; interest: number; principal: number; balance: number }
/** Ответ /applications/{id}/loan — суммы в рублях. */
export type Loan = {
  product: string; amount: number; rate: number; term_months: number; seasonal: boolean
  next_payment: LoanPayment | null; overpayment: number | null; max_payment?: number; min_payment?: number; tips: string[]
}

/** Выданный кредит: ближайший платёж и подсказки банка. */
export function useLoan(applicationId: string | undefined) {
  const { token } = useSession()
  return useQuery({
    queryKey: homeKeys.loan(applicationId ?? ''),
    queryFn: () => request<Loan>(`/api/v1/applications/${applicationId}/loan`, {}, token),
    enabled: !!applicationId,
    staleTime: 60_000,
  })
}

/** Заявка целиком — нужна только ради решения банка и советов «как получить больше». Без опроса. */
export function useApplicationDecision(applicationId: string | undefined) {
  const { token } = useSession()
  return useQuery({
    queryKey: homeKeys.application(applicationId ?? ''),
    queryFn: () => request<Application>(`/api/v1/applications/${applicationId}`, {}, token),
    enabled: !!applicationId,
    staleTime: 60_000,
  })
}

const byNewest = (a: MyApplicationItem, b: MyApplicationItem) => (b.created_at ?? '').localeCompare(a.created_at ?? '')

/** Последний выданный кредит (по дате заявки). */
export const latestIssued = (items: MyApplicationItem[], product?: string) =>
  [...items].filter(i => i.status === 'ISSUED' && (!product || i.product === product)).sort(byNewest)[0]

/** Последняя заявка (по дате создания). */
export const latestApplication = (items: MyApplicationItem[]) => [...items].sort(byNewest)[0]

// ——— Кредиты в других банках ———

type Recurring = NonNullable<Forecast['recurring']>[number]

const isAlfa = (name: string) => /альфа|alfa/i.test(name)

/** «Банк «Восток-Кредит»» → «банк «Восток-Кредит»» — для фразы «платите в банк …». */
export const bankName = (counterparty: string) => counterparty.replace(/^Банк(?=\s)/, 'банк')

export type ForeignLoan = { counterparty: string; amount: number; day: number }

/**
 * Регулярные платежи по кредитам в другие банки (kind=LOAN_PAYMENT, получатель — не Альфа),
 * сложенные по банку: самый крупный — первым.
 */
export function foreignLoans(recurring: Recurring[] | undefined): ForeignLoan[] {
  const byBank = new Map<string, ForeignLoan>()
  for (const r of recurring ?? []) {
    if (r.kind !== 'LOAN_PAYMENT' || isAlfa(r.counterparty)) continue
    const prev = byBank.get(r.counterparty)
    byBank.set(r.counterparty, prev ? { ...prev, amount: prev.amount + r.amount } : { counterparty: r.counterparty, amount: r.amount, day: r.day })
  }
  return [...byBank.values()].sort((a, b) => b.amount - a.amount)
}

// ——— Даты ———

export const dayMonth = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

/** Ближайшая дата платежа «каждое N-е число» внутри прогноза (ISO) — или null, если в 30 дней не попадает. */
export function nextDateInForecast(series: Forecast['series'], dayOfMonth: number): string | null {
  return series.find(p => new Date(`${p.date}T00:00:00`).getDate() === dayOfMonth)?.date ?? null
}

/** Остаток по прогнозу на конец дня. */
export const balanceOn = (series: Forecast['series'], iso: string) => series.find(p => p.date === iso.slice(0, 10))?.balance ?? null
