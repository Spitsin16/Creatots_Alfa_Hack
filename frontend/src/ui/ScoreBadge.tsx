import { scoreTone, toneTitle } from '../api'
import styles from './ScoreBadge.module.css'

export type ScoreBadgeProps = {
  /** Класс риска A–E (decision_class) */
  cls: string | null | undefined
  /** Балл скоринга */
  score: number | null | undefined
  /** Статус заявки: отказ красится чёрным независимо от класса */
  status?: string
  /** s — пилюля для таблиц, m — пилюля покрупнее, l — блок для карточки заявки */
  size?: 's' | 'm' | 'l'
  className?: string
}

/**
 * ТОЛЬКО ДЛЯ БАНКА. Балл и класс риска: буква класса + балл + цвет по scoreTone из api.ts
 * (зелёный — низкий риск, жёлтый — пограничный, красный — ручная проверка, чёрный — отказ).
 * Клиенту баллы и классы показывать нельзя (правило кейса).
 */
export function ScoreBadge({ cls, score, status, size = 's', className }: ScoreBadgeProps) {
  const tone = scoreTone(cls, status)
  const title = toneTitle[tone]
  const hasScore = score !== null && score !== undefined
  if (size === 'l') {
    return <div className={[styles.block, styles[tone], className].filter(Boolean).join(' ')}>
      <div className={styles.blockMain}>
        <span className={styles.blockLabel}>Балл скоринга</span>
        <b className={styles.blockScore}>{hasScore ? score : '—'}</b>
      </div>
      <div className={styles.blockSide}>
        <span className={styles.blockClass} aria-label={`Класс ${cls ?? 'не рассчитан'}`}>{cls ?? '—'}</span>
        <span className={styles.blockTone}>{title}</span>
      </div>
    </div>
  }
  return <span className={[styles.pill, styles[size], styles[tone], className].filter(Boolean).join(' ')} title={`Класс ${cls ?? '—'} · ${title}`}>
    {cls && <b className={styles.cls}>{cls}</b>}
    <span>{hasScore ? score : '—'}</span>
  </span>
}
