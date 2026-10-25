import { Status } from '@alfalab/core-components/status/esm'
import { statusName } from '../common/status'

export type StatusColor = 'green' | 'orange' | 'red' | 'grey' | 'blue'

// Цвет статуса по смыслу для человека:
// зелёный — хорошо / готово, оранжевый — ждём действия клиента, синий — банк работает,
// красный — отказ, серый — неактивно (черновик, отменена, истекла).
const colorByStatus: Record<string, StatusColor> = {
  APPROVED: 'green', CONTRACT_SIGNED: 'green', ISSUED: 'green',
  AWAITING_SIGNATURE: 'orange', INFO_REQUESTED: 'orange', COUNTER_OFFER: 'orange',
  SUBMITTED: 'blue', VALIDATION: 'blue', ENRICHMENT: 'blue', SCORING: 'blue', MANUAL_REVIEW: 'blue',
  REJECTED: 'red',
  DRAFT: 'grey', CANCELLED: 'grey', EXPIRED: 'grey',
}

/** Цвет статуса заявки (если нужен вне тега — например, для точки в таймлайне). */
export const statusColor = (status: string): StatusColor => colorByStatus[status] ?? 'grey'

export type StatusTagProps = {
  /** Код статуса заявки из API: APPROVED, MANUAL_REVIEW… */
  status: string
  /** Свой текст вместо русского имени статуса */
  children?: string
  /** 20 — в таблицах, 24 — по умолчанию, 32 — крупно в шапке заявки */
  size?: 20 | 24 | 32
  /** muted-alt — мягкая заливка (по умолчанию), contrast — насыщенная */
  view?: 'muted-alt' | 'contrast'
  className?: string
}

/** Статус заявки: русское имя (из common/status.ts) + цвет Status кита. */
export function StatusTag({ status, children, size = 24, view = 'muted-alt', className }: StatusTagProps) {
  return <Status color={statusColor(status)} view={view} size={size} shape="rounded" uppercase={false} className={className}>
    {children ?? statusName[status] ?? status}
  </Status>
}
