// Запросы рабочего места банка. Ключи кэша — от keys из queries.ts, чтобы после решения
// инвалидация ['bank-queue'] / ['bank-application', id] / ['approvals'] обновляла всё сразу.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BankItem, DocItem, request } from '../../api'
import { useSession } from '../../auth'
import { keys, QueuePage } from '../../queries'

export type InternalDecision = {
  id: string; rules_version: number; score: number; cls: string; factors: Record<string, number>; stop_factors: string[]
  limit_kopecks: number; binding_constraint: string | null; rate: number | null; outcome: string; explanation: string | null
}

/** Снимки источников по бизнесу (как отдаёт /bank/applications/{id} → snapshots). Все поля необязательные. */
export type Snapshots = {
  REGISTRY?: {
    inn?: string; ogrn?: string; type?: string; okved?: string; region?: string; status?: string; reg_date?: string
    director?: { full_name?: string }; bankruptcy?: boolean; mass_address?: boolean; address_invalid?: boolean
  }
  FNS?: { regime?: string; tax_debt?: number; account_block?: boolean; annual_revenue?: Record<string, number> }
  BKI?: {
    external?: { bank?: string; product?: string; balance?: number; monthly_payment?: number; rate?: number; months_left?: number; overdue_days?: number }[]
    has_history?: boolean; current_overdue_days?: number; past_max_overdue_days_12m?: number
  }
  ALFA?: {
    account?: { opened?: string; balance?: number; balance_as_of?: string }
    credits?: { product?: string; balance?: number; monthly_payment?: number; overdue_days?: number; status?: string }[]
    transactions?: { date: string; kind: string; amount: number; direction: string }[]
  }
  PROFILE?: { assets_owned?: { kind?: string; title?: string; value?: number }[]; sandbox?: boolean }
  [source: string]: unknown
}

export type BankDetail = BankItem & {
  created_at: string; purpose: string; term_months: number
  snapshots: Snapshots; decisions: InternalDecision[]
}

export type RiskItem = {
  approval_id: string; application_id: string; business_name: string; amount_kopecks: number
  proposed_outcome: string; underwriter_comment: string; decision_id?: string
}

export type AuditItem = {
  id: string; actor_id: string | null; actor_name: string | null; action: string; entity: string; entity_id: string
  before: Record<string, unknown> | null; after: Record<string, unknown> | null; at: string
}

export function useBankApplication(id: string) {
  const { token } = useSession()
  return useQuery({
    queryKey: keys.bankApplication(id),
    queryFn: () => request<BankDetail>(`/api/v1/bank/applications/${id}`, {}, token),
    enabled: !!id,
    refetchInterval: 5000,
  })
}

export function useApplicationDocuments(id: string) {
  const { token } = useSession()
  return useQuery({
    queryKey: ['application-documents', id],
    queryFn: () => request<{ items: DocItem[] }>(`/api/v1/applications/${id}/documents`, {}, token).then(x => x.items),
    refetchInterval: 15000,
  })
}

/** События по заявке из журнала аудита (у сотрудника банка нет доступа к клиентскому таймлайну). */
export function useApplicationHistory(id: string) {
  const { token } = useSession()
  return useQuery({
    queryKey: [...keys.bankApplication(id), 'history'],
    queryFn: () => request<{ items: AuditItem[]; total: number }>(`/api/v1/bank/audit?entity_id=${encodeURIComponent(id)}&page_size=200`, {}, token),
    refetchInterval: 10000,
  })
}

export function useRiskApprovals(enabled = true) {
  const { token } = useSession()
  return useQuery({
    queryKey: keys.approvals,
    // Бэк отдаёт и «зависшие» согласования по заявкам, которые уже не на ручной проверке (например, истёк срок
    // после двойного одобрения) — подтвердить их нельзя (409), поэтому показываем только заявки на ручной проверке.
    queryFn: async () => {
      const [items, review] = await Promise.all([
        request<RiskItem[]>('/api/v1/bank/approvals', {}, token),
        request<QueuePage>('/api/v1/bank/applications?status=MANUAL_REVIEW&page=1&page_size=100', {}, token),
      ])
      const open = new Set(review.items.map(x => x.id))
      return items.filter(x => open.has(x.application_id))
    },
    enabled,
    refetchInterval: 5000,
  })
}

/** Сколько заявок в статусе: лёгкий запрос page_size=1, берём total. */
export function useStatusCount(status: string, mine = false) {
  const { token } = useSession()
  const params = new URLSearchParams({ page: '1', page_size: '1' })
  if (status) params.set('status', status)
  if (mine) params.set('mine', 'true')
  return useQuery({
    queryKey: [...keys.bankQueue, 'count', params.toString()],
    queryFn: () => request<QueuePage>(`/api/v1/bank/applications?${params}`, {}, token).then(x => x.total),
    refetchInterval: 15000,
  })
}

/**
 * Скоринговое решение заявки: автоматический расчёт, а не копия, созданная решением специалиста.
 * Решения идут от новых к старым; авторасчёт на ручную проверку — с исходом MANUAL_REVIEW,
 * иначе берём самый ранний (копии специалиста создаются позже).
 */
export function scoringDecision(decisions: InternalDecision[]): InternalDecision | undefined {
  return decisions.find(d => d.outcome === 'MANUAL_REVIEW') ?? decisions[decisions.length - 1]
}

/** Действия специалистов из журнала: какие решения приняли андеррайтер и риск-менеджер. */
export type Workflow = {
  /** Последнее решение андеррайтера ждёт второго одобрения риск-менеджера */
  pendingRisk: boolean
  /** Риск-менеджер вернул последнее решение андеррайтеру */
  returned: AuditItem | null
  lastUnderwriter: AuditItem | null
  lastRisk: AuditItem | null
}

export function useWorkflow(history: AuditItem[] | undefined): Workflow | null {
  return useMemo(() => {
    if (!history) return null
    // history — от новых к старым
    const lastUnderwriter = history.find(h => h.action.startsWith('UNDERWRITER_')) ?? null
    const lastRisk = history.find(h => h.action.startsWith('RISK_')) ?? null
    const latest = history.find(h => h.action.startsWith('UNDERWRITER_') || h.action.startsWith('RISK_')) ?? null
    const pendingRisk = !!latest && latest.action.startsWith('UNDERWRITER_') && latest.after?.risk_required === true
    const returned = latest && latest.action === 'RISK_RETURN' ? latest : null
    return { pendingRisk, returned, lastUnderwriter, lastRisk }
  }, [history])
}

/**
 * Среднемесячная выручка по счёту в Альфе — считаем на фронте по операциям (подписываем «расчётно»).
 * Берём не больше 12 последних полных месяцев: последний месяц выписки отбрасываем, если он неполный.
 */
