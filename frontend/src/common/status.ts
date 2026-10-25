// Статусы заявки: русские имена, трек «как у посылки» и сроки, которые честно считаются из правил банка.

export const statusName: Record<string, string> = {
  DRAFT: 'Черновик', AWAITING_SIGNATURE: 'Ждёт руководителя', SUBMITTED: 'Отправлена', VALIDATION: 'Проверяем данные',
  ENRICHMENT: 'Запрашиваем данные', SCORING: 'Готовим решение', MANUAL_REVIEW: 'Проверяет специалист',
  APPROVED: 'Одобрено', REJECTED: 'Отказ', COUNTER_OFFER: 'Предложение банка', INFO_REQUESTED: 'Нужны документы',
  CANCELLED: 'Отменена', EXPIRED: 'Срок истёк', CONTRACT_SIGNED: 'Договор подписан', ISSUED: 'Деньги на счёте',
}

// Статусы, в которых заявка сама не меняется — ждём клиента или процесс завершён.
export const settledStatuses = ['DRAFT', 'ISSUED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'INFO_REQUESTED', 'COUNTER_OFFER']

// Заявка завершена: по ней больше ничего не произойдёт.
export const finalStatuses = ['ISSUED', 'REJECTED', 'CANCELLED', 'EXPIRED']

// Автоматическая обработка: воркер проходит эти шаги за секунды.
export const processingStatuses = ['SUBMITTED', 'VALIDATION', 'ENRICHMENT', 'SCORING']

/** Пять этапов трекера — то, что клиент видит как «путь посылки». */
export const trackSteps = ['Заявка отправлена', 'Проверка данных', 'Решение', 'Подписание', 'Деньги на счёте'] as const

/** Подписи этапов для конкретной заявки: пока заявка не отправлена, первый этап — «Отправка заявки». */
export function trackLabels(track: Track): string[] {
  const unsent = track.active === 1 && !track.doneAt[0]
  return trackSteps.map((label, i) => (i === 0 && unsent ? 'Отправка заявки' : label))
}

// На каком этапе (1…5) находится заявка в каждом статусе.
const stageOf: Record<string, number> = {
  DRAFT: 1, AWAITING_SIGNATURE: 1,
  SUBMITTED: 2, VALIDATION: 2, ENRICHMENT: 2, SCORING: 2,
  MANUAL_REVIEW: 3, INFO_REQUESTED: 3, COUNTER_OFFER: 3, REJECTED: 3,
  APPROVED: 4,
  CONTRACT_SIGNED: 5, ISSUED: 5,
}

// Каким статусом закрывается этап — его время подписываем под шагом.
const stageDoneBy: Record<number, string[]> = {
  1: ['SUBMITTED'],
  2: ['MANUAL_REVIEW', 'APPROVED', 'COUNTER_OFFER', 'REJECTED', 'INFO_REQUESTED'],
  3: ['APPROVED', 'REJECTED'],
  4: ['CONTRACT_SIGNED'],
  5: ['ISSUED'],
}

export type TimelineItem = { from_status: string | null; to_status: string; comment: string | null; at: string }

/** Состояние шага трекера: как рисовать индикатор кита Steps. */
export type StepMode = 'done' | 'current' | 'waiting' | 'action' | 'success' | 'failed' | 'stopped' | 'todo' | 'skipped'

export type Track = {
  /** Текущий этап, 1…5 */
  active: number
  modes: StepMode[]
  /** Время, когда этап завершился (ISO), — для подписи под шагом */
  doneAt: (string | null)[]
}

/** Где на треке заявка: какой этап текущий и как его рисовать. */
export function trackOf(status: string, timeline: TimelineItem[]): Track {
  let base = status
  // Отменённая или истёкшая — останавливаемся на том этапе, где это случилось.
  if (status === 'CANCELLED' || status === 'EXPIRED') {
    const last = [...timeline].reverse().find(t => t.to_status === status)
    base = last?.from_status ?? 'DRAFT'
  }
  const active = stageOf[base] ?? 1
  const currentMode: StepMode =
    status === 'REJECTED' ? 'failed'
      : status === 'CANCELLED' || status === 'EXPIRED' ? 'stopped'
        : status === 'ISSUED' ? 'success'
          : ['INFO_REQUESTED', 'COUNTER_OFFER', 'APPROVED'].includes(status) ? 'action'
            : [...processingStatuses, 'MANUAL_REVIEW', 'CONTRACT_SIGNED'].includes(status) ? 'waiting'
              : 'current'
  const modes = trackSteps.map((_, i): StepMode => {
    const n = i + 1
    if (n < active) return 'done'
    if (n === active) return currentMode
    return currentMode === 'failed' || currentMode === 'stopped' ? 'skipped' : 'todo'
  })
  const doneAt = trackSteps.map((_, i) => {
    const n = i + 1
    if (n > active || (n === active && currentMode !== 'success' && currentMode !== 'failed')) return null
    const hit = timeline.find(t => stageDoneBy[n]?.includes(t.to_status))
    return hit?.at ?? null
  })
  return { active, modes, doneAt }
}

/**
 * Системный комментарий бэка к переходу — словами для клиента. Бэк пишет их для журнала
 * («Клиент приложил документы», «Автоматическое решение готово» даже при передаче специалисту),
 * клиенту это путает. Незнакомые комментарии (слова специалиста) показываем как есть.
 */
export function clientComment(t: TimelineItem, product?: string): string | null {
  const c = t.comment?.trim()
  if (!c) return null
  switch (c) {
    case 'Автоматическое решение готово':
      return t.to_status === 'MANUAL_REVIEW' ? 'Заявку передали специалисту на проверку'
        : t.to_status === 'APPROVED' ? 'Одобрено автоматически'
          : t.to_status === 'COUNTER_OFFER' ? 'Банк подобрал другие условия'
            : 'Решение принято автоматически'
    case 'Клиент приложил документы': return 'Вы приложили документы'
    case 'Клиент принял предложение банка': return 'Вы приняли предложение банка'
    case 'Клиент отклонил предложение банка': return 'Вы отказались от предложения банка'
    case 'Клиент отменил заявку': return 'Вы отменили заявку'
    case 'Ожидается подпись руководителя': return 'Передана руководителю — отправить её может он'
    case 'Средства выданы на счёт':
      return product === 'OVERDRAFT' ? 'Лимит подключён к расчётному счёту'
        : product === 'REFINANCE' ? 'Деньги направлены на погашение кредита в другом банке' : c
  }
  if (t.to_status === 'EXPIRED' && /не принято за/i.test(c)) {
    return t.from_status === 'COUNTER_OFFER'
      ? `Предложение банка не принято за ${OFFER_VALID_DAYS} дней`
      : `Договор не подписан за ${OFFER_VALID_DAYS} дней`
  }
  return c
}

/** Из какого статуса заявка перешла в status в последний раз (например, что именно истекло). */
export function enteredFrom(status: string, timeline: TimelineItem[]): string | null {
  return [...timeline].reverse().find(t => t.to_status === status)?.from_status ?? null
}

/** Когда заявка вошла в статус в последний раз (для сроков). */
export function enteredAt(status: string, timeline: TimelineItem[]): Date | null {
  const hit = [...timeline].reverse().find(t => t.to_status === status)
  return hit ? new Date(hit.at) : null
}

// --- Сроки банка (те же правила, что на бэке: backend/app/services/notifications/sla.py) ---
// Рабочее время 9:00–18:00 по Москве (UTC+3), пн–пт; праздники в демо не учитываются.
const MSK_OFFSET_H = 3
const DAY_START = 9
const DAY_END = 18

/** Ответ в чате — 4 рабочих часа; ручная проверка — 1 рабочий день (9 рабочих часов). */
export const CHAT_ANSWER_HOURS = 4
export const REVIEW_HOURS = 9
/** Одобрение и предложение банка действуют 30 дней (ТЗ, раздел 8). */
export const OFFER_VALID_DAYS = 30

const toMsk = (d: Date) => new Date(d.getTime() + MSK_OFFSET_H * 3600_000)
const fromMsk = (d: Date) => new Date(d.getTime() - MSK_OFFSET_H * 3600_000)

function nextWorkStart(local: Date): Date {
  const d = new Date(local)
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60
  if (hours >= DAY_END) { d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(DAY_START, 0, 0, 0) }
  else if (hours < DAY_START) d.setUTCHours(DAY_START, 0, 0, 0)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) { d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(DAY_START, 0, 0, 0) }
  return d
}

/** Момент, к которому истекают N рабочих часов с from (как answer_due на бэке). */
export function workingDeadline(from: Date, hours: number): Date {
  let local = nextWorkStart(toMsk(from))
  let left = hours * 3600_000
  for (let guard = 0; guard < 60; guard++) {
    const end = new Date(local); end.setUTCHours(DAY_END, 0, 0, 0)
    if (local.getTime() + left <= end.getTime()) return fromMsk(new Date(local.getTime() + left))
    left -= end.getTime() - local.getTime()
    local = nextWorkStart(end)
  }
  return fromMsk(local)
}

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400_000)

/** «24 октября», «24 октября 2027» — год только если не текущий. */
export function formatDate(value: string | Date, withYear = false): string {
  const d = typeof value === 'string' ? new Date(value) : value
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(withYear || !sameYear ? { year: 'numeric' } : {}) }).replace(/\s*г\.$/, '')
}

/** «24.10, 13:05» — коротко для истории и шагов. */
export function formatDateTime(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
}

/** Срок по Москве: «26 октября, 18:00 мск». */
export function formatDeadline(d: Date): string {
  const local = toMsk(d)
  const day = local.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' })
  const time = local.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
  return `${day}, ${time} мск`
}

/**
 * Подпись кнопки, которая ведёт в трекер к нужному действию: «Перейти к подписанию».
 * Само действие (код, отправка) выполняется в трекере, поэтому на кнопке — переход, а не «Подпишите».
 */
export function clientActionGo(status: string, permissions: string[]): string | null {
  if (!clientAction(status, permissions)) return null
  switch (status) {
    case 'DRAFT': return permissions.includes('SUBMIT') ? 'Перейти к отправке' : 'Перейти к заявке'
    case 'AWAITING_SIGNATURE': return 'Перейти к отправке'
    case 'INFO_REQUESTED': return 'Перейти к документам'
    case 'COUNTER_OFFER': return 'Посмотреть предложение'
    case 'APPROVED': return 'Перейти к подписанию'
    default: return 'Открыть заявку'
  }
}

/**
 * Что клиенту сделать по заявке прямо сейчас (для списка заявок и шапки трекера).
 * null — ничего, ждём банк или заявка завершена.
 */
export function clientAction(status: string, permissions: string[]): string | null {
  const canSubmit = permissions.includes('SUBMIT')
  const canSign = permissions.includes('SIGN')
  const canFill = permissions.includes('FILL')
  switch (status) {
    case 'DRAFT': return canSubmit ? 'Отправьте заявку' : canFill ? 'Передайте директору' : null
    case 'AWAITING_SIGNATURE': return canSubmit ? 'Отправьте заявку' : null
    case 'INFO_REQUESTED': return canFill ? 'Загрузите документы' : null
    case 'COUNTER_OFFER': return canSubmit ? 'Ответьте на предложение' : null
    case 'APPROVED': return canSign ? 'Подпишите договор' : null
    default: return null
  }
}
