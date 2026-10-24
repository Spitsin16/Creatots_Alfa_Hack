import { createContext, ReactNode, useContext, useId } from 'react'
import { AmountInput } from '@alfalab/core-components/amount-input/esm'
import { NumberInput } from '@alfalab/core-components/number-input/esm'
import { Select } from '@alfalab/core-components/select/esm'
import { formatValue, getAt, Kind, meta, Path, pathKey, routeOptions, Rules, suffix } from './meta'
import styles from './RuleField.module.css'

/** Черновик правил, действующая версия и изменение значения — общие для всех полей формы */
export type RulesForm = {
  draft: Rules
  base: Rules
  errors: Record<string, string>
  set: (path: Path, value: unknown) => void
}

export const RulesFormContext = createContext<RulesForm | null>(null)

export function useRulesForm() {
  const ctx = useContext(RulesFormContext)
  if (!ctx) throw new Error('useRulesForm вне RulesFormContext')
  return ctx
}

const digits: Partial<Record<Kind, number>> = { percent: 2, pp: 2, times: 2, share: 1, points: 0, score: 0, months: 0, days: 0 }
const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d

export type RuleFieldProps = {
  path: Path
  /** Своя подпись вместо общей из meta (например, короткая — внутри таблицы классов) */
  label?: ReactNode
  /** Скрыть подпись (в таблицах она в заголовке колонки) */
  hideLabel?: boolean
  /** Подсказка под полем, когда значение не менялось */
  hint?: ReactNode
  /** Показывать единицу справа в поле */
  showSuffix?: boolean
  className?: string
}

/**
 * Поле правил на ките: число / рубли / маршрут. Изменённое относительно действующей версии значение
 * подсвечивается, под ним — «было …». Пустое поле — ошибка (не даём отправить на прогон).
 */
export function RuleField({ path, label, hideLabel, hint, showSuffix = true, className }: RuleFieldProps) {
  const { draft, base, errors, set } = useRulesForm()
  const id = useId()
  const { label: metaLabel, kind } = meta(path, base)
  const value = getAt(draft, path)
  const was = getAt(base, path)
  const changed = !(Object.is(value, was) || (typeof value === 'number' && typeof was === 'number' && Math.abs(value - was) < 1e-9))
  const error = errors[pathKey(path)]
  const shownLabel = hideLabel ? undefined : label ?? metaLabel
  const bottom = error ? undefined : changed ? <span className={styles.was}>Было: {formatValue(kind, was)}</span> : hint
  const cls = [styles.field, changed ? styles.changed : '', className].filter(Boolean).join(' ')
  // Поле кита не пробрасывает aria-label — без видимой подписи даём скрытый <label for>
  const hidden = hideLabel ? <label htmlFor={id} className={styles.srOnly}>{metaLabel}</label> : null

  if (kind === 'route') {
    return <div className={cls} data-changed={changed || undefined}>
      {hidden}
      <Select
        id={id}
        size={40}
        block
        label={shownLabel}
        labelView="outer"
        options={routeOptions}
        selected={String(value)}
        onChange={({ selected }) => selected && set(path, selected.key)}
        hint={bottom}
        error={error}
        fieldProps={{ fieldClassName: styles.control }}
        optionsSize={40}
      />
    </div>
  }

  if (kind === 'rub') {
    return <div className={cls} data-changed={changed || undefined}>
      {hidden}
      <AmountInput
        id={id}
        size={40}
        block
        label={shownLabel}
        labelView="outer"
        value={typeof value === 'number' ? value : null}
        minority={1}
        currency="RUB"
        integersOnly
        positiveOnly
        bold={false}
        transparentMinor={false}
        onChange={(_, { value: v }) => set(path, v)}
        hint={bottom}
        error={error}
        fieldClassName={styles.control}
      />
    </div>
  }

  const isShare = kind === 'share'
  const shown = typeof value === 'number' ? (isShare ? round(value * 100, 2) : value) : null
  return <div className={cls} data-changed={changed || undefined}>
    {hidden}
    <NumberInput
      id={id}
      size={40}
      block
      label={shownLabel}
      labelView="outer"
      value={shown}
      fractionLength={digits[kind] ?? 2}
      min={kind === 'points' ? -100 : 0}
      onChange={(_, { value: v }) => set(path, v === null ? null : isShare ? round(v / 100) : v)}
      rightAddons={showSuffix && suffix[kind] ? <span className={styles.suffix}>{suffix[kind]}</span> : undefined}
      hint={bottom}
      error={error}
      fieldClassName={styles.control}
    />
  </div>
}
