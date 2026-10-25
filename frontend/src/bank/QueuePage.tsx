import { MouseEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button } from '@alfalab/core-components/button/esm'
import { Pagination } from '@alfalab/core-components/pagination/esm'
import { Select } from '@alfalab/core-components/select/esm'
import { Table } from '@alfalab/core-components/table/esm'
import { Tab, Tabs } from '@alfalab/core-components/tabs/esm'
import { Tag } from '@alfalab/core-components/tag/esm'
import { BubbleMIcon } from '@alfalab/icons-glyph/BubbleMIcon'
import { DocumentLinesMIcon } from '@alfalab/icons-glyph/DocumentLinesMIcon'
import { UserMIcon } from '@alfalab/icons-glyph/UserMIcon'
import { BankItem } from '../api'
import { useSession } from '../auth'
import { useBankQueue } from '../queries'
import { Bell, Card, EmptyState, ErrorState, LoadingState, Money, PageHeader, ScoreBadge, Stack, StatusTag } from '../ui'
import { useStatusCount } from './workplace/data'
import { bankStatusName, formatDateShort, formatDateTime, productName, shortStaffName } from './workplace/text'
import styles from './QueuePage.module.css'

const PAGE_SIZE = 20
const ALL = 'ALL'
const statusTabs: [string, string][] = [
  [ALL, 'Все'], ['MANUAL_REVIEW', 'Ручная проверка'], ['INFO_REQUESTED', 'Ждём документы'],
  ['APPROVED', 'Одобренные'], ['ISSUED', 'Выданные'], ['REJECTED', 'Отказы'],
]
const productOptions = [{ key: ALL, content: 'Все продукты' }, ...Object.entries(productName).map(([key, content]) => ({ key, content }))]

type QueueItem = BankItem & { created_at?: string }

// Очередь банка: фильтры и номер страницы живут в адресе — их видно в ссылке и они переживают «назад».
export function QueuePage() {
  const { me } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filter = {
    status: params.get('status') ?? '',
    product: params.get('product') ?? '',
    mine: params.get('mine') === '1',
    page: Math.max(1, Number(params.get('page') ?? 1) || 1),
  }
  const queue = useBankQueue(filter, PAGE_SIZE)
  const isUnderwriter = me.role === 'UNDERWRITER'
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    if (!('page' in patch)) next.delete('page')
    setParams(next)
  }
  const hasFilters = !!(filter.status || filter.product || filter.mine)
  const data = queue.data
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const open = (id: string) => navigate(`/bank/applications/${id}`)
  const from = data && data.total ? (filter.page - 1) * PAGE_SIZE + 1 : 0
  const to = data ? Math.min(filter.page * PAGE_SIZE, data.total) : 0

  return <Stack gap={24}>
    <PageHeader
      eyebrow="Кабинет банка"
      title="Очередь заявок"
      subtitle="Заявки клиентов с баллом скоринга и статусом. Заявки с просроченным вопросом клиента — наверху."
      actions={<Bell />}
    />

    <QueueStats active={filter.status} mine={isUnderwriter} onPick={status => set({ status: filter.status === status ? '' : status })} />

    <Card padding="none" className={styles.queueCard}>
      <div className={styles.toolbar}>
        <Tabs
          view="secondary"
          size="xxs"
          scrollable
          selectedId={filter.status || ALL}
          onChange={(_, { selectedId }) => set({ status: selectedId === ALL ? '' : String(selectedId) })}
          className={styles.tabs}
        >
          {statusTabs.map(([id, title]) => <Tab key={id} id={id} title={title} />)}
        </Tabs>
        <div className={styles.filters}>
          {isUnderwriter && <Tag size={40} checked={filter.mine} leftAddons={<UserMIcon className={styles.tagIcon} />} onClick={() => set({ mine: filter.mine ? '' : '1' })}>
            Мои заявки
          </Tag>}
          <Select
            size={40}
            className={styles.product}
            options={productOptions}
            selected={filter.product || ALL}
            onChange={({ selected }) => set({ product: !selected || selected.key === ALL ? '' : selected.key })}
            label="Продукт"
            labelView="inner"
            optionsListWidth="field"
          />
          <div className={styles.found} aria-live="polite">
            {data ? <>Найдено: <b>{data.total}</b></> : ' '}
          </div>
          {hasFilters && <Button view="text" size={32} onClick={() => setParams(new URLSearchParams())}>Сбросить фильтры</Button>}
        </div>
      </div>

      {queue.isPending && <div className={styles.pad}><LoadingState view="skeleton" rows={6} label="Загружаем очередь…" /></div>}
      {queue.error && !data && <div className={styles.pad}><ErrorState error={queue.error} onRetry={() => queue.refetch()} title="Не получилось загрузить очередь" /></div>}
      {data?.items.length === 0 && <EmptyState
        compact
        icon={<DocumentLinesMIcon />}
        title={hasFilters ? 'Под фильтры ничего не попало' : 'Заявок пока нет'}
        text={hasFilters ? 'Измените статус или продукт — или сбросьте фильтры.' : 'Новые заявки появятся здесь автоматически.'}
        action={hasFilters ? <Button view="secondary" size={40} onClick={() => setParams(new URLSearchParams())}>Сбросить фильтры</Button> : undefined}
      />}

      {data && data.items.length > 0 && <div className={[styles.results, queue.isPlaceholderData ? styles.stale : ''].filter(Boolean).join(' ')}>
        <div className={styles.tableWrap}>
          <Table className={styles.table} wrapper={false}>
            <Table.THead>
              <Table.THeadCell className={styles.th}>Клиент</Table.THeadCell>
              <Table.THeadCell className={styles.th} width={170}>Продукт</Table.THeadCell>
              <Table.THeadCell className={styles.th} width={128} textAlign="right">Сумма</Table.THeadCell>
              <Table.THeadCell className={styles.th} width={96}>Балл</Table.THeadCell>
              <Table.THeadCell className={styles.th} width={160}>Статус</Table.THeadCell>
              <Table.THeadCell className={styles.th} width={124}>Исполнитель</Table.THeadCell>
            </Table.THead>
            <Table.TBody>
              {(data.items as QueueItem[]).map(item => <Table.TRow
                key={item.id}
                onClick={() => open(item.id)}
                className={[styles.row, item.question_overdue ? styles.rowOverdue : ''].filter(Boolean).join(' ')}
              >
                <Table.TCell className={styles.td}><ClientCell item={item} /></Table.TCell>
                <Table.TCell className={styles.td}>
                  <span className={styles.primary}>{productName[item.product] ?? item.product}</span>
                  {item.created_at && <span className={styles.meta}>от {formatDateShort(item.created_at)}</span>}
                </Table.TCell>
                <Table.TCell className={[styles.td, styles.right].join(' ')}><Money kopecks={item.amount_kopecks} weight="medium" /></Table.TCell>
                <Table.TCell className={styles.td}><ScoreBadge cls={item.decision_class} score={item.score} status={item.status} /></Table.TCell>
                <Table.TCell className={styles.td}><StatusTag status={item.status} size={20}>{bankStatusName[item.status] ?? item.status}</StatusTag></Table.TCell>
                <Table.TCell className={styles.td}><Assignee item={item} meId={me.id} /></Table.TCell>
              </Table.TRow>)}
            </Table.TBody>
          </Table>
        </div>

        {/* Узкий экран: те же заявки карточками-строками */}
        <ul className={styles.list}>
          {(data.items as QueueItem[]).map(item => <li key={item.id}>
            <Link to={`/bank/applications/${item.id}`} className={[styles.listItem, item.question_overdue ? styles.rowOverdue : ''].filter(Boolean).join(' ')}>
              <div className={styles.listTop}>
                <span className={styles.listName}>{item.business_name}</span>
                <ScoreBadge cls={item.decision_class} score={item.score} status={item.status} />
              </div>
              <div className={styles.listMid}>
                <span>{productName[item.product] ?? item.product}</span>
                <Money kopecks={item.amount_kopecks} weight="bold" />
              </div>
              <div className={styles.listBottom}>
                <StatusTag status={item.status} size={20}>{bankStatusName[item.status] ?? item.status}</StatusTag>
                <span className={styles.meta}>ИНН {item.inn}{item.assignee_id ? ` · ${item.assignee_id === me.id ? 'ведёте вы' : shortStaffName(item.assignee_name)}` : ''}</span>
              </div>
              <Question item={item} />
            </Link>
          </li>)}
        </ul>

        <div className={styles.footer}>
          <span className={styles.range}>{from}–{to} из {data.total}</span>
          {pages > 1 && <Pagination
            currentPageIndex={Math.min(filter.page, pages) - 1}
            pagesCount={pages}
            sidePadding={1}
            activePadding={1}
            onPageChange={index => set({ page: index > 0 ? String(index + 1) : '' })}
          />}
        </div>
      </div>}
      {queue.error && data && <div className={styles.pad}><ErrorState error={queue.error} onRetry={() => queue.refetch()} title="Не получилось обновить очередь" /></div>}
    </Card>
  </Stack>
}

function ClientCell({ item }: { item: QueueItem }) {
  const stop = (e: MouseEvent) => e.stopPropagation()
  return <div className={styles.client}>
    <Link to={`/bank/applications/${item.id}`} className={styles.clientName} onClick={stop}>{item.business_name}</Link>
    <span className={styles.meta}>ИНН {item.inn}</span>
    <Question item={item} />
  </div>
}

function Question({ item }: { item: QueueItem }) {
  if (item.question_overdue) return <span className={[styles.question, styles.questionOverdue].join(' ')}>
    <BubbleMIcon className={styles.questionIcon} aria-hidden />Вопрос клиента без ответа — срок прошёл
  </span>
  if (item.open_question_due_at) return <span className={styles.question}>
    <BubbleMIcon className={styles.questionIcon} aria-hidden />Вопрос клиента · ответить до {formatDateTime(item.open_question_due_at)}
  </span>
  return null
}

function Assignee({ item, meId }: { item: QueueItem; meId: string }) {
  if (!item.assignee_id) return <span className={styles.muted}>—</span>
  if (item.assignee_id === meId) return <span className={styles.me}>Вы</span>
  return <span className={styles.primary}>{shortStaffName(item.assignee_name) || 'назначен'}</span>
}

// Полоса показателей: сколько заявок в ключевых статусах. Клик — фильтр очереди по статусу.
function QueueStats({ active, mine, onPick }: { active: string; mine: boolean; onPick: (status: string) => void }) {
  const manual = useStatusCount('MANUAL_REVIEW')
  const mineManual = useStatusCount('MANUAL_REVIEW', true)
  const info = useStatusCount('INFO_REQUESTED')
  const approved = useStatusCount('APPROVED')
  const issued = useStatusCount('ISSUED')
  const tiles = [
    { status: 'MANUAL_REVIEW', label: 'На ручной проверке', q: manual, hint: mine ? (mineManual.data != null ? `у вас в работе: ${mineManual.data}` : ' ') : 'ждут решения специалиста', accent: true },
    { status: 'INFO_REQUESTED', label: 'Ждут документов', q: info, hint: 'от клиента' },
    { status: 'APPROVED', label: 'Одобрено', q: approved, hint: 'ждут подписи клиента' },
    { status: 'ISSUED', label: 'Выдано', q: issued, hint: 'деньги у клиента' },
  ]
  return <div className={styles.stats}>
    {tiles.map(t => <button
      key={t.status}
      type="button"
      className={[styles.stat, active === t.status ? styles.statActive : ''].filter(Boolean).join(' ')}
      aria-pressed={active === t.status}
      onClick={() => onPick(t.status)}
    >
      <span className={styles.statLabel}>{t.label}</span>
      <span className={[styles.statValue, t.accent && (t.q.data ?? 0) > 0 ? styles.statValueAccent : ''].filter(Boolean).join(' ')}>
        {t.q.data ?? (t.q.error ? '—' : '…')}
      </span>
      <span className={styles.statHint}>{t.hint}</span>
    </button>)}
  </div>
}
