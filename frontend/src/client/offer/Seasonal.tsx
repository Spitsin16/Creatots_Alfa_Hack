import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipProps } from 'recharts'
import { Segment, SegmentedControl } from '@alfalab/core-components/segmented-control/esm'
import { apiErrorCode } from '../../api'
import { Card, ErrorBoundary, ErrorState, LoadingState } from '../../ui'
import { SeasonalData, monthsIn, rub } from './offerMath'
import styles from './offer.module.css'

// Цвета графика = токены кита: синий (graphic-link) — платёж по сезонному графику,
// графит пунктиром — платёж «равными долями» для сравнения.
const BAR = '#2288fa'
const INK = '#212124'
const GRID = '#e7e8eb'
const AXIS = '#898991'

type Row = { key: string; tick: string; title: string; payment: number; interest: number; principal: number; balance: number }

const monthShort = (d: Date) => d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')
const monthLong = (d: Date) => {
  const s = d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '')
  return s[0].toUpperCase() + s.slice(1)
}

/** 158 703 → «159 тыс.» для оси. */
const compact = (v: number) => v >= 1_000_000
  ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(v / 1_000_000)} млн`
  : v >= 1_000 ? `${Math.round(v / 1_000)} тыс.` : `${Math.round(v)}`

/** Сезонный график платежей (если в анкете «Больше в сезон»): столбцы по месяцам и сравнение с равными платежами. */
export function SeasonalCard({ data, loading, error, onRetry }: { data?: SeasonalData; loading: boolean; error: unknown; onRetry: () => void }) {
  const title = 'Сезонный график платежей'
  const subtitle = 'Вы выбрали «Больше в сезон»: платёж следует за выручкой — больше в сильные месяцы, меньше в слабые'
  if (loading) return <Card title={title} subtitle={subtitle}><LoadingState view="skeleton" rows={4} label="Считаем сезонный график…" /></Card>
  if (error != null) {
    const message = error instanceof Error ? error.message : ''
    // 409 SEASONAL_NOT_AVAILABLE («не нужен»): выручка ровная или продукт без ежемесячного платежа — это не ошибка, а ответ
    if (apiErrorCode(error) === 'SEASONAL_NOT_AVAILABLE' || /не нужен/i.test(message)) return <Card title={title} subtitle="Для этого предложения подойдут равные платежи: выручка по месяцам у вас ровная, сезонный график ничего не даст." />
    return <Card title={title}><ErrorState error={error} title="Не получилось посчитать сезонный график" onRetry={onRetry} /></Card>
  }
  if (!data || data.schedule.length === 0) return null
  return <Card title={title} subtitle={subtitle}>
    <ErrorBoundary compact><SeasonalBody data={data} /></ErrorBoundary>
  </Card>
}

function SeasonalBody({ data }: { data: SeasonalData }) {
  const [range, setRange] = useState<'year' | 'all'>('year')
  const rows: Row[] = data.schedule.map((r, i) => {
    const d = new Date(r.date)
    const tick = d.getMonth() === 0 || i === 0 ? `${monthShort(d)} ${String(d.getFullYear()).slice(2)}` : monthShort(d)
    return { key: r.date, tick, title: monthLong(d), payment: r.payment, interest: r.interest, principal: r.principal, balance: r.balance }
  })
  const shown = range === 'year' ? rows.slice(0, 12) : rows
  const diff = data.overpayment - data.annuity_overpayment
  const low = monthsIn(data.low_months)
  const peak = monthsIn(data.peak_months)
  const max = Math.max(...shown.map(r => r.payment), data.annuity_payment)
  // подписи оси X: за год — каждый месяц, за весь срок — только январи (с годом) и первый месяц
  const tickOf = new Map(shown.map(r => [r.key, r.tick]))
  const januaries = shown.filter(r => r.key.slice(5, 7) === '01').map(r => r.key)
  const firstJan = shown.findIndex(r => r.key.slice(5, 7) === '01')
  const narrow = useNarrow()
  const ticks = range === 'year'
    ? shown.filter((_, i) => !narrow || i % 3 === 0).map(r => r.key)
    : (firstJan < 0 || firstJan > 3 ? [shown[0].key, ...januaries] : januaries)

  return <>
    <div className={styles.seasonStats}>
      <div className={styles.seasonStat}>
        <div className={styles.seasonStatLabel}>Равными платежами, в месяц</div>
        <div className={styles.seasonStatValue}>{rub({ rubles: data.annuity_payment })}</div>
        <div className={styles.seasonStatHint}>переплата {rub({ rubles: data.annuity_overpayment })}</div>
      </div>
      <div className={styles.seasonStat}>
        <div className={styles.seasonStatLabel}>По сезонному графику</div>
        <div className={styles.seasonStatValue}>{rub({ rubles: data.min_payment })} – {rub({ rubles: data.max_payment })}</div>
        <div className={styles.seasonStatHint}>переплата {rub({ rubles: data.overpayment })}</div>
      </div>
      <div className={styles.seasonStat}>
        <div className={styles.seasonStatLabel}>Разница в переплате</div>
        <div className={styles.seasonStatValue}>{diff > 0 ? '+' : diff < 0 ? '−' : ''}{rub({ rubles: Math.abs(diff) })}</div>
        <div className={styles.seasonStatHint}>за весь срок ({rows.length}{'\u00a0'}мес.), {diff > 0 ? 'сезонный дороже' : diff < 0 ? 'сезонный дешевле' : 'одинаково'}</div>
      </div>
    </div>
    <p className={styles.seasonLead}>
      {low ? `В ${low} платёж падает до ${rub({ rubles: data.min_payment })}` : `Самый маленький платёж — ${rub({ rubles: data.min_payment })}`}
      {peak ? `, а в сезон — в ${peak} — растёт до ${rub({ rubles: data.max_payment })}.` : `, самый большой — ${rub({ rubles: data.max_payment })}.`}
      {' '}{diff > 0
        ? `За эту гибкость переплата выше на ${rub({ rubles: diff })} за весь срок — решать вам.`
        : diff < 0 ? `И переплата даже меньше на ${rub({ rubles: -diff })}.` : ''}
    </p>

    <div className={styles.chartHead}>
      <div className={styles.chartLegend} aria-hidden>
        <span><i className={styles.swatchBar} />Сезонный платёж</span>
        <span><i className={styles.swatchLine} />Равные платежи, {rub({ rubles: data.annuity_payment })}</span>
      </div>
      <div className={styles.segments}>
        <SegmentedControl selectedId={range} onChange={id => setRange(id === 'all' ? 'all' : 'year')} size={32} shape="rounded">
          <Segment id="year" title="Первый год" />
          <Segment id="all" title="Весь срок" />
        </SegmentedControl>
      </div>
    </div>

    <div className={styles.chart} role="img" aria-label={`Платежи по месяцам: от ${rub({ rubles: data.min_payment })} до ${rub({ rubles: data.max_payment })}; равными долями — ${rub({ rubles: data.annuity_payment })}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={shown} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={range === 'year' ? '28%' : '18%'}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="key" tickFormatter={k => tickOf.get(k) ?? ''} ticks={ticks} interval={0}
            tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: AXIS, fontSize: 12 }} />
          <YAxis tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 12 }} width={76}
            domain={[0, Math.ceil(max * 1.1 / 50_000) * 50_000]} />
          <Tooltip cursor={{ fill: 'rgba(11, 31, 53, 0.05)' }} content={<SeasonTooltip />} />
          <Bar dataKey="payment" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          <ReferenceLine y={data.annuity_payment} stroke={INK} strokeDasharray="5 4" strokeWidth={1.5} ifOverflow="extendDomain" />
        </BarChart>
      </ResponsiveContainer>
    </div>

    <details className={styles.tableToggle}>
      <summary>Показать график таблицей</summary>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Месяц</th><th>Платёж</th><th>Из них проценты</th><th>Остаток долга</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.key}>
            <td>{r.title}</td><td>{rub({ rubles: r.payment })}</td><td>{rub({ rubles: r.interest })}</td><td>{rub({ rubles: r.balance })}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </>
}

function SeasonTooltip({ active, payload }: TooltipProps<number, string>) {
  const row = active && payload?.[0]?.payload as Row | undefined
  if (!row) return null
  return <div className={styles.tooltip}>
    <div className={styles.tooltipTitle}>{row.title}</div>
    <div>Платёж {rub({ rubles: row.payment })}</div>
    <div className={styles.tooltipMuted}>из них проценты {rub({ rubles: row.interest })}</div>
    {row.principal < 0 && <div className={styles.tooltipMuted}>Платёж меньше процентов — долг вырастет на {rub({ rubles: -row.principal })}</div>}
  </div>
}

/** Узкий экран (телефон): подписи оси реже, чтобы не налезали. */
function useNarrow(query = '(max-width: 600px)') {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return narrow
}
