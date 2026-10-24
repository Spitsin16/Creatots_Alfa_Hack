import { Link } from 'react-router'
import { ArrowRightMIcon } from '@alfalab/icons-glyph/ArrowRightMIcon'
import { BanknotesMIcon } from '@alfalab/icons-glyph/BanknotesMIcon'
import { CalendarMIcon } from '@alfalab/icons-glyph/CalendarMIcon'
import { ChartLineAscMIcon } from '@alfalab/icons-glyph/ChartLineAscMIcon'
import { Card, Money } from '../../ui'
import type { Tip } from './tips'
import styles from './TipsCard.module.css'

const icons = { calendar: <CalendarMIcon />, loan: <BanknotesMIcon />, growth: <ChartLineAscMIcon /> }

/** «Подсказки для бизнеса»: 1–4 плитки-совета из данных клиента. Нет подсказок — нет карточки. */
export function TipsCard({ tips }: { tips: Tip[] }) {
  if (!tips.length) return null
  return <Card title="Подсказки для бизнеса" subtitle="Собрали из данных вашего счёта и заявок" className={styles.card}>
    <ul className={[styles.grid, styles[`cols${Math.min(tips.length, 4)}`]].join(' ')}>
      {tips.map(t => <li key={t.id} className={styles.tip}>
        <div className={styles.head}>
          <span className={[styles.icon, styles[t.tone]].join(' ')} aria-hidden>{icons[t.icon]}</span>
          <span className={styles.eyebrow}>{t.eyebrow}</span>
        </div>
        <div className={styles.title}>{t.title}</div>
        {t.amount != null && <Money rubles={t.amount} size="m" className={styles.amount} />}
        <p className={styles.text}>{t.text}</p>
        {t.action && (t.action.to
          ? <Link to={t.action.to} className={styles.action}>{t.action.label}<ArrowRightMIcon aria-hidden /></Link>
          : <button type="button" className={styles.action} onClick={t.action.onClick}>{t.action.label}<ArrowRightMIcon aria-hidden /></button>)}
      </li>)}
    </ul>
  </Card>
}
