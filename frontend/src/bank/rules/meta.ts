// Справочник формы правил: подписи, единицы и форматирование значений rules.yaml.
// Нужен и полям формы, и списку изменений, и таблице «было/стало» — поэтому отдельно от вёрстки.
import { productName } from '../../api'

export type Rules = Record<string, any>
export type Path = (string | number)[]

/** Как показывать и редактировать число */
export type Kind =
  | 'percent' // ставка как есть: 14 → «14 %»
  | 'share'   // доля 0..1, в форме — проценты: 0.25 → «25 %»
  | 'pp'      // процентные пункты
  | 'rub'     // рубли
  | 'months'
  | 'days'
  | 'points'  // баллы фактора (со знаком)
  | 'score'   // порог балла (без знака)
  | 'times'   // множитель выручки
  | 'route'   // маршрут класса
  | 'raw'

export type Band = { lt?: number; lte?: number; gt?: number; gte?: number; eq?: number; points: number }
export type ClassRule = { name: string; min: number; limit_coef: number; rate_premium: number | null; route: string }
export type Product = {
  title: string; min_amount: number; max_amount: number; term_months: { min: number; max: number }
  base_rate: number; revenue_coef: number | null
}

// ——— Значения по пути ———

export function getAt(obj: any, path: Path): any {
  return path.reduce((node, key) => (node == null ? undefined : node[key]), obj)
}

export function setAt<T>(obj: T, path: Path, value: unknown): T {
  const next: any = structuredClone(obj)
  let node = next
  for (const key of path.slice(0, -1)) node = node[key]
  node[path[path.length - 1]] = value
  return next
}

export const pathKey = (path: Path) => path.join('.')

/** Изменённые «листья» черновика относительно действующей версии */
export type Change = { path: Path; before: unknown; after: unknown }

export function diff(base: any, draft: any, path: Path = []): Change[] {
  if (Object.is(base, draft)) return []
  const isObj = (v: unknown): v is any => v !== null && typeof v === 'object'
  if (isObj(base) && isObj(draft)) {
    const keys = Array.isArray(base) ? [...Array(Math.max(base.length, draft.length)).keys()] : [...new Set([...Object.keys(base), ...Object.keys(draft)])]
    return keys.flatMap(k => diff(base[k], draft[k], [...path, k]))
  }
  if (typeof base === 'number' && typeof draft === 'number' && Math.abs(base - draft) < 1e-9) return []
  return [{ path, before: base, after: draft }]
}

// ——— Словари ———

export const factorInfo: Record<string, { title: string; text: string; unit?: 'months' | 'coef' | 'share' | 'rub' }> = {
  BUSINESS_AGE: { title: 'Срок работы бизнеса', text: 'Сколько месяцев бизнес работает по данным реестра.', unit: 'months' },
  REVENUE_STABILITY: { title: 'Стабильность выручки', text: 'Разброс выручки по месяцам (коэффициент вариации): чем он меньше, тем ровнее выручка.', unit: 'coef' },
  DEBT_LOAD: { title: 'Долговая нагрузка', text: 'Какую долю выручки клиент уже отдаёт на платежи по кредитам — в Альфе и в других банках.', unit: 'share' },
  CREDIT_HISTORY: { title: 'Кредитная история', text: 'Просрочки по данным бюро кредитных историй.' },
  ALFA_HISTORY: { title: 'История в Альфе', text: 'Как клиент платил по прежним кредитам в Альфе.' },
  TAX_DEBT: { title: 'Налоговая задолженность', text: 'Долг перед ФНС на дату расчёта.', unit: 'rub' },
  INDUSTRY_RISK: { title: 'Отраслевой риск', text: 'Риск отрасли по коду ОКВЭД из реестра.' },
  ALFA_SHARE: { title: 'Доля оборотов в Альфе', text: 'Какая часть выручки по данным ФНС проходит через счёт в Альфе.', unit: 'share' },
  DATA_QUALITY: { title: 'Полнота данных', text: 'За сколько месяцев и из каких источников видна выручка.' },
}

export const sourceTitle: Record<string, string> = {
  registry: 'реестр', alfa_or_statement: 'Альфа или выписка', alfa_and_bki: 'Альфа и БКИ', bki: 'БКИ', alfa: 'Альфа',
  fns: 'ФНС', 'registry.okved': 'ОКВЭД из реестра', alfa_and_fns: 'Альфа и ФНС', all: 'все источники',
}

export const valueTitle: Record<string, string> = {
  CLEAN_12M: 'без просрочек', NO_HISTORY: 'нет истории', PAST_OVERDUE_LT_30: 'просрочка до 30 дней',
  PAST_OVERDUE_GTE_30: 'просрочка от 30 дней', GOOD_BORROWER: 'платил без просрочек', NOT_BORROWER: 'не брал кредитов',
  HAD_OVERDUE: 'были просрочки', low: 'низкий', medium: 'средний', high: 'высокий', ALFA_12M: 'Альфа, 12 мес.',
  ALFA_LT_12M: 'Альфа, до 12 мес.', STATEMENT_12M: 'выписка за 12 мес.', STATEMENT_6_11M: 'выписка за 6–11 мес.', FNS_ONLY: 'только ФНС',
}

export const routeTitle: Record<string, string> = { AUTO: 'Автоматически', MANUAL_REVIEW: 'Ручная проверка', REJECTED: 'Отказ' }
export const routeOptions = Object.entries(routeTitle).map(([key, content]) => ({ key, content }))

export const outcomeTitle: Record<string, string> = {
  APPROVED: 'Одобрено', COUNTER_OFFER: 'Контрпредложение', MANUAL_REVIEW: 'Ручная проверка', REJECTED: 'Отказ', INFO_REQUESTED: 'Запрос документов',
}

export const reasonTitle: Record<string, string> = {
  CLASS_D: 'класс D — на проверку', CLASS_E: 'класс E — низкий балл', AMOUNT_ABOVE_AUTO: 'сумма выше порога авторешения',
  MASS_ADDRESS: 'массовый адрес', NO_CAPACITY: 'не хватает платёжеспособности', BUSINESS_TOO_YOUNG: 'бизнесу меньше 3 мес.',
  LIQUIDATION: 'ликвидация', BANKRUPTCY: 'банкротство', CURRENT_OVERDUE: 'текущая просрочка', TAX_ACCOUNT_BLOCK: 'блокировка счетов ФНС',
  INVALID_LEGAL_ADDRESS: 'недостоверный адрес', STATEMENT_INVALID: 'выписка не сходится', SOURCE_UNAVAILABLE: 'источник недоступен',
  FNS_MISMATCH_HIGH: 'расхождение с ФНС',
}

export const flagTitle: Record<string, string> = {
  MASS_ADDRESS: 'Массовый адрес регистрации',
  AMOUNT_ABOVE_AUTO: 'Сумма выше порога второго одобрения',
  SOURCE_UNAVAILABLE: 'Источник данных не ответил после 3 попыток',
  FNS_MISMATCH_HIGH: 'Выписка расходится с ФНС больше чем на 30%',
}

export const stopTitle: Record<string, string> = {
  BUSINESS_TOO_YOUNG: 'Бизнесу меньше 3 месяцев', LIQUIDATION: 'Ликвидация или закрытие по реестру', BANKRUPTCY: 'Банкротство',
  CURRENT_OVERDUE: 'Текущая просрочка 30 дней и больше', TAX_ACCOUNT_BLOCK: 'ФНС заблокировала счета',
  INVALID_LEGAL_ADDRESS: 'Недостоверный юридический адрес', STATEMENT_INVALID: 'Выписка не сходится (запрос документов)',
}

export const purposeTitle: Record<string, string> = {
  cash_gap: 'Кассовый разрыв', inventory: 'Закупка товара', equipment: 'Оборудование', expansion: 'Развитие бизнеса',
  refinance: 'Рефинансирование', other: 'Другое',
}

/**
 * Название продукта — как во всём кабинете (очередь, карточка, журнал, кабинет клиента): «Оборотный кредит».
 * В rules.yaml у него другое название («Кредит на оборотные цели») — его берём, только если код продукта незнаком.
 */
export const productTitle = (rules: Rules | null | undefined, code: string) => {
  const name = productName(code)
  return name !== code ? name : rules?.products?.[code]?.title ?? code
}

export const assetTitle: Record<string, string> = { real_estate: 'Недвижимость', vehicle: 'Транспорт', equipment: 'Оборудование' }

// ——— Числа ———

const nf = (digits = 2) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits })
export const num = (v: number, digits = 2) => nf(digits).format(v)
export const rub = (v: number) => `${nf(0).format(Math.round(v))} ₽`
export const signed = (v: number) => (v > 0 ? `+${num(v)}` : v < 0 ? `−${num(Math.abs(v))}` : '0')

export const plural = (n: number, forms: [string, string, string]) => {
  const a = Math.abs(n)
  if (!Number.isInteger(a)) return forms[1]
  const n10 = a % 10, n100 = a % 100
  return forms[n10 === 1 && n100 !== 11 ? 0 : n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20) ? 1 : 2]
}
const points = (v: number) => plural(v, ['балл', 'балла', 'баллов'])

/** Единица справа в поле ввода (коротко, без склонения) */
export const suffix: Record<Kind, string> = {
  percent: '%', share: '%', pp: 'п.п.', rub: '₽', months: 'мес.', days: 'дн.', points: 'б.', score: 'б.', times: '× выручки', route: '', raw: '',
}

/**
 * Срок действия одобрения. Бэк пока не читает rules.outcome.offer_valid_days — срок зашит в коде
 * (backend/app/services/expiry.py, OFFER_VALID_DAYS = 30), поэтому на экране — только это число.
 */
export const OFFER_VALID_DAYS = 30

/** Значение для человека: «14 %», «5 000 000 ₽», «+10 баллов» */
export function formatValue(kind: Kind, v: unknown): string {
  if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) return '—'
  if (kind === 'route') return routeTitle[String(v)] ?? String(v)
  if (typeof v !== 'number') return String(v)
  switch (kind) {
    case 'percent': return `${num(v)} %`
    case 'share': return `${num(v * 100, 1)} %`
    case 'pp': return `${num(v)} п.п.`
    case 'rub': return rub(v)
    case 'months': return `${num(v, 0)} мес.`
    case 'days': return `${num(v, 0)} дн.`
    case 'points': return `${signed(v)} ${points(v)}`
    case 'score': return `${num(v, 0)} ${points(v)}`
    case 'times': return `${num(v)} × выручки`
    default: return num(v)
  }
}

/** Порог диапазона фактора — в единицах фактора */
function thresholdText(unit: string | undefined, v: number) {
  if (unit === 'share') return `${num(v * 100, 1)}%`
  if (unit === 'rub') return rub(v)
  return num(v)
}
const unitTail = (unit: string | undefined) => (unit === 'months' ? ' мес.' : '')

/**
 * Подписи диапазонов фактора по порядку проверки (срабатывает первый подходящий):
 * [lt 6, lt 12, gte 36] → «меньше 6 мес.», «6–12 мес.», «36 мес. и больше».
 */
export function bandLabels(bands: Band[], unit?: string): string[] {
  const t = (v: number) => thresholdText(unit, v)
  const tail = unitTail(unit)
  return bands.map((b, i) => {
    const prev = bands[i - 1]
    if (b.eq !== undefined) return b.eq === 0 && unit === 'rub' ? 'нет долга' : `ровно ${t(b.eq)}${tail}`
    if (b.lt !== undefined) return prev?.lt !== undefined ? `${t(prev.lt)} – ${t(b.lt)}${tail}` : `меньше ${t(b.lt)}${tail}`
    if (b.lte !== undefined) return prev?.eq !== undefined || prev?.lt !== undefined ? `до ${t(b.lte)}${tail}` : `не больше ${t(b.lte)}${tail}`
    if (b.gt !== undefined) return `больше ${t(b.gt)}${tail}`
    if (b.gte !== undefined) return prev?.gte !== undefined ? `${t(b.gte)} – ${t(prev.gte)}${tail}` : `${t(b.gte)}${tail} и больше`
    return '—'
  })
}

/** Есть ли ошибки в полях скоринга (тогда диапазон балла не считаем) */
export const hasScoringErrors = (errors: Record<string, string>) => Object.keys(errors).some(k => k.startsWith('scoring.'))

/** Возможный диапазон балла: база + минимум/максимум каждого фактора (честно считается из правил) */
export function scoreRange(rules: Rules): { min: number; max: number } {
  let min = Number(rules.scoring.base) || 0
  let max = min
  for (const f of Object.values<any>(rules.scoring.factors)) {
    const pts: number[] = f.bands ? f.bands.map((b: Band) => b.points) : Object.values(f.values ?? {})
    if (typeof f.only_fns_points === 'number') pts.push(f.only_fns_points)
    const clean = pts.filter(p => typeof p === 'number' && !Number.isNaN(p))
    if (clean.length) { min += Math.min(...clean); max += Math.max(...clean) }
  }
  return { min, max }
}

// ——— Подписи полей по пути ———

const pct = (v: number) => `${num(v * 100, 1)}%`

/** Подпись и единица любого редактируемого поля — для формы и списка изменений */
export function meta(path: Path, rules: Rules): { label: string; kind: Kind } {
  const key = pathKey(path)
  const fixed: Record<string, { label: string; kind: Kind }> = {
    'market.key_rate': { label: 'Ключевая ставка ЦБ', kind: 'percent' },
    'market.rate_floor_over_key': { label: 'Минимальная надбавка к ключевой', kind: 'pp' },
    'debt_load.max_payment_share': { label: 'Платежи по всем кредитам, не больше', kind: 'share' },
    'outcome.risk_manager_above': { label: 'Второе одобрение риск-менеджера — для сумм больше', kind: 'rub' },
    'outcome.offer_valid_days': { label: 'Срок действия одобрения', kind: 'days' },
    'limit.round_down_to': { label: 'Округление лимита вниз до', kind: 'rub' },
    'rate.collateral_discount_pp': { label: 'Скидка к ставке за залог', kind: 'pp' },
    'collateral.secured_max_amount': { label: 'Максимальная сумма с залогом', kind: 'rub' },
    'collateral.secured_max_term_months': { label: 'Максимальный срок с залогом', kind: 'months' },
    'seasonal_schedule.enabled_if_min_month_share_below': { label: 'Сезонный график: слабый месяц ниже', kind: 'share' },
    'seasonal_schedule.min_payment_share': { label: 'Сезонный график: платёж не меньше', kind: 'share' },
    'scoring.base': { label: 'Базовый балл', kind: 'score' },
  }
  if (fixed[key]) return fixed[key]
  const [a, b, c, d, e] = path
  if (a === 'rate' && b === 'alfa_share_discount') {
    return { label: `Скидка за обороты в Альфе от ${pct(rules.rate.alfa_share_discount[c as number]?.gte ?? 0)}`, kind: 'pp' }
  }
  if (a === 'collateral' && b === 'ltv') return { label: `${assetTitle[String(c)] ?? c}: доля от оценки`, kind: 'share' }
  if (a === 'classes') {
    const name = rules.classes[b as number]?.name ?? b
    const field: Record<string, { label: string; kind: Kind }> = {
      min: { label: 'балл от', kind: 'score' }, limit_coef: { label: 'доля лимита', kind: 'share' },
      rate_premium: { label: 'надбавка к ставке', kind: 'pp' }, route: { label: 'решение', kind: 'route' },
    }
    const f = field[String(c)] ?? { label: String(c), kind: 'raw' as Kind }
    return { label: `Класс ${name}: ${f.label}`, kind: f.kind }
  }
  if (a === 'products') {
    const title = productTitle(rules, String(b))
    if (c === 'term_months') return { label: `${title}: срок ${d === 'min' ? 'от' : 'до'}`, kind: 'months' }
    const field: Record<string, { label: string; kind: Kind }> = {
      base_rate: { label: 'базовая ставка', kind: 'percent' }, min_amount: { label: 'сумма от', kind: 'rub' },
      max_amount: { label: 'сумма до', kind: 'rub' }, revenue_coef: { label: 'лимит от выручки', kind: 'times' },
    }
    const f = field[String(c)] ?? { label: String(c), kind: 'raw' as Kind }
    return { label: `${title}: ${f.label}`, kind: f.kind }
  }
  if (a === 'scoring' && b === 'factors') {
    const code = String(c)
    const factor = rules.scoring.factors[code]
    const title = factorInfo[code]?.title ?? code
    if (d === 'bands') return { label: `${title}: ${bandLabels(factor.bands, factorInfo[code]?.unit)[e as number]}`, kind: 'points' }
    if (d === 'values') return { label: `${title}: ${valueTitle[String(e)] ?? e}`, kind: 'points' }
    if (d === 'only_fns_points') return { label: `${title}: только данные ФНС`, kind: 'points' }
  }
  return { label: key, kind: 'raw' }
}

/** В какой вкладке формы живёт поле — для счётчиков изменений на вкладках */
export type SectionId = 'factors' | 'classes' | 'limits' | 'rates' | 'routing' | 'collateral'

export function sectionOf(path: Path): SectionId {
  const [a, , c] = path
  if (a === 'scoring') return 'factors'
  if (a === 'classes') return c === 'route' ? 'routing' : 'classes'
  if (a === 'products') return c === 'base_rate' ? 'rates' : 'limits'
  if (a === 'market' || a === 'rate') return 'rates'
  if (a === 'outcome') return 'routing'
  if (a === 'collateral') return 'collateral'
  return 'limits'
}

/** Ошибки черновика до отправки на прогон: пустые поля и очевидные противоречия */
export function validate(draft: Rules, changes: Change[]): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const ch of changes) {
    if (ch.after === null || ch.after === undefined || (typeof ch.after === 'number' && Number.isNaN(ch.after))) errors[pathKey(ch.path)] = 'Введите число'
  }
  const classes: ClassRule[] = draft.classes ?? []
  classes.forEach((c, i) => {
    const prev = classes[i - 1]
    if (prev && typeof c.min === 'number' && typeof prev.min === 'number' && c.min >= prev.min) {
      errors[pathKey(['classes', i, 'min'])] ??= `Порог должен быть ниже, чем у класса ${prev.name}`
    }
  })
  // Класс — первый сверху, порог которого клиент набрал. Если у последнего порог выше 0,
  // клиенту с низким баллом класс не найдётся и расчёт на бэке упадёт.
  const last = classes[classes.length - 1]
  if (last && typeof last.min === 'number' && last.min > 0) {
    errors[pathKey(['classes', classes.length - 1, 'min'])] ??= 'Должен быть 0'
  }
  for (const [code, p] of Object.entries<Product>(draft.products ?? {})) {
    if (p.min_amount > p.max_amount) errors[pathKey(['products', code, 'max_amount'])] ??= 'Меньше минимальной суммы'
    if (p.term_months.min > p.term_months.max) errors[pathKey(['products', code, 'term_months', 'max'])] ??= 'Меньше минимального срока'
  }
  const key = draft.market?.key_rate
  if (typeof key === 'number' && (key <= 0 || key > 50)) errors['market.key_rate'] ??= 'От 0 до 50%'
  const share = draft.debt_load?.max_payment_share
  if (typeof share === 'number' && (share <= 0 || share > 1)) errors['debt_load.max_payment_share'] ??= 'От 1 до 100%'
  return errors
}
