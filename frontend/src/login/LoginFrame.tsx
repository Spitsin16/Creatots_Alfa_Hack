import { ComponentType, ReactNode, SVGProps, useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { Typography } from '@alfalab/core-components/typography/esm'
import { ArrowBackMIcon } from '@alfalab/icons-glyph/ArrowBackMIcon'
import styles from './LoginFrame.module.css'

export type HeroPoint = { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; text: string }

type Props = {
  /** Надзаголовок героя: «Умный кредитный кабинет» */
  eyebrow: string
  /** Главная фраза экрана (h1) */
  title: ReactNode
  /** Пояснение под заголовком */
  lead: ReactNode
  /** Три ценности продукта с иконками */
  points?: HeroPoint[]
  /** Главное действие в герое (красная кнопка) */
  action?: ReactNode
  /** Мелкая строка внизу героя */
  footnote?: ReactNode
  /** Ссылка «назад» над правой частью */
  back?: { to: string; label: string }
  children: ReactNode
}

const GAP = 16

/**
 * Герой прилипает при прокрутке, но никогда не обрезается. Помещается в окно — стоит сверху (top 16).
 * Выше окна — прилипает нижним краем: сначала уезжает ровно настолько, чтобы показать низ, и дальше стоит.
 */
function useStickyHero() {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => el.style.setProperty('--hero-top', `${Math.min(GAP, window.innerHeight - el.offsetHeight - GAP)}px`)
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(el)
    window.addEventListener('resize', update)
    return () => { observer?.disconnect(); window.removeEventListener('resize', update) }
  }, [])
  return ref
}

/**
 * Каркас экранов входа: слева тёмный герой с ценностью продукта (на десктопе прилипает при прокрутке),
 * справа — выбор учётки, путь не-клиента или песочница. На узком экране герой уходит наверх.
 */
export function LoginFrame({ eyebrow, title, lead, points, action, footnote, back, children }: Props) {
  const heroRef = useStickyHero()
  return <div className={styles.page}>
    <aside className={styles.hero} ref={heroRef}>
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden>А</span>
        <span className={styles.brandText}><b>Альфа-Бизнес</b><small>Кредиты для бизнеса</small></span>
      </div>

      <div className={styles.heroMain}>
        <div className={styles.eyebrow}>{eyebrow}</div>
        <Typography.Title tag="h1" view="xlarge" font="system" weight="bold" className={styles.title}>{title}</Typography.Title>
        <p className={styles.lead}>{lead}</p>
        {points && <ul className={styles.points}>
          {points.map(({ icon: Icon, title: pointTitle, text }) => <li key={pointTitle}>
            <span className={styles.pointIcon} aria-hidden><Icon /></span>
            <span><b>{pointTitle}</b><small>{text}</small></span>
          </li>)}
        </ul>}
        {action && <div className={styles.action}>{action}</div>}
      </div>

      {footnote && <div className={styles.footnote}>{footnote}</div>}
    </aside>

    <main className={styles.panel}>
      {back && <Link to={back.to} className={styles.back}><ArrowBackMIcon aria-hidden />{back.label}</Link>}
      {children}
    </main>
  </div>
}
