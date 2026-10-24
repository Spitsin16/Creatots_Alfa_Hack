import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { Button } from '@alfalab/core-components/button/esm'
import { IconButton } from '@alfalab/core-components/icon-button/esm'
import { Input } from '@alfalab/core-components/input/esm'
import { Plate } from '@alfalab/core-components/plate/esm'
import { Status } from '@alfalab/core-components/status/esm'
import { Tab, Tabs } from '@alfalab/core-components/tabs/esm'
import { ArrowLeftCurvedSIcon } from '@alfalab/icons-glyph/ArrowLeftCurvedSIcon'
import { CheckmarkCircleMIcon } from '@alfalab/icons-glyph/CheckmarkCircleMIcon'
import { ChevronDownSIcon } from '@alfalab/icons-glyph/ChevronDownSIcon'
import { SlidersMIcon } from '@alfalab/icons-glyph/SlidersMIcon'
import { request } from '../api'
import { useSession } from '../auth'
import { Bell } from '../common/Bell'
import { Card, EmptyState, ErrorState, Grid, LoadingState, PageHeader, Stack } from '../ui'
import { ConfirmModal } from './rules/ConfirmModal'
import { loadDraft, SimResult, SimState, storeDraft } from './rules/draftStore'
import { diff, formatValue, meta, OFFER_VALID_DAYS, Path, pathKey, plural, Rules, SectionId, sectionOf, setAt, validate } from './rules/meta'
import { RulesFormContext } from './rules/RuleField'
import { ClassesSection, CollateralSection, FactorsSection, LimitsSection, RatesSection, RoutingSection } from './rules/Sections'
import { isDemoPersona, rowDiff, SimulationSummary, SimulationTable } from './rules/SimulationTable'
import styles from './RulesAdmin.module.css'

type Version = { version: number; active: boolean; author_id: string | null; created_at: string }
type Listing = { active_version: number | null; active_rules: Rules | null; versions: Version[] }
type AuditEntry = { entity_id: string; actor_name: string | null; after: { comment?: string } | null; at: string }
type Confirm = { kind: 'save' } | { kind: 'activate'; version: number } | { kind: 'travel' }

const sections: { id: SectionId; title: string; render: () => ReactNode }[] = [
  { id: 'factors', title: 'Скоринг', render: () => <FactorsSection /> },
  { id: 'classes', title: 'Классы', render: () => <ClassesSection /> },
  { id: 'limits', title: 'Лимиты', render: () => <LimitsSection /> },
  { id: 'rates', title: 'Ставки', render: () => <RatesSection /> },
  { id: 'routing', title: 'Маршруты', render: () => <RoutingSection /> },
  { id: 'collateral', title: 'Залог', render: () => <CollateralSection /> },
]

const dateTime = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}

const RULES_KEY = ['rules-admin'] as const
const HISTORY_KEY = ['rules-history'] as const

// Админ правил: форма вместо YAML. Изменение = новая версия; до включения — прогон «было/стало» на тестовых клиентах.
// Включение версии и перемотка времени — только после подтверждения в модальном окне.
export function RulesAdmin({ token }: { token: string }) {
  const client = useQueryClient()
  const listing = useQuery({ queryKey: RULES_KEY, queryFn: () => request<Listing>('/api/v1/bank/rules', {}, token) })
  // Комментарии и авторы версий — из журнала аудита (необязательно: без них список версий всё равно работает)
  const history = useQuery({
    queryKey: HISTORY_KEY,
    queryFn: () => request<{ items: AuditEntry[] }>('/api/v1/bank/audit?action=RULES_VERSION_CREATED&page_size=200', {}, token),
    retry: false,
  })

  // Черновик, результат прогона и комментарий — в sessionStorage: уход на «Журнал» и обновление их не теряют
  const [restored] = useState(loadDraft)
  const [draft, setDraft] = useState<Rules | null>(restored?.draft ?? null)
  const [sim, setSim] = useState<SimState | null>(restored?.sim ?? null)
  const [comment, setComment] = useState(restored?.comment ?? '')
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [notice, setNotice] = useState<{ view: 'positive' | 'attention'; title: string; text: string } | null>(null)
  const [lastSaved, setLastSaved] = useState<number | null>(null)
  const [jump, setJump] = useState(0)
  const [showSandbox, setShowSandbox] = useState(false)
  const resultsRef = useRef<HTMLDivElement>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  const checkedRestore = useRef(false)

  // Вкладка — в адресе (?tab=classes), чтобы «Назад» и обновление открывали тот же раздел
  const [url, setUrl] = useSearchParams()
  const tabParam = url.get('tab')
  const tab: SectionId = sections.some(s => s.id === tabParam) ? tabParam as SectionId : 'factors'
  const setTab = (id: SectionId) => setUrl(prev => {
    const next = new URLSearchParams(prev)
    if (id === 'factors') next.delete('tab'); else next.set('tab', id)
    return next
  }, { replace: true })

  const base = listing.data?.active_rules ?? null
  // Черновик из хранилища, посчитанный от другой версии, не показываем ни одного кадра (эффект ниже его сбросит)
  const staleRestore = !!listing.data && !!restored?.draft && draft === restored.draft && restored.version !== listing.data.active_version
  const form = (staleRestore ? null : draft) ?? base
  const changes = useMemo(() => (base && form ? diff(base, form) : []), [base, form])
  const errors = useMemo(() => (form ? validate(form, changes) : {}), [form, changes])
  const errorCount = Object.keys(errors).length
  const formKey = useMemo(() => (form ? JSON.stringify(form) : ''), [form])
  const fresh = !!sim && sim.key === formKey && changes.length > 0
  const versions = listing.data?.versions ?? []
  const activeVersion = listing.data?.active_version ?? null
  const nextVersion = versions.reduce((m, v) => Math.max(m, v.version), 0) + 1
  const countBy = changes.reduce<Partial<Record<SectionId, number>>>((acc, ch) => {
    const s = sectionOf(ch.path)
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {})

  // Сохранённый черновик считался от другой версии (её сменили, пока страница была закрыта) — сбрасываем
  useEffect(() => {
    if (!listing.data || checkedRestore.current) return
    checkedRestore.current = true
    if (restored && (restored.draft || restored.comment) && restored.version !== listing.data.active_version) {
      setDraft(null); setSim(null); setComment('')
      setNotice({ view: 'attention', title: 'Черновик сброшен', text: `Пока вас не было, включили версию ${listing.data.active_version}. Изменения нужно внести заново — уже от неё.` })
    }
  }, [listing.data, restored])

  useEffect(() => {
    if (!listing.data || !checkedRestore.current) return
    storeDraft(changes.length === 0 && !comment ? null : { version: activeVersion, draft, sim, comment })
  }, [listing.data, activeVersion, draft, sim, comment, changes.length])

  // После включения версии или перемотки — к сообщению вверху страницы: кнопки были далеко внизу
  useEffect(() => {
    if (!jump) return
    window.scrollTo({ top: 0, behavior: 'smooth' })
    noticeRef.current?.focus({ preventScroll: true })
  }, [jump])

  const set = (path: Path, value: unknown) => setDraft(d => setAt(d ?? base, path, value))
  const reset = () => { setDraft(null); setSim(null) }
  const showNotice = (n: NonNullable<typeof notice>) => { setNotice(n); setJump(j => j + 1) }

  // После включения версии форма начинается заново — от новой действующей версии
  const afterSwitch = async () => {
    await client.invalidateQueries({ queryKey: RULES_KEY })
    void client.invalidateQueries({ queryKey: HISTORY_KEY })
    setDraft(null); setSim(null); setConfirm(null)
  }

  const simulate = useMutation({
    mutationFn: (rules: Rules) => request<SimResult>('/api/v1/bank/rules/simulate', { method: 'POST', body: JSON.stringify({ rules }) }, token),
    onSuccess: (result, rules) => {
      setSim({ key: JSON.stringify(rules), result })
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    },
  })
  const save = useMutation({
    mutationFn: () => request<{ version: number }>('/api/v1/bank/rules', { method: 'POST', body: JSON.stringify({ rules: form, comment: comment.trim(), activate: true }) }, token),
    onSuccess: async r => {
      await afterSwitch(); setComment(''); setLastSaved(r.version)
      showNotice({ view: 'positive', title: `Версия ${r.version} сохранена и включена`, text: 'Новые расчёты и заявки идут по ней. Уже принятые решения хранят свою версию правил.' })
    },
  })
  const activate = useMutation({
    mutationFn: (v: number) => request(`/api/v1/bank/rules/${v}/activate`, { method: 'POST' }, token),
    onSuccess: async (_, v) => {
      await afterSwitch(); setLastSaved(null)
      showNotice({ view: 'positive', title: `Включена версия ${v}`, text: 'Новые расчёты идут по ней. Черновик изменений сброшен.' })
    },
  })
  const travel = useMutation({
    mutationFn: () => request<{ expired: string[] }>('/api/v1/bank/admin/time-travel', { method: 'POST', body: JSON.stringify({ days: 31 }) }, token),
    onSuccess: r => {
      setConfirm(null)
      showNotice({
        view: 'positive',
        title: 'Время перемотано на 31 день',
        text: r.expired.length ? `Истёк срок одобрения у ${r.expired.length} ${plural(r.expired.length, ['заявки', 'заявок', 'заявок'])} — статус «Срок предложения истёк».` : 'Просроченных одобрений нет.',
      })
    },
  })
  const resetMutations = () => { save.reset(); activate.reset(); travel.reset() }
  const openConfirm = (c: Confirm) => { resetMutations(); setConfirm(c) }
  const closeConfirm = () => { setConfirm(null); resetMutations() }
  // После успеха фокус не возвращаем на кнопку внизу — иначе страница уедет обратно от сообщения
  // (пока идёт onSuccess, мутация ещё в статусе pending — поэтому учитываем и его)
  const succeeded = [save, activate, travel].some(m => m.isPending || m.isSuccess)

  const header = <PageHeader
    eyebrow="Кабинет банка"
    title="Правила решения"
    subtitle="Скоринг, классы, лимиты и ставки. Любое изменение сохраняется новой версией: сначала проверьте её на тестовых клиентах, потом включите."
    actions={<>
      {activeVersion !== null && <Status color="green" view="muted-alt" size={32} shape="rounded" uppercase={false}>Действует версия {activeVersion}</Status>}
      <Bell />
    </>}
  />

  if (listing.isPending) return <Stack>{header}<LoadingState view="skeleton" rows={6} label="Загружаем правила…" /></Stack>
  if (listing.error) return <Stack>{header}<ErrorState error={listing.error} title="Не получилось загрузить правила" onRetry={() => listing.refetch()} /></Stack>
  if (!base || !form) return <Stack>{header}<EmptyState icon={<SlidersMIcon />} title="Нет действующей версии правил" text="Правила загружаются из rules.yaml при запуске стенда. Перезапустите бэкенд или обратитесь к разработчикам." /></Stack>

  const demoRows = sim?.result.personas.filter(r => isDemoPersona(r.persona)) ?? []
  const otherRows = sim?.result.personas.filter(r => !isDemoPersona(r.persona)) ?? []
  const comments = new Map((history.data?.items ?? []).map(i => [i.entity_id, i]))
  const canSave = fresh && errorCount === 0 && comment.trim().length >= 3

  return <RulesFormContext.Provider value={{ draft: form, base, errors, set }}>
    <Stack>
      {header}

      {notice && <div ref={noticeRef} tabIndex={-1} className={styles.notice} role="status">
        <Plate view={notice.view} title={notice.title} hasCloser onClose={() => setNotice(null)} leftAddons={notice.view === 'positive' ? <CheckmarkCircleMIcon /> : undefined}>{notice.text}</Plate>
      </div>}

      <Grid columns="minmax(0, 1fr) 304px" align="start">
        <Card padding="none" className={styles.formCard}>
          <Tabs
            view="primary"
            size="s"
            scrollable
            selectedId={tab}
            onChange={(_, { selectedId }) => setTab(selectedId as SectionId)}
            className={styles.tabs}
            containerClassName={styles.tabList}
          >
            {sections.map(s => <Tab
              key={s.id}
              id={s.id}
              // Счётчик изменений — надстрочный значок, ширины вкладки не занимает: все шесть вкладок помещаются и с ним
              title={<span className={styles.tabTitle}>
                {s.title}
                {countBy[s.id] ? <>
                  <span className={styles.tabCount} aria-hidden>{countBy[s.id]}</span>
                  <span className={styles.srOnly}>, изменено: {countBy[s.id]}</span>
                </> : null}
              </span>}
            >
              <div className={styles.formBody}>{s.render()}</div>
            </Tab>)}
          </Tabs>
        </Card>

        <aside className={styles.side}>
          <Card title={`Новая версия ${nextVersion}`} subtitle="Ни на что не влияет, пока вы её не включите, и не пропадёт, если уйти со страницы." padding="m">
            {changes.length === 0
              ? <p className={styles.muted}>Изменений пока нет. Поменяйте значения в разделах формы — здесь появится список, а изменённые поля подсветятся.</p>
              : <>
                <div className={styles.changesHead}>Изменено {changes.length} {plural(changes.length, ['значение', 'значения', 'значений'])}</div>
                <ul className={styles.changes}>
                  {changes.map(ch => {
                    const m = meta(ch.path, base)
                    const bad = errors[pathKey(ch.path)]
                    return <li key={pathKey(ch.path)} className={bad ? styles.changeBad : undefined}>
                      <button type="button" className={styles.changeLabel} onClick={() => setTab(sectionOf(ch.path))}>{m.label}</button>
                      <span className={styles.changeValues}>
                        <s>{formatValue(m.kind, ch.before)}</s> → <b>{formatValue(m.kind, ch.after)}</b>
                      </span>
                      <IconButton icon={ArrowLeftCurvedSIcon} size={24} view="secondary" className={styles.undo} aria-label={`Вернуть: ${m.label}`} title="Вернуть как было" onClick={() => set(ch.path, ch.before)} />
                    </li>
                  })}
                </ul>
              </>}
            {errorCount > 0 && <div className={styles.errorNote} role="alert">Исправьте подсвеченные поля ({errorCount}) — с ними прогон не запустится.</div>}
            {simulate.error && <div className={styles.errorNote} role="alert">{(simulate.error as Error).message}</div>}
            <div className={styles.sideActions}>
              <Button view={fresh ? 'secondary' : 'accent'} size={48} block loading={simulate.isPending} disabled={!changes.length || errorCount > 0} onClick={() => simulate.mutate(form)}>
                Проверить на клиентах
              </Button>
              <Button view="transparent" size={40} block disabled={!changes.length} onClick={reset}>Сбросить изменения</Button>
            </div>
          </Card>

          <Card title="Версии" padding="m">
            {versions.length === 0 ? <p className={styles.muted}>Версий пока нет.</p> : <ul className={styles.versions}>
              {versions.map(v => {
                const h = comments.get(String(v.version))
                return <li key={v.version} className={v.active ? styles.versionActive : undefined}>
                  <div className={styles.versionHead}>
                    <b>Версия {v.version}</b>
                    {v.active
                      ? <Status color="green" view="muted-alt" size={20} shape="rounded" uppercase={false}>действует</Status>
                      : <Button view="secondary" size={32} onClick={() => openConfirm({ kind: 'activate', version: v.version })}>Включить</Button>}
                  </div>
                  <div className={styles.versionMeta}>{dateTime(v.created_at)}{h?.actor_name ? ` · ${h.actor_name.replace(/^Админ правил\s+/, '')}` : !v.author_id ? ' · из файла rules.yaml' : ''}</div>
                  {h?.after?.comment && <div className={styles.versionComment}>«{h.after.comment}»</div>}
                </li>
              })}
            </ul>}
          </Card>

          <Card title="Перемотка времени" padding="m">
            <p className={styles.muted}>Для демо: одобрение действует {OFFER_VALID_DAYS} дней. Перемотка покажет, что станет с одобренными, но не подписанными заявками.</p>
            <Button view="secondary" size={40} block onClick={() => openConfirm({ kind: 'travel' })}>Перемотать на 31 день</Button>
          </Card>
        </aside>
      </Grid>

      <div ref={resultsRef} className={styles.results}>
        <Card
          title="Проверка на тестовых клиентах"
          subtitle={sim ? `Те же клиенты и данные. В каждой ячейке: было по действующей версии ${sim.result.base_version} → стало по черновику. Изменения подсвечены.` : 'Покажет, как изменятся решения по тестовым клиентам, до включения новой версии.'}
          actions={sim && !fresh ? <Status color="orange" view="muted-alt" size={24} shape="rounded" uppercase={false}>нужно проверить заново</Status> : undefined}
        >
          {!sim && (lastSaved !== null && changes.length === 0
            ? <EmptyState compact icon={<CheckmarkCircleMIcon />} title={`Версия ${lastSaved} включена`} text="Новые расчёты идут по ней. Для следующей версии измените значения в форме и снова запустите проверку." />
            : <EmptyState compact icon={<SlidersMIcon />} title="Прогона ещё не было" text="Измените значения в форме и нажмите «Проверить на клиентах» — здесь появится таблица «было → стало» по тестовым клиентам." />)}
          {sim && <Stack gap={20}>
            {!fresh && <Plate view="attention" title="Значения изменились после проверки">Запустите проверку ещё раз — сохранить можно только проверенный вариант.</Plate>}
            <div className={!fresh ? styles.stale : undefined}>
              <Stack gap={16}>
                <SimulationSummary rows={demoRows} />
                <SimulationTable rows={demoRows} />
                {otherRows.length > 0 && <div>
                  <button type="button" className={styles.more} aria-expanded={showSandbox} onClick={() => setShowSandbox(v => !v)}>
                    <ChevronDownSIcon className={showSandbox ? styles.moreIconOpen : styles.moreIcon} aria-hidden />
                    Клиенты из песочницы: {otherRows.length}, изменится у {otherRows.filter(r => r.changed).length}
                  </button>
                  {showSandbox && <div className={styles.moreBody}><SimulationTable rows={otherRows} /></div>}
                </div>}
              </Stack>
            </div>
            <div className={styles.saveRow}>
              <Input
                block
                size={48}
                label="Что меняем и почему"
                labelView="outer"
                placeholder="Например: подняли ключевую ставку вслед за ЦБ"
                value={comment}
                maxLength={500}
                onChange={(_, { value }) => setComment(value)}
                hint="Комментарий попадёт в журнал аудита и в список версий"
              />
              <Button view={fresh ? 'accent' : 'secondary'} size={48} disabled={!canSave} onClick={() => openConfirm({ kind: 'save' })} className={styles.saveButton}>
                Сохранить и включить версию {nextVersion}
              </Button>
            </div>
          </Stack>}
        </Card>
      </div>

      <ConfirmModal
        open={confirm?.kind === 'save'}
        title={`Включить версию ${nextVersion}?`}
        confirmLabel={`Включить версию ${nextVersion}`}
        loading={save.isPending}
        error={save.error ? (save.error as Error).message : undefined}
        onConfirm={() => save.mutate()}
        onClose={closeConfirm}
        restoreFocus={!succeeded}
      >
        <p>Новые правила начнут действовать сразу — для всех новых расчётов и заявок всех клиентов.</p>
        <ul>
          <li>Изменено {changes.length} {plural(changes.length, ['значение', 'значения', 'значений'])}</li>
          {sim && <li>По прогону результат изменится у {demoRows.filter(r => r.changed).length} из {demoRows.length} тестовых клиентов{demoRows.some(r => rowDiff(r).outcome) ? ', в том числе решение' : ''}</li>}
          <li>Уже принятые решения сохранят версию&nbsp;{activeVersion}</li>
        </ul>
        <p>Вернуться к прежней версии можно в списке версий.</p>
      </ConfirmModal>

      <ConfirmModal
        open={confirm?.kind === 'activate'}
        title={confirm?.kind === 'activate' ? `Включить версию ${confirm.version}?` : ''}
        confirmLabel={confirm?.kind === 'activate' ? `Включить версию ${confirm.version}` : 'Включить'}
        loading={activate.isPending}
        error={activate.error ? (activate.error as Error).message : undefined}
        onConfirm={() => confirm?.kind === 'activate' && activate.mutate(confirm.version)}
        onClose={closeConfirm}
        restoreFocus={!succeeded}
      >
        <p>Сейчас действует версия {activeVersion}. После включения все новые расчёты и заявки пойдут по версии {confirm?.kind === 'activate' ? confirm.version : ''}.</p>
        {changes.length > 0 && <p>Несохранённые изменения в черновике ({changes.length}) будут сброшены.</p>}
      </ConfirmModal>

      <ConfirmModal
        open={confirm?.kind === 'travel'}
        title="Перемотать время на 31 день?"
        confirmLabel="Перемотать"
        loading={travel.isPending}
        error={travel.error ? (travel.error as Error).message : undefined}
        onConfirm={() => travel.mutate()}
        onClose={closeConfirm}
        restoreFocus={!succeeded}
      >
        <p>Это демо-действие для всего стенда: у всех одобренных, но не подписанных заявок истечёт срок предложения.</p>
        <p>Отменить перемотку нельзя.</p>
      </ConfirmModal>
    </Stack>
  </RulesFormContext.Provider>
}

/** Маршрут /bank/rules. */
export function RulesPage() {
  const { token } = useSession()
  return <RulesAdmin token={token} />
}
