export type Business = {
  id: string; inn: string; name: string; type: string; membership_kind: string; permissions: string[]
  /** Срок доверенности (МЧД) у сотрудника клиента; у владельца — null */
  valid_to?: string | null
}
export type Me = { id: string; full_name: string; login: string; role: string; businesses: Business[] }
export type Offer = {
  id: string; outcome: string; product: string; requested_amount_kopecks: number; limit_kopecks: number;
  rate: number | null; payment_kopecks: number | null; term_months: number;
  advice: { code: string; text: string; new_limit_kopecks: number; new_rate: number | null }[]
  /** До какого момента действует расчёт (после — пересчитать) */
  expires_at?: string
}
export type Application = {
  id: string; business_id: string; product: string; amount_kopecks: number; term_months: number;
  purpose: string; segment_code: string; status: string; version: number;
  created_at?: string; pre_offer_id?: string | null;
  timeline?: { from_status: string | null; to_status: string; comment: string | null; at: string }[];
  decision?: { outcome: string; limit_kopecks: number; rate: number | null; explanation: string; advice: Offer['advice'] } | null
  assignee_name?: string | null
}
export type BankItem = {
  id: string; business_name: string; inn: string; amount_kopecks: number; product: string; segment_code: string;
  status: string; decision_class: string | null; score: number | null; assignee_id: string | null
  open_question_due_at?: string | null; question_overdue?: boolean; assignee_name?: string | null
}

const base = import.meta.env.VITE_API_URL ?? ''

/**
 * Ошибка запроса к API. message — текст для человека (из ответа бэка), status — HTTP-код
 * (0 — нет связи с сервером), code — машинный код бэка («PRE_OFFER_EXPIRED», «SEASONAL_NOT_AVAILABLE»…).
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** Код ошибки бэка, если это ApiError: `apiErrorCode(e) === 'PRE_OFFER_EXPIRED'`. */
export const apiErrorCode = (e: unknown) => (e instanceof ApiError ? e.code : null)

/** Запрос не дошёл до сервера (нет связи, стенд не запущен). */
export const isNetworkError = (e: unknown) => e instanceof TypeError || (e instanceof ApiError && e.status === 0)

export async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'NETWORK', 'Нет связи с сервером. Проверьте подключение и повторите.')
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(response.status, typeof body.code === 'string' ? body.code : null, body.message ?? 'Не удалось выполнить запрос')
  return body as T
}

export const rubles = (kopecks: number) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(kopecks / 100)

export const productName = (value: string) => ({
  OVERDRAFT: 'Овердрафт', WORKING_CAPITAL: 'Оборотный кредит', CREDIT_LINE: 'Кредитная линия', REFINANCE: 'Рефинансирование',
}[value] ?? value)

export type Explanation = {
  outcome: string; headline: string; product: string; why_amount: string | null; reason: string | null;
  counter: string | null; strengths: string[]; weaknesses: string[]; terms?: string; summary?: string | null; source?: string;
  counter_terms?: { product: string; amount: number; term: number; rate?: number } | null;
  advice: { code: string; text: string; new_limit: number | null; new_rate: number | null; costs?: string }[]
}
export type Forecast = {
  start_balance: number; series: { date: string; balance: number }[]; headline: string; details: string[];
  suggestion: string | null
  gap: { date: string; shortfall: number; overdraft_suggestion: number; /** что списывается в день разрыва */ reasons?: string[] } | null
  /** Крупные регулярные платежи (аренда, зарплата, налоги…) */
  recurring?: { counterparty: string; kind: string; day: number; amount: number }[]
}
export type SeasonalSchedule = {
  schedule: { date: string; payment: number; interest: number; principal: number; balance: number }[]
  annuity_payment: number; max_payment: number; min_payment: number; overpayment: number; annuity_overpayment: number
}
export type ChatMessage = {
  id: string; author_side: 'CLIENT' | 'BANK'; author_name: string; text: string; created_at: string
  /** У вопроса клиента: до какого времени банк должен ответить и когда ответил */
  answer_due_at?: string | null; answered_at?: string | null
}
export type Chat = { items: ChatMessage[]; open_question_due_text: string | null; overdue: boolean }
export type NotificationItem = { id: string; title: string; text: string; application_id: string | null; created_at: string; read: boolean }

// Неразрывный пробел перед «₽»: знак рубля не уезжает на следующую строку.
export const rub = (value: number) => `${new Intl.NumberFormat('ru-RU').format(Math.round(value))}\u00a0₽`

export type DocItem = {
  id: string; kind: string; kind_title: string; title: string; filename: string | null; size: number | null
  application_id: string | null; status: string; valid_to: string | null; expired: boolean; created_at: string | null
}

export async function uploadFile<T>(path: string, file: File, token: string): Promise<T> {
  return request<T>(path, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) } }, token)
}

export async function downloadFile(path: string, filename: string, token: string): Promise<void> {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error('Не удалось скачать файл')
  const url = URL.createObjectURL(await response.blob())
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Открыть документ в новой вкладке (договор в HTML). Вкладку открываем сразу — иначе браузер сочтёт её всплывающим окном. */
export async function openFile(path: string, token: string): Promise<void> {
  const tab = window.open('', '_blank')
  try {
    const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error('Не удалось открыть файл')
    const url = URL.createObjectURL(await response.blob())
    if (tab) tab.location.href = url; else window.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) { tab?.close(); throw e }
}

// Цвет балла для сотрудника: зелёный — авто-одобрение, жёлтый — пограничный,
// красный — ручная проверка, чёрный — отказ/стоп-фактор.
export const scoreTone = (cls: string | null | undefined, status?: string): string =>
  status === 'REJECTED' || cls === 'E' ? 'black' : cls === 'A' || cls === 'B' ? 'green' : cls === 'C' ? 'yellow' : cls === 'D' ? 'red' : 'none'

export const toneTitle: Record<string, string> = {
  green: 'низкий риск', yellow: 'пограничный', red: 'ручная проверка', black: 'отказ', none: 'нет расчёта',
}

export type MyApplicationItem = {
  id: string; status: string; active: boolean
  product?: string; amount_kopecks?: number; term_months?: number; created_at?: string
}
export type MyApplications = { items: MyApplicationItem[]; active_id: string | null }
