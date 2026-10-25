// Выручка по месяцам из операций по счёту в Альфе — тем же способом, что и движок решения
// (backend/app/services/scoring/engine.py → derive):
//  • окно — последние полные месяцы до даты расчёта, не больше 12 и только после открытия счёта
//    (месяц открытия не берём, если счёт открыт не 1-го числа);
//  • выручка — только поступления вида REVENUE; свои переводы, кредиты и возвраты не считаем
//    (rules.yaml → revenue.exclude_inflow_kinds);
//  • месяц без поступлений тоже входит в среднее (как ноль);
//  • отдельно — переводы со своего счёта в другом банке (OWN_TRANSFER с «р/с в» в назначении):
//    это не выручка, но признак того, что часть оборота идёт мимо Альфы.
import type { Snapshots } from '../data'

/** Дата расчёта движка (AS_OF в engine.py = DEMO_TODAY). Окно месяцев считается от неё. */
export const ENGINE_AS_OF = '2026-10-22'
/** Порог из data/rules.yaml → manual_review_flags.FNS_MISMATCH_HIGH: «fns_mismatch > 0.30» — на ручную проверку. */
export const FNS_MISMATCH_LIMIT = 0.3
/** С какого расхождения подсвечиваем «близко к порогу» — только подсказка интерфейса, в правилах её нет. */
export const FNS_MISMATCH_WATCH = 0.2

export type RevenueMonth = {
  /** «2026-03» */
  key: string
  /** Выручка за месяц, ₽ */
  revenue: number
  /** Переводы со своего счёта в другом банке, ₽ (не выручка) */
  ownOther: number
}

export type FnsAnnual = {
  year: string
  /** Годовая выручка по декларации, ₽ */
  annual: number
  /** Среднемесячная по декларации = годовая / 12 */
  monthly: number
}

export type FnsCompare = FnsAnnual & {
  /** (среднемесячная по счёту − по декларации) / по декларации: −0,12 = по счёту на 12% меньше */
  mismatch: number
  /** |расхождение| в процентах так, как оно показано на экране (см. shownPercent) */
  shownPct: number
  /** Уровень выбирается по показанному числу, чтобы цифра и плашка не спорили друг с другом */
  level: 'ok' | 'watch' | 'high'
}

export type MonthlyRevenue = {
  months: RevenueMonth[]
  /** Сумма выручки за окно, ₽ */
  total: number
  /** Среднемесячная выручка (В в расчёте лимита без выписки из другого банка), ₽ */
  avg: number
  /** Сумма переводов со своего счёта в другом банке за окно, ₽ */
  ownOtherTotal: number
  /** Прочие поступления, которые не считаются выручкой (свои пополнения, кредиты, возвраты), ₽ */
  excludedTotal: number
  /** Есть ли вообще операции по счёту */
  hasTransactions: boolean
  /** Годовая выручка по налоговой — есть даже тогда, когда сравнивать не с чем (нет полных месяцев) */
  fnsAnnual: FnsAnnual | null
  /** Сравнение со счётом — только когда есть полные месяцы */
  fns: FnsCompare | null
}

type Tx = { date: string; kind: string; amount: number; direction: string; purpose?: string }

/**
 * |доля| в процентах для экрана: обычно целое, а рядом с порогами 20% и 30% (±0,5 п.п.) — с одним знаком
 * после запятой, иначе 20,04% и 19,96% выглядели бы одинаково «20%», но с разными плашками.
 */
export function shownPercent(share: number): number {
  const p = Math.abs(share) * 100
  const near = [FNS_MISMATCH_WATCH, FNS_MISMATCH_LIMIT].some(t => Math.abs(p - t * 100) < 0.5)
  return near ? Math.round(p * 10) / 10 : Math.round(p)
}

/** «1 полный месяц», «3 полных месяца», «7 полных месяцев». */
export function fullMonthsText(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return `${n} полный месяц`
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} полных месяца`
  return `${n} полных месяцев`
}

const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`

/** Окно полных месяцев, как в engine.derive: от месяца перед датой расчёта назад, но не раньше открытия счёта. */
export function revenueWindow(asOf: string, opened: string | undefined): string[] {
  let y = Number(asOf.slice(0, 4))
  let m = Number(asOf.slice(5, 7)) - 1
  if (m === 0) { m = 12; y -= 1 }
  const openKey = opened ? opened.slice(0, 7) : null
  const openDay = opened ? Number(opened.slice(8, 10)) : 1
  const months: string[] = []
  while (months.length < 12) {
    const key = monthKey(y, m)
    if (openKey && (key < openKey || (key === openKey && openDay > 1))) break
    months.push(key)
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
  }
  return months.reverse()
}

export function monthlyRevenue(snapshots: Snapshots | undefined, asOf = ENGINE_AS_OF): MonthlyRevenue | null {
  const alfa = snapshots?.ALFA
  if (!alfa) return null
  const tx = (alfa.transactions ?? []) as Tx[]
  const window = revenueWindow(asOf, alfa.account?.opened)
  const inWindow = new Set(window)
  const rev = new Map<string, number>()
  const own = new Map<string, number>()
  let excludedTotal = 0
  for (const t of tx) {
    if (t.direction !== 'IN') continue
    const key = t.date.slice(0, 7)
    if (!inWindow.has(key)) continue
    const amount = Number(t.amount) || 0
    if (t.kind === 'REVENUE') {
      rev.set(key, (rev.get(key) ?? 0) + amount)
      continue
    }
    if (t.kind === 'OWN_TRANSFER' && (t.purpose ?? '').includes('р/с в')) own.set(key, (own.get(key) ?? 0) + amount)
    else excludedTotal += amount
  }
  const months = window.map(key => ({ key, revenue: rev.get(key) ?? 0, ownOther: own.get(key) ?? 0 }))
  const total = months.reduce((s, x) => s + x.revenue, 0)
  const avg = months.length ? total / months.length : 0
  const ownOtherTotal = months.reduce((s, x) => s + x.ownOther, 0)

  // Движок сравнивает с выручкой за 2025 год; берём последний год, который отдала ФНС (сейчас это и есть 2025).
  const annual = snapshots?.FNS?.annual_revenue ?? {}
  const year = Object.keys(annual).filter(k => (annual[k] ?? 0) > 0).sort().pop()
  const fnsAnnual: FnsAnnual | null = year ? { year, annual: annual[year], monthly: annual[year] / 12 } : null
  let fns: FnsCompare | null = null
  if (fnsAnnual && months.length) {
    const mismatch = (avg - fnsAnnual.monthly) / fnsAnnual.monthly
    const shownPct = shownPercent(mismatch)
    const level = shownPct > Math.round(FNS_MISMATCH_LIMIT * 100) ? 'high' : shownPct > Math.round(FNS_MISMATCH_WATCH * 100) ? 'watch' : 'ok'
    fns = { ...fnsAnnual, mismatch, shownPct, level }
  }
  return { months, total, avg, ownOtherTotal, excludedTotal, hasTransactions: tx.length > 0, fnsAnnual, fns }
}
