import { useState } from 'react'
import { Button } from '@alfalab/core-components/button/esm'
import { Tag } from '@alfalab/core-components/tag/esm'
import { ArrowUpCircleMIcon } from '@alfalab/icons-glyph/ArrowUpCircleMIcon'
import { BanknotesMIcon } from '@alfalab/icons-glyph/BanknotesMIcon'
import { CalendarMIcon } from '@alfalab/icons-glyph/CalendarMIcon'
import { CheckmarkCircleMIcon } from '@alfalab/icons-glyph/CheckmarkCircleMIcon'
import { PercentMIcon } from '@alfalab/icons-glyph/PercentMIcon'
import { Application, productName } from '../../api'
import { CHAT_ANSWER_HOURS, clientComment, enteredAt, formatDateTime, OFFER_VALID_DAYS, statusName } from '../../common/status'
import { Card } from '../../ui/Card'
import { KeyValue } from '../../ui/KeyValue'
import { formatMoney, Money } from '../../ui/Money'
import { LoadingState } from '../../ui/States'
import { statusColor } from '../../ui/StatusTag'
import { annuitySchedule, isAnnuityProduct, overdraftInterest, purposeName } from './schedule'
import { seasonalExpected, seasonalFor, useOfferRate, useSeasonalApi } from './terms'
import styles from './Application.module.css'

// Статусы, в которых ставка из решения — это условия для клиента (а не черновой расчёт банка).
const decidedStatuses = ['APPROVED', 'CONTRACT_SIGNED', 'ISSUED']
// До решения (и в предложении банка — для сравнения) ставку показываем из предложения, из которого создана заявка.
const beforeDecision = ['DRAFT', 'AWAITING_SIGNATURE', 'SUBMITTED', 'VALIDATION', 'ENRICHMENT', 'SCORING', 'MANUAL_REVIEW', 'INFO_REQUESTED', 'COUNTER_OFFER']
export const termsKnown = (a: Application) => decidedStatuses.includes(a.status) && a.decision?.rate != null
const pct = (rate: number) => `${String(rate).replace('.', ',')}%`

/** Условия заявки: продукт, сумма, срок, ставка и платёж (из решения, а до него — из предложения). */
export function ConditionsCard({ a }: { a: Application }) {
  const known = termsKnown(a)
  const before = !known && beforeDecision.includes(a.status)
  const offerRate = useOfferRate(a, before)
  const seasonalApi = useSeasonalApi(a)
  const rate = known ? a.decision!.rate! : before ? offerRate : null
  const overdraft = a.product === 'OVERDRAFT'
  const amount = a.amount_kopecks / 100
  const seasonal = rate != null && seasonalExpected(a) ? seasonalFor(seasonalApi.data, amount, rate, a.term_months) : null
  const payment = rate != null && isAnnuityProduct(a.product) ? annuitySchedule(amount, rate, a.term_months, null).payment : null
  return <Card title={a.status === 'COUNTER_OFFER' ? 'Условия заявки' : 'Условия'} padding="m">
    <KeyValue items={[
      { label: 'Продукт', value: productName(a.product) },
      { label: overdraft ? 'Лимит' : 'Сумма', value: <Money kopecks={a.amount_kopecks} /> },
      { label: overdraft ? 'Срок лимита' : 'Срок', value: `${a.term_months} мес.`, hint: overdraft ? 'каждый транш — до 60 дней' : undefined },
      rate != null
        ? { label: 'Ставка', value: `${pct(rate)} годовых`, hint: known ? undefined : 'из предложения' }
        : before && a.status !== 'COUNTER_OFFER' && { label: 'Ставка', value: <span className={styles.muted}>в решении банка</span> },
      seasonal
        ? { label: 'Платёж', value: <>от <Money rubles={seasonal.min} /> до <Money rubles={seasonal.max} /></>, hint: 'в месяц, по сезону — расчётно' }
        : payment != null && { label: 'Платёж', value: <Money rubles={payment} prefix="≈" />, hint: known ? 'в месяц, расчётно' : 'в месяц, из предложения — расчётно' },
      overdraft && known && { label: 'Платёж', value: 'по факту', hint: 'проценты только за дни пользования' },
      { label: 'Цель', value: purposeName[a.purpose] ?? a.purpose },
    ]} />
    {['DRAFT', 'AWAITING_SIGNATURE'].includes(a.status) && <div className={styles.fineprint}>
      {/* ТЗ 5.3: предложение действует 30 дней, условия попадают в договор без изменений, если не было контрпредложения */}
      Условия предложения действуют {OFFER_VALID_DAYS} дней и попадут в договор без изменений, если банк не предложит другие.
    </div>}
    <div className={styles.fineprint}>Досрочное погашение — без штрафа. Комиссий и страховок нет.</div>
  </Card>
}

/** Кто ведёт заявку + «Написать специалисту». */
export function SpecialistCard({ a, onWrite }: { a: Application; onWrite: () => void }) {
  const name = a.assignee_name?.replace(/^Андеррайтер\s+/, '') ?? null
  return <Card padding="m">
    <div className={styles.specialist}>
      <span className={[styles.avatar, name ? '' : styles.avatarEmpty].join(' ')} aria-hidden>{name ? name[0] : '?'}</span>
      <div className={styles.specialistText}>
        <span className={styles.specialistRole}>{name ? 'Заявку ведёт специалист' : 'Специалист ещё не назначен'}</span>
        <b>{name ?? 'Заявка в общей очереди'}</b>
      </div>
    </div>
    <p className={styles.specialistNote}>
      {name ? `Отвечает в чате в течение ${CHAT_ANSWER_HOURS} рабочих часов (пн–пт, 9:00–18:00 мск).` : 'Её возьмёт первый свободный специалист. Вопрос в чат можно задать уже сейчас.'}
    </p>
    <Button view="secondary" size={40} block onClick={onWrite}>Написать специалисту</Button>
  </Card>
}

/** История статусов — компактно, новые сверху. */
export function HistoryCard({ a }: { a: Application }) {
  const [all, setAll] = useState(false)
  const items = [...(a.timeline ?? [])].reverse()
  const shown = all ? items : items.slice(0, 4)
  return <Card title="История" padding="m">
    {items.length === 0 && <div className={styles.muted}>История появится после отправки заявки.</div>}
    <ol className={styles.history}>
      {shown.map((t, i) => {
        const name = statusName[t.to_status] ?? t.to_status
        const comment = clientComment(t, a.product)
        return <li key={`${t.at}-${i}`} className={styles.historyItem}>
          <span className={[styles.dot, styles[`dot-${statusColor(t.to_status)}`]].join(' ')} aria-hidden />
          <div className={styles.historyText}>
            <b>{name}</b>
            {comment && comment !== name && <span>{comment}</span>}
          </div>
          <time className={styles.historyTime} dateTime={t.at}>{formatDateTime(t.at)}</time>
        </li>
      })}
    </ol>
    {items.length > 4 && <Button view="text" size={32} onClick={() => setAll(!all)} className={styles.more}>
      {all ? 'Свернуть' : `Вся история · ${items.length}`}
    </Button>}
  </Card>
}

/** Есть ли что показать в карточке решения. */
export const hasDecision = (a: Application) =>
  ['APPROVED', 'CONTRACT_SIGNED', 'ISSUED'].includes(a.status) && !!a.decision && (!!a.decision.explanation?.trim() || (a.decision.advice ?? []).length > 0 || a.decision.rate != null)

/** Есть ли график платежей или объяснение погашения. */
export const hasSchedule = (a: Application) => termsKnown(a) && (a.product === 'OVERDRAFT' || isAnnuityProduct(a.product))

/** Что даст совет: лимит — только если он больше одобренной суммы, ставка — только если ниже. */
function gainText(x: { new_limit_kopecks: number; new_rate: number | null }, amountKopecks: number, rate: number | null): string {
  const parts = [
    x.new_limit_kopecks > amountKopecks ? `лимит до ${formatMoney({ kopecks: x.new_limit_kopecks })}` : null,
    x.new_rate != null && rate != null && x.new_rate < rate ? `ставка ${pct(x.new_rate)}` : null,
  ].filter(Boolean)
  return parts.join(', ')
}

/** Решение банка: текст объяснения, одобренные условия и «как получить больше». */
export function DecisionCard({ a }: { a: Application }) {
  const d = a.decision
  if (!d || !hasDecision(a)) return null
  const explanation = d.explanation?.trim()
  const advice = d.advice ?? []
  return <Card title="Решение банка" padding="m">
    {explanation && <p className={styles.decisionText}>{explanation}</p>}
    {d.rate != null && <div className={styles.decisionTerms}>
      <CheckmarkCircleMIcon className={styles.decisionIcon} aria-hidden />
      <span>
        Одобрено <b>{formatMoney({ kopecks: a.amount_kopecks })}</b> под <b>{pct(d.rate)}</b> годовых
        {d.limit_kopecks > a.amount_kopecks && <small className={styles.decisionLimit}>Лимит по решению банка — до {formatMoney({ kopecks: d.limit_kopecks })}</small>}
      </span>
    </div>}
    {advice.length > 0 && <div className={styles.more2}>
      <div className={styles.adviceTitle}>Как получить больше в следующий раз</div>
      <ul className={styles.gainList}>
        {advice.map(x => <li key={x.code}>
          <ArrowUpCircleMIcon className={styles.gainIcon} aria-hidden />
          <div><span>{x.text}</span>
            {gainText(x, a.amount_kopecks, d.rate) && <small>{gainText(x, a.amount_kopecks, d.rate)}</small>}
          </div>
        </li>)}
      </ul>
    </div>}
  </Card>
}

type Variant = 'seasonal' | 'equal'
const monthText = (d: Date) => d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '')

/** График платежей (сезонный или равными платежами) или объяснение, как гасится овердрафт. */
export function ScheduleCard({ a }: { a: Application }) {
  const [all, setAll] = useState(false)
  const [picked, setPicked] = useState<Variant | null>(null)
  const known = termsKnown(a)
  const seasonalApi = useSeasonalApi(a)
  const rate = a.decision?.rate
  if (!known || rate == null) return null
  const amount = a.amount_kopecks / 100
  const issued = a.status === 'ISSUED'
  // Договор подписан: показываем график договора (равные платежи), без вариантов на выбор
  const signed = issued || a.status === 'CONTRACT_SIGNED'
  const title = signed ? 'График платежей' : 'Предварительный график'

  if (a.product === 'OVERDRAFT') {
    const example = Math.min(100_000, amount)
    const interest = overdraftInterest(example, rate, 10)
    return <Card title="Как гасится овердрафт" subtitle="Отдельного графика платежей нет" padding="m">
      <ul className={styles.howList}>
        <li><BanknotesMIcon aria-hidden /><div><b>Деньги — когда не хватает на счёте</b><span>Лимит {formatMoney({ kopecks: a.amount_kopecks })} {issued ? 'подключён' : 'подключат'} к расчётному счёту на {a.term_months} мес. Платёж пройдёт, даже если своих денег на счёте меньше.</span></div></li>
        <li><ArrowUpCircleMIcon aria-hidden /><div><b>Гасится поступлениями</b><span>Долг закрывается деньгами, которые приходят на счёт, — вносить платежи по графику не нужно.</span></div></li>
        <li><CalendarMIcon aria-hidden /><div><b>Каждый транш — до 60 дней</b><span>Взятую сумму нужно вернуть на счёт в течение 60 дней.</span></div></li>
        <li><PercentMIcon aria-hidden /><div><b>Проценты — только за дни пользования</b><span>Ставка {pct(rate)} годовых. Например, {formatMoney({ rubles: example })} на 10 дней — примерно {formatMoney({ rubles: interest })}.</span></div></li>
      </ul>
    </Card>
  }

  if (!isAnnuityProduct(a.product)) return null
  if (seasonalExpected(a) && seasonalApi.isPending) return <Card title={title} padding="m"><LoadingState view="skeleton" rows={3} label="Считаем график…" /></Card>

  const issuedAt = issued ? enteredAt('ISSUED', a.timeline ?? []) : null
  const equal = annuitySchedule(amount, rate, a.term_months, issuedAt)
  const seasonal = seasonalExpected(a) ? seasonalFor(seasonalApi.data, amount, rate, a.term_months) : null
  // Сезонный ждём, только если клиент его выбирал, — с него и начинаем
  const variant: Variant = seasonal ? (picked ?? 'seasonal') : 'equal'
  const s = variant === 'seasonal' && seasonal ? seasonal : equal
  const rows = all ? s.rows : s.rows.slice(0, 6)
  const rub = (v: number) => formatMoney({ rubles: v })
  const growing = variant === 'seasonal' && s.rows.some(r => r.principal <= 0)
  return <Card title={title} padding="m"
    subtitle={signed
      ? 'Равные платежи по сумме, ставке и сроку договора. Расчёт примерный — точные даты и суммы в договоре'
      : variant === 'seasonal'
        ? 'Платёж следует за выручкой: больше в сезон, меньше в межсезонье. Расчёт по сумме, ставке и сроку из решения — точный график в договоре'
        : 'Расчёт по сумме, ставке и сроку из решения — точный график в договоре'}>
    {seasonal && <div className={styles.variants} role="group" aria-label="Варианты расчёта">
      <span className={styles.variantsLabel}>Варианты расчёта</span>
      <Tag size={32} shape="rounded" view="filled" checked={variant === 'seasonal'} onClick={() => setPicked('seasonal')}>Больше в сезон</Tag>
      <Tag size={32} shape="rounded" view="filled" checked={variant === 'equal'} onClick={() => setPicked('equal')}>Равными платежами</Tag>
    </div>}
    {variant === 'seasonal' && seasonal
      ? <KeyValue view="tiles" columns={2} items={[
        { label: 'Платёж в межсезонье', value: <Money rubles={seasonal.min} prefix="от" /> },
        { label: 'Платёж в сезон', value: <Money rubles={seasonal.max} prefix="до" /> },
        { label: 'Переплата', value: <Money rubles={seasonal.overpayment} prefix="≈" />, hint: `равными — ≈ ${rub(equal.overpayment)}` },
        { label: 'Всего вернуть', value: <Money rubles={seasonal.total} prefix="≈" />, hint: `${a.term_months} платежей` },
      ]} />
      : <KeyValue view="tiles" columns={3} items={[
        { label: 'Платёж в месяц', value: <Money rubles={equal.payment} prefix="≈" /> },
        { label: 'Переплата', value: <Money rubles={equal.overpayment} prefix="≈" />, hint: 'это все проценты за срок' },
        { label: 'Всего вернуть', value: <Money rubles={equal.total} prefix="≈" />, hint: `${a.term_months} платежей` },
      ]} />}
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>№</th><th>{variant === 'seasonal' ? 'Месяц' : issuedAt ? 'Дата, примерно' : 'Месяц'}</th><th>Платёж</th><th>Проценты</th><th>Долг</th><th>Остаток</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.n}>
          <td className={styles.num}>{r.n}</td>
          <td>{variant === 'seasonal' && r.date ? monthText(r.date) : r.date ? r.date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : `${r.n}-й`}</td>
          <td><b>{rub(r.payment)}</b></td><td>{rub(r.interest)}</td><td>{r.principal > 0 ? rub(r.principal) : '—'}</td><td>{rub(r.balance)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {s.rows.length > 6 && <Button view="text" size={32} onClick={() => setAll(!all)} className={styles.more}>
      {all ? 'Свернуть' : `Показать все ${s.rows.length} платежей`}
    </Button>}
    {growing && <div className={[styles.fineprint, styles.dashNote].join(' ')}>«—» в графе «Долг»: в слабый месяц платёж меньше начисленных процентов, долг в этот месяц не уменьшается.</div>}
    <div className={styles.fineprint}>Досрочное погашение — без штрафа. Комиссий и страховок нет.</div>
  </Card>
}
