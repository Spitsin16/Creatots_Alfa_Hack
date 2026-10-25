import { ReactNode } from 'react'
import { Link } from 'react-router'
import { Typography } from '@alfalab/core-components/typography/esm'
import styles from './Card.module.css'

export type CardProps = {
  /** Заголовок секции (h2, 22px) */
  title?: ReactNode
  /** Пояснение под заголовком, серым */
  subtitle?: ReactNode
  /** Справа от заголовка: ссылка «Все», вторичная кнопка, тег статуса */
  actions?: ReactNode
  children?: ReactNode
  /**
   * default — белая карточка на сером фоне страницы;
   * muted — серая подложка (блок внутри белой карточки);
   * dark — тёмный акцентный блок (одна «герой»-карточка на экран, не больше);
   * outlined — белая с рамкой (карточка внутри белой карточки).
   */
  view?: 'default' | 'muted' | 'dark' | 'outlined'
  /** Внутренние поля: none 0 / s 16 / m 24 / l 28 (по умолчанию) */
  padding?: 'none' | 's' | 'm' | 'l'
  /** HTML-тег обёртки (по умолчанию section) */
  as?: 'section' | 'div' | 'article' | 'aside'
  /** Вся карточка — ссылка роутера (подсветка при наведении) */
  to?: string
  className?: string
  id?: string
}

/** Белая карточка-секция с заголовком и действиями справа. */
export function Card({ title, subtitle, actions, children, view = 'default', padding = 'l', as = 'section', to, className, id }: CardProps) {
  const cls = [styles.card, styles[`view-${view}`], styles[`pad-${padding}`], to ? styles.link : '', className].filter(Boolean).join(' ')
  const head = (title || actions) && <div className={styles.head}>
    <div className={styles.headText}>
      {title && <Typography.Title tag="h2" view="small" font="system" className={styles.title}>{title}</Typography.Title>}
      {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
    </div>
    {actions && <div className={styles.actions}>{actions}</div>}
  </div>
  const body = <>{head}{!title && !actions && subtitle && <div className={styles.subtitle}>{subtitle}</div>}{children}</>
  if (to) return <Link to={to} className={cls} id={id}>{body}</Link>
  const Tag = as
  return <Tag className={cls} id={id}>{body}</Tag>
}
