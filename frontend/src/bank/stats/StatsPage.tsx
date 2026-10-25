import { ReactNode, useMemo } from 'react'
import { Link } from 'react-router'
import { Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BubbleMIcon } from '@alfalab/icons-glyph/BubbleMIcon'
import { ChartColumnThreeMIcon } from '@alfalab/icons-glyph/ChartColumnThreeMIcon'
import { ShieldMIcon } from '@alfalab/icons-glyph/ShieldMIcon'
import { UserMIcon } from '@alfalab/icons-glyph/UserMIcon'
import { toneTitle, scoreTone } from '../../api'
import { Bell, Card, EmptyState, ErrorBoundary, ErrorState, Grid, LoadingState, Money, PageHeader, Stack, statusColor, StatusColor } from '../../ui'
import { bankStatusName, productName } from '../workplace/text'
import { decisionStats, DecisionStats, formatDuration, Group, queueStats, useAllApplications, useDecisionAudit } from './data'
import styles from './StatsPage.module.css'

/** Порядок статусов — по ходу заявки: от черновика к выдаче, потом неуспешные исходы. */
const statusOrder = [
  'DRAFT', 'AWAITING_SIGNATURE', 'SUBMITTED', 'VALIDATION', 'ENRICHMENT', 'SCORING', 'MANUAL_REVIEW', 'INFO_REQUESTED',
  'COUNTER_OFFER', 'APPROVED', 'CONTRACT_SIGNED', 'ISSUED', 'REJECTED', 'CANCELLED', 'EXPIRED',
]
// Те же смысловые цвета, что у тегов статуса (StatusTag): зелёный — готово, оранжевый — ждём клиента,
// синий — работает банк, красный — отказ, серый — неактивно.
const statusFill: Record<StatusColor, string> = { green: '#0cc44d', orange: '#fa9313', blue: '#2288fa', red: '#ff5431', grey: '#b8b9c0' }
// Классы риска — цветами ScoreBadge, чтобы сводка совпадала с очередью и карточкой.
const toneFill: Record<string, string> = { green: '#0d8a35', yellow: '#f5a524', red: '#e5281b', black: '#121213', none: '#c9cad0' }
const AUTO_FILL = '#212124'
const MANUAL_FILL = '#c9cad0'
const PRODUCT_FILL = '#2288fa'

const num = (v: number) => new Intl.NumberFormat('ru-RU').format(v)
const pct = (part: number, total: number) => (total ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format((part / total) * 100)}%` : '—')

/** Мини-дашборд банка (ТЗ, раздел 9, п. 7): заявки по статусам, доля авторешений, время до решения. */
export function StatsPage() {
  const apps = useAllApplications()
  const audit = useDecisionAudit()
  const q = useMemo(() => (apps.data ? queueStats(apps.data) : null), [apps.data])
  const decisions = useMemo(() => {
    if (!audit.data || !apps.data) return null
    return decisionStats(audit.data, new Map(apps.data.map(a => [a.id, a.status])))
  }, [audit.data, apps.data])

  return <Stack gap={24}>
    <PageHeader
      eyebrow="Кабинет банка"
      title="Сводка"
      subtitle="Заявки по статусам и продуктам, доля авторешений и время до решения. Считается из очереди заявок и журнала аудита, обновляется сама."
      actions={<Bell />}
    />

    {apps.isPending && <LoadingState view="skeleton" rows={6} label="Собираем сводку…" />}
    {apps.error && !apps.data && <ErrorState error={apps.error} title="Не получилось загрузить заявки" onRetry={() => apps.refetch()} />}
    {q && q.total === 0 && <EmptyState icon={<ChartColumnThreeMIcon />} title="Заявок пока нет" text="Сводка появится, когда клиенты начнут подавать заявки." />}

    {q && q.total > 0 && <>
      {apps.error && <ErrorState error={apps.error} title="Данные не обновились — показываем последние полученные" onRetry={() => apps.refetch()} />}

      <div className={styles.tiles}>
        <Tile label="Всего заявок" value={num(q.total)} hint={`в работе у банка: ${num(q.inWork.count)}`} />
        <Tile label="На ручной проверке" value={num(q.manual)} accent={q.manual > 0} to="/bank?status=MANUAL_REVIEW"
          hint={q.unassigned ? `без исполнителя: ${num(q.unassigned)}` : 'у всех есть исполнитель'} />
        <Tile label="Доля авторешений" value={decisions ? pct(decisions.auto, decisions.scored) : audit.error ? '—' : '…'}
          hint={decisions ? `${num(decisions.auto)} из ${num(decisions.scored)} без специалиста` : ' '} />
        <Tile label="Время до решения" value={decisions?.autoTime ? formatDuration(decisions.autoTime.avg) : audit.error ? '—' : '…'}
          hint={decisions?.manualTime ? `авто; вручную — ${formatDuration(decisions.manualTime.avg)}` : 'авто, в среднем'} />
      </div>

      <Grid columns={2}>
        <Card title="Требует внимания" subtitle="Сейчас, по очереди заявок">
          <ul className={styles.attention}>
            <Attention icon={<UserMIcon />} to="/bank?status=MANUAL_REVIEW" value={q.unassigned} label="Без исполнителя"
              text="на ручной проверке, никто не взял в работу" />
            <Attention icon={<ShieldMIcon />} to="/bank?status=MANUAL_REVIEW" value={decisions?.pendingRisk} label="Ждут риск-менеджера"
              text="решение андеррайтера ждёт второго одобрения" pending={!decisions && !audit.error} />
            <Attention icon={<BubbleMIcon />} to="/bank" value={q.overdue} label="Вопрос клиента просрочен" negative
              text={q.openQuestions ? `открытых вопросов: ${num(q.openQuestions)}; просроченные — наверху очереди` : 'открытых вопросов клиентов нет'} />
          </ul>
        </Card>

        <Card title="Суммы заявок" subtitle="По запрошенной сумме заявки">
          <div className={styles.money}>
            <MoneyRow label="В работе у банка" hint={`${num(q.inWork.count)} заявок: проверка и запрос документов`} kopecks={q.inWork.amount} />
            <MoneyRow label="Одобрено, ждёт подписи" hint={`${num(q.approved.count)} заявок`} kopecks={q.approved.amount} />
            <MoneyRow label="Выдано" hint={`${num(q.issued.count)} кредитов`} kopecks={q.issued.amount} strong />
          </div>
        </Card>
      </Grid>

      <Grid columns={2}>
        <Card title="Заявки по статусам" subtitle="Нажмите на статус — откроется очередь с этим фильтром">
          <BarList
            items={[...q.byStatus].sort((a, b) => statusOrder.indexOf(a.key) - statusOrder.indexOf(b.key))}
            name={k => bankStatusName[k] ?? k}
            fill={k => statusFill[statusColor(k)]}
            to={k => `/bank?status=${k}`}
          />
        </Card>

        <Stack>
          <Card title="Авторешения" subtitle="Сколько заявок система решила сама, без специалиста">
            <AuditBlock audit={audit} decisions={decisions}>{d => <AutoDecisions d={d} />}</AuditBlock>
          </Card>
          <Card title="По продуктам" subtitle="Количество и сумма заявок; нажмите — откроется очередь по продукту">
            <BarList items={q.byProduct} name={k => productName[k] ?? k} fill={() => PRODUCT_FILL} to={k => `/bank?product=${k}`} showAmount />
          </Card>
        </Stack>
      </Grid>

      <Grid columns={2}>
        <Card title="Классы риска" subtitle="Класс по скорингу, A — самый надёжный. «—» — расчёта ещё не было">
          <ErrorBoundary compact><ClassChart groups={q.byClass} /></ErrorBoundary>
        </Card>
        <Card title="Время до решения" subtitle="От отправки заявки в банк до решения">
          <AuditBlock audit={audit} decisions={decisions}>{d => <DecisionTimes d={d} />}</AuditBlock>
        </Card>
      </Grid>

      <p className={styles.source}>
        Отдельного API статистики нет — сводка собрана на странице из очереди заявок (все заявки, которые видит банк) и журнала
        аудита за всё время работы стенда. Доля авторешений — по первому автоматическому решению каждой заявки; время до решения —
        от отправки заявки до решения системы или специалиста.
      </p>
    </>}
  </Stack>
}

/** Блок, который считается по журналу аудита: загрузка, ошибка, пусто — или содержимое. */
function AuditBlock({ audit, decisions, children }: {
  audit: ReturnType<typeof useDecisionAudit>; decisions: DecisionStats | null; children: (d: DecisionStats) => ReactNode
}) {
  if (audit.error && !decisions) return <ErrorState error={audit.error} title="Не получилось загрузить журнал аудита" onRetry={() => audit.refetch()} />
  if (!decisions) return <LoadingState view="inline" label="Считаем по журналу аудита…" />
  if (decisions.scored === 0) return <EmptyState compact icon={<ChartColumnThreeMIcon />} title="Автоматических решений пока нет" text="Появятся, когда заявки пройдут скоринг." />
  return <ErrorBoundary compact>{children(decisions)}</ErrorBoundary>
}

function Tile({ label, value, hint, accent, to }: { label: string; value: string; hint: string; accent?: boolean; to?: string }) {
  const body = <>
    <span className={styles.tileLabel}>{label}</span>
    <span className={[styles.tileValue, accent ? styles.tileAccent : ''].filter(Boolean).join(' ')}>{value}</span>
    <span className={styles.tileHint}>{hint}</span>
  </>
  return to
    ? <Link to={to} className={[styles.tile, styles.tileLink].join(' ')}>{body}</Link>
    : <div className={styles.tile}>{body}</div>
}

function Attention({ icon, to, value, label, text, negative, pending }: {
  icon: ReactNode; to: string; value: number | undefined; label: string; text: string; negative?: boolean; pending?: boolean
}) {
  const hot = !!value
  return <li>
    <Link to={to} className={styles.attentionItem}>
      <span className={[styles.attentionIcon, hot ? (negative ? styles.hotNegative : styles.hot) : ''].filter(Boolean).join(' ')} aria-hidden>{icon}</span>
      <span className={styles.attentionText}>
        <b>{label}</b>
        <small>{text}</small>
      </span>
      <span className={[styles.attentionValue, hot && negative ? styles.valueNegative : ''].filter(Boolean).join(' ')}>
        {value != null ? num(value) : pending ? '…' : '—'}
      </span>
    </Link>
  </li>
}

function MoneyRow({ label, hint, kopecks, strong }: { label: string; hint: string; kopecks: number; strong?: boolean }) {
  return <div className={styles.moneyRow}>
    <span className={styles.moneyText}><b>{label}</b><small>{hint}</small></span>
    <Money kopecks={kopecks} size={strong ? 'l' : 'm'} />
  </div>
}

/** Горизонтальные полосы-ссылки: подпись, число, полоса длиной от максимума. */
function BarList({ items, name, fill, to, showAmount }: {
  items: Group[]; name: (key: string) => string; fill: (key: string) => string; to: (key: string) => string; showAmount?: boolean
}) {
  const max = Math.max(1, ...items.map(i => i.count))
  return <ul className={styles.bars}>
    {items.map(i => <li key={i.key}>
      <Link to={to(i.key)} className={styles.barRow} aria-label={`${name(i.key)}: ${i.count} — открыть в очереди`}>
        <span className={styles.barHead}>
          <span className={styles.barName}>{name(i.key)}</span>
          {showAmount && <Money kopecks={i.amount} weight="regular" className={styles.barAmount} />}
          <b className={styles.barCount}>{num(i.count)}</b>
        </span>
        <span className={styles.barTrack} aria-hidden>
          <span className={styles.barFill} style={{ width: `${Math.max(2, (i.count / max) * 100)}%`, background: fill(i.key) }} />
        </span>
      </Link>
    </li>)}
  </ul>
}

type Slice = { name: string; value: number; fill: string }

function AutoDecisions({ d }: { d: DecisionStats }) {
  const slices: Slice[] = [
    { name: 'Решила система', value: d.auto, fill: AUTO_FILL },
    { name: 'Ушли на ручную проверку', value: d.manual, fill: MANUAL_FILL },
  ]
  return <div className={styles.auto}>
    <div className={styles.donut}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="100%" startAngle={90} endAngle={-270}
            stroke="#fff" strokeWidth={2} isAnimationActive={false}>
            {slices.map(s => <Cell key={s.name} fill={s.fill} />)}
          </Pie>
          <Tooltip content={<SliceTooltip total={d.scored} />} isAnimationActive={false} />
        </PieChart>
      </ResponsiveContainer>
      <div className={styles.donutCenter} aria-hidden>
        <b>{pct(d.auto, d.scored)}</b>
        <span>авто</span>
      </div>
    </div>
    <div className={styles.autoSide}>
      <ul className={styles.legend}>
        {slices.map(s => <li key={s.name}>
          <span className={styles.swatch} style={{ background: s.fill }} aria-hidden />
          <span>{s.name}</span>
          <b>{num(s.value)}</b>
        </li>)}
      </ul>
      <p className={styles.autoNote}>Из {num(d.scored)} заявок, прошедших автоматический расчёт. Считается по первому расчёту каждой заявки.</p>
    </div>
  </div>
}

function DecisionTimes({ d }: { d: DecisionStats }) {
  return <div className={styles.times}>
    <div className={styles.timeRow}>
      <span className={styles.timeLabel}><b>Система</b><small>{num(d.auto)} авторешений: первый расчёт сразу дал итог</small></span>
      <span className={styles.timeValue}>{d.autoTime ? formatDuration(d.autoTime.avg) : '—'}<small>в среднем</small></span>
    </div>
    <div className={styles.timeRow}>
      <span className={styles.timeLabel}>
        <b>Со специалистом</b>
        <small>решено {num(d.manualDecided)} из {num(d.manual)} ручных: итоговое решение андеррайтера или подтверждение риск-менеджера</small>
      </span>
      <span className={styles.timeValue}>{d.manualTime ? formatDuration(d.manualTime.avg) : '—'}
        <small>{d.manualTime ? `в среднем, медиана ${formatDuration(d.manualTime.median)}` : 'решений ещё нет'}</small>
      </span>
    </div>
  </div>
}

function SliceTooltip({ active, payload, total }: { active?: boolean; payload?: { payload: Slice }[]; total: number }) {
  if (!active || !payload?.length) return null
  const s = payload[0].payload
  return <div className={styles.tooltip}><b>{s.name}</b><span>{num(s.value)} заявок · {pct(s.value, total)}</span></div>
}

type ClassRow = { cls: string; count: number; tone: string }

function ClassChart({ groups }: { groups: Group[] }) {
  const rows: ClassRow[] = ['A', 'B', 'C', 'D', 'E', '—'].map(cls => ({
    cls, count: groups.find(g => g.key === cls)?.count ?? 0, tone: scoreTone(cls === '—' ? null : cls),
  }))
  return <>
    <div className={styles.classChart}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 24, right: 4, bottom: 0, left: 4 }} barCategoryGap="22%">
          <XAxis dataKey="cls" tickLine={false} axisLine={{ stroke: '#e7e8eb' }} tick={{ fill: '#6b6d78', fontSize: 13, fontWeight: 600 }} />
          <YAxis hide allowDecimals={false} />
          <Tooltip content={<ClassTooltip />} cursor={{ fill: 'rgba(11, 31, 53, 0.04)' }} isAnimationActive={false} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false} minPointSize={2}>
            {rows.map(r => <Cell key={r.cls} fill={toneFill[r.tone]} />)}
            <LabelList dataKey="count" position="top" fill="#212124" fontSize={13} fontWeight={600} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    <ul className={styles.classLegend}>
      {(['green', 'yellow', 'red', 'black'] as const).map(t => <li key={t}>
        <span className={styles.swatch} style={{ background: toneFill[t] }} aria-hidden />
        {t === 'green' ? 'A–B' : t === 'yellow' ? 'C' : t === 'red' ? 'D' : 'E'} — {toneTitle[t]}
      </li>)}
    </ul>
  </>
}

function ClassTooltip({ active, payload }: { active?: boolean; payload?: { payload: ClassRow }[] }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return <div className={styles.tooltip}>
    <b>{r.cls === '—' ? 'Без расчёта' : `Класс ${r.cls}`}</b>
    <span>{num(r.count)} заявок{r.cls !== '—' ? ` · ${toneTitle[r.tone]}` : ''}</span>
  </div>
}
