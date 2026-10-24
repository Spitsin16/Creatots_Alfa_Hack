import { Amount } from '@alfalab/core-components/amount/esm'
import styles from './Money.module.css'

type Size = 'inherit' | 's' | 'm' | 'l' | 'xl'
type Tone = 'default' | 'secondary' | 'positive' | 'negative' | 'attention' | 'inverted'

export type MoneyProps = (
  | { /** Сумма в копейках — так деньги приходят из API (amount_kopecks, limit_kopecks…) */ kopecks: number; rubles?: never }
  | { /** Сумма в рублях — так приходят прогноз и советы (balance, shortfall, new_limit…) */ rubles: number; kopecks?: never }
) & {
  /**
   * Размер: inherit — как окружающий текст; s 16 / m 20 / l 32 / xl 44 px.
   * l — главная сумма карточки, xl — одна главная сумма экрана (лимит в предложении).
   */
  size?: Size
  tone?: Tone
  /** Слово перед суммой: «до», «≈», «от» */
  prefix?: string
  /** Жирность: по умолчанию bold, medium — для сумм в таблицах и списках */
  weight?: 'bold' | 'medium' | 'regular'
  className?: string
}

/** Деньги: копейки или рубли → «270 000 ₽» (до рубля, через Amount кита). */
export function Money({ kopecks, rubles, size = 'inherit', tone = 'default', prefix, weight = 'bold', className }: MoneyProps) {
  const value = Math.round(kopecks !== undefined ? kopecks / 100 : rubles ?? 0)
  const cls = [styles.money, styles[`size-${size}`], styles[`tone-${tone}`], styles[`weight-${weight}`], className].filter(Boolean).join(' ')
  return <span className={cls}>
    {prefix && <span className={styles.prefix}>{prefix} </span>}
    <Amount value={value} minority={1} currency="RUB" view="default" fontWeight={weight === 'regular' ? undefined : weight} transparentMinor={false} />
  </span>
}

/** Та же сумма строкой — для текста, title и aria-label: «270 000 ₽». */
export function formatMoney(value: { kopecks: number } | { rubles: number }) {
  const rub = 'kopecks' in value ? value.kopecks / 100 : value.rubles
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(rub))} ₽`
}
