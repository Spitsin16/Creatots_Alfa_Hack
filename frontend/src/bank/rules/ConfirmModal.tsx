import { ReactNode } from 'react'
import { Button } from '@alfalab/core-components/button/esm'
import { Modal } from '@alfalab/core-components/modal/esm'
import styles from './ConfirmModal.module.css'

export type ConfirmModalProps = {
  open: boolean
  title: ReactNode
  children: ReactNode
  confirmLabel: string
  loading?: boolean
  error?: string
  onConfirm: () => void
  onClose: () => void
  /** Вернуть фокус на кнопку, открывшую окно (после успешного действия — не нужно) */
  restoreFocus?: boolean
}

/** Подтверждение необратимого действия (включение версии правил, перемотка времени) — модальное окно кита. */
export function ConfirmModal({ open, title, children, confirmLabel, loading, error, onConfirm, onClose, restoreFocus = true }: ConfirmModalProps) {
  return <Modal open={open} onClose={() => { if (!loading) onClose() }} size={500} disableRestoreFocus={!restoreFocus}>
    <Modal.Header hasCloser title={title} />
    <Modal.Content>
      <div className={styles.body}>{children}</div>
      {error && <div className={styles.error} role="alert">{error}</div>}
    </Modal.Content>
    <Modal.Footer sticky layout="start" gap={16}>
      <Button view="accent" size={48} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
      <Button view="secondary" size={48} disabled={loading} onClick={onClose}>Отмена</Button>
    </Modal.Footer>
  </Modal>
}
