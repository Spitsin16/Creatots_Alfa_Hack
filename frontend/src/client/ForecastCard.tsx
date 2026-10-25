import { ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipProps } from 'recharts'
import { Button } from '@alfalab/core-components/button/esm'
import { Status } from '@alfalab/core-components/status/esm'
import { ChartLineAscMIcon } from '@alfalab/icons-glyph/ChartLineAscMIcon'
import { CheckmarkCircleMIcon } from '@alfalab/icons-glyph/CheckmarkCircleMIcon'
import { LightningMIcon } from '@alfalab/icons-glyph/LightningMIcon'
import { Forecast, request } from '../api'
import { useSession } from '../auth'
import { Card, EmptyState, ErrorBoundary, ErrorState, LoadingState, Money, formatMoney } from '../ui'
import styles from './ForecastCard.module.css'

/** Ответ /forecast (с регулярными платежами и причинами разрыва). */
export type ForecastData = Forecast

/** Прогноз остатка на 30 дней. overdraftKopecks — посчитать с учётом лимита овердрафта (на странице предложения). */
export function useForecast(businessId: string, overdraftKopecks?: number) {
  const { token } = useSession()
  return useQuery({
    queryKey: ['forecast', businessId, overdraftKopecks ?? 0],
    queryFn: () => request<ForecastData>(`/api/v1/businesses/${businessId}/forecast${overdraftKopecks ? `?overdraft_limit_kopecks=${overdraftKopecks}` : ''}`, {}, token),
    staleTime: 60_000,
  })
}

export type ForecastCardProps = {
  /** Оставлен для совместимости: токен берётся из сессии */
  token?: string
  businessId: string
  /** Лимит овердрафта в копейках: на графике появится зона «овердрафт покрывает» */
  overdraftKopecks?: number
  /** Кнопка «Подобрать овердрафт» под прогнозом: получает рекомендуемую сумму в рублях */
  onPick?: (rubles: number) => void
  /**
   * Овердрафт, который у клиента уже есть (главная): выданный — рисуем прогноз с его лимитом и не предлагаем подбор;
   * заявка в работе — ведём в неё. 'loading' — пока не знаем, карточка ждёт, чтобы совет не «перепрыгивал».
   */
  currentOverdraft?: CurrentOverdraft
  title?: ReactNode
  className?: string
}

/** Овердрафт клиента по его заявкам. Суммы — в копейках, как в API. */
export type CurrentOverdraft =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'issued'; limitKopecks: number; applicationId: string; pending?: PendingOverdraft }
  | ({ kind: 'pending' } & PendingOverdraft)

/** Заявка на овердрафт, которая ещё в работе (черновик, ждёт подписи, проверка, одобрена, подписан договор). */
export type PendingOverdraft = { applicationId: string; amountKopecks?: number; status: string }

// Цвета графика = токены кита: графит для остатка, красный (status-negative) — когда денег не хватает.
const INK = '#212124'
const NEGATIVE = '#ff4837'
const POSITIVE = '#0cc44d'
const GRID = '#e7e8eb'
const AXIS_TEXT = 'rgba(60, 60, 67, 0.6)'

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const day = (iso: string) => new Date(`${iso}T00:00:00`)
const shortDate = (iso: string) => `${day(iso).getDate()} ${MONTHS[day(iso).getMonth()]}`
const longDate = (iso: string) => day(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })
const dayMonth = (iso: string) => day(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

/** Пробелы внутри сумм из текстов бэка («240 000 ₽») — неразрывные, чтобы сумма не рвалась на две строки. */
const keepAmounts = (text: string) => text.replace(/(\d) (?=\d{3}\b)/g, '$1\u00a0').replace(/(\d) ₽/g, '$1\u00a0₽')

/** «500 тыс.», «1,2 млн», «−200 тыс.» — подписи оси */
function compact(value: number) {
  const abs = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  if (abs === 0) return '0'
  if (abs >= 1_000_000) return `${sign}${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(abs / 1_000_000)} млн`
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)} тыс.`
  return `${sign}${Math.round(abs)}`
}

/** Круглые деления оси Y с нулём: 4–6 штук. */
function niceTicks(min: number, max: number) {
  const span = Math.max(max - min, 1)
  const steps = [10_000, 20_000, 25_000, 50_000, 100_000, 200_000, 250_000, 500_000, 1_000_000, 2_000_000, 2_500_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000]
  const step = steps.find(s => span / s <= 5.5) ?? steps[steps.length - 1]
  const from = Math.floor(min / step) * step
  const to = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = from; v <= to + 1; v += step) ticks.push(v)
  return { ticks, domain: [from, to] as [number, number] }
}

// Размеры графика: высота, отступ сверху, высота оси дат → высота области построения.
const CHART_H = 220
const MARGIN_TOP = 8
const X_AXIS_H = 30
const PLOT_H = CHART_H - MARGIN_TOP - X_AXIS_H
/** Сколько пикселей под точкой разрыва занимает подпись (дата и сумма) */
const LABEL_SPACE = 54

/**
 * Ось Y. Без разрыва — от нуля (или минимума) до максимума по круглым делениям.
 * С разрывом низ оси — ровно столько, чтобы под точкой поместилась подпись, без пустых делений ниже.
 */
function yAxis(dataMin: number, dataMax: number, gapBalance?: number, overdraftRubles?: number) {
  const low = Math.min(0, dataMin, overdraftRubles ? -overdraftRubles : 0)
  if (gapBalance === undefined) return niceTicks(low, dataMax)
  let bottom = low
  let top = dataMax
  for (let i = 0; i < 3; i++) {
    top = niceTicks(bottom, dataMax).domain[1]
    // Точка разрыва должна быть не ниже LABEL_SPACE пикселей от низа: (gap − bottom) / (top − bottom) ≥ LABEL_SPACE / PLOT_H
    const r = LABEL_SPACE / PLOT_H
    bottom = Math.min(low - (top - low) * 0.03, (gapBalance - r * top) / (1 - r))
  }
  const { ticks } = niceTicks(bottom, dataMax)
  return { ticks: ticks.filter(t => t >= bottom && t <= top), domain: [bottom, top] as [number, number] }
}

/** Выделяет сумму в заголовке прогноза: «… не хватить <b>211 060 ₽</b>». */
function Headline({ text, negative }: { text: string; negative: boolean }) {
  const match = negative ? text.match(/(\d[\d\s  ]*\s?₽)/) : null
  if (!match || match.index === undefined) return <>{text}</>
  return <>{text.slice(0, match.index)}<span className={styles.headlineAmount}>{match[1]}</span>{text.slice(match.index + match[1].length)}</>
}

/** Прогноз остатка на 30 дней по регулярным платежам и поступлениям: график, день разрыва, совет. */
export function ForecastCard({ businessId, overdraftKopecks, onPick, currentOverdraft, title = 'Деньги на счёте', className }: ForecastCardProps) {
  const forecast = useForecast(businessId, overdraftKopecks)
  const navigate = useNavigate()
  const subtitle = 'Прогноз на 30 дней по регулярным платежам и поступлениям'
  const cls = [styles.card, className].filter(Boolean).join(' ')

  if (forecast.isPending || currentOverdraft?.kind === 'loading') return <Card title={title} subtitle={subtitle} className={cls}>
    <LoadingState view="skeleton" rows={4} label="Считаем прогноз…" />
  </Card>
  if (forecast.error) return <Card title={title} subtitle={subtitle} className={cls}>
    <ErrorState title="Не получилось посчитать прогноз" error={forecast.error} onRetry={() => forecast.refetch()} />
  </Card>
  const f = forecast.data
  if (!f.series.length) return <Card title={title} subtitle={subtitle} className={cls}>
    <EmptyState compact icon={<ChartLineAscMIcon />} title="Пока мало данных по счёту" text="Прогноз появится, когда по счёту накопятся регулярные платежи и поступления." />
  </Card>

  const gap = f.gap
  const lowest = f.series.reduce((a, b) => (b.balance < a.balance ? b : a))
  // Овердрафт, который у клиента уже выдан (главная). Лимит из предложения (overdraftKopecks) главнее — это другой экран.
  const own = overdraftKopecks ? undefined : currentOverdraft
  const issued = own?.kind === 'issued' ? own : undefined
  const pending = own?.kind === 'pending' ? own : issued?.pending
  const limitKopecks = overdraftKopecks || issued?.limitKopecks || undefined
  const limitRubles = limitKopecks ? limitKopecks / 100 : undefined
  // С лимитом овердрафта нехватка своих денег покрывается лимитом
  const covered = !!gap && !!limitRubles && limitRubles >= gap.shortfall
  const partly = !!gap && !!issued && !covered
  // Сколько не покроет выданный лимит — честная разница прогноза и лимита, округляем вверх до тысячи («около»)
  const rest = gap && limitRubles ? Math.ceil((gap.shortfall - limitRubles) / 1000) * 1000 : 0

  const headline = gap && issued
    ? `${dayMonth(gap.date)} остаток уйдёт в минус на ${formatMoney({ rubles: gap.shortfall })} — ${covered ? 'ваш овердрафт это покроет' : 'овердрафт покроет только часть'}`
    : f.headline
  const status = covered ? { color: 'green' as const, text: 'Овердрафт закроет разрыв' }
    : partly ? { color: 'orange' as const, text: 'Овердрафт закроет часть' }
      : gap ? { color: 'red' as const, text: 'Может не хватить' } : { color: 'green' as const, text: 'Денег хватает' }
  const open = (id: string) => navigate(`/applications/${id}`)

  return <Card title={title} subtitle={subtitle} className={cls}
    actions={<Status color={status.color} view="muted-alt" size={24} shape="rounded" uppercase={false}>{status.text}</Status>}>
    <p className={[styles.headline, gap ? styles.headlineGap : ''].join(' ')}><Headline text={keepAmounts(headline)} negative={!!gap && !covered} /></p>

    <ErrorBoundary compact>
      <BalanceChart forecast={f} overdraftRubles={limitRubles} covered={covered}
        gapText={gap && partly ? `минус ${formatMoney({ rubles: gap.shortfall })}` : undefined} />
    </ErrorBoundary>

    {gap && (gap.reasons?.length || f.details.length) ? <div className={styles.reasons}>
      <span className={styles.reasonsTitle}>{dayMonth(gap.date)} списываются</span>
      <ul>{(gap.reasons?.length ? gap.reasons : f.details).map(r => <li key={r}>{keepAmounts(r)}</li>)}</ul>
    </div> : null}

    {gap && issued && covered && <div className={styles.suggestion}>
      <span className={[styles.suggestionIcon, styles.suggestionIconOk].join(' ')} aria-hidden><CheckmarkCircleMIcon /></span>
      <span className={styles.suggestionText}>
        Ваш овердрафт {formatMoney({ kopecks: issued.limitKopecks })} закроет разрыв — включится сам и погасится первыми поступлениями.
      </span>
      <Button view="secondary" size={40} className={styles.suggestionButton} onClick={() => open(issued.applicationId)}>Открыть овердрафт</Button>
    </div>}

    {gap && issued && partly && <div className={styles.suggestion}>
      <span className={styles.suggestionIcon} aria-hidden><LightningMIcon /></span>
      <span className={styles.suggestionText}>
        Овердрафт {formatMoney({ kopecks: issued.limitKopecks })} закроет часть: не хватит ещё около {formatMoney({ rubles: rest })}.
        {pending ? ' Заявка на новый овердрафт уже в работе.' : onPick && gap.overdraft_suggestion > 0 ? ' Подберём новый лимит, который закроет весь разрыв.' : ''}
      </span>
      {pending
        ? <Button view="secondary" size={40} className={styles.suggestionButton} onClick={() => open(pending.applicationId)}>Открыть заявку</Button>
        : onPick && gap.overdraft_suggestion > 0 && <Button view="secondary" size={40} className={styles.suggestionButton} onClick={() => onPick(gap.overdraft_suggestion)}>
          Увеличить лимит
        </Button>}
    </div>}

    {gap && !issued && pending && <div className={styles.suggestion}>
      <span className={styles.suggestionIcon} aria-hidden><LightningMIcon /></span>
      <span className={styles.suggestionText}>
        Заявка на овердрафт{pending.amountKopecks ? ` на ${formatMoney({ kopecks: pending.amountKopecks })}` : ''} уже в работе
        {pending.amountKopecks
          ? pending.amountKopecks / 100 >= gap.shortfall ? ' — когда его выдадут, этого лимита хватит на разрыв.' : ` — этого лимита не хватит на весь разрыв: нужно около ${formatMoney({ rubles: gap.overdraft_suggestion })}.`
          : '.'}
      </span>
      <Button view="secondary" size={40} className={styles.suggestionButton} onClick={() => open(pending.applicationId)}>Открыть заявку</Button>
    </div>}

    {gap && !issued && !pending && f.suggestion && <div className={styles.suggestion}>
      <span className={styles.suggestionIcon} aria-hidden><LightningMIcon /></span>
      <span className={styles.suggestionText}>{keepAmounts(f.suggestion)}</span>
      {onPick && gap.overdraft_suggestion > 0 && <Button view="secondary" size={40} className={styles.suggestionButton} onClick={() => onPick(gap.overdraft_suggestion)}>
        Подобрать овердрафт
      </Button>}
    </div>}

    {!gap && <div className={styles.calm}>
      <span className={styles.calmIcon} aria-hidden><CheckmarkCircleMIcon /></span>
      <span>Самый низкий остаток по прогнозу — <Money rubles={lowest.balance} weight="bold" />, {dayMonth(lowest.date)}</span>
    </div>}

    {!gap && <UpcomingPayments forecast={f} />}
  </Card>
}

/** Ближайшие крупные регулярные списания (из recurring): дата следующего платежа считается от первого дня прогноза. */
function UpcomingPayments({ forecast }: { forecast: ForecastData }) {
  const start = forecast.series[0]?.date
  if (!start || !forecast.recurring?.length) return null
  const from = day(start)
  const next = (dayOfMonth: number) => {
    const d = new Date(from.getFullYear(), from.getMonth(), dayOfMonth)
    if (d < from) d.setMonth(d.getMonth() + 1)
    return d
  }
  const rows = [...forecast.recurring].sort((x, y) => y.amount - x.amount).slice(0, 3)
    .map(r => ({ ...r, when: next(r.day) })).sort((x, y) => x.when.getTime() - y.when.getTime())
  return <div className={styles.upcoming}>
    <span className={styles.reasonsTitle}>Крупные регулярные платежи</span>
    <ul>{rows.map(r => <li key={`${r.counterparty}-${r.day}`}>
      <span className={styles.upcomingDate}>{r.when.getDate()} {MONTHS[r.when.getMonth()]}</span>
      <span className={styles.upcomingName}>{r.counterparty}</span>
      <Money rubles={r.amount} weight="medium" className={styles.upcomingSum} />
    </li>)}</ul>
  </div>
}

type Point = { date: string; balance: number }

function BalanceChart({ forecast, overdraftRubles, covered, gapText }: { forecast: ForecastData; overdraftRubles?: number; covered?: boolean; gapText?: string }) {
  const id = useId().replace(/:/g, '')
  const data: Point[] = forecast.series
  const values = data.map(p => p.balance)
  const dataMax = Math.max(...values)
  const dataMin = Math.min(...values)
  const gap = forecast.gap
  const gapPoint = gap ? data.find(p => p.date === gap.date) : undefined

  // Ось: от нуля (или минимума/лимита овердрафта) до максимума; снизу ровно столько места, сколько нужно подписи разрыва.
  const { ticks, domain } = yAxis(dataMin, dataMax, gapPoint?.balance, overdraftRubles)

  // Где у линии и заливки проходит ноль (доля от верха их рамки): выше — графит, ниже — красный.
  const zero = dataMax <= 0 ? 0 : dataMin >= 0 ? 1 : dataMax / (dataMax - dataMin)
  const xTicks = [0, 7, 14, 21, data.length - 1].filter(i => i < data.length).map(i => data[i].date)
  const gapIndex = gapPoint ? data.indexOf(gapPoint) / Math.max(data.length - 1, 1) : 0
  const gapAlign = gapIndex < 0.4 ? 'start' : gapIndex > 0.6 ? 'end' : 'middle'
  // Подпись зоны овердрафта — сверху слева, под нулём: снизу у точки разрыва своя подпись (на телефоне они бы наложились).
  // Узкая зона (лимит мал по сравнению с остатком): подпись не помещается внутри — ставим под зоной, по центру.
  const zoneThin = !!overdraftRubles && (overdraftRubles / Math.max(domain[1] - domain[0], 1)) * PLOT_H < 24

  return <div className={styles.chart}>
    <ResponsiveContainer width="100%" height={CHART_H}>
      <AreaChart data={data} margin={{ top: MARGIN_TOP, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`stroke-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset={zero} stopColor={INK} />
            <stop offset={zero} stopColor={NEGATIVE} />
          </linearGradient>
          <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset={0} stopColor={INK} stopOpacity={0.1} />
            <stop offset={zero} stopColor={INK} stopOpacity={0.02} />
            <stop offset={zero} stopColor={NEGATIVE} stopOpacity={0.06} />
            <stop offset={1} stopColor={NEGATIVE} stopOpacity={0.18} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} />
        {overdraftRubles ? <ReferenceArea y1={-overdraftRubles} y2={0} fill={POSITIVE} fillOpacity={0.08} stroke="none" ifOverflow="extendDomain"
          label={{ value: `Овердрафт ${formatMoney({ rubles: overdraftRubles })}`, position: zoneThin ? 'bottom' : 'insideTopLeft', fill: '#0d9336', fontSize: 12, fontWeight: 600 }} /> : null}
        <XAxis dataKey="date" height={X_AXIS_H} ticks={xTicks} tickFormatter={shortDate} tickLine={false} axisLine={false}
          tick={{ fill: AXIS_TEXT, fontSize: 12 }} tickMargin={8} interval={0} padding={{ left: 4, right: 4 }} />
        <YAxis domain={domain} ticks={ticks} tickFormatter={compact} tickLine={false} axisLine={false}
          tick={<YTick />} width={64} interval={0} allowDataOverflow />
        <Tooltip content={<ChartTooltip overdraftRubles={overdraftRubles} />} cursor={{ stroke: INK, strokeOpacity: 0.25, strokeWidth: 1 }} isAnimationActive={false} />
        <ReferenceLine y={0} stroke={NEGATIVE} strokeWidth={1} strokeOpacity={dataMin < 0 ? 0.8 : 0.45} />
        {gapPoint && <ReferenceLine segment={[{ x: gapPoint.date, y: domain[1] }, { x: gapPoint.date, y: gapPoint.balance }]} stroke={NEGATIVE} strokeOpacity={0.35} strokeWidth={1} />}
        <Area type="monotone" dataKey="balance" stroke={`url(#stroke-${id})`} strokeWidth={2} fill={`url(#fill-${id})`}
          baseValue={0} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2, fill: INK }} isAnimationActive={false} />
        {gapPoint && gap && <ReferenceDot x={gapPoint.date} y={gapPoint.balance} r={6} fill={NEGATIVE} stroke="#fff" strokeWidth={2}
          label={<GapLabel date={gap.date} text={gapText ?? `${covered ? 'из овердрафта' : 'не хватит'} ${formatMoney({ rubles: gap.shortfall })}`} align={gapAlign} />} />}
      </AreaChart>
    </ResponsiveContainer>
    {/* Табличный двойник графика — для экранных дикторов. Прячем обёртку: у самой таблицы height: 1px не работает,
        и её строки растягивали страницу снизу. */}
    <div className={styles.srOnly}>
      <table>
        <caption>Прогноз остатка по дням</caption>
        <tbody>{data.map(p => <tr key={p.date}><th scope="row">{longDate(p.date)}</th><td>{formatMoney({ rubles: p.balance })}</td></tr>)}</tbody>
      </table>
    </div>
  </div>
}

/** Подпись у точки разрыва: дата и сумма нехватки. viewBox даёт recharts. */
// Подпись стоит под точкой (это минимум графика, снизу оставлено место) и уходит в сторону от середины графика,
// где под линией свободно: справа от разрыва линия поднимается, слева — падает сверху.
// Под подписью — белая подложка по размеру текста: линии сетки не перечёркивают сумму.
function GapLabel({ date, text, align, viewBox }: { date: string; text: string; align: 'start' | 'middle' | 'end'; viewBox?: { x?: number; y?: number; width?: number; height?: number } }) {
  const cx = (viewBox?.x ?? 0) + (viewBox?.width ?? 0) / 2
  const cy = (viewBox?.y ?? 0) + (viewBox?.height ?? 0) / 2
  const x = align === 'start' ? cx - 8 : align === 'end' ? cx + 8 : cx
  const textRef = useRef<SVGGElement>(null)
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const b = textRef.current?.getBBox()
    if (!b) return
    setBox(prev => (prev && prev.x === b.x && prev.y === b.y && prev.width === b.width && prev.height === b.height ? prev : { x: b.x, y: b.y, width: b.width, height: b.height }))
  }, [x, cy, text, date, align])
  return <g className={styles.gapLabel}>
    {box && <rect x={box.x - 6} y={box.y - 3} width={box.width + 12} height={box.height + 6} rx={8} className={styles.gapLabelBg} />}
    <g ref={textRef}>
      <text x={x} y={cy + 24} textAnchor={align} className={styles.gapLabelDate}>{dayMonth(date)}</text>
      <text x={x} y={cy + 42} textAnchor={align} className={styles.gapLabelValue}>{text}</text>
    </g>
  </g>
}

/** Подпись оси Y в одну строку (стандартная у recharts переносится на узкой оси). */
function YTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: number } }) {
  return <text x={x} y={y} dy={4} textAnchor="end" fill={AXIS_TEXT} fontSize={12}>{compact(payload?.value ?? 0)}</text>
}

function ChartTooltip({ active, payload, overdraftRubles }: TooltipProps<number, string> & { overdraftRubles?: number }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as Point
  const fromOverdraft = p.balance < 0 && !!overdraftRubles && -p.balance <= overdraftRubles
  return <div className={styles.tooltip}>
    <Money rubles={p.balance} size="s" tone={p.balance < 0 && !fromOverdraft ? 'negative' : 'default'} />
    <span className={styles.tooltipDate}>{longDate(p.date)}{fromOverdraft ? ' · из овердрафта' : p.balance < 0 ? ' · не хватает денег' : ''}</span>
  </div>
}
