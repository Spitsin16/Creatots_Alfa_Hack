import { useQuery } from '@tanstack/react-query'
import { request } from '../../api'
import { useSession } from '../../auth'

/** Платёж по графику договора. Суммы — в рублях. */
export type LoanPayment = { date: string; payment: number; interest: number; principal: number; balance: number }

/** Ответ GET /applications/{id}/loan — кабинет кредита после выдачи. Суммы — в рублях. */
export type Loan = {
  product: string
  amount: number
  rate: number
  term_months: number
  signed_at?: string
  /** Платёж следует за выручкой: больше в сезон, меньше в межсезонье */
  seasonal: boolean
  /** Для овердрафта пусто: он гасится поступлениями */
  schedule: LoanPayment[]
  next_payment: LoanPayment | null
  overpayment: number | null
  max_payment?: number
  min_payment?: number
  tips: string[]
  forecast: {
    headline: string
    suggestion: string | null
    gap: { date: string; shortfall: number } | null
    series: { date: string; balance: number }[]
  } | null
}

// Ключ — внутри ['application', id]: инвалидация заявки перечитывает и кредит.
export const loanKey = (applicationId: string) => ['application', applicationId, 'loan'] as const

/** Кредит по выданной заявке. До выдачи бэк отвечает 409 — поэтому запрашиваем только при ISSUED. */
export function useLoan(applicationId: string, enabled: boolean) {
  const { token } = useSession()
  return useQuery({
    queryKey: loanKey(applicationId),
    queryFn: () => request<Loan>(`/api/v1/applications/${applicationId}/loan`, {}, token),
    enabled: enabled && !!applicationId,
    staleTime: 60_000,
    retry: 1,
  })
}
