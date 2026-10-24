import { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button } from '@alfalab/core-components/button/esm'
import { Input } from '@alfalab/core-components/input/esm'
import { useMatchMedia } from '@alfalab/core-components/mq/esm'
import { Pagination } from '@alfalab/core-components/pagination/esm'
import { Select } from '@alfalab/core-components/select/esm'
import { Table } from '@alfalab/core-components/table/esm'
import { ChevronDownSIcon } from '@alfalab/icons-glyph/ChevronDownSIcon'
import { ClockLineMIcon } from '@alfalab/icons-glyph/ClockLineMIcon'
import { MagnifierSIcon } from '@alfalab/icons-glyph/MagnifierSIcon'
import { RobotMIcon } from '@alfalab/icons-glyph/RobotMIcon'
import { request } from '../api'
import { useSession } from '../auth'
import { Bell } from '../common/Bell'
import { Card, EmptyState, ErrorState, LoadingState, PageHeader, Spinner, Stack } from '../ui'
import {
  actionGroups, actionTitle, actionTone, actor, AuditItem, AuditPageData, detailRows, entityRef, entityTitle, peopleOf, shortId, summary,
} from './audit/auditMeta'
import styles from './AuditPage.module.css'

const ALL = 'ALL'
const PAGE_SIZES = [25, 50, 100]
const DEFAULT_SIZE = 25
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const dayYearFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
const fullFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** «14:32» + «сегодня» / «вчера» / «22 окт.» */
function when(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { time: '—', day: '', full: iso }
  const today = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000)
  const day = days === 0 ? 'сегодня' : days === 1 ? 'вчера' : d.getFullYear() === today.getFullYear() ? dayFmt.format(d) : dayYearFmt.format(d)
  return { time: timeFmt.format(d), day, full: fullFmt.format(d) }
}

const plural = (n: number, forms: [string, string, string]) => {
  const n10 = n % 10, n100 = n % 100
  return forms[n10 === 1 && n100 !== 11 ? 0 : n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20) ? 1 : 2]
}

// Журнал аудита: кто, что и когда сделал (решения, назначения, правила, SMS-заглушка, чат).
// Фильтр по типу действия и по номеру объекта — на бэке (action, entity_id), постранично.
export function AuditPage({ token }: { token: string }) {
  const { me } = useSession()
  const navigate = useNavigate()
  // Карточку заявки в банке открывают андеррайтер и риск-менеджер; админу правил она недоступна
  const canOpenApplication = me.role === 'UNDERWRITER' || me.role === 'RISK_MANAGER'
  const [mobile] = useMatchMedia('(max-width: 700px)')

  // Фильтр, номер объекта, страница и размер страницы живут в адресе (?action=&q=&page=&size=):
  // «Назад» из карточки заявки и обновление страницы возвращают журнал в то же состояние.
  const [url, setUrl] = useSearchParams()
  const action = url.get('action') || ALL
  const entity = (url.get('q') ?? '').trim()
  const page = Math.max(1, Number.parseInt(url.get('page') ?? '', 10) || 1)
  const sizeParam = Number(url.get('size'))
  const perPage = PAGE_SIZES.includes(sizeParam) ? sizeParam : DEFAULT_SIZE

  /** Поменять параметры адреса; значения по умолчанию из адреса убираем */
  const update = (patch: { action?: string; q?: string; page?: number; size?: number }, replace = false) => {
    setUrl(prev => {
      const next = new URLSearchParams(prev)
      const put = (key: string, value: string | number | undefined, fallback: string | number) => {
        if (value === undefined) return
        if (value === fallback || value === '') next.delete(key); else next.set(key, String(value))
      }
      put('action', patch.action, ALL)
      put('q', patch.q, '')
      put('page', patch.page, 1)
      put('size', patch.size, DEFAULT_SIZE)
      return next
    }, { replace })
  }

  const [search, setSearch] = useState(entity)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [openRefs, setOpenRefs] = useState<Set<string>>(new Set())
  const topRef = useRef<HTMLDivElement>(null)

  // Адрес → поле поиска («Назад», «Сбросить», «Все события объекта»)
  useEffect(() => { setSearch(s => (s.trim() === entity ? s : entity)) }, [entity])
  // Поле поиска → адрес, с небольшой задержкой, чтобы не дёргать бэк на каждую букву
  useEffect(() => {
    const value = search.trim()
    if (value === entity) return
    const t = setTimeout(() => update({ q: value, page: 1 }, true), 400)
    return () => clearTimeout(t)
  }, [search, entity])

  const params = new URLSearchParams({ page: String(page), page_size: String(perPage) })
  if (action !== ALL) params.set('action', action)
  if (entity) params.set('entity_id', entity)
  const q = useQuery({
    queryKey: ['bank-audit', params.toString()],
    queryFn: () => request<AuditPageData>(`/api/v1/bank/audit?${params}`, {}, token),
    placeholderData: keepPreviousData,
    refetchInterval: 15000,
  })

  const total = q.data?.total ?? 0
  const pagesCount = Math.max(1, Math.ceil(total / perPage))
  const filtered = action !== ALL || !!entity

  // Страница из адреса больше, чем есть (журнал короче или открыли старую ссылку) — на последнюю
  useEffect(() => {
    if (q.data && total > 0 && page > pagesCount) update({ page: pagesCount }, true)
  }, [q.data, total, page, pagesCount])

  const flip = (setter: typeof setOpen) => (id: string) => setter(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggle = flip(setOpen)
  const toggleRefs = flip(setOpenRefs)
  const toTop = () => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const goPage = (p: number) => { update({ page: p }); toTop() }
  const resetFilters = () => { setSearch(''); update({ action: ALL, q: '', page: 1 }) }
  const showObject = (item: AuditItem) => {
    setSearch(item.entity_id)
    update({ q: item.entity_id, action: ALL, page: 1 })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const appLink = (item: AuditItem) => (item.entity === 'application' && canOpenApplication ? `/bank/applications/${item.entity_id}` : null)

  const objectCell = (item: AuditItem) => {
    const link = appLink(item)
    const text = <><span className={styles.objectType}>{entityTitle(item)}</span><span className={styles.objectRef}>{entityRef(item)}</span></>
    return link
      ? <Link to={link} className={styles.objectLink} onClick={e => e.stopPropagation()} title="Открыть карточку заявки">{text}</Link>
      : <span className={styles.object} title={item.entity_id}>{text}</span>
  }

  const mobileWho = (item: AuditItem) => {
    const a = actor(item)
    return a.system ? a.name : `${a.name}, ${a.role.toLowerCase()}`
  }

  const whoCell = (item: AuditItem) => {
    const a = actor(item)
    return <div className={styles.who}>
      <span className={[styles.avatar, a.system ? styles.avatarSystem : ''].join(' ')} aria-hidden>
        {a.system ? <RobotMIcon /> : a.name.trim().charAt(0)}
      </span>
      <span className={styles.whoText}>
        <span className={styles.whoName}>{a.name}</span>
        <span className={styles.whoRole}>{a.role}</span>
      </span>
    </div>
  }

  const actionCell = (item: AuditItem) => {
    const s = summary(item, people)
    return <div className={styles.action}>
      <span className={styles.actionTitle}><i className={[styles.dot, styles[`tone-${actionTone(item.action)}`]].join(' ')} aria-hidden />{actionTitle(item.action)}</span>
      {s && <span className={styles.summary}>{s}</span>}
    </div>
  }

  const details = (item: AuditItem) => {
    const rows = detailRows(item, people)
    const link = appLink(item)
    return <div className={styles.details}>
      {rows.length > 0
        ? <dl className={styles.detailList}>
          {rows.map(r => {
            const refsKey = `${item.id}:${r.key}`
            const refsOpen = openRefs.has(refsKey)
            return <div key={r.key} className={[r.changed ? styles.detailChanged : '', r.wide ? styles.detailWide : ''].filter(Boolean).join(' ') || undefined}>
              <dt>{r.label}</dt>
              <dd>
                {r.before !== undefined && <><s>{r.before}</s><span className={styles.arrow}> → </span></>}<b>{r.value}</b>
                {r.refs && <button type="button" className={styles.refsToggle} aria-expanded={refsOpen} onClick={() => toggleRefs(refsKey)}>
                  {refsOpen ? 'Скрыть номера' : 'Показать номера'}
                </button>}
              </dd>
              {r.refs && refsOpen && <ul className={styles.refs}>
                {r.refs.map(id => <li key={id}>{canOpenApplication
                  ? <Link to={`/bank/applications/${id}`} className={styles.refLink} title="Открыть карточку заявки">{shortId(id)}</Link>
                  : <span className={styles.ref} title={id}>{shortId(id)}</span>}</li>)}
              </ul>}
            </div>
          })}
        </dl>
        : <p className={styles.noDetails}>Дополнительных данных нет.</p>}
      <div className={styles.detailFoot}>
        <span className={styles.detailMeta}>{when(item.at).full} · номер объекта <code>{item.entity_id}</code></span>
        <div className={styles.detailButtons}>
          {!entity && <Button view="secondary" size={32} onClick={() => showObject(item)}>Все события объекта</Button>}
          {link && <Button view="secondary" size={32} onClick={() => navigate(link)}>Открыть заявку</Button>}
        </div>
      </div>
    </div>
  }

  const items = q.data?.items ?? []
  // Имена сотрудников по номерам — для «Ответственный: …» в назначениях (бэк отдаёт только номер)
  const people = useMemo(() => peopleOf(items), [items])

  return <Stack>
    <PageHeader
      eyebrow="Кабинет банка"
      title="Журнал аудита"
      subtitle="Кто и когда что сделал: заявки, решения, правила, уведомления. Новые события сверху, нажмите на строку — откроются подробности."
      actions={<Bell />}
    />

    <Card padding="none" className={styles.card}>
      <div className={styles.filters} ref={topRef}>
        <Select
          className={styles.filterAction}
          size={48}
          block
          label="Действие"
          options={[{ key: ALL, content: 'Все действия' }, ...actionGroups]}
          selected={action}
          onChange={({ selected }) => update({ action: selected?.key ?? ALL, page: 1 })}
          optionsListWidth="field"
          optionsSize={40}
          visibleOptions={9}
        />
        <Input
          className={styles.filterSearch}
          size={48}
          block
          label="Номер объекта"
          value={search}
          onChange={(_, { value }) => setSearch(value)}
          clear
          onClear={() => setSearch('')}
          leftAddons={<MagnifierSIcon className={styles.searchIcon} />}
          hint="Полный номер — его видно в подробностях события"
        />
        {filtered && <Button view="transparent" size={48} onClick={resetFilters} className={styles.resetButton}>Сбросить</Button>}
      </div>

      <div className={styles.meta}>
        {q.data && <span>{filtered ? 'Найдено' : 'Всего'} {new Intl.NumberFormat('ru-RU').format(total)} {plural(total, ['событие', 'события', 'событий'])}</span>}
        {q.isFetching && q.data && <Spinner size={16} label="Обновляем" />}
      </div>

      {q.isPending && <div className={styles.pad}><LoadingState view="skeleton" rows={8} label="Загружаем журнал…" /></div>}
      {q.error && !q.data && <div className={styles.pad}><ErrorState error={q.error} title="Не получилось загрузить журнал" onRetry={() => q.refetch()} /></div>}
      {q.data && items.length === 0 && <EmptyState
        compact
        icon={<ClockLineMIcon />}
        title={filtered ? 'Событий не нашли' : 'Журнал пока пуст'}
        text={entity ? 'Нужен полный номер объекта — скопируйте его из подробностей события или нажмите «Все события объекта».' : filtered ? 'Попробуйте выбрать другое действие.' : 'События появятся, когда клиенты и сотрудники начнут работать.'}
        action={filtered ? <Button view="secondary" size={40} onClick={resetFilters}>Сбросить фильтры</Button> : undefined}
      />}

      {q.data && items.length > 0 && !mobile && <Table
        wrapper={false}
        className={styles.table}
        pagination={<Table.Pagination
          perPage={perPage}
          currentPageIndex={page - 1}
          pagesCount={pagesCount}
          possiblePerPage={PAGE_SIZES}
          onPageChange={i => goPage(i + 1)}
          onPerPageChange={n => update({ size: n, page: 1 })}
          className={styles.pagination}
        />}
      >
        <Table.THead>
          <Table.THeadCell width={118}>Когда</Table.THeadCell>
          <Table.THeadCell width={228}>Кто</Table.THeadCell>
          <Table.THeadCell>Действие</Table.THeadCell>
          <Table.THeadCell width={170}>Объект</Table.THeadCell>
          <Table.THeadCell width={52}><span className={styles.srOnly}>Подробнее</span></Table.THeadCell>
        </Table.THead>
        <Table.TBody>
          {items.map(item => {
            const w = when(item.at)
            const isOpen = open.has(item.id)
            return <Table.TExpandableRow
              key={item.id}
              expanded={isOpen}
              onToggle={() => toggle(item.id)}
              className={[styles.row, isOpen ? styles.rowOpen : ''].join(' ')}
              renderContent={expanded => (expanded ? <Table.TCell colSpan={5} className={styles.expandCell}>{details(item)}</Table.TCell> : null)}
            >
              <Table.TCell className={styles.cell}><div className={styles.when} title={w.full}><b>{w.time}</b><span>{w.day}</span></div></Table.TCell>
              <Table.TCell className={styles.cell}>{whoCell(item)}</Table.TCell>
              <Table.TCell className={styles.cell}>{actionCell(item)}</Table.TCell>
              <Table.TCell className={styles.cell}>{objectCell(item)}</Table.TCell>
              <Table.TCell className={[styles.cell, styles.chevronCell].join(' ')}>
                <button type="button" className={styles.chevron} aria-expanded={isOpen} aria-label={isOpen ? 'Свернуть подробности' : 'Показать подробности'}>
                  <ChevronDownSIcon className={isOpen ? styles.chevronOpen : undefined} />
                </button>
              </Table.TCell>
            </Table.TExpandableRow>
          })}
        </Table.TBody>
      </Table>}

      {q.data && items.length > 0 && mobile && <>
        <ul className={styles.cards}>
          {items.map(item => {
            const w = when(item.at)
            const isOpen = open.has(item.id)
            return <li key={item.id} className={styles.mCard}>
              <button type="button" className={styles.mHead} aria-expanded={isOpen} onClick={() => toggle(item.id)}>
                <span className={styles.mTop}>
                  {actionCell(item)}
                  <ChevronDownSIcon className={[styles.mChevron, isOpen ? styles.chevronOpen : ''].join(' ')} aria-hidden />
                </span>
                <span className={styles.mMeta}>{w.day}, {w.time} · {mobileWho(item)}</span>
              </button>
              <div className={styles.mObject}>{objectCell(item)}</div>
              {isOpen && details(item)}
            </li>
          })}
        </ul>
        {pagesCount > 1 && <div className={styles.mPagination}>
          <Pagination currentPageIndex={page - 1} pagesCount={pagesCount} onPageChange={i => goPage(i + 1)} sidePadding={0} activePadding={1} />
        </div>}
      </>}
    </Card>
  </Stack>
}

/** Маршрут /bank/audit. */
export function AuditRoute() {
  const { token } = useSession()
  return <AuditPage token={token} />
}
