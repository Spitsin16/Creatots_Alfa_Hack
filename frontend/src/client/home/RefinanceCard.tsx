import { ReactNode } from 'react'
import { Link } from 'react-router'
import { Button } from '@alfalab/core-components/button/esm'
import { ArrowRightMIcon } from '@alfalab/icons-glyph/ArrowRightMIcon'
import { ArrowsCwMIcon } from '@alfalab/icons-glyph/ArrowsCwMIcon'
import { MyApplicationItem, Offer } from '../../api'
import { Card, Money, formatMoney } from '../../ui'
import type { OfferContext } from '../offerStore'
import { ForeignLoan, Loan, bankName, dayMonth } from './data'
import styles from './RefinanceCard.module.css'

export type RefinanceCardProps = {
  /** Кредиты в других банках из регулярных платежей прогноза (самый крупный первым) */
  loans: ForeignLoan[]
  /** Последний выданный кредит «Рефинансирование» и его график — для «было → стало» */
  issued?: { item: MyApplicationItem; loan: Loan } | null
  /** Активная (ещё не выданная) заявка на рефинансирование */
  active?: MyApplicationItem | null
  /** Последний расчёт в этой вкладке, если он про рефинансирование */
  offer?: { id: string; offer: Offer; context?: OfferContext } | null
  /** Заполнить анкету целью «Снизить платёж по кредиту» и проскроллить к ней */
  onCalc: () => void
  canCalc: boolean
}

/** «a, b и c» */
const listRu = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}` : items[0] ?? '')

/**
 * «Перенесите кредит в Альфу»: клиент платит по кредиту в другой банк (видно по регулярным платежам со счёта).
 * Остаток долга нам неизвестен — сумму клиент введёт в анкете сам. «Было → стало» показываем,
 * только когда есть реальный новый платёж: выданный кредит или расчёт рефинансирования.
 */
export function RefinanceCard({ loans, issued, active, offer, onCalc, canCalc }: RefinanceCardProps) {
  if (!loans.length) return null
  const main = loans[0]
  const total = loans.reduce((s, l) => s + l.amount, 0)
  const banks = listRu(loans.map(l => bankName(l.counterparty)))
  const oldLine = <>Вы платите <Money rubles={total} /> в месяц {loans.length > 1 ? 'по кредитам' : 'по кредиту'} в {banks}</>

  // 1. Кредит на рефинансирование уже выдан: старый платёж против ближайшего платежа в Альфу
  if (issued?.loan.next_payment) {
    const { loan, item } = issued
    const next = loan.next_payment!
    const seasonal = loan.seasonal && loan.min_payment != null && loan.max_payment != null && loan.max_payment - loan.min_payment >= 1
    return <Shell title="Рефинансирование выдано"
      text={<>Выдали <Money kopecks={item.amount_kopecks ?? 0} /> на перенос кредита. Сравните платежи:</>}
      compare={<Compare
        before={{ label: `Платёж в ${bankName(main.counterparty)}`, rubles: total, note: 'в месяц, по выписке счёта' }}
        after={{ label: 'Ближайший платёж в Альфу', rubles: next.payment, note: seasonal
          ? `${dayMonth(next.date)} · по сезонному графику от ${formatMoney({ rubles: loan.min_payment! })} до ${formatMoney({ rubles: loan.max_payment! })}`
          : dayMonth(next.date) }}
        saving={!seasonal && next.payment < total ? total - next.payment : null} />}
      action={<Link to={`/applications/${item.id}`} className={styles.link}>Открыть кредит<ArrowRightMIcon aria-hidden /></Link>} />
  }

  // 2. Заявка на перенос уже оформлена
  if (active) return <Shell title="Перенос кредита в Альфу"
    text={<>{oldLine}. Заявка на перенос уже оформлена.</>}
    action={<Link to={`/applications/${active.id}`} className={styles.link}>Открыть заявку на перенос<ArrowRightMIcon aria-hidden /></Link>} />

  // 3. В этой вкладке уже посчитали рефинансирование
  const newPayment = offer?.offer.payment_kopecks
  if (offer && newPayment != null && offer.offer.limit_kopecks > 0) {
    const before = offer.context?.refinance?.oldPaymentRub ?? total
    return <Shell title="Перенесите кредит в Альфу"
      text={<>{oldLine}. Вы уже посчитали перенос долга на <Money kopecks={offer.offer.limit_kopecks} />:</>}
      compare={<Compare
        before={{ label: `Сейчас в ${bankName(main.counterparty)}`, rubles: before, note: 'в месяц' }}
        after={{ label: 'По вашему расчёту в Альфе', rubles: newPayment / 100, note: `в месяц, ${offer.offer.term_months} мес.` }}
        saving={newPayment / 100 < before ? before - newPayment / 100 : null}
        higher={newPayment / 100 > before ? 'Новый платёж выше нынешнего — пересчитайте на срок подлиннее' : undefined} />}
      action={<Link to={`/offer/${offer.id}`} className={styles.link}>Открыть расчёт<ArrowRightMIcon aria-hidden /></Link>} />
  }

  // 4. Приглашение посчитать
  return <Shell title="Перенесите кредит в Альфу"
    text={<>{oldLine}. Перенесите кредит к нам — посчитаем новый платёж за минуту. Остаток долга укажете сами.</>}
    action={canCalc ? <Button view="secondary" size={40} onClick={onCalc} className={styles.button}>Посчитать новый платёж</Button> : null} />
}

function Shell({ title, text, compare, action }: { title: string; text: ReactNode; compare?: ReactNode; action?: ReactNode }) {
  return <Card className={styles.card} padding="m" as="section">
    <div className={styles.row}>
      <span className={styles.icon} aria-hidden><ArrowsCwMIcon /></span>
      <div className={styles.body}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.text}>{text}</p>
        {compare}
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  </Card>
}

type Side = { label: string; rubles: number; note: string }

function Compare({ before, after, saving, higher }: { before: Side; after: Side; saving: number | null; higher?: string }) {
  return <div className={styles.compare}>
    <div className={styles.side}>
      <span className={styles.sideLabel}>{before.label}</span>
      <Money rubles={before.rubles} size="m" tone="secondary" />
      <span className={styles.sideNote}>{before.note}</span>
    </div>
    <ArrowRightMIcon className={styles.arrow} aria-label="стало" />
    <div className={styles.side}>
      <span className={styles.sideLabel}>{after.label}</span>
      <Money rubles={after.rubles} size="m" />
      <span className={styles.sideNote}>{after.note}</span>
    </div>
    {saving != null && saving >= 1 && <div className={styles.saving}>
      Меньше примерно на <Money rubles={saving} /> в месяц
    </div>}
    {higher && <div className={styles.higher}>{higher}</div>}
  </div>
}
