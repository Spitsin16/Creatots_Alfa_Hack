import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router'
import { isBank, useSession } from '../auth'
import { DemoState, DemoUpdate, skipped } from './demoStore'
import { deadStatuses, Facts, finalStatuses, participantsOf, Scenario, Snapshot } from './scenarios'

// Следит за заявкой сценария из-под любой роли:
// клиент — /applications/{id} (и список заявок своего бизнеса, чтобы поймать только что созданную),
// банк — /bank/applications/{id} (и очередь, чтобы найти заявку клиента сценария по ИНН).
// Последнее увиденное сохраняется в состоянии панели — следующий участник видит шаг сразу, без мигания.
//
// Какая заявка «наша»: созданная после старта прогона (по часам сервера), у бизнеса клиента сценария
// и не из списка skip (прошлый прогон, чужая или старая заявка из адреса). Заявку из адреса страницы
// сначала проверяем по этим признакам и только потом показываем её шаги.
//
// Ждём ли риск-менеджера. Статус при этом тот же MANUAL_REVIEW, что и до решения андеррайтера.
// Банк узнаёт точно — по журналу аудита заявки, как карточка банка (bank/workplace/data.ts useWorkflow):
// последнее UNDERWRITER_* с risk_required — ждём, RISK_RETURN — вернули. Клиенту журнал не виден: у него
// «ждём» = последнее решение — одобрение и заявку ведёт специалист. После возврата риск-менеджером
// исполнитель снимается, а решение остаётся прежним — его запоминаем (returnedKey) и, пока оно не сменилось
// новым, считаем, что вернули, даже когда андеррайтер снова взял заявку.

const POLL_MS = 4000
/** После ошибки опрашиваем реже, пока связь не вернётся */
const RETRY_MS = 15_000
/** Запас на точность часов: заголовок Date — с точностью до секунды, плюс время ответа */
const SKEW_MS = 5000

const base = import.meta.env.VITE_API_URL ?? ''

/** Ошибка запроса с HTTP-кодом: 403/404 — заявка не наша (или её удалили), остальное — временный сбой. */
class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

/**
 * Часы сервера минус часы браузера, мс. Время создания заявки ставит сервер (БД),
 * а старт сценария — браузер; в Docker часы могут разойтись, поэтому сверяемся по заголовку Date.
 */
let clockOffset = 0

async function get<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  const date = Date.parse(response.headers.get('date') ?? '')
  if (!Number.isNaN(date)) clockOffset = date - Date.now()
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new HttpError(response.status, body.message ?? 'Не удалось выполнить запрос')
  return body as T
}

type DecisionView = { outcome: string; limit_kopecks?: number | null; rate?: number | null; explanation?: string | null }
type ClientApp = {
  id: string; status: string; amount_kopecks: number; created_at?: string; assignee_name?: string | null
  timeline?: { to_status: string }[]; decision?: DecisionView | null
}
type BankApp = {
  id: string; status: string; inn: string; business_name: string; amount_kopecks: number; created_at?: string; assignee_id: string | null
  decisions: DecisionView[]
}
type AuditEvent = { action: string; after: Record<string, unknown> | null }
type Listed = { id: string; status: string; created_at?: string; inn?: string }
/** risk — точный ответ банка из журнала (null — журнала не видно, решаем по признакам в п. 4) */
type Seen = { id: string; snapshot: Snapshot; inn: string | null; businessName: string | null; createdAt: number; risk: { pending: boolean; returned: boolean } | null }

const time = (value?: string) => (value ? Date.parse(value) : 0)
const final = (status: string) => finalStatuses.includes(status)
/** Одно и то же решение и клиент, и банк видят одинаково: исход, сумма, ставка, комментарий специалиста */
const decisionKey = (d?: DecisionView | null) => (d ? [d.outcome, d.limit_kopecks ?? '', d.rate ?? '', d.explanation ?? ''].join('|') : null)
const approvalOutcomes = ['APPROVED', 'COUNTER_OFFER']

/** Ждём ли риск-менеджера — по журналу заявки: последнее действие специалиста банка. */
function riskFromAudit(status: string, events: AuditEvent[]) {
  if (status !== 'MANUAL_REVIEW') return { pending: false, returned: false }
  const latest = events.find(e => e.action.startsWith('UNDERWRITER_') || e.action.startsWith('RISK_')) // от новых к старым
  return {
    pending: !!latest && latest.action.startsWith('UNDERWRITER_') && latest.after?.risk_required === true,
    returned: latest?.action === 'RISK_RETURN',
  }
}

const fromClient = (a: ClientApp): Seen => ({
  id: a.id,
  snapshot: {
    status: a.status,
    assigned: !!a.assignee_name,
    lastOutcome: a.decision?.outcome ?? null,
    everInfoRequested: (a.timeline ?? []).some(t => t.to_status === 'INFO_REQUESTED'),
    amountKopecks: a.amount_kopecks,
    lastLive: [...(a.timeline ?? [])].reverse().find(t => !deadStatuses.includes(t.to_status))?.to_status ?? null,
    decisionKey: decisionKey(a.decision),
  },
  inn: null,
  businessName: null,
  createdAt: time(a.created_at),
  risk: null,
})

const fromBank = (a: BankApp, audit: AuditEvent[] | null): Seen => ({
  id: a.id,
  snapshot: {
    status: a.status,
    assigned: !!a.assignee_id,
    lastOutcome: a.decisions[0]?.outcome ?? null,
    everInfoRequested: a.decisions.some(d => d.outcome === 'INFO_REQUESTED'),
    amountKopecks: a.amount_kopecks,
    // истории статусов в карточке банка нет — последний живой статус берём из того, что панель видела раньше
    lastLive: null,
    decisionKey: decisionKey(a.decisions[0]),
  },
  inn: a.inn,
  businessName: a.business_name,
  createdAt: time(a.created_at),
  risk: audit ? riskFromAudit(a.status, audit) : null,
})

/**
 * Ждём риск-менеджера или решение вернули. Банк знает точно (журнал); клиенту — по признакам:
 * на ручной проверке последнее решение — одобрение; исполнителя нет — значит, риск-менеджер его вернул
 * (запоминаем это решение); исполнитель есть — ждём риск-менеджера, если решение не то, что вернули.
 */
function riskState(seen: Seen, returnedKey: string | null) {
  const snap = seen.snapshot
  const key = snap.decisionKey ?? null
  if (seen.risk) {
    const { pending, returned } = seen.risk
    return { pending, returned, returnedKey: returned ? key : pending ? null : returnedKey }
  }
  const approvedLike = snap.status === 'MANUAL_REVIEW' && approvalOutcomes.includes(snap.lastOutcome ?? '')
  const nextKey = approvedLike && !snap.assigned ? key : returnedKey
  const returned = approvedLike && key !== null && key === nextKey
  return { pending: approvedLike && snap.assigned && !returned, returned, returnedKey: nextKey }
}

const sameSnapshot = (a: Snapshot | null, b: Snapshot) => !!a && JSON.stringify(a) === JSON.stringify(b)

/** Старт прогона по часам сервера, с запасом на точность. */
const since = (s: DemoState) => s.startedAt + clockOffset - SKEW_MS

/**
 * Самая новая заявка, созданная после старта прогона и не отмеченная как чужая.
 * Завершённые не отбрасываем: кофейня проходит путь до «Деньги выданы» за секунды, быстрее опроса.
 * Заявку прошлого прогона отсекает skip, а старые — время создания.
 */
const newest = (items: Listed[], s: DemoState) =>
  items
    .filter(i => !s.skip.includes(i.id) && time(i.created_at) >= since(s))
    .sort((a, b) => time(b.created_at) - time(a.created_at))[0]

/** Состояние связи с API для строки «Заявка» в панели. */
export type Sync = { error: string | null; retrying: boolean; refetch: () => void }

export function useScenarioTracking(scenario: Scenario | null, state: DemoState, update: (u: DemoUpdate) => void): { facts: Facts; sync: Sync } {
  const { token, me } = useSession()
  const { pathname } = useLocation()
  const bank = isBank(me.role)
  const tracks = !!scenario?.tracksApplication
  const participant = !!scenario && participantsOf(scenario).includes(me.login)
  const business = me.businesses[0]

  // 1. Что видно из адреса: расчёт предложения, заявка, посещённые экраны шагов; ИНН клиента сценария.
  useEffect(() => {
    if (!scenario) return
    update(s => {
      const patch: Partial<DemoState> = {}
      if (!bank && participant && business && s.inn !== business.inn) patch.inn = business.inn
      if (!bank && participant && business && s.businessName !== business.name) patch.businessName = business.name
      const offer = pathname.match(/^\/offer\/([^/]+)/)
      if (!bank && participant && offer && s.offerId !== offer[1]) patch.offerId = offer[1]
      const visited = scenario.steps
        .filter(step => step.actor === me.login && step.visit?.test(pathname) && !s.marks.includes(step.id))
        .map(step => step.id)
      if (visited.length) patch.marks = [...s.marks, ...visited]
      if (tracks && !s.appId) {
        // Только кандидат: пока не пришёл ответ (snapshot пуст), шаги по ней не отмечаются — см. проверку в п. 4.
        const fromUrl = bank ? pathname.match(/^\/bank\/applications\/([^/]+)$/) : participant ? pathname.match(/^\/applications\/([^/]+)$/) : null
        if (fromUrl && !s.skip.includes(fromUrl[1])) patch.appId = fromUrl[1]
      }
      return Object.keys(patch).length ? patch : null
    })
  }, [pathname, scenario, me.login, bank, participant, business, tracks, update])

  // 2. Клиент сценария: ловим заявку, созданную после старта.
  const mine = useQuery({
    queryKey: ['demo', 'my-applications', business?.id, me.login],
    queryFn: () => get<{ items: Listed[] }>(`/api/v1/applications?business_id=${business!.id}`, token),
    enabled: tracks && !bank && participant && !state.appId && !!business,
    refetchInterval: q => (q.state.status === 'error' ? RETRY_MS : POLL_MS),
    retry: false,
  })
  // 3. Сотрудник банка: ищем заявку клиента сценария в очереди по ИНН.
  const queue = useQuery({
    queryKey: ['demo', 'bank-queue', me.login],
    queryFn: () => get<{ items: Listed[] }>('/api/v1/bank/applications?page=1&page_size=50', token),
    enabled: tracks && bank && !state.appId && !!state.inn,
    refetchInterval: q => (q.state.status === 'error' ? RETRY_MS : POLL_MS),
    retry: false,
  })
  useEffect(() => {
    if (state.appId) return
    const items = !bank ? mine.data?.items : queue.data?.items.filter(i => i.inn === state.inn)
    if (!items) return
    update(s => {
      if (s.appId) return null
      const found = newest(items, s)
      return found ? { appId: found.id } : null
    })
  }, [mine.data, queue.data, bank, state.appId, state.inn, update])

  // 4. Статус заявки — из API, доступного текущей роли.
  const canSee = bank || participant
  const detail = useQuery({
    queryKey: ['demo', 'application', bank ? 'bank' : 'client', state.appId, me.login],
    queryFn: async () => {
      if (!bank) return fromClient(await get<ClientApp>(`/api/v1/applications/${state.appId}`, token))
      const [app, audit] = await Promise.all([
        get<BankApp>(`/api/v1/bank/applications/${state.appId}`, token),
        // журнал нужен только для «ждём риск-менеджера / вернули»; не открылся — решаем по признакам, как у клиента
        get<{ items: AuditEvent[] }>(`/api/v1/bank/audit?entity_id=${encodeURIComponent(state.appId!)}&page_size=50`, token).then(r => r.items, () => null),
      ])
      return fromBank(app, audit)
    },
    enabled: tracks && !!state.appId && canSee,
    // ошибка — реже (и без повторов на 4xx), завершённая заявка — больше не опрашиваем
    refetchInterval: q => (q.state.status === 'error' ? RETRY_MS : q.state.data && final(q.state.data.snapshot.status) ? false : POLL_MS),
    retry: (count, error) => !(error instanceof HttpError && error.status < 500) && count < 1,
  })
  useEffect(() => {
    const seen = detail.data
    if (!seen) return
    update(s => {
      if (seen.id !== s.appId) return null // ответ по заявке, которую панель уже забыла
      // Не наша: чужой бизнес; или заявка из адреса, созданная до старта прогона (snapshot ещё пуст — её не проверяли).
      const foreign = !!seen.inn && !!s.inn && seen.inn !== s.inn
      const old = !s.snapshot && seen.createdAt > 0 && seen.createdAt < since(s)
      if (foreign || old) return { appId: null, snapshot: null, returnedKey: null, skip: skipped(s, seen.id) }
      const patch: Partial<DemoState> = {}
      const before = s.snapshot
      const risk = riskState(seen, s.returnedKey)
      const snapshot: Snapshot = {
        ...seen.snapshot,
        lastLive: seen.snapshot.lastLive || !before ? seen.snapshot.lastLive : deadStatuses.includes(before.status) ? before.lastLive : before.status,
        riskPending: risk.pending,
        returned: risk.returned,
      }
      if (!sameSnapshot(before, snapshot)) patch.snapshot = snapshot
      if (risk.returnedKey !== s.returnedKey) patch.returnedKey = risk.returnedKey
      if (seen.inn && !s.inn) patch.inn = seen.inn
      if (seen.businessName && seen.businessName !== s.businessName) patch.businessName = seen.businessName
      return Object.keys(patch).length ? patch : null
    })
  }, [detail.data, update])
  // Нет доступа (чужая заявка) или её нет (стенд подняли с нуля) — забываем её и ищем заявку прогона заново.
  const lost = detail.error instanceof HttpError && (detail.error.status === 403 || detail.error.status === 404)
  useEffect(() => {
    if (!lost || !state.appId) return
    const id = state.appId
    update(s => (s.appId === id ? { appId: null, snapshot: null, returnedKey: null, skip: skipped(s, id) } : null))
  }, [lost, state.appId, update])

  const failed = !lost ? detail.error ?? (state.appId ? null : mine.error ?? queue.error) : null
  return {
    facts: { appId: state.appId, offerId: state.offerId, business: state.businessName, snapshot: state.snapshot, marks: state.marks },
    sync: {
      error: failed ? failed.message : null,
      retrying: detail.isFetching || mine.isFetching || queue.isFetching,
      refetch: () => { void (state.appId ? detail.refetch() : bank ? queue.refetch() : mine.refetch()) },
    },
  }
}
