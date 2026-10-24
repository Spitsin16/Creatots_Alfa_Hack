// Словари рабочего места банка: статусы, факторы, причины — языком андеррайтера.
// Только для кабинета банка (тут есть баллы и классы — клиенту это не показываем).

/** Статус заявки глазами сотрудника банка (у клиента формулировки другие — common/status.ts). */
export const bankStatusName: Record<string, string> = {
  DRAFT: 'Черновик',
  AWAITING_SIGNATURE: 'Ждёт подписи',
  SUBMITTED: 'Отправлена',
  VALIDATION: 'Проверка данных',
  ENRICHMENT: 'Сбор данных',
  SCORING: 'Скоринг',
  MANUAL_REVIEW: 'Ручная проверка',
  APPROVED: 'Одобрена',
  REJECTED: 'Отказ',
  COUNTER_OFFER: 'Контрпредложение',
  INFO_REQUESTED: 'Ждём документы',
  CANCELLED: 'Отменена',
  EXPIRED: 'Истёк срок',
  CONTRACT_SIGNED: 'Договор подписан',
  ISSUED: 'Выдана',
}

/** Что сейчас происходит с заявкой и чего ждём — подпись под статусом в панели решения. */
export const bankStatusHint: Record<string, string> = {
  DRAFT: 'Клиент ещё не отправил заявку.',
  AWAITING_SIGNATURE: 'Заявку подготовил сотрудник клиента, ждём подписи руководителя.',
  SUBMITTED: 'Заявка принята, идёт автоматическая обработка.',
  VALIDATION: 'Идёт автоматическая обработка.',
  ENRICHMENT: 'Запрашиваем данные из источников.',
  SCORING: 'Идёт автоматический расчёт.',
  APPROVED: 'Решение принято, ждём подписи договора клиентом.',
  COUNTER_OFFER: 'Клиенту отправлено контрпредложение, ждём его ответа.',
  INFO_REQUESTED: 'Ждём документы от клиента. Когда он их приложит, заявка снова пройдёт расчёт и вернётся в очередь.',
  REJECTED: 'По заявке отказ. Клиент видит причину и советы, как улучшить условия.',
  CONTRACT_SIGNED: 'Договор подписан, идёт выдача.',
  ISSUED: 'Деньги выданы клиенту.',
  CANCELLED: 'Клиент отменил заявку.',
  EXPIRED: 'Клиент не ответил вовремя, срок предложения истёк.',
}

export const productName: Record<string, string> = {
  OVERDRAFT: 'Овердрафт',
  WORKING_CAPITAL: 'Оборотный кредит',
  CREDIT_LINE: 'Кредитная линия',
  REFINANCE: 'Рефинансирование',
}

export const purposeName: Record<string, string> = {
  cash_gap: 'Закрыть кассовый разрыв',
  inventory: 'Закупка товара',
  equipment: 'Покупка оборудования',
  expansion: 'Развитие бизнеса',
  refinance: 'Рефинансирование кредитов',
  other: 'Другое',
}

/** Исход решения (автоматического или специалиста). */
export const outcomeName: Record<string, string> = {
  APPROVED: 'Одобрение',
  COUNTER_OFFER: 'Контрпредложение',
  MANUAL_REVIEW: 'Ручная проверка',
  INFO_REQUESTED: 'Запрос документов',
  REJECTED: 'Отказ',
}

export const factorName: Record<string, string> = {
  BUSINESS_AGE: 'Срок работы бизнеса',
  REVENUE_STABILITY: 'Стабильность выручки',
  DEBT_LOAD: 'Долговая нагрузка',
  CREDIT_HISTORY: 'Кредитная история (БКИ)',
  ALFA_HISTORY: 'Кредиты в Альфе',
  TAX_DEBT: 'Налоговая задолженность',
  INDUSTRY_RISK: 'Отраслевой риск',
  ALFA_SHARE: 'Доля оборотов в Альфе',
  DATA_QUALITY: 'Полнота данных',
}

/** Чем ограничен расчётный лимит (binding_constraint) — коротко и развёрнуто. */
export const bindingText: Record<string, { title: string; text: string }> = {
  REVENUE: {
    title: 'Обороты по счёту',
    text: 'Лимит рассчитан от среднемесячной чистой выручки с понижающим коэффициентом класса риска.',
  },
  CAPACITY: {
    title: 'Платёжеспособность',
    text: 'При большей сумме платёж вместе с текущими кредитами превысит допустимую долговую нагрузку.',
  },
  REFINANCE_BALANCE: {
    title: 'Остаток рефинансируемого долга',
    text: 'Лимит равен остатку долга в других банках по данным БКИ — больше рефинансировать нечего.',
  },
  PRODUCT_MAX: {
    title: 'Максимум продукта',
    text: 'Лимит упирается в максимальную сумму продукта по действующим правилам.',
  },
}

export const stopFactorName: Record<string, string> = {
  BUSINESS_TOO_YOUNG: 'Бизнес моложе минимального срока',
  LIQUIDATION: 'Ликвидация или закрытие по данным реестра',
  BANKRUPTCY: 'Сведения о банкротстве',
  CURRENT_OVERDUE: 'Текущая просрочка 30+ дней (БКИ)',
  TAX_ACCOUNT_BLOCK: 'Блокировка операций по счетам (ФНС)',
  INVALID_LEGAL_ADDRESS: 'Недостоверный юридический адрес (ЕГРЮЛ)',
  STATEMENT_INVALID: 'Выписка из другого банка не прошла проверку',
}

/** Коды причин отказа — те же, что принимает бэк (REJECTION_REASONS). */
export const rejectReasons: [string, string][] = [
  ['LOW_CAPACITY', 'Недостаточная платёжеспособность'],
  ['CREDIT_HISTORY', 'Негативная кредитная история'],
  ['DATA_MISMATCH', 'Данные не сходятся'],
  ['OTHER', 'Другая причина'],
]
export const rejectReasonName: Record<string, string> = Object.fromEntries(rejectReasons)

export const taxRegimeName: Record<string, string> = {
  USN6: 'УСН «доходы» 6%',
  USN15: 'УСН «доходы минус расходы» 15%',
  OSN: 'ОСНО',
  OSNO: 'ОСНО',
  PSN: 'Патент',
  AUSN: 'АУСН',
  NPD: 'НПД',
}

/** Порог второго одобрения риск-менеджера: сумма больше 5 млн ₽ (ТЗ, data/rules.yaml → outcome.risk_manager_above). */
export const RISK_THRESHOLD_KOPECKS = 500_000_000

/** Почему решению нужно второе одобрение риск-менеджера — те же условия, что проверяет бэк. */
export function riskReasons(action: string, amountKopecks: number, cls: string | null | undefined, limitKopecks: number | null | undefined): string[] {
  if (action !== 'APPROVE' && action !== 'COUNTER_OFFER') return []
  const reasons: string[] = []
  if (amountKopecks > RISK_THRESHOLD_KOPECKS) reasons.push('сумма больше 5 млн ₽')
  if (action === 'APPROVE' && (cls === 'D' || cls === 'E')) reasons.push(`одобрение вопреки скорингу (класс ${cls})`)
  if (action === 'APPROVE' && limitKopecks != null && amountKopecks > limitKopecks) reasons.push('сумма выше расчётного лимита')
  return reasons
}

/**
 * Причины второго одобрения для решения, которое уже ждёт риск-менеджера: исход из согласования/решения
 * (APPROVED / COUNTER_OFFER), предложенная сумма и скоринговое решение заявки (класс, расчётный лимит).
 */
export function pendingRiskReasons(outcome: string | null | undefined, amountKopecks: number | null | undefined, scoring: { cls: string; limit_kopecks: number } | undefined): string[] {
  if (!outcome || amountKopecks == null) return []
  return riskReasons(outcome === 'COUNTER_OFFER' ? 'COUNTER_OFFER' : 'APPROVE', amountKopecks, scoring?.cls, scoring?.limit_kopecks)
}

/** «Андеррайтер Смирнова Е.» → «Смирнова Е.» */
export const shortStaffName = (name: string | null | undefined) => (name ?? '').replace(/^(Андеррайтер|Риск-менеджер|Администратор правил)\s+/, '')

const dateTime = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const dateOnly = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const dateShort = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })

const parse = (iso: string | null | undefined) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}
/** «24 окт., 13:14» */
export const formatDateTime = (iso: string | null | undefined) => { const d = parse(iso); return d ? dateTime.format(d) : '' }
/** «24 октября 2026 г.» */
export const formatDate = (iso: string | null | undefined) => { const d = parse(iso); return d ? dateOnly.format(d) : '' }
/** «24.10.2026» */
export const formatDateShort = (iso: string | null | undefined) => { const d = parse(iso); return d ? dateShort.format(d) : '' }

/** Возраст в годах и месяцах: «8 лет 6 мес.» */
export function ageText(fromIso: string | null | undefined) {
  const d = parse(fromIso)
  if (!d) return ''
  const now = new Date()
  let months = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth()
  if (now.getDate() < d.getDate()) months -= 1
  if (months < 0) return ''
  const years = Math.floor(months / 12)
  const rest = months % 12
  const y = years % 10 === 1 && years % 100 !== 11 ? 'год' : [2, 3, 4].includes(years % 10) && ![12, 13, 14].includes(years % 100) ? 'года' : 'лет'
  if (years === 0) return `${rest} мес.`
  return rest ? `${years} ${y} ${rest} мес.` : `${years} ${y}`
}

export const percent = (value: number | null | undefined) =>
  value == null ? '—' : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)}%`
