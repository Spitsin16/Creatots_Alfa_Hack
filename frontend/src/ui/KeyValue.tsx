import { ReactNode } from 'react'
import styles from './KeyValue.module.css'

export type KeyValueItem = {
  label: ReactNode
  value: ReactNode
  /** Мелкая подпись под значением: «расчётно», «по выписке за 6 мес.» */
  hint?: ReactNode
  /** Уникальный ключ, если label не строка */
  key?: string
}

export type KeyValueProps = {
  items: (KeyValueItem | null | false | undefined)[]
  /**
   * rows — строки «название слева — значение справа» с разделителями (реквизиты, условия);
   * tiles — плитки «название сверху, крупное значение снизу» в несколько колонок (ставка / срок / платёж).
   */
  view?: 'rows' | 'tiles'
  /** Колонки для tiles (на узком экране складываются в 2, затем в 1) */
  columns?: 2 | 3 | 4
  className?: string
}

/** Список «название — значение». Пустые элементы (null/false) пропускаются — удобно для условных строк. */
export function KeyValue({ items, view = 'rows', columns = 3, className }: KeyValueProps) {
  const list = items.filter(Boolean) as KeyValueItem[]
  const cls = [styles.list, styles[view], view === 'tiles' ? styles[`cols-${columns}`] : '', className].filter(Boolean).join(' ')
  return <dl className={cls}>
    {list.map((item, i) => <div key={item.key ?? (typeof item.label === 'string' ? item.label : i)} className={styles.item}>
      <dt className={styles.label}>{item.label}</dt>
      <dd className={styles.value}>{item.value}{item.hint && <small className={styles.hint}>{item.hint}</small>}</dd>
    </div>)}
  </dl>
}
