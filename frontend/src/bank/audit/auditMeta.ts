// Журнал аудита: коды действий → русские названия, понятные детали вместо сырого JSON.
// Коды собраны из всех записей GET /api/v1/bank/audit и из бэкенда (action="…").
import { productName } from '../../api'
import { statusName } from '../../common/status'
import { findPersona } from '../../demo/personas'
import { formatMoney } from '../../ui'
import { outcomeTitle } from '../rules/meta'

export type AuditItem = {
  id: string
  actor_id: string | null
  actor_name: string | null
  action: string
  entity: string
  entity_id: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  at: string
}
export type AuditPageData = { items: AuditItem[]; total: number; page: number; page_size: number }

export type Category = 'applications' | 'decisions' | 'client' | 'system' | 'rules'
export type Tone = 'positive' | 'negative' | 'attention' | 'info' | 'neutral'

export const categoryTitle: Record<Category, string> = {
  applications: 'Заявки',
  decisions: 'Решения банка',
  client: 'Действия клиента',
  system: 'Система и уведомления',
  rules: 'Правила',
}

export const actions: Record<string, { title: string; cat: Category; tone: Tone }> = {
  APPLICATION_CREATED: { title: 'Создана заявка', cat: 'applications', tone: 'neutral' },
  APPLICATION_AWAITS_SIGNATURE: { title: 'Заявка ждёт подписи руководителя', cat: 'applications', tone: 'attention' },
  APPLICATION_SUBMITTED: { title: 'Заявка отправлена в банк', cat: 'applications', tone: 'info' },
  APPLICATION_DOCUMENT_ADDED: { title: 'К заявке приложен документ', cat: 'applications', tone: 'neutral' },
  APPLICATION_CANCELLED: { title: 'Заявка отменена', cat: 'applications', tone: 'negative' },
  COUNTER_OFFER_ACCEPTED: { title: 'Клиент принял другие условия', cat: 'applications', tone: 'positive' },
  COUNTER_OFFER_DECLINED: { title: 'Клиент отказался от других условий', cat: 'applications', tone: 'negative' },
  CONTRACT_SIGNED: { title: 'Договор подписан кодом', cat: 'applications', tone: 'positive' },
  CREDIT_ISSUED: { title: 'Кредит выдан', cat: 'applications', tone: 'positive' },
  OFFER_EXPIRED: { title: 'Истёк срок одобрения', cat: 'applications', tone: 'negative' },

  AUTOMATIC_DECISION_CREATED: { title: 'Автоматическое решение', cat: 'decisions', tone: 'info' },
  APPLICATION_ASSIGNED: { title: 'Заявка взята в работу', cat: 'decisions', tone: 'info' },
  APPLICATION_UNASSIGNED_SLA: { title: 'Заявка вернулась в очередь по сроку', cat: 'decisions', tone: 'attention' },
  UNDERWRITER_APPROVE: { title: 'Андеррайтер одобрил', cat: 'decisions', tone: 'positive' },
  UNDERWRITER_COUNTER_OFFER: { title: 'Андеррайтер предложил другие условия', cat: 'decisions', tone: 'attention' },
  UNDERWRITER_REQUEST_INFO: { title: 'Андеррайтер запросил документы', cat: 'decisions', tone: 'attention' },
  UNDERWRITER_REJECT: { title: 'Андеррайтер отказал', cat: 'decisions', tone: 'negative' },
  RISK_APPROVE: { title: 'Риск-менеджер согласовал', cat: 'decisions', tone: 'positive' },
  RISK_RETURN: { title: 'Риск-менеджер вернул на проверку', cat: 'decisions', tone: 'attention' },

  CONSENTS_GIVEN: { title: 'Клиент дал согласия на запросы', cat: 'client', tone: 'neutral' },
  PRE_OFFER_CREATED: { title: 'Рассчитано предложение', cat: 'client', tone: 'neutral' },
  STATEMENT_APPLIED: { title: 'Учтена выписка другого банка', cat: 'client', tone: 'positive' },
  DOCUMENT_UPLOADED: { title: 'Загружен документ', cat: 'client', tone: 'neutral' },
  CHAT_MESSAGE: { title: 'Сообщение в чате заявки', cat: 'client', tone: 'neutral' },
  ASSISTANT_ASKED: { title: 'Вопрос ассистенту', cat: 'client', tone: 'neutral' },
  SANDBOX_CLIENT_CREATED: { title: 'Создан клиент в песочнице', cat: 'client', tone: 'neutral' },

  SOURCES_REQUESTED: { title: 'Запрошены данные из источников', cat: 'system', tone: 'neutral' },
  EXPLANATION_GENERATED: { title: 'Подготовлено объяснение для клиента', cat: 'system', tone: 'neutral' },
  SMS_STUB: { title: 'SMS-уведомление (заглушка)', cat: 'system', tone: 'neutral' },
  DEMO_TIME_TRAVEL: { title: 'Перемотка времени (демо)', cat: 'system', tone: 'attention' },

  RULES_VERSION_CREATED: { title: 'Создана версия правил', cat: 'rules', tone: 'info' },
  RULES_ACTIVATED: { title: 'Включена версия правил', cat: 'rules', tone: 'attention' },
}

export const actionTitle = (code: string) => actions[code]?.title ?? code
export const actionTone = (code: string): Tone => actions[code]?.tone ?? 'neutral'
export const actionCategory = (code: string): Category | null => actions[code]?.cat ?? null

/** Опции фильтра: группы по смыслу */
export const actionGroups = (Object.keys(categoryTitle) as Category[]).map(cat => ({
  label: categoryTitle[cat],
  options: Object.entries(actions).filter(([, a]) => a.cat === cat).map(([key, a]) => ({ key, content: a.title })),
}))

// ——— Объект ———

export const shortId = (id: string) => (id.length > 12 ? id.slice(0, 8) : id)

export function entityTitle(item: AuditItem): string {
  switch (item.entity) {
    case 'application': return 'Заявка'
    case 'pre_offer': return 'Расчёт предложения'
    case 'business': return 'Клиент'
    case 'user': return 'Пользователь'
    case 'document': return 'Документ'
    case 'rules': return 'Правила'
    case 'system': return 'Стенд'
    default: return item.entity
  }
}

export function entityRef(item: AuditItem): string {
  if (item.entity === 'rules') return `версия ${item.entity_id}`
  if (item.entity === 'system') return item.entity_id === 'clock' ? 'часы демо' : item.entity_id
  if (item.entity === 'user' && typeof item.after?.to === 'string') return String(item.after.to)
  return `№ ${shortId(item.entity_id)}`
}

// ——— Кто ———

const rolePrefix = /^(Андеррайтер|Риск-менеджер|Админ правил)\s+/
/** Роль — как в боковом меню и профиле (бэк пишет сокращённо «Админ правил») */
const roleTitle: Record<string, string> = { 'Админ правил': 'Администратор правил' }

/**
 * «Андеррайтер Смирнова Е.» → имя «Смирнова Е.», роль «Андеррайтер»; без имени — «Система».
 * У сотрудников банка бэк всегда ставит роль перед фамилией, поэтому имя без роли — клиент.
 */
export function actor(item: AuditItem): { name: string; role: string; system: boolean } {
  if (!item.actor_name) return { name: 'Система', role: 'автоматически', system: true }
  const m = item.actor_name.match(rolePrefix)
  return m
    ? { name: item.actor_name.replace(rolePrefix, ''), role: roleTitle[m[1]] ?? m[1], system: false }
    : { name: item.actor_name, role: 'Клиент', system: false }
}

/** Имена сотрудников по их номерам — из записей, где они сами действуют (бэк отдаёт в журнале только номер ответственного) */
export type People = ReadonlyMap<string, string>
export function peopleOf(items: AuditItem[]): People {
  const map = new Map<string, string>()
  for (const i of items) if (i.actor_id && i.actor_name && !map.has(i.actor_id)) map.set(i.actor_id, actor(i).name)
  return map
}

/** Ответственный по заявке: имя, если оно известно, иначе — без технического номера */
function assignee(item: AuditItem, people: People | undefined, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'не назначен'
  const id = String(v)
  if (id === item.actor_id && item.actor_name) return actor(item).name
  return people?.get(id) ?? 'сотрудник банка'
}

// ——— Детали ———

// Коды причин решений андеррайтера (бэк: REJECTION_REASONS + DOCS у запроса документов). Незнакомый код — «другое».
const reasonCode: Record<string, string> = {
  LOW_CAPACITY: 'недостаточная платёжеспособность', CREDIT_HISTORY: 'кредитная история', DATA_MISMATCH: 'данные не сходятся',
  DOCS: 'нужны документы', OTHER: 'другое',
}
const consentTitle: Record<string, string> = { BKI: 'БКИ', FNS: 'ФНС' }
const intentTitle: Record<string, string> = {
  APPLICATION_STATUS: 'статус заявки', CAN_TAKE: 'можно ли взять кредит', ENOUGH_MONEY: 'хватит ли денег',
  OVERPAYMENT: 'переплата и платёж', WHY_LIMIT: 'почему такой лимит', OUT_OF_SCOPE: 'вопрос не про кредит',
}
const sourceName: Record<string, string> = { bki: 'БКИ', fns: 'ФНС', alfa: 'Альфа', registry: 'реестр', mchd: 'МЧД' }
const docKind: Record<string, string> = { CHARTER: 'устав', MCHD: 'МЧД', STATEMENT: 'выписка', CONTRACT: 'договор', CERTIFICATE: 'справка', OTHER: 'прочее' }
const rubles = (v: unknown) => (typeof v === 'number' ? formatMoney({ rubles: v }) : String(v))
const rublesOrNone = (v: unknown) => (v === 0 ? 'нет' : rubles(v))
const word = (dict: Record<string, string>) => (v: unknown) => dict[String(v)] ?? String(v)

/** Параметры клиента песочницы (POST /sandbox/clients): подпись и единицы — по строке на параметр */
const sandboxParams: [key: string, label: string, format: (v: unknown) => string][] = [
  ['type', 'Форма', word({ IP: 'ИП', LLC: 'ООО' })],
  ['revenue', 'Выручка в месяц', rubles],
  ['age_months', 'Срок работы бизнеса', v => `${v} мес.`],
  ['industry', 'Отраслевой риск', word({ low: 'низкий', medium: 'средний', high: 'высокий' })],
  ['seasonality', 'Сезонность выручки', word({ none: 'нет', moderate: 'умеренная', strong: 'сильная' })],
  ['alfa_share', 'Доля оборотов в Альфе', v => (typeof v === 'number' ? `${Math.round(v * 100)} %` : String(v))],
  ['alfa_credit', 'Кредит в Альфе', word({ none: 'не брал', good: 'платил без просрочек', overdue: 'были просрочки' })],
  ['credit_history', 'Кредитная история', word({ clean: 'без просрочек', none: 'нет истории', past_lt30: 'просрочки до 30 дн.', past_gte30: 'просрочки от 30 дн.' })],
  ['current_overdue_days', 'Текущая просрочка', v => (v === 0 ? 'нет' : `${v} дн.`)],
  ['external_balance', 'Долг в другом банке', rublesOrNone],
  ['external_payment', 'Платёж в другом банке в месяц', rublesOrNone],
  ['tax_debt', 'Налоговый долг', rublesOrNone],
  ['real_estate_value', 'Имущество для залога', rublesOrNone],
  ['asset_kind', 'Вид имущества', word({ real_estate: 'недвижимость', vehicle: 'транспорт, спецтехника', equipment: 'оборудование' })],
]

const plural = (n: number, forms: [string, string, string]) => {
  const n10 = n % 10, n100 = n % 100
  return forms[n10 === 1 && n100 !== 11 ? 0 : n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20) ? 1 : 2]
}

/** Подписи полей деталей; null — техническое поле, не показываем */
const keyTitle: Record<string, string | null> = {
  status: 'Статус', version: 'Версия заявки', rules_version: 'Версия правил', outcome: 'Результат', decision_id: 'Решение',
  reason_code: 'Причина', risk_required: 'Нужно согласование риск-менеджера', assignee_id: 'Ответственный', kinds: 'Согласия',
  intent: 'Тема вопроса', to: 'Кому', note: 'Примечание', text: 'Текст', side: 'Кто написал', message_id: null,
  days: 'Перемотано, дней', expired: 'Истёк срок у заявок', attempts: 'Запросы к источникам', not_found: 'Не нашли данные в',
  unavailable: 'Не ответили', statement_id: 'Выписка', limit_kopecks: 'Лимит', pre_offer_id: 'Расчёт', active_version: 'Действующая версия правил',
  comment: 'Комментарий', changed_personas: 'Изменилось у клиентов', score: 'Балл', params: 'Параметры', reason: 'Причина',
  kind: 'Вид документа', document_id: 'Документ', business_id: 'Клиент', rate: 'Ставка', product: 'Продукт', term_months: 'Срок',
  amount_kopecks: 'Сумма', due_at: 'Срок взятия в работу', source: 'Как подготовлено', idempotency_key: null,
}

const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

function fmt(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') {
    if (key === 'assignee_id') return 'не назначен'
    return '—'
  }
  switch (key) {
    case 'status': return statusName[String(v)] ?? String(v)
    case 'outcome': return outcomeTitle[String(v)] ?? String(v)
    case 'reason_code': return reasonCode[String(v)] ?? reasonCode.OTHER
    case 'risk_required': return v ? 'да' : 'нет'
    case 'kinds': return Array.isArray(v) ? v.map(k => consentTitle[k] ?? k).join(', ') : String(v)
    case 'intent': return intentTitle[String(v)] ?? String(v)
    case 'side': return v === 'BANK' ? 'банк' : v === 'CLIENT' ? 'клиент' : String(v)
    case 'limit_kopecks': case 'amount_kopecks': return typeof v === 'number' ? formatMoney({ kopecks: v }) : String(v)
    case 'rate': return `${String(v).replace('.', ',')}%`
    case 'product': return productName(String(v))
    case 'term_months': return `${v} мес.`
    case 'kind': return docKind[String(v)] ?? String(v)
    case 'source': return v === 'LLM' ? 'языковая модель' : v === 'TEMPLATE' ? 'по шаблону' : String(v)
    case 'due_at': { const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? String(v) : dateTimeFmt.format(d) }
    case 'expired': return Array.isArray(v) ? (v.length ? `${v.length} ${plural(v.length, ['заявка', 'заявки', 'заявок'])}` : 'нет') : String(v)
    case 'not_found': case 'unavailable': return Array.isArray(v) ? (v.length ? v.map(x => sourceName[String(x)] ?? x).join(', ') : 'нет') : String(v)
    case 'attempts': return typeof v === 'object' ? Object.entries(v as Record<string, number>).map(([k, n]) => `${sourceName[k] ?? k}: ${n}`).join(', ') : String(v)
    case 'changed_personas': return Array.isArray(v) ? (v.length ? v.map(id => findPersona(String(id))?.title ?? id).join(', ') : 'ни у кого') : String(v)
    case 'assignee_id': return 'сотрудник банка'
    case 'decision_id': case 'statement_id': case 'pre_offer_id': case 'document_id': case 'business_id':
      return `№ ${shortId(String(v))}`
    default:
      if (typeof v === 'boolean') return v ? 'да' : 'нет'
      if (Array.isArray(v)) return v.map(String).join(', ')
      if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${String(x)}`).join(', ')
      return String(v)
  }
}

export type DetailRow = {
  key: string; label: string; value: string; before?: string; changed: boolean
  /** Список объектов (например, заявки с истёкшим сроком) — раскрывается по кнопке */
  refs?: string[]
  /** Широкая строка: на всю ширину блока деталей */
  wide?: boolean
}

/** Строки деталей: «было → стало» для изменившихся полей, просто значение для остальных */
export function detailRows(item: AuditItem, people?: People): DetailRow[] {
  const before = item.before ?? {}
  const after = item.after ?? {}
  const show = (key: string, v: unknown) => (key === 'assignee_id' ? assignee(item, people, v) : fmt(key, v))
  // Вложенные параметры — в конец, отдельными строками
  const keys = [...new Set([...Object.keys(after), ...Object.keys(before)])].sort((a, b) => Number(a === 'params') - Number(b === 'params'))
  return keys.flatMap((key): DetailRow[] => {
    const label = key in keyTitle ? keyTitle[key] : key
    if (label === null) return []
    const raw = key in after ? after[key] : before[key]
    if (key === 'params' && raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const params = raw as Record<string, unknown>
      const known = sandboxParams.filter(([k]) => k in params).map(([k, l, f]) => ({ key: `params.${k}`, label: l, value: f(params[k]), changed: false }))
      const rest = Object.keys(params).filter(k => !sandboxParams.some(([p]) => p === k)).map(k => ({ key: `params.${k}`, label: k, value: fmt(k, params[k]), changed: false }))
      return [...known, ...rest]
    }
    if (key === 'expired' && Array.isArray(raw) && raw.length) {
      return [{ key, label, value: fmt(key, raw), changed: false, refs: raw.map(String), wide: true }]
    }
    const inBefore = key in before
    const inAfter = key in after
    const b = show(key, before[key])
    const a = show(key, after[key])
    if (inBefore && inAfter && b !== a) return [{ key, label, value: a, before: b, changed: true }]
    const value = inAfter ? a : b
    // Пустые поля без изменений не показываем (например, «Причина: —» у одобрения)
    if (value === '—') return []
    return [{ key, label, value, changed: false }]
  })
}

const truncate = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** Короткая строка деталей для свёрнутой записи */
export function summary(item: AuditItem, people?: People): string {
  const b = item.before ?? {}
  const a = item.after ?? {}
  const statusChange = b.status && a.status && b.status !== a.status ? `${fmt('status', b.status)} → ${fmt('status', a.status)}` : ''
  switch (item.action) {
    case 'SMS_STUB': return typeof a.text === 'string' ? `«${truncate(a.text, 80)}»` : ''
    case 'CONSENTS_GIVEN': return fmt('kinds', a.kinds)
    case 'ASSISTANT_ASKED': return `Тема: ${fmt('intent', a.intent)}`
    case 'PRE_OFFER_CREATED': return `${fmt('outcome', a.outcome)} · правила v${a.rules_version ?? '—'}`
    case 'STATEMENT_APPLIED': return `Лимит ${fmt('limit_kopecks', b.limit_kopecks)} → ${fmt('limit_kopecks', a.limit_kopecks)}`
    case 'DEMO_TIME_TRAVEL': {
      const n = Array.isArray(a.expired) ? a.expired.length : 0
      return `+${a.days ?? '?'} дн. · ${n ? `истёк срок у ${n} ${plural(n, ['заявки', 'заявок', 'заявок'])}` : 'просроченных одобрений нет'}`
    }
    case 'RULES_VERSION_CREATED': return a.comment ? `«${truncate(String(a.comment), 70)}»` : 'без комментария'
    case 'RULES_ACTIVATED': return `Версия ${b.active_version ?? '—'} → ${a.active_version ?? '—'}`
    case 'APPLICATION_ASSIGNED': return a.assignee_id ? `Ответственный: ${assignee(item, people, a.assignee_id)}` : 'Ответственный снят'
    case 'APPLICATION_UNASSIGNED_SLA': return 'Ответственный снят — заявку не взяли вовремя'
    case 'CHAT_MESSAGE': return `Пишет ${fmt('side', a.side)}`
    case 'SOURCES_REQUESTED': {
      const un = Array.isArray(a.unavailable) ? a.unavailable : []
      return un.length ? `Не ответили: ${fmt('unavailable', un)}` : 'Все источники ответили'
    }
    case 'COUNTER_OFFER_ACCEPTED': return [fmt('product', a.product), fmt('amount_kopecks', a.amount_kopecks), a.rate != null ? fmt('rate', a.rate) : ''].filter(Boolean).join(' · ')
    case 'APPLICATION_CANCELLED': case 'COUNTER_OFFER_DECLINED': return a.reason ? truncate(String(a.reason), 80) : statusChange
    case 'DOCUMENT_UPLOADED': case 'APPLICATION_DOCUMENT_ADDED': return `Документ: ${fmt('kind', a.kind)}`
    case 'SANDBOX_CLIENT_CREATED': return [a.outcome ? fmt('outcome', a.outcome) : '', a.score != null ? `балл ${a.score}` : ''].filter(Boolean).join(' · ')
    case 'EXPLANATION_GENERATED': return fmt('source', a.source)
    case 'UNDERWRITER_APPROVE': case 'UNDERWRITER_COUNTER_OFFER': case 'UNDERWRITER_REQUEST_INFO': case 'UNDERWRITER_REJECT': {
      const parts = [statusChange || (a.risk_required ? 'Ждёт согласования риск-менеджера' : ''), a.reason_code ? `причина: ${fmt('reason_code', a.reason_code)}` : '']
      return parts.filter(Boolean).join(' · ')
    }
    default: {
      if (statusChange) return statusChange
      const first = detailRows(item, people)[0]
      return first ? `${first.label}: ${first.before ? `${first.before} → ` : ''}${first.value}` : ''
    }
  }
}
