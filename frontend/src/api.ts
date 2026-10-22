export type Business = {
  id: string; inn: string; name: string; type: string; membership_kind: string; permissions: string[]
}
export type Me = { id: string; full_name: string; login: string; role: string; businesses: Business[] }
export type Offer = {
  id: string; outcome: string; product: string; requested_amount_kopecks: number; limit_kopecks: number;
  rate: number | null; payment_kopecks: number | null; term_months: number;
  advice: { code: string; text: string; new_limit_kopecks: number; new_rate: number | null }[]
}
export type Application = {
  id: string; business_id: string; product: string; amount_kopecks: number; term_months: number;
  purpose: string; segment_code: string; status: string; version: number;
  timeline?: { from_status: string | null; to_status: string; comment: string | null; at: string }[];
  decision?: { outcome: string; limit_kopecks: number; rate: number | null; explanation: string; advice: Offer['advice'] } | null
}
export type BankItem = {
  id: string; business_name: string; inn: string; amount_kopecks: number; product: string; segment_code: string;
  status: string; decision_class: string | null; score: number | null; assignee_id: string | null
  open_question_due_at?: string | null; question_overdue?: boolean
}

const base = import.meta.env.VITE_API_URL ?? ''

export async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message ?? 'Не удалось выполнить запрос')
  return body as T
}

export const rubles = (kopecks: number) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(kopecks / 100)

export const productName = (value: string) => ({
  OVERDRAFT: 'Овердрафт', WORKING_CAPITAL: 'Оборотный кредит', CREDIT_LINE: 'Кредитная линия', REFINANCE: 'Рефинансирование',
}[value] ?? value)

export type Explanation = {
  outcome: string; headline: string; product: string; why_amount: string | null; reason: string | null;
  counter: string | null; strengths: string[]; weaknesses: string[]; terms?: string;
  advice: { code: string; text: string; new_limit: number | null; new_rate: number | null; costs?: string }[]
}
export type Forecast = {
  start_balance: number; series: { date: string; balance: number }[]; headline: string; details: string[];
  suggestion: string | null; gap: { date: string; shortfall: number; overdraft_suggestion: number } | null
}
export type SeasonalSchedule = {
  schedule: { date: string; payment: number; interest: number; principal: number; balance: number }[]
  annuity_payment: number; max_payment: number; min_payment: number; overpayment: number; annuity_overpayment: number
}
export type ChatMessage = { id: string; author_side: 'CLIENT' | 'BANK'; author_name: string; text: string; created_at: string }
export type Chat = { items: ChatMessage[]; open_question_due_text: string | null; overdue: boolean }
export type NotificationItem = { id: string; title: string; text: string; application_id: string | null; created_at: string; read: boolean }

export const rub = (value: number) => `${new Intl.NumberFormat('ru-RU').format(Math.round(value))} ₽`
