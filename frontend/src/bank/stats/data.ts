// Сводка банка. Отдельного API статистики на бэке нет — собираем из того, что уже отдаёт стенд:
//  • GET /bank/applications — все заявки (≈200, две страницы по 100): статусы, продукты, классы, суммы, исполнители;
//  • GET /bank/audit?action=… — события журнала по нескольким кодам действий: авторешения, отправка заявки,
//    решения андеррайтера и риск-менеджера. Из них — доля авторешений и время от отправки до решения.
import { useQuery } from '@tanstack/react-query'
import { BankItem, request } from '../../api'
import { useSession } from '../../auth'
import { keys } from '../../queries'
import { AuditItem } from '../workplace/data'

export type StatsApp = BankItem & { created_at?: string }

const APPS_PAGE = 100 // больше бэк не отдаёт за раз
const AUDIT_PAGE = 200

/** Все страницы списка: первую берём сразу, остальные — параллельно (их число известно из total). */
async function fetchAll<T>(url: (page: number) => string, pageSize: number, token: string) {
  const first = await request<{ items: T[]; total: number }>(url(1), {}, token)
  const pages = Math.ceil(first.total / pageSize)
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
    request<{ items: T[]; total: number }>(url(i + 2), {}, token)))
  return [first, ...rest].flatMap(p => p.items)
}

export function useAllApplications() {
  const { token } = useSession()
  return useQuery({
    // под ключом очереди: решение по заявке инвалидирует ['bank-queue'] — сводка обновится вместе с очередью
    queryKey: [...keys.bankQueue, 'stats-all'],
    queryFn: () => fetchAll<StatsApp>(p => `/api/v1/bank/applications?page=${p}&page_size=${APPS_PAGE}`, APPS_PAGE, token),
    refetchInterval: 30000,
  })
}

/** Коды журнала, из которых считаются авторешения и время до решения. */
const AUDIT_ACTIONS = [
  'APPLICATION_SUBMITTED', 'AUTOMATIC_DECISION_CREATED',
  'UNDERWRITER_APPROVE', 'UNDERWRITER_COUNTER_OFFER', 'UNDERWRITER_REJECT', 'UNDERWRITER_REQUEST_INFO',
  'RISK_APPROVE', 'RISK_RETURN',
] as const

export function useDecisionAudit() {
  const { token } = useSession()
  return useQuery({
    queryKey: [...keys.bankQueue, 'stats-audit'],
    queryFn: async () => {
      // бэк фильтрует журнал только по одному коду действия — запрос на каждый код
      const lists = await Promise.all(AUDIT_ACTIONS.map(action => fetchAll<AuditItem>(
        p => `/api/v1/bank/audit?action=${action}&page=${p}&page_size=${AUDIT_PAGE}`, AUDIT_PAGE, token)))
      return lists.flat()
    },
    refetchInterval: 60000,
  })
}

// ——— Счётчики по списку заявок ———

/** Заявки, которые сейчас обрабатывает банк (автоматика или специалист). */
const IN_WORK = ['SUBMITTED', 'VALIDATION', 'ENRICHMENT', 'SCORING', 'MANUAL_REVIEW', 'INFO_REQUESTED']

export type Group = { key: string; count: number; amount: number }

function groupBy(apps: StatsApp[], key: (a: StatsApp) => string): Group[] {
  const map = new Map<string, Group>()
  for (const a of apps) {
    const k = key(a)
    const g = map.get(k) ?? { key: k, count: 0, amount: 0 }
    g.count += 1
    g.amount += a.amount_kopecks
    map.set(k, g)
  }
  return [...map.values()]
}

const sum = (apps: StatsApp[]) => apps.reduce((s, a) => s + a.amount_kopecks, 0)

export function queueStats(apps: StatsApp[]) {
  const manual = apps.filter(a => a.status === 'MANUAL_REVIEW')
  const inWork = apps.filter(a => IN_WORK.includes(a.status))
  const approved = apps.filter(a => a.status === 'APPROVED' || a.status === 'CONTRACT_SIGNED')
  const issued = apps.filter(a => a.status === 'ISSUED')
  return {
    total: apps.length,
    byStatus: groupBy(apps, a => a.status),
    byProduct: groupBy(apps, a => a.product).sort((a, b) => b.count - a.count),
    byClass: groupBy(apps, a => a.decision_class ?? '—'),
    manual: manual.length,
    unassigned: manual.filter(a => !a.assignee_id).length,
    overdue: apps.filter(a => a.question_overdue).length,
    openQuestions: apps.filter(a => a.open_question_due_at).length,
    inWork: { count: inWork.length, amount: sum(inWork) },
    approved: { count: approved.length, amount: sum(approved) },
    issued: { count: issued.length, amount: sum(issued) },
  }
}

// ——— Доля авторешений и время до решения (по журналу) ———

/** Итоговые исходы: всё, кроме отправки на ручную проверку и запроса документов. */
const FINAL = ['APPROVED', 'REJECTED', 'COUNTER_OFFER']

export type DecisionStats = {
  /** Заявки, по которым был автоматический расчёт */
  scored: number
  /** …и первый же расчёт дал итоговое решение (одобрение / контрпредложение / отказ) */
  auto: number
  /** …первый расчёт отправил на ручную проверку */
  manual: number
  /** Из ручных — по скольким специалисты уже приняли итоговое решение */
  manualDecided: number
  /** Секунды от отправки заявки до решения: среднее и медиана */
  autoTime: { avg: number; median: number } | null
  manualTime: { avg: number; median: number } | null
  /** Решение андеррайтера ждёт второго одобрения (последнее действие — его решение с risk_required) */
  pendingRisk: number
}

const time = (iso: string) => new Date(iso).getTime()
const byTime = (a: AuditItem, b: AuditItem) => time(a.at) - time(b.at)

function avgMedian(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return {
    avg: values.reduce((s, v) => s + v, 0) / values.length,
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
  }
}

/**
 * По каждой заявке: первое событие «отправлена в банк» и первое автоматическое решение.
 * Авторешение — если первый расчёт сразу дал итог. Иначе решение принял специалист: первое итоговое действие
 * андеррайтера без второго одобрения или подтверждение риск-менеджера. Время — от отправки до этого события.
 */
export function decisionStats(events: AuditItem[], statusById: Map<string, string>): DecisionStats {
  const byApp = new Map<string, AuditItem[]>()
  for (const e of events) {
    if (e.entity !== 'application') continue
    const list = byApp.get(e.entity_id) ?? []
    list.push(e)
    byApp.set(e.entity_id, list)
  }
  let auto = 0
  let manual = 0
  let pendingRisk = 0
  const autoTimes: number[] = []
  const manualTimes: number[] = []
  for (const [id, list] of byApp) {
    list.sort(byTime)
    const submitted = list.find(e => e.action === 'APPLICATION_SUBMITTED')
    const firstAuto = list.find(e => e.action === 'AUTOMATIC_DECISION_CREATED')
    const staff = list.filter(e => e.action.startsWith('UNDERWRITER_') || e.action.startsWith('RISK_'))
    const last = staff[staff.length - 1]
    if (last?.action.startsWith('UNDERWRITER_') && last.after?.risk_required === true && statusById.get(id) === 'MANUAL_REVIEW') pendingRisk += 1
    if (!firstAuto) continue
    const status = String(firstAuto.after?.status ?? '')
    if (FINAL.includes(status)) {
      auto += 1
      if (submitted) autoTimes.push((time(firstAuto.at) - time(submitted.at)) / 1000)
      continue
    }
    manual += 1
    const decided = staff.find(e =>
      (['UNDERWRITER_APPROVE', 'UNDERWRITER_COUNTER_OFFER', 'UNDERWRITER_REJECT'].includes(e.action) && e.after?.risk_required !== true)
      || e.action === 'RISK_APPROVE')
    if (decided && submitted) manualTimes.push((time(decided.at) - time(submitted.at)) / 1000)
  }
  return {
    scored: auto + manual, auto, manual, manualDecided: manualTimes.length,
    autoTime: avgMedian(autoTimes), manualTime: avgMedian(manualTimes), pendingRisk,
  }
}

/** Длительность словами: «0,4 с», «13 мин», «2 ч 5 мин», «3 дн. 4 ч». */
export function formatDuration(seconds: number) {
  const num = (v: number, digits = 0) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(v)
  if (seconds < 60) return `${num(seconds, seconds < 10 ? 1 : 0)} с`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours} ч ${minutes % 60} мин` : `${hours} ч`
  const days = Math.floor(hours / 24)
  return hours % 24 ? `${days} дн. ${hours % 24} ч` : `${days} дн.`
}

