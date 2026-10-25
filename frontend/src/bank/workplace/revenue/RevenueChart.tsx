import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipProps } from 'recharts'
import { Status } from '@alfalab/core-components/status/esm'
import { EmptyState, ErrorBoundary, formatMoney } from '../../../ui'
import { FNS_MISMATCH_LIMIT, FNS_MISMATCH_WATCH, fullMonthsText, MonthlyRevenue, RevenueMonth } from './monthlyRevenue'
import styles from './RevenueChart.module.css'

// Цвета берём из токенов кита (SVG-атрибуты recharts не понимают var(), поэтому читаем значения
// переменных при отрисовке; второе значение — запасное, если переменной нет):
//  синий status-info — выручка, графит accent-secondary пунктиром — налоговая,
//  neutral-300 — сетка, neutral-700 — подписи осей.
// Бирюзовый для своих переводов — не токен кита: в палитре нет второго цвета для данных, который
// хорошо отличался бы от синего; пара синий/бирюзовый проверена на различимость при нарушениях цветового зрения.
const TOKENS = {
  bar: ['--color-light-status-info', '#2288fa'],
  ink: ['--color-light-accent-secondary', '#212124'],
  grid: ['--color-light-neutral-300', '#e7e8eb'],
  axis: ['--color-light-neutral-700', '#898991'],
} as const
const OWN = '#0d9488'
type Palette = Record<keyof typeof TOKENS, string>

function readPalette(): Palette {
  const css = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const out = {} as Palette
  for (const [k, [name, fallback]] of Object.entries(TOKENS) as [keyof Palette, readonly [string, string]][]) {
    out[k] = css?.getPropertyValue(name).trim() || fallback
  }
  return out
}

const rub = (v: number) => formatMoney({ rubles: v })
const pct = (v: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.abs(v) * 100)}%`
/** Процент, уже округлённый в monthlyRevenue (целое или с одним знаком у порогов). */
const pctShown = (p: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(p)}%`

/** Круглые деления оси: шаг 1 / 2 / 2,5 / 5 × 10ⁿ, 3–4 деления от нуля. */
function niceTicks(max: number) {
  if (!(max > 0)) return [0, 1]
  const raw = max / 3
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(k => k * pow).find(s => s >= raw) ?? 10 * pow
  const ticks: number[] = []
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v))
  return ticks
}

/** Подпись деления оси: если верх оси от миллиона — все деления в млн («0,5 млн»), иначе в тыс. */
const axisLabel = (top: number) => (v: number) => v === 0 ? '0' : top >= 1_000_000
  ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(v / 1_000_000)} млн`
  : top >= 1_000 ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v / 1_000)} тыс.` : `${Math.round(v)}`

const monthDate = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1)
const monthShort = (key: string) => monthDate(key).toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')
const monthLong = (key: string) => {
  const s = monthDate(key).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '')
  return s[0].toUpperCase() + s.slice(1)
}
const periodText = (months: RevenueMonth[]) => months.length === 1
  ? monthLong(months[0].key).toLowerCase()
  : `${monthShort(months[0].key)} ${months[0].key.slice(0, 4)} – ${monthShort(months[months.length - 1].key)} ${months[months.length - 1].key.slice(0, 4)}`

const levelView = {
  ok: { color: 'grey', text: 'в пределах нормы' },
  watch: { color: 'orange', text: `близко к порогу ${pct(FNS_MISMATCH_LIMIT)}` },
  high: { color: 'red', text: `больше порога ${pct(FNS_MISMATCH_LIMIT)}` },
} as const

type Row = RevenueMonth & { title: string }

/**
 * «Выручка по месяцам: счёт и налоговая» для карточки заявки у сотрудника банка (ТЗ, раздел 9 п. 2).
 * Столбики — выручка по счёту в Альфе за месяц, пунктир — выручка из декларации, делённая на 12.
 */
export function RevenueChart({ data, regime }: { data: MonthlyRevenue; regime?: string }) {
  return <section className={styles.root} aria-labelledby="revenue-chart-title">
    <h3 id="revenue-chart-title" className={styles.title}>Выручка по месяцам: счёт и налоговая</h3>
    <ErrorBoundary compact><RevenueBody data={data} regime={regime} /></ErrorBoundary>
  </section>
}

function RevenueBody({ data, regime }: { data: MonthlyRevenue; regime?: string }) {
  const narrow = useNarrow()
  const [c] = useState(readPalette)
  const { months, fns, fnsAnnual } = data
  const fnsOnly = fnsAnnual && <p className={styles.note}>По налоговой за {fnsAnnual.year} год — <b>{rub(fnsAnnual.annual)}</b>, в среднем {rub(fnsAnnual.monthly)} в месяц.</p>

  if (!data.hasTransactions) return <>
    <EmptyState compact title="Операций по счёту нет" text="Банк не получил движений по счёту в Альфе — помесячную выручку построить не из чего." />
    {fnsOnly}
  </>
  if (months.length === 0) return <>
    <EmptyState compact title="Полных месяцев ещё нет" text="Счёт открыт недавно: в расчёт берутся только полные месяцы после открытия счёта." />
    {fnsOnly}
  </>
  if (data.total === 0) return <>
    <EmptyState compact title="Выручки за период нет" text={`За ${periodText(months)} на счёт не поступало выручки — только свои переводы, кредиты или возвраты.`} />
    {fnsOnly}
  </>

  const rows: Row[] = months.map(m => ({
    ...m,
    title: monthLong(m.key),
  }))
  const showOwn = data.ownOtherTotal > 0
  const ticks = rows.filter((_, i) => !narrow || i % 3 === 0 || i === rows.length - 1).map(r => r.key)
  const n = months.length
  const full = n === 12
  const level = fns ? levelView[fns.level] : null
  const yTicks = niceTicks(Math.max(...rows.map(r => r.revenue + (showOwn ? r.ownOther : 0)), fns?.monthly ?? 0))
  const yTop = yTicks[yTicks.length - 1]

  return <>
    <p className={styles.lead}>
      Выручка на счёте в Альфе за {n === 1 ? 'последний полный месяц' : fullMonthsText(n)} ({periodText(months)}) — без своих переводов, кредитов и возвратов, как в расчёте лимита.
    </p>

    <div className={styles.legend} aria-hidden>
      <span><i className={styles.swatch} style={{ background: c.bar }} />Выручка по счёту</span>
      {showOwn && <span><i className={styles.swatch} style={{ background: OWN }} />Свои переводы из другого банка (не выручка)</span>}
      {fns && <span><i className={styles.swatchLine} />Налоговая {fns.year}: годовая ÷ 12 = {rub(fns.monthly)}/мес.</span>}
    </div>

    <div className={styles.chart} role="img" aria-label={`Выручка по счёту по месяцам, в среднем ${rub(data.avg)} в месяц${fns ? `; по налоговой за ${fns.year} год в среднем ${rub(fns.monthly)} в месяц` : ''}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="key" ticks={ticks} interval={0} height={36}
            tickLine={false} axisLine={{ stroke: c.grid }} tick={<MonthTick first={rows[0].key} color={c.axis} />} />
          <YAxis tickFormatter={axisLabel(yTop)} tickLine={false} axisLine={false} tick={{ fill: c.axis, fontSize: 12 }}
            width={narrow ? 52 : 64} domain={[0, yTop]} ticks={yTicks} interval={0} />
          <Tooltip cursor={{ fill: 'rgba(11, 31, 53, 0.05)' }} content={<MonthTooltip fnsMonthly={fns?.monthly} />} />
          <Bar dataKey="revenue" stackId="in" fill={c.bar} radius={showOwn ? 0 : [4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false} />
          {showOwn && <Bar dataKey="ownOther" stackId="in" fill={OWN} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false} />}
          {fns && <ReferenceLine y={fns.monthly} stroke={c.ink} strokeDasharray="5 4" strokeWidth={1.5} ifOverflow="extendDomain" />}
        </BarChart>
      </ResponsiveContainer>
    </div>

    <div className={styles.summary}>
      <p className={styles.summaryText}>
        За {n}{' '}мес. по счёту <b>{rub(data.total)}</b>{!full && n > 1 && <> (в среднем {rub(data.avg)}/мес.)</>}
        {fns && <>, по налоговой за {fns.year}{' '}год <b>{rub(fns.annual)}</b>{!full && <> (в среднем {rub(fns.monthly)}/мес.)</>}
          , расхождение{!full && ' среднемесячной'} <b className={styles[`level_${fns.level}`]}>{pctShown(fns.shownPct)}</b></>}
      </p>
      {fns && level && <Status view="muted-alt" color={level.color} size={24} shape="rounded" uppercase={false}>{level.text}</Status>}
    </div>

    {fns && <p className={styles.note}>
      {fns.shownPct === 0 ? 'По счёту примерно столько же, сколько в декларации.' : fns.mismatch < 0
        ? `По счёту на ${pctShown(fns.shownPct)} меньше, чем в декларации — часть выручки может идти через другой банк или кассу.`
        : `По счёту на ${pctShown(fns.shownPct)} больше, чем в декларации.`}
      {' '}До {pct(FNS_MISMATCH_WATCH)} включительно — обычный разброс, больше {pct(FNS_MISMATCH_LIMIT)} — повод проверить вручную.
      {' '}Счёт — за {n === 1 ? 'последний полный месяц' : `последние ${fullMonthsText(n)}`}, декларация — за {fns.year}{' '}год.
    </p>}
    {!fns && <p className={styles.note}>
      {regime === 'PSN'
        ? 'Клиент на патенте: выручку в налоговую он не декларирует, поэтому сравнивать не с чем — линии налоговой нет.'
        : 'Годовой выручки от налоговой нет (декларацию за прошлый год ещё не сдавали или режим без декларации), поэтому сравнивать не с чем — линии налоговой нет.'}
    </p>}
    {showOwn && <p className={styles.note}>
      Ещё {rub(data.ownOtherTotal)} клиент перевёл себе со своего счёта в другом банке: это не выручка, но часть оборота идёт мимо Альфы.
    </p>}

    <details className={styles.tableToggle}>
      <summary>Показать таблицей</summary>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr>
            <th>Месяц</th><th>Выручка по счёту</th>
            {fns && <th>{narrow ? 'К ФНС' : 'К налоговой'}</th>}
            {showOwn && <th>Свои переводы</th>}
          </tr></thead>
          <tbody>{rows.map(r => <tr key={r.key}>
            <td>{narrow ? `${monthShort(r.key)} ${r.key.slice(0, 4)}` : r.title}</td><td>{rub(r.revenue)}</td>
            {fns && <td>{signedPct((r.revenue - fns.monthly) / fns.monthly)}</td>}
            {showOwn && <td>{r.ownOther ? rub(r.ownOther) : '—'}</td>}
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </>
}

/** Подпись месяца на оси; год — второй строкой у первого месяца и у января. */
function MonthTick({ x, y, payload, first, color }: { x?: number; y?: number; payload?: { value: string }; first: string; color: string }) {
  const key = payload?.value
  if (!key) return null
  const showYear = key === first || key.endsWith('-01')
  return <text x={x} y={y} dy={12} textAnchor="middle" fill={color} fontSize={12}>
    <tspan x={x}>{monthShort(key)}</tspan>
    {showYear && <tspan x={x} dy={14}>{key.slice(0, 4)}</tspan>}
  </text>
}

const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${pct(v)}`

function MonthTooltip({ active, payload, fnsMonthly }: TooltipProps<number, string> & { fnsMonthly?: number }) {
  const row = active && payload?.[0]?.payload as Row | undefined
  if (!row) return null
  return <div className={styles.tooltip}>
    <div className={styles.tooltipTitle}>{row.title}</div>
    <div>Выручка по счёту {rub(row.revenue)}</div>
    {fnsMonthly ? <div className={styles.tooltipMuted}>{signedPct((row.revenue - fnsMonthly) / fnsMonthly)} к среднему по налоговой</div> : null}
    {row.ownOther > 0 && <div className={styles.tooltipMuted}>Свои переводы из другого банка {rub(row.ownOther)}</div>}
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
