// Расчётный график платежей: аннуитет по сумме, ставке и сроку из решения банка.
// Та же формула, что в движке (backend/app/services/scoring/engine.py: annuity_payment).
// Это предварительный расчёт на экране — точный график в договоре.

export type ScheduleRow = {
  /** Номер платежа, 1…n */
  n: number
  /** Примерная дата: через n месяцев после выдачи (если дата выдачи известна) */
  date: Date | null
  payment: number
  interest: number
  principal: number
  /** Остаток долга после платежа */
  balance: number
}

export type Annuity = {
  payment: number
  overpayment: number
  total: number
  rows: ScheduleRow[]
}

/** Ежемесячный платёж, ₽ (rate — % годовых). */
export function annuityPayment(amount: number, ratePct: number, months: number): number {
  const r = ratePct / 100 / 12
  if (r === 0) return amount / months
  return (amount * r) / (1 - (1 + r) ** -months)
}

const addMonths = (d: Date, months: number) => {
  const x = new Date(d)
  const day = x.getDate()
  x.setDate(1)
  x.setMonth(x.getMonth() + months)
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()
  x.setDate(Math.min(day, last))
  return x
}

/** Полный аннуитетный график, суммы в рублях (с копейками — округляем при показе). */
export function annuitySchedule(amount: number, ratePct: number, months: number, issuedAt: Date | null): Annuity {
  const payment = annuityPayment(amount, ratePct, months)
  const r = ratePct / 100 / 12
  let balance = amount
  const rows: ScheduleRow[] = []
  for (let n = 1; n <= months; n++) {
    const interest = balance * r
    let principal = payment - interest
    let pay = payment
    if (n === months) { principal = balance; pay = principal + interest }
    balance = Math.max(0, balance - principal)
    rows.push({ n, date: issuedAt ? addMonths(issuedAt, n) : null, payment: pay, interest, principal, balance })
  }
  const total = rows.reduce((s, x) => s + x.payment, 0)
  return { payment, total, overpayment: total - amount, rows }
}

/** Проценты по овердрафту за несколько дней пользования: сумма × ставка × дни / 365. */
export const overdraftInterest = (amount: number, ratePct: number, days: number) => (amount * ratePct) / 100 * days / 365

/** Продукты с ежемесячными платежами (аннуитет). Овердрафт гасится поступлениями на счёт. */
export const isAnnuityProduct = (product: string) => ['WORKING_CAPITAL', 'CREDIT_LINE', 'REFINANCE'].includes(product)

export const purposeName: Record<string, string> = {
  cash_gap: 'Закрыть кассовый разрыв', inventory: 'Закупка товара или сырья', equipment: 'Оборудование или ремонт',
  expansion: 'Новая точка, расширение', refinance: 'Снизить платёж по другому кредиту', other: 'Другое',
}
