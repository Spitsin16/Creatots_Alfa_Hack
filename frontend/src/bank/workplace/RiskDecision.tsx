import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@alfalab/core-components/button/esm'
import { Plate } from '@alfalab/core-components/plate/esm'
import { Textarea } from '@alfalab/core-components/textarea/esm'
import { request } from '../../api'
import { useSession } from '../../auth'
import { keys } from '../../queries'
import { RiskItem } from './data'
import styles from './RiskDecision.module.css'

export type RiskResult = { action: 'APPROVE' | 'RETURN'; application_id: string; status: string; result: string }

/**
 * Второе одобрение риск-менеджера: обязательный комментарий + «Подтвердить» / «Вернуть андеррайтеру».
 * У каждой строки согласований — своя форма со своим комментарием, ошибкой и ожиданием.
 */
export function RiskDecision({ approval, accent = false, onDone }: { approval: RiskItem; accent?: boolean; onDone?: (r: RiskResult) => void }) {
  const { token } = useSession()
  const client = useQueryClient()
  const [comment, setComment] = useState('')
  const [tried, setTried] = useState(false)
  const decide = useMutation({
    mutationFn: (action: 'APPROVE' | 'RETURN') => request<Omit<RiskResult, 'action'>>(`/api/v1/bank/approvals/${approval.approval_id}`, {
      method: 'POST', body: JSON.stringify({ action, comment: comment.trim() }),
    }, token),
    onSuccess: (r, action) => {
      setComment(''); setTried(false)
      onDone?.({ ...r, action })
      void client.invalidateQueries({ queryKey: keys.approvals })
      void client.invalidateQueries({ queryKey: keys.bankQueue })
      void client.invalidateQueries({ queryKey: keys.bankApplication(approval.application_id) })
    },
  })
  const commentError = comment.trim().length < 3 ? 'Напишите комментарий — не короче 3 символов' : ''
  const submit = (action: 'APPROVE' | 'RETURN') => {
    setTried(true)
    if (commentError) return
    decide.mutate(action)
  }
  return <div className={styles.form}>
    <Textarea
      label="Комментарий риск-менеджера"
      labelView="outer"
      placeholder="Почему подтверждаете или что нужно доработать"
      value={comment}
      onChange={(_, { value }) => setComment(value)}
      error={tried && commentError ? commentError : undefined}
      hint="Обязательно. Сохранится в истории согласования."
      minRows={2}
      maxLength={1000}
      autosize
      block
      size={48}
    />
    {decide.error && <Plate view="negative" title="Не получилось сохранить решение" className={styles.error}>{decide.error.message}</Plate>}
    <div className={styles.buttons}>
      <Button view={accent ? 'accent' : 'primary'} size={40} block loading={decide.isPending && decide.variables === 'APPROVE'} disabled={decide.isPending} onClick={() => submit('APPROVE')}>
        Подтвердить решение
      </Button>
      <Button view="secondary" size={40} block loading={decide.isPending && decide.variables === 'RETURN'} disabled={decide.isPending} onClick={() => submit('RETURN')}>
        Вернуть андеррайтеру
      </Button>
    </div>
  </div>
}
