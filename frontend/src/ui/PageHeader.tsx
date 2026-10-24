import { ReactNode } from 'react'
import { Link } from 'react-router'
import { Typography } from '@alfalab/core-components/typography/esm'
import { ChevronBackMIcon } from '@alfalab/icons-glyph/ChevronBackMIcon'
import styles from './PageHeader.module.css'

export type BackLink = {
  /** Подпись ссылки: «Мои заявки», «Изменить ответы» */
  label: string
  /** Куда ведёт (ссылка роутера). Если не задано — нужен onClick */
  to?: string
  onClick?: () => void
}

export type PageHeaderProps = {
  /** Маленькая надпись над заголовком: название бизнеса, «Кабинет банка». Не вместе с back */
  eyebrow?: ReactNode
  /** Ссылка «назад» над заголовком — для вложенных экранов (заявка, предложение, карточка) */
  back?: BackLink
  title: ReactNode
  subtitle?: ReactNode
  /** Справа от заголовка: колокольчик <Bell />, метрика, вторичная кнопка */
  actions?: ReactNode
  className?: string
}

/** Шапка экрана: eyebrow или «назад», заголовок h1, подзаголовок, действия справа. */
export function PageHeader({ eyebrow, back, title, subtitle, actions, className }: PageHeaderProps) {
  return <header className={[styles.header, className].filter(Boolean).join(' ')}>
    <div className={styles.main}>
      {back && <BackButton {...back} />}
      {!back && eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
      <Typography.TitleResponsive tag="h1" view="medium" font="system" className={styles.title}>{title}</Typography.TitleResponsive>
      {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
    </div>
    {actions && <div className={styles.actions}>{actions}</div>}
  </header>
}

function BackButton({ label, to, onClick }: BackLink) {
  const content = <><ChevronBackMIcon className={styles.backIcon} aria-hidden /><span>{label}</span></>
  if (to) return <Link className={styles.back} to={to} onClick={onClick}>{content}</Link>
  return <button type="button" className={styles.back} onClick={onClick}>{content}</button>
}
