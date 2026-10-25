import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Application, BankItem, MyApplications, request } from './api'
import { useSession } from './auth'
import { settledStatuses } from './common/status'

// Ключи кэша: после действия с заявкой инвалидируем ['application', id] и списки.
export const keys = {
  application: (id: string) => ['application', id] as const,
  myApplications: (businessId: string) => ['my-applications', businessId] as const,
  bankQueue: ['bank-queue'] as const,
  bankApplication: (id: string) => ['bank-application', id] as const,
  approvals: ['approvals'] as const,
}

// Заявка клиента; пока идёт автоматическая обработка или ждём банк — опрашиваем раз в 5 с.
export function useApplication(id: string | undefined) {
  const { token } = useSession()
  return useQuery({
    queryKey: keys.application(id ?? ''),
    queryFn: () => request<Application>(`/api/v1/applications/${id}`, {}, token),
    enabled: !!id,
    refetchInterval: q => (q.state.data && settledStatuses.includes(q.state.data.status) ? false : 5000),
  })
}

export function useMyApplications(businessId: string) {
  const { token } = useSession()
  return useQuery({
    queryKey: keys.myApplications(businessId),
    queryFn: () => request<MyApplications>(`/api/v1/applications?business_id=${businessId}`, {}, token),
    refetchInterval: 15000,
  })
}

export type QueueFilter = { status: string; product: string; mine: boolean; page: number }
export type QueuePage = { items: BankItem[]; total: number; page: number; page_size: number }

export function useBankQueue(f: QueueFilter, pageSize = 20) {
  const { token } = useSession()
  const params = new URLSearchParams({ page: String(f.page), page_size: String(pageSize) })
  if (f.status) params.set('status', f.status)
  if (f.product) params.set('product', f.product)
  if (f.mine) params.set('mine', 'true')
  return useQuery({
    queryKey: [...keys.bankQueue, params.toString()],
    queryFn: () => request<QueuePage>(`/api/v1/bank/applications?${params}`, {}, token),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  })
}
