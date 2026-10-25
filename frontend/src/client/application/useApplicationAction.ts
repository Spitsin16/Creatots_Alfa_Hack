import { useMutation, useQueryClient } from '@tanstack/react-query'
import { request } from '../../api'
import { useSession } from '../../auth'
import { documentKeys } from '../../common/Documents'
import { keys } from '../../queries'

/** consentSubmit — дать согласие на БКИ/ФНС и сразу отправить заявку (если бэк ответил «нужны согласия»). */
export type ActionKind = 'submit' | 'consentSubmit' | 'cancel' | 'sign' | 'accept' | 'decline'

const paths: Record<ActionKind, string> = {
  submit: 'submit', consentSubmit: 'submit', cancel: 'cancel', sign: 'sign', accept: 'counter-offer/accept', decline: 'counter-offer/decline',
}

/** Действия клиента по заявке. После любого — перечитываем заявку, список и документы. */
export function useApplicationAction(applicationId: string, businessId: string) {
  const { token } = useSession()
  const client = useQueryClient()
  const refresh = () => {
    void client.invalidateQueries({ queryKey: keys.application(applicationId) })
    void client.invalidateQueries({ queryKey: keys.myApplications(businessId) })
    void client.invalidateQueries({ queryKey: documentKeys.application(applicationId) })
  }
  const mutation = useMutation({
    mutationFn: async ({ kind, body }: { kind: ActionKind; body?: unknown }) => {
      if (kind === 'consentSubmit') {
        await request(`/api/v1/businesses/${businessId}/consents`, { method: 'POST', body: JSON.stringify({ kinds: ['BKI', 'FNS'] }) }, token)
      }
      // Повторное нажатие не создаст дубль: бэк принимает ключ идемпотентности на отправку и подпись.
      const headers: Record<string, string> = paths[kind] === 'submit' || kind === 'sign' ? { 'Idempotency-Key': `${applicationId}-${paths[kind]}` } : {}
      return request<unknown>(`/api/v1/applications/${applicationId}/${paths[kind]}`, { method: 'POST', body: JSON.stringify(body ?? {}), headers }, token)
    },
    onSuccess: refresh,
  })
  return { ...mutation, refresh, pendingKind: mutation.isPending ? mutation.variables?.kind : undefined }
}

export type ApplicationAction = ReturnType<typeof useApplicationAction>
