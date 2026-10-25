import { ComponentType, ReactNode, SVGProps } from 'react'
import { Link } from 'react-router'
import { Typography } from '@alfalab/core-components/typography/esm'
import { ArrowBackMIcon } from '@alfalab/icons-glyph/ArrowBackMIcon'
import styles from './LoginFrame.module.css'

export type HeroPoint = { icon?: ComponentType<SVGProps<SVGSVGElement>>; title: string; text: string }

type Props = {
  /** Заголовок экрана (h1) */
  title: ReactNode
  /** Пояснение под заголовком */
  lead?: ReactNode
  /** Короткие факты под заголовком: что будет на экране (без иконок — только текст) */
  points?: HeroPoint[]
  /** Главное действие под заголовком */
  action?: ReactNode
  /** Мелкая строка внизу страницы */
  footnote?: ReactNode
  /** Ссылка «назад» над заголовком */
  back?: { to: string; label: string }
  /** Устаревшее: надзаголовок больше не выводим (правка ментора 25.10 — меньше «шаблонных» элементов) */
  eyebrow?: string
  children: ReactNode
}

/**
 * Каркас экранов входа (выбор учётки, путь не-клиента, песочница): спокойная светлая страница
 * в одну колонку, как служебные экраны интернет-банка. Сверху — строка бренда и пометка демо-стенда.
 */
export function LoginFrame({ title, lead, points, action, footnote, back, children }: Props) {
  return <div className={styles.page}>
    <header className={styles.bar}>
      <Link to="/login" className={styles.brand} aria-label="Альфа-Бизнес, к выбору учётки">
        <span className={styles.brandMark} aria-hidden>А</span>
        <span className={styles.brandName}>Альфа-Бизнес</span>
        <span className={styles.brandProduct}>Кредиты</span>
      </Link>
      <span className={styles.stand}>Демо-стенд, данные синтетические</span>
    </header>

    <main className={styles.main}>
      {back && <Link to={back.to} className={styles.back}><ArrowBackMIcon aria-hidden />{back.label}</Link>}
      <div className={styles.head}>
        <Typography.Title tag="h1" view="large" font="system" weight="bold" className={styles.title}>{title}</Typography.Title>
        {lead && <p className={styles.lead}>{lead}</p>}
        {points && <dl className={styles.points}>
          {points.map(p => <div key={p.title}><dt>{p.title}</dt><dd>{p.text}</dd></div>)}
        </dl>}
        {action && <div className={styles.action}>{action}</div>}
      </div>
      {children}
      {footnote && <p className={styles.footnote}>{footnote}</p>}
    </main>
  </div>
}
