import { ProgressBar } from '@alfalab/core-components/progress-bar/esm'
import { Spinner as KitSpinner } from '@alfalab/core-components/spinner/esm'
import styles from './Spinner.module.css'

/**
 * Индикатор ожидания: кнопки и блоки, где система что-то считает или обрабатывает.
 * light — белый (на красной/тёмной кнопке). size 16 — в строку и в кнопку, 24 — в блок.
 */
export function Spinner({ label, light, size = 16 }: { label?: string; light?: boolean; size?: 16 | 24 }) {
  return <span className={[styles.wrap, light ? styles.light : ''].filter(Boolean).join(' ')} role="status" aria-live="polite">
    <KitSpinner preset={size} visible colors={light ? 'inverted' : 'default'} className={styles.spinner} />
    {label ? <span>{label}</span> : <span className={styles.srOnly}>Загрузка</span>}
  </span>
}

const steps = ['SUBMITTED', 'VALIDATION', 'ENRICHMENT', 'SCORING']
const stepText: Record<string, string> = {
  SUBMITTED: 'Заявка принята', VALIDATION: 'Проверяем данные', ENRICHMENT: 'Запрашиваем БКИ и ФНС', SCORING: 'Рассчитываем решение',
  CONTRACT_SIGNED: 'Зачисляем деньги на счёт',
}

// Полоса прогресса автоматической обработки заявки.
export function Processing({ status }: { status: string }) {
  const index = steps.indexOf(status)
  const share = status === 'CONTRACT_SIGNED' ? 90 : Math.max(10, ((index + 1) / (steps.length + 1)) * 100)
  return <div className={styles.processing}>
    <Spinner label={stepText[status] ?? 'Обрабатываем'} size={24} />
    <ProgressBar value={share} view="accent" size={4} className={styles.bar} />
    <small className={styles.hint}>Обычно это занимает несколько секунд — статус обновится сам</small>
  </div>
}
