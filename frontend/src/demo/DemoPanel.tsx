import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Button } from '@alfalab/core-components/button/esm'
import { IconButton } from '@alfalab/core-components/icon-button/esm'
import { Notification } from '@alfalab/core-components/notification/esm'
import { Typography } from '@alfalab/core-components/typography/esm'
import { ArrowRightMIcon } from '@alfalab/icons-glyph/ArrowRightMIcon'
import { ArrowsCwMIcon } from '@alfalab/icons-glyph/ArrowsCwMIcon'
import { CheckmarkCircleMIcon } from '@alfalab/icons-glyph/CheckmarkCircleMIcon'
import { CheckmarkCompactMIcon } from '@alfalab/icons-glyph/CheckmarkCompactMIcon'
import { CrossCompactMIcon } from '@alfalab/icons-glyph/CrossCompactMIcon'
import { ChevronForwardMIcon } from '@alfalab/icons-glyph/ChevronForwardMIcon'
import { DownloadMIcon } from '@alfalab/icons-glyph/DownloadMIcon'
import { EyeOffMIcon } from '@alfalab/icons-glyph/EyeOffMIcon'
import { ListBulletedMIcon } from '@alfalab/icons-glyph/ListBulletedMIcon'
import { RouteLineMIcon } from '@alfalab/icons-glyph/RouteLineMIcon'
import { homePath, isBank, useAuth, useSession } from '../auth'
import { bankStatusName } from '../bank/workplace/text'
import { Spinner } from '../common/Spinner'
import { statusName } from '../common/status'
import { StatusTag } from '../ui/StatusTag'
import { errorText } from '../ui/States'
import statementUrl from './assets/p3b_other_bank_1c.txt?url'
import { clearTabExceptDemo, DemoState, DemoUpdate, freshRun, useDemoStore, useHiddenFlag } from './demoStore'
import { demoLogin, findPersona, roleTitle } from './personas'
import {
  actorOf, clientActorOf, derailed, doneHintOf, Facts, findScenario, innOf, isBankActor, isKnownActor, onSpot, participantsOf, progress, registerActor,
  riskPending, riskReturned, Scenario, scenarios, screenOf, StatusNames, Step, todoOf, withClient,
} from './scenarios'
import { Sync, useScenarioTracking } from './useScenarioTracking'
import styles from './DemoPanel.module.css'

// Демо-панель для жюри: сценарии показа по шагам и вход следующим участником без экрана входа.
// Свёрнута — язычок у правого края по центру высоты (на телефоне — пилюля слева внизу);
// раскрыта — плавающая панель справа, у клиента заканчивается над кнопкой ассистента.
// Скрыть целиком — кнопка внизу панели; вернуть — Alt+Shift+D или ?demo в адресе (после скрытия об этом
// говорит уведомление с кнопкой «Вернуть»).
export function DemoPanel() {
  const { me } = useSession()
  const location = useLocation()
  const [hidden, setHidden] = useHiddenFlag({ shortcut: true })
  const [hiddenNotice, setHiddenNotice] = useState(false)
  // Стабильный обработчик: Notification кита перезапускает таймер автозакрытия, когда меняется onCloseTimeout
  const closeNotice = useCallback(() => setHiddenNotice(false), [])
  const [state, update] = useDemoStore()
  if (state.client) registerActor(state.client.login, { name: state.client.name, role: 'клиент из песочницы' })
  const clientLogin = state.client?.login
  const scenario = useMemo(() => { const base = findScenario(state.scenarioId); return base && withClient(base, clientLogin) }, [state.scenarioId, clientLogin])
  const { facts, sync } = useScenarioTracking(scenario, state, update)

  useEffect(() => {
    if (hidden && new URLSearchParams(location.search).has('demo')) setHidden(false)
  }, [hidden, location.search, setHidden])

  const done = scenario ? progress(scenario, facts) : []
  const currentIndex = done.indexOf(false)
  const current = scenario && currentIndex >= 0 ? scenario.steps[currentIndex] : null
  const handOver = !!scenario && !!current && current.actor !== me.login && !derailed(scenario, facts)

  // Участник выполнил свой шаг здесь, а следующий — за другим: один раз сами раскрываем панель
  // с кнопкой «Дальше: войти как …». Если её свернули — больше не навязываемся.
  // Шаг может смениться и назад: риск-менеджер вернул решение — дальше снова андеррайтер.
  const previous = useRef<{ index: number; actor: string | null } | null>(null)
  useEffect(() => {
    const before = previous.current
    previous.current = { index: currentIndex, actor: current?.actor ?? null }
    if (!before || hidden || state.open || currentIndex === before.index) return
    if (before.actor === me.login && (handOver || currentIndex === -1)) update({ open: true })
  }, [currentIndex, current?.actor, handOver, hidden, me.login, state.open, update])

  if (hidden) {
    // Сразу после «Скрыть панель» — как её вернуть: иначе жюри, скрыв её случайно, потеряет сценарии.
    return <Notification visible={hiddenNotice} position="bottom" autoCloseDelay={10_000} badge="neutral-information"
      title="Панель скрыта" onClose={closeNotice} onCloseTimeout={closeNotice}
      actionButton={<Button view="secondary" colors="inverted" size={32} onClick={() => { setHidden(false); closeNotice() }}>Вернуть</Button>}>
      Вернуть потом — <span className={styles.nowrap}>Alt+Shift+D</span> или <span className={styles.nowrap}>?demo</span> в конце адреса страницы.
    </Notification>
  }

  if (!state.open) {
    // Очередь за другим участником — точка на язычке зовёт открыть панель.
    // Шаг ваш — подсказка «что сделать» во всплывающей подписке язычка.
    const title = handOver && current ? `Дальше: ${actorOf(current.actor).name} — откройте панель`
      : current && scenario && current.actor === me.login && !derailed(scenario, facts) ? `Ваш шаг ${currentIndex + 1} из ${scenario.steps.length}: ${current.title}. ${todoOf(current, facts)}`
        : 'Демо-сценарий: шаги показа и быстрый вход участниками'
    return <button type="button" className={[styles.tab, handOver ? styles.tabReady : ''].filter(Boolean).join(' ')} onClick={() => update({ open: true })}
      aria-expanded={false} aria-controls="demo-panel" title={title}>
      <RouteLineMIcon className={styles.tabIcon} aria-hidden />
      <span className={styles.tabText}>Демо-сценарий</span>
      {/* как в заголовке панели: «шаг 4 из 6», пройденный сценарий — галочка */}
      {scenario && <span className={styles.tabCount} aria-label={currentIndex === -1 ? 'сценарий пройден' : `шаг ${currentIndex + 1} из ${done.length}`}>
        {currentIndex === -1 ? <CheckmarkCompactMIcon aria-hidden className={styles.tabDone} /> : `${currentIndex + 1}/${done.length}`}
      </span>}
    </button>
  }
  return <Panel scenario={scenario} facts={facts} sync={sync} done={done} state={state} update={update} withAssistant={!isBank(me.role)} onHide={() => { update({ open: false }); setHidden(true); setHiddenNotice(true) }} />
}

type PanelProps = {
  scenario: Scenario | null; facts: Facts; sync: Sync; done: boolean[]; state: DemoState; update: (u: DemoUpdate) => void
  withAssistant: boolean; onHide: () => void
}

function Panel({ scenario, facts, sync, done, state, update, withAssistant, onHide }: PanelProps) {
  const { me } = useSession()
  const auth = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [switching, setSwitching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const panel = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)

  // Esc сворачивает панель (если фокус в ней или нигде — чтобы не мешать выпадающим спискам страницы);
  // при открытии фокус — на панель, дальше Tab идёт по её кнопкам.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const focus = document.activeElement
      if (e.key === 'Escape' && (!focus || focus === document.body || panel.current?.contains(focus))) update({ open: false })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [update])
  useEffect(() => { panel.current?.focus({ preventScroll: true }) }, [])

  const currentIndex = done.indexOf(false)
  const current = scenario && currentIndex >= 0 ? scenario.steps[currentIndex] : null
  const derail = scenario ? derailed(scenario, facts) : null
  const finished = !!scenario && currentIndex === -1

  // Текущий шаг — в поле зрения панели (при открытии и когда шаг сменился).
  useLayoutEffect(() => {
    const box = body.current
    if (!box) return
    if (derail || finished) { box.scrollTop = 0; return } // сверху — объяснение, что случилось
    const step = box.querySelector<HTMLElement>('[data-current="true"]')
    if (!step) return
    const boxRect = box.getBoundingClientRect()
    const rect = step.getBoundingClientRect()
    if (rect.top < boxRect.top || rect.bottom > boxRect.bottom) box.scrollTop += rect.top - boxRect.top - 64
  }, [currentIndex, scenario?.id, derail, finished])

  // Войти участником сценария и сразу открыть его экран — без экрана входа.
  // Если там его шаг — панель сворачивается, чтобы не закрывать кнопки страницы (на 1280 она легла бы
  // на правую колонку карточки); что сделать, участник уже прочитал в панели, подсказка остаётся на язычке.
  const goAs = async (login: string, path: string, collapse: boolean) => {
    if (login === me.login) { if (collapse) update({ open: false }); navigate(path); return }
    setSwitching(login); setError(null)
    try {
      const token = await demoLogin(login)
      clearTabExceptDemo()
      if (collapse) update({ open: false })
      auth.login(token)
      navigate(path)
    } catch (e) {
      setError(errorText(e)); setSwitching(null)
    }
  }
  const scenarioInn = (id: string) => { const base = findScenario(id); return base ? innOf(base) : null }
  const pick = (id: string) => update(s => (s.runOf === id ? { scenarioId: id } : { ...freshRun(s, id, scenarioInn(id)), client: null, open: true }))
  const restart = () => update(s => ({ ...freshRun(s, s.scenarioId, s.client || !s.scenarioId ? null : scenarioInn(s.scenarioId)), open: true }))

  return <aside id="demo-panel" ref={panel} tabIndex={-1} aria-label="Демо-сценарий"
    className={[styles.panel, withAssistant ? styles.aboveAssistant : ''].filter(Boolean).join(' ')}>
    <header className={styles.head}>
      <div className={styles.headText}>
        <span className={styles.eyebrow}>{scenario ? `Демо-сценарий · ${finished ? 'пройден' : `шаг ${currentIndex + 1} из ${scenario.steps.length}`}` : 'Демо для жюри'}</span>
        <Typography.Title tag="h2" view="xsmall" font="system" weight="bold" className={styles.title}>{scenario?.title ?? 'Что показать'}</Typography.Title>
      </div>
      <IconButton icon={ChevronForwardMIcon} size={32} view="secondary" aria-label="Свернуть демо-панель" onClick={() => update({ open: false })} />
    </header>

    <div className={styles.body} ref={body}>
      <You />
      {!scenario && <ScenarioList onPick={pick} running={state.runOf} />}
      {scenario && <>
        <SandboxClient scenario={scenario} state={state} update={update} />
        {scenario.tracksApplication && <ApplicationLine facts={facts} sync={sync} />}
        {derail && <div className={styles.alert} role="alert">{derail} Нажмите «Пройти заново» — новая заявка подхватится сама.</div>}
        {finished && <div className={styles.finale} role="status"><CheckmarkCircleMIcon aria-hidden /><div><b>Сценарий пройден</b><span>{nb(scenario.finale)}</span></div></div>}
        {/* Свой список вместо Steps кита: тот делает каждый шаг role="button", а внутри шага есть свои кнопки */}
        <ol className={styles.steps} aria-label="Шаги сценария">
          {scenario.steps.map((step, i) => <StepView key={step.id} index={i} step={step} facts={facts} current={i === currentIndex} broken={i === currentIndex && !!derail}
            done={done[i]} last={i === scenario.steps.length - 1} here={step.actor === me.login} onMark={() => update(s => ({ marks: [...s.marks, step.id] }))}
            onCollapse={onSpot(step, facts, pathname) ? () => update({ open: false }) : undefined} />)}
        </ol>
        <Participants scenario={scenario} facts={facts} done={done} switching={switching} onGo={goAs} />
      </>}
    </div>

    <footer className={styles.foot}>
      {/* Ошибки — над главной кнопкой: их видно там же, куда нажали */}
      {error && <div className={styles.alert} role="alert">Не получилось войти: {error}</div>}
      {scenario?.tracksApplication && sync.error && <SyncError sync={sync} known={!!facts.snapshot} />}
      {scenario && <NextButton scenario={scenario} facts={facts} current={current} currentIndex={currentIndex} finished={finished || !!derail}
        pathname={pathname} switching={switching} onGo={goAs} onRestart={restart} />}
      <div className={styles.footLinks}>
        {scenario && <button type="button" onClick={() => update({ scenarioId: null })}><ListBulletedMIcon aria-hidden />Сценарии</button>}
        {scenario && !finished && !derail && <button type="button" onClick={restart}><ArrowsCwMIcon aria-hidden />Заново</button>}
        <button type="button" onClick={onHide} title="Вернуть панель: Alt+Shift+D или ?demo в адресе страницы"><EyeOffMIcon aria-hidden />Скрыть панель</button>
      </div>
    </footer>
  </aside>
}

// Цифры и единицы не разрываем переносом: «270 000 ₽», «5,5 млн», «48 мес.»
const nb = (text: string) => text.replace(/(\d|млн|тыс\.) (?=\d|₽|млн|тыс|мес)/g, '$1\u00a0')

// ——— Кто сейчас вошёл ———

const shortName = (fullName: string) => fullName.split(' ').slice(0, 2).join(' ')

function You() {
  const { me } = useSession()
  const known = isKnownActor(me.login)
  const actor = actorOf(me.login)
  return <div className={styles.you}>
    <Avatar login={me.login} fallback={me.full_name} />
    <span className={styles.youText}>
      <small>Сейчас вы</small>
      <b>{known ? actor.name : shortName(me.full_name)}</b>
      <span>{known ? actor.role : roleTitle[me.role] ?? me.role}</span>
    </span>
  </div>
}

function Avatar({ login, size = 36, fallback }: { login: string; size?: 28 | 36; fallback?: string }) {
  const name = isKnownActor(login) ? actorOf(login).name : fallback ?? login
  return <span className={[styles.avatar, isBankActor(login) ? styles.avatarBank : '', size === 28 ? styles.avatarSmall : ''].filter(Boolean).join(' ')} aria-hidden>
    {name[0]?.toUpperCase()}
  </span>
}

// ——— Список сценариев ———

const stepsWord = (n: number) => (n === 1 ? 'шаг' : n < 5 ? 'шага' : 'шагов')

function ScenarioList({ onPick, running }: { onPick: (id: string) => void; running: string | null }) {
  return <div className={styles.list}>
    <p className={styles.lead}>Выберите сценарий — панель подскажет, кто что делает, и пустит следующего участника без экрана входа.</p>
    {scenarios.map(s => <button key={s.id} type="button" className={[styles.scenario, s.primary ? styles.scenarioPrimary : ''].filter(Boolean).join(' ')} onClick={() => onPick(s.id)}>
      <span className={styles.scenarioTitle}>{s.title}{s.id === running ? <em className={styles.running}>продолжить</em> : s.primary && <em>главный</em>}</span>
      <span className={styles.scenarioShort}>{nb(s.short)}</span>
      <span className={styles.scenarioMeta}>
        <span className={styles.avatars}>{participantsOf(s).map(l => <Avatar key={l} login={l} size={28} />)}</span>
        {s.steps.length} {stepsWord(s.steps.length)}
        <ChevronForwardMIcon className={styles.scenarioArrow} aria-hidden />
      </span>
    </button>)}
  </div>
}

// ——— Свой клиент из песочницы вместо демо-персоны ———

function SandboxClient({ scenario, state, update }: { scenario: Scenario; state: DemoState; update: (u: DemoUpdate) => void }) {
  const { me } = useSession()
  const base = findScenario(scenario.id)
  const original = base && clientActorOf(base)
  if (!original) return null
  if (state.client) {
    return <div className={styles.note}>
      <span>Клиента играет ваш клиент из песочницы — <b>{state.client.name}</b>. Исход расчёта зависит от его данных.</span>
      <button type="button" className={styles.noteLink} onClick={() => update(s => ({ ...freshRun(s, scenario.id, innOf(base)), client: null }))}>Вернуть: {actorOf(original).name}</button>
    </div>
  }
  if (me.role !== 'CLIENT' || isKnownActor(me.login) || findPersona(me.login)) return null
  return <div className={styles.note}>
    <span>Вы вошли своим клиентом из песочницы. Можно пройти сценарий за него вместо «{actorOf(original).name}».</span>
    <Button view="secondary" size={32} onClick={() => update(s => ({ ...freshRun(s, scenario.id, me.businesses[0]?.inn ?? null), client: { login: me.login, name: shortName(me.full_name) } }))}>
      Пройти за этого клиента
    </Button>
  </div>
}

// ——— Заявка сценария ———

/** Названия статусов словами того, кто смотрит: у банка «Ручная проверка», у клиента «Проверяет специалист». */
const useStatusNames = (): StatusNames => (isBank(useSession().me.role) ? bankStatusName : statusName)

function ApplicationLine({ facts, sync }: { facts: Facts; sync: Sync }) {
  const names = useStatusNames()
  const snap = facts.snapshot
  return <div className={styles.application}>
    <span>Заявка</span>
    {!facts.appId && <b className={styles.muted}>ещё не создана</b>}
    {facts.appId && !snap && (sync.error ? <b className={styles.muted}>статус неизвестен</b> : <Spinner label="Узнаём статус…" />)}
    {facts.appId && snap && <span className={styles.appState}>
      <b className={styles.appId}>№ {facts.appId.slice(0, 8)}</b>
      <StatusTag status={snap.status} size={20}>
        {riskPending(facts) ? 'Ждёт риск-менеджера' : riskReturned(facts) ? 'Вернули андеррайтеру' : names[snap.status] ?? snap.status}
      </StatusTag>
    </span>}
  </div>
}

/** Статус заявки не обновился — над главной кнопкой: от статуса зависит, кого она позовёт. */
function SyncError({ sync, known }: { sync: Sync; known: boolean }) {
  return <div className={styles.syncError} role="status">
    <span>{known ? 'Статус заявки не обновился — шаги по последнему известному.' : 'Не удалось узнать статус заявки.'} Повторим сами.</span>
    <Button view="text" size={32} loading={sync.retrying} onClick={sync.refetch} className={styles.syncRetry}>Обновить</Button>
  </div>
}

// ——— Шаг ———

type StepViewProps = {
  index: number; step: Step; facts: Facts; current: boolean; broken: boolean; done: boolean; last: boolean; here: boolean
  onMark: () => void; onCollapse?: () => void
}

function StepView({ index, step, facts, current, broken, done, last, here, onMark, onCollapse }: StepViewProps) {
  const { me } = useSession()
  const names = useStatusNames()
  const actor = actorOf(step.actor)
  const open = current && !broken
  const waiting = open ? step.waiting?.(facts) ?? null : null
  const mark = broken ? <CrossCompactMIcon aria-hidden /> : done ? <CheckmarkCompactMIcon aria-hidden /> : index + 1
  const state = broken ? 'шаг сорвался' : done ? 'выполнен' : current ? 'текущий шаг' : 'впереди'
  return <li data-current={current} aria-current={current ? 'step' : undefined}
    className={[styles.step, current ? styles.stepCurrent : '', done ? styles.stepDone : '', broken ? styles.stepBroken : '', last ? styles.stepLast : ''].filter(Boolean).join(' ')}>
    <span className={styles.stepMark} aria-hidden>{mark}</span>
    <span className={styles.srOnly}>Шаг {index + 1}, {state}: </span>
    <span className={styles.stepTitle}>{step.title}</span>
    <span className={styles.stepActor}>{actor.name} · {actor.role}{here && !done && <em>это вы</em>}</span>
    {open && <div className={styles.todo}>
      <span className={styles.where}>{here ? 'Здесь' : 'Где'}: {step.where}</span>
      <p>{nb(todoOf(step, facts))}</p>
      {step.bankNote && isBank(me.role) && <p className={styles.bankNote}>{nb(step.bankNote)}</p>}
      <span className={styles.doneHint}><CheckmarkCircleMIcon aria-hidden />Готово, когда {nb(doneHintOf(step, names))}</span>
      {waiting && <span className={styles.waiting}><Spinner label={waiting} /></span>}
      {step.extra === 'statement' && <Button view="secondary" size={32} href={statementUrl} download="p3b_other_bank_1c.txt" leftAddons={<DownloadMIcon />} className={styles.inlineButton}>
        Выписка 1С для демо
      </Button>}
      {step.manual && here && <Button view="transparent" size={32} onClick={onMark} className={styles.inlineButton}>Отметить шаг выполненным</Button>}
      {here && onCollapse && <Button view="secondary" size={32} onClick={onCollapse} className={styles.inlineButton}>Понятно — свернуть панель</Button>}
    </div>}
  </li>
}

// ——— Главная кнопка: следующий участник или экран шага ———

type GoAs = (login: string, path: string, collapse: boolean) => void

type NextProps = {
  scenario: Scenario; facts: Facts; current: Step | null; currentIndex: number; finished: boolean; pathname: string
  switching: string | null; onGo: GoAs; onRestart: () => void
}

function NextButton({ scenario, facts, current, currentIndex, finished, pathname, switching, onGo, onRestart }: NextProps) {
  const { me } = useSession()
  if (finished || !current) {
    return <Button view="secondary" size={48} block leftAddons={<ArrowsCwMIcon />} onClick={onRestart}>Пройти заново</Button>
  }
  const path = current.path(facts)
  // Длинные подписи не выталкивают стрелку: текст кнопки сжимается и обрезается многоточием
  const nextProps = { view: 'primary', size: 56, block: true, textResizing: 'fill', rightAddons: <ArrowRightMIcon />, className: styles.next, labelClassName: styles.nextLabel } as const
  if (current.actor !== me.login) {
    const actor = actorOf(current.actor)
    return <Button {...nextProps} loading={switching === current.actor} disabled={!!switching} onClick={() => onGo(current.actor, path, true)}
      title={`Войти как ${actor.name} (${actor.role}) и открыть экран «${screenOf(path)}»`}>
      <span className={styles.nextText}><small>{currentIndex === 0 ? 'Начать' : 'Дальше'} · {actor.role}</small><b>Войти как {actor.name}</b></span>
    </Button>
  }
  if (!onSpot(current, facts, pathname)) {
    return <Button {...nextProps} onClick={() => onGo(me.login, path, true)}>
      <span className={styles.nextText}><small>Ваш шаг · откройте экран</small><b>{screenOf(path)}</b></span>
    </Button>
  }
  // Шаг делается на этом экране — следующий участник доступен заранее, но не главным действием.
  const following = scenario.steps.slice(currentIndex + 1).find(s => s.actor !== me.login)
  if (!following) {
    // Ручной шаг без «посещения страницы» панель сама не отметит — у него кнопка «Отметить шаг выполненным»
    return <p className={styles.nextNote}>{current.manual && !current.visit
      ? 'Сделайте шаг на этом экране и нажмите в нём «Отметить шаг выполненным».'
      : 'Сделайте шаг на этом экране — панель отметит его сама.'}</p>
  }
  return <div className={styles.nextLater}>
    <span>Сделайте шаг на этом экране, потом</span>
    <Button view="secondary" size={40} block loading={switching === following.actor} disabled={!!switching} rightAddons={<ArrowRightMIcon />}
      onClick={() => onGo(following.actor, following.path(facts), false)}>
      Войти как {actorOf(following.actor).name}
    </Button>
  </div>
}

// ——— Быстрый вход любым участником сценария ———

type ParticipantsProps = { scenario: Scenario; facts: Facts; done: boolean[]; switching: string | null; onGo: GoAs }

function Participants({ scenario, facts, done, switching, onGo }: ParticipantsProps) {
  const { me } = useSession()
  // Участник попадает на свой ближайший невыполненный шаг, а если шагов не осталось — на свою стартовую страницу.
  const stepOf = (login: string) => scenario.steps.find((s, i) => s.actor === login && !done[i])
  const pathFor = (login: string) => stepOf(login)?.path(facts) ?? homePath(findPersona(login)?.role ?? 'CLIENT')
  // Панель сворачиваем, только если участник идёт делать текущий шаг; иначе ему нужно видеть, чего ждём
  const current = scenario.steps[done.indexOf(false)]
  return <div className={styles.people}>
    <span className={styles.peopleTitle}>Участники — войти как…</span>
    {participantsOf(scenario).map(login => {
      const actor = actorOf(login)
      return <div key={login} className={styles.person}>
        <Avatar login={login} size={28} />
        <span className={styles.personText}><b>{actor.name}</b><span>{actor.role}</span></span>
        {login === me.login
          ? <span className={styles.hereTag}>вы здесь</span>
          : <Button view="secondary" size={32} loading={switching === login} disabled={!!switching} onClick={() => onGo(login, pathFor(login), !!current && stepOf(login) === current)}>Войти</Button>}
      </div>
    })}
  </div>
}
