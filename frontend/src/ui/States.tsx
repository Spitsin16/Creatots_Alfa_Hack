import { ReactNode } from 'react'
import { Button } from '@alfalab/core-components/button/esm'
import { Plate } from '@alfalab/core-components/plate/esm'
import { Skeleton } from '@alfalab/core-components/skeleton/esm'
import { ExclamationCircleMIcon } from '@alfalab/icons-glyph/ExclamationCircleMIcon'
import { Spinner } from '../common/Spinner'
import styles from './States.module.css'

export type EmptyStateProps = {
  /** Иконка из @alfalab/icons-glyph (MIcon), например <DocumentLinesMIcon /> */
  icon?: ReactNode
  title: ReactNode
  text?: ReactNode
  /** Кнопка или ссылка, которая выводит из пустого состояния */
  action?: ReactNode
  /** Без белой подложки и с меньшими полями — внутри Card */
  compact?: boolean
  className?: string
}

/** «Пусто»: заявок нет, документов нет, под фильтр ничего не попало. Всегда объясняет, что делать дальше. */
export function EmptyState({ icon, title, text, action, compact, className }: EmptyStateProps) {
  return <div className={[styles.empty, compact ? styles.compact : '', className].filter(Boolean).join(' ')}>
    {icon && <div className={styles.emptyIcon} aria-hidden>{icon}</div>}
    <div className={styles.emptyTitle}>{title}</div>
    {text && <div className={styles.emptyText}>{text}</div>}
    {action && <div className={styles.emptyAction}>{action}</div>}
  </div>
}

export type LoadingStateProps = {
  /** Что именно грузим: «Загружаем заявку…» */
  label?: string
  /**
   * block — белый блок со спиннером (по умолчанию, вместо карточки);
   * inline — спиннер с подписью в строку (внутри карточки);
   * page — по центру экрана (пока нет данных для всей страницы);
   * skeleton — серые полосы-заглушки (списки, таблицы).
   */
  view?: 'block' | 'inline' | 'page' | 'skeleton'
  /** Сколько полос у skeleton */
  rows?: number
  className?: string
}

/** Загрузка: спиннер кита с подписью или скелетон. */
export function LoadingState({ label = 'Загружаем…', view = 'block', rows = 3, className }: LoadingStateProps) {
  if (view === 'skeleton') {
    return <div className={[styles.skeleton, className].filter(Boolean).join(' ')} role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} visible animate borderRadius={12} className={styles.skeletonRow} style={{ width: i === rows - 1 && rows > 1 ? '60%' : '100%' }} />)}
    </div>
  }
  const cls = [styles.loading, styles[`loading-${view}`], className].filter(Boolean).join(' ')
  return <div className={cls}><Spinner label={label} size={view === 'inline' ? 16 : 24} /></div>
}

export type ErrorStateProps = {
  /** Ошибка из useQuery/useMutation (error.message), строка или что угодно */
  error?: unknown
  /** Заголовок; по умолчанию «Не получилось загрузить данные» */
  title?: ReactNode
  /** Кнопка «Повторить» — передайте refetch() */
  onRetry?: () => void
  /** Подпись кнопки повтора */
  retryLabel?: string
  className?: string
}

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' && error ? error : 'Проверьте соединение и попробуйте ещё раз.'

/** Ошибка запроса: красная плашка кита с текстом и кнопкой «Повторить». Вместо белого экрана. */
export function ErrorState({ error, title = 'Не получилось загрузить данные', onRetry, retryLabel = 'Повторить', className }: ErrorStateProps) {
  return <Plate
    view="negative"
    title={title}
    leftAddons={<ExclamationCircleMIcon className={styles.errorIcon} />}
    buttons={onRetry ? [<Button key="retry" onClick={() => onRetry()}>{retryLabel}</Button>] : undefined}
    className={[styles.error, className].filter(Boolean).join(' ')}
  >
    {errorText(error)}
  </Plate>
}
