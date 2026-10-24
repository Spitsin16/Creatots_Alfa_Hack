import { useParams } from 'react-router'
import { Bell, PageHeader, Stack } from '../ui'
import { ReviewPanel, RiskQueue } from './ReviewPanel'
import { useRiskApprovals } from './workplace/data'
import styles from './BankPages.module.css'

// Карточка заявки — отдельная страница: на неё ведут очередь, согласования и уведомления.
export function BankApplicationPage() {
  const { id = '' } = useParams()
  return <ReviewPanel key={id} id={id} />
}

// Второе одобрение риск-менеджера: суммы больше 5 млн ₽ и одобрения вопреки скорингу.
export function RiskPage() {
  const list = useRiskApprovals()
  const count = list.data?.length
  return <Stack gap={24}>
    <PageHeader
      eyebrow="Кабинет банка"
      title="Согласования"
      subtitle="Второе одобрение решений андеррайтеров: суммы больше 5 млн ₽, одобрения вопреки скорингу (класс D–E) и выше расчётного лимита."
      actions={<>
        {count != null && <div className={styles.counter} aria-label={`Ждут решения: ${count}`}>
          <b>{count}</b><span>ждут<br />решения</span>
        </div>}
        <Bell />
      </>}
    />
    <RiskQueue />
  </Stack>
}

// Правила (RulesPage) и журнал (AuditRoute) — в RulesAdmin.tsx и AuditPage.tsx: так они грузятся отдельными частями.
