import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipProps } from 'recharts'
import { Button } from '@alfalab/core-components/button/esm'
import { BulbMIcon } from '@alfalab/icons-glyph/BulbMIcon'
import { productName } from '../../api'
import { Card, ErrorBoundary, ErrorState, KeyValue, LoadingState, Money, formatMoney } from '../../ui'
import { OverdraftHow } from '../application/Panels'
import type { Loan, LoanPayment } from './useLoan'
import appStyles from '../application/Application.module.css'
import styles from './Loan.module.css'

const pct = (rate: number) => `${String(rate).replace('.', ',')}%`
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`)
const dayMonth = (iso: string) => day(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
const fullDate = (iso: string) => day(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
const monthYear = (iso: string) => day(iso).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '')
const rub = (v: number) => formatMoney({ rubles: v })

/** «40 тыс.», «1,2 млн» — подписи оси */
function compact(value: number) {
  const abs = Math.abs(value)
  if (abs === 0) return '0'
  if (abs >= 1_000_000) return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(abs / 1_000_000)} млн`
  if (abs >= 1_000) return `${Math.round(abs / 1_000)} тыс.`
  return String(Math.round(abs))
}

/** Блок «Мой кредит» на странице выданной заявки: условия, ближайший платёж, график платежей из договора. */
export function LoanCard({ loan, issuedAt, purpose }: { loan: Loan; issuedAt?: string | null; purpose?: string }) {
  const overdraft = loan.product === 'OVERDRAFT'
  const since = issuedAt ?? loan.signed_at
  return <Card padding="l" className={styles.card}>
    <div className={styles.hero}>
      <div className={styles.heroMain}>
        <span className={styles.eyebrow}>Мой кредит · {productName(loan.product)}</span>
        <Money rubles={loan.amount} size="xl" />
        <span className={styles.heroNote}>
          {overdraft ? 'лимит на расчётном счёте' : loan.product === 'REFINANCE' ? 'направлено на погашение кредита в другом банке' : 'зачислено на расчётный счёт'}
          {since ? ` · с ${dayMonth(since)}` : ''}
        </span>
        {purpose && <span className={styles.heroNote}>Цель — {purpose.toLowerCase()}</span>}
      </div>
      <span className={styles.badge}>Действует</span>
    </div>

    {overdraft
      ? <KeyValue view="tiles" columns={3} className={styles.tiles} items={[
        { label: 'Ставка', value: `${pct(loan.rate)} годовых` },
        { label: 'Срок лимита', value: `${loan.term_months} мес.`, hint: 'каждый транш — до 60 дней' },
        { label: 'Платёж', value: 'по факту', hint: 'проценты только за дни использования' },
      ]} />
      : <KeyValue view="tiles" columns={4} className={styles.tiles} items={[
        loan.next_payment
          ? { label: 'Ближайший платёж', value: <Money rubles={loan.next_payment.payment} />, hint: dayMonth(loan.next_payment.date) }
          : { label: 'Ближайший платёж', value: '—' },
        { label: 'Ставка', value: `${pct(loan.rate)} годовых` },
        { label: 'Срок', value: `${loan.term_months} мес.`, hint: loan.schedule.length ? `до ${fullDate(loan.schedule[loan.schedule.length - 1].date)}` : undefined },
        { label: 'Переплата', value: loan.overpayment != null ? <Money rubles={loan.overpayment} /> : '—', hint: 'все проценты за срок' },
      ]} />}

    {overdraft
      ? <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Как работает овердрафт</h3>
        <p className={styles.sectionNote}>Отдельного графика платежей нет — долг гасится поступлениями на счёт.</p>
        <OverdraftHow amountKopecks={Math.round(loan.amount * 100)} rate={loan.rate} termMonths={loan.term_months} issued />
      </div>
      : loan.schedule.length > 0 && <PaymentSchedule loan={loan} />}

    <div className={appStyles.fineprint}>Досрочное погашение — без штрафа. Комиссий и страховок нет.</div>
  </Card>
}

/** График платежей по месяцам (столбики) и раскрывающаяся таблица. */
function PaymentSchedule({ loan }: { loan: Loan }) {
  const [open, setOpen] = useState(false)
  const rows = loan.schedule
  const growing = rows.some(r => r.principal <= 0)
  const min = loan.min_payment ?? Math.min(...rows.map(r => r.payment))
  const max = loan.max_payment ?? Math.max(...rows.map(r => r.payment))
  return <div className={styles.section}>
    <h3 className={styles.sectionTitle}>{loan.seasonal ? 'График платежей: больше в сезон, меньше в межсезонье' : 'График платежей'}</h3>
    <p className={styles.sectionNote}>
      {loan.seasonal
        ? <>От <b>{rub(min)}</b> до <b>{rub(max)}</b> в месяц — платёж следует за выручкой бизнеса.</>
        : <>{rows.length} равных платежей по <b>{rub(rows[0].payment)}</b>{rows[rows.length - 1].payment !== rows[0].payment ? ', последний — немного другой' : ''}. Списываются со счёта по графику договора.</>}
    </p>

    <ErrorBoundary compact>
      <ScheduleChart rows={rows} />
    </ErrorBoundary>

    <Button view="secondary" size={40} className={styles.toggle} onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="loan-schedule-table">
      {open ? 'Скрыть таблицу платежей' : `Таблица платежей · ${rows.length}`}
    </Button>
    {open && <div id="loan-schedule-table">
      <div className={appStyles.tableWrap}>
        <table className={appStyles.table}>
          <thead><tr><th>№</th><th>Дата</th><th>Платёж</th><th>Проценты</th><th>Долг</th><th>Остаток</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={r.date}>
            <td className={appStyles.num}>{i + 1}</td>
            <td>{fullDate(r.date)}</td>
            <td><b>{rub(r.payment)}</b></td><td>{rub(r.interest)}</td><td>{r.principal > 0 ? rub(r.principal) : '—'}</td><td>{rub(r.balance)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {growing && <div className={appStyles.fineprint}>«—» в графе «Долг»: в слабый месяц платёж меньше начисленных процентов, долг в этот месяц не уменьшается.</div>}
    </div>}
  </div>
}

const INK = '#212124'
const INK_SOFT = '#8d8d93'
const GRID = '#e7e8eb'
const AXIS_TEXT = 'rgba(60, 60, 67, 0.6)'

type Point = LoanPayment & { n: number; label: string }

function ScheduleChart({ rows }: { rows: LoanPayment[] }) {
  const many = rows.length > 12
  const data: Point[] = rows.map((r, i) => {
    const d = day(r.date)
    return { ...r, n: i + 1, label: many ? `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : MONTHS[d.getMonth()] }
  })
  return <div className={styles.chart}>
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={rows.length > 24 ? '18%' : '28%'}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" interval="preserveStart" minTickGap={14} tickLine={false} axisLine={false} tick={{ fill: AXIS_TEXT, fontSize: 12 }} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} tick={<YTick />} width={60} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: INK, fillOpacity: 0.05 }} isAnimationActive={false} />
        <Bar dataKey="payment" radius={[4, 4, 0, 0]} isAnimationActive={false} fill={INK}
          shape={(props: unknown) => {
            const p = props as { x: number; y: number; width: number; height: number; index: number }
            const r = Math.min(4, p.width / 2, p.height)
            const { x, y, width: w, height: h } = p
            // Ближайший платёж — тёмный, остальные — серые
            return <path d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`}
              fill={p.index === 0 ? INK : INK_SOFT} />
          }} />
      </BarChart>
    </ResponsiveContainer>
    <div className={styles.legend}>
      <span><i className={styles.legendNext} aria-hidden />ближайший платёж</span>
      <span><i className={styles.legendRest} aria-hidden />следующие платежи</span>
    </div>
  </div>
}

/** Подпись оси Y в одну строку (стандартная у recharts переносится на узкой оси). */
function YTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: number } }) {
  return <text x={x} y={y} dy={4} textAnchor="end" fill={AXIS_TEXT} fontSize={12}>{compact(payload?.value ?? 0)}</text>
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as Point
  return <div className={styles.tooltip}>
    <span className={styles.tooltipDate}>{p.n}-й платёж · {monthYear(p.date)}</span>
    <Money rubles={p.payment} size="s" />
    <span className={styles.tooltipSplit}>проценты {rub(p.interest)}{p.principal > 0 ? ` · долг ${rub(p.principal)}` : ''}</span>
  </div>
}

/** Подсказки после выдачи — из ответа бэка. */
export function LoanTips({ tips }: { tips: string[] }) {
  if (!tips.length) return null
  return <Card title="Подсказки" padding="m">
    <ul className={styles.tips}>
      {tips.map(t => <li key={t}><BulbMIcon className={styles.tipIcon} aria-hidden /><span>{t}</span></li>)}
    </ul>
  </Card>
}

/** Загрузка и ошибка блока «Мой кредит». */
export function LoanPending() {
  return <Card title="Мой кредит" padding="l"><LoadingState view="skeleton" rows={4} label="Загружаем кредит и график платежей…" /></Card>
}

export function LoanError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return <Card title="Мой кредит" padding="l"><ErrorState title="Не получилось загрузить кредит" error={error} onRetry={onRetry} /></Card>
}
