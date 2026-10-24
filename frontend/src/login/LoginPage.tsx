import { ComponentType, FormEvent, SVGProps, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@alfalab/core-components/button/esm'
import { IconButton } from '@alfalab/core-components/icon-button/esm'
import { Input } from '@alfalab/core-components/input/esm'
import { Status } from '@alfalab/core-components/status/esm'
import { Typography } from '@alfalab/core-components/typography/esm'
import { ArrowRightMIcon } from '@alfalab/icons-glyph/ArrowRightMIcon'
import { CakeMIcon } from '@alfalab/icons-glyph/CakeMIcon'
import { ChartColumnThreeAscArrowMIcon } from '@alfalab/icons-glyph/ChartColumnThreeAscArrowMIcon'
import { ContainerMIcon } from '@alfalab/icons-glyph/ContainerMIcon'
import { CrossMIcon } from '@alfalab/icons-glyph/CrossMIcon'
import { DocumentStampMIcon } from '@alfalab/icons-glyph/DocumentStampMIcon'
import { DoorOpenMIcon } from '@alfalab/icons-glyph/DoorOpenMIcon'
import { FactoryMIcon } from '@alfalab/icons-glyph/FactoryMIcon'
import { HairbrushMIcon } from '@alfalab/icons-glyph/HairbrushMIcon'
import { LightningMIcon } from '@alfalab/icons-glyph/LightningMIcon'
import { MagicWandMIcon } from '@alfalab/icons-glyph/MagicWandMIcon'
import { PfmCoffeCupMIcon } from '@alfalab/icons-glyph/PfmCoffeCupMIcon'
import { PfmTransportMIcon } from '@alfalab/icons-glyph/PfmTransportMIcon'
import { QuestionCircleMIcon } from '@alfalab/icons-glyph/QuestionCircleMIcon'
import { ScrewdriverWrenchMIcon } from '@alfalab/icons-glyph/ScrewdriverWrenchMIcon'
import { ShieldMIcon } from '@alfalab/icons-glyph/ShieldMIcon'
import { SlidersMIcon } from '@alfalab/icons-glyph/SlidersMIcon'
import { UserTieMIcon } from '@alfalab/icons-glyph/UserTieMIcon'
import { Spinner } from '../common/Spinner'
import { DEMO_PASSWORD, Persona, personaGroups, personas, personasOf } from '../demo/personas'
import { LoginFrame } from './LoginFrame'
import { SavedSandboxClient, useSandboxClients } from './sandboxClients'
import { useDemoEnter } from './useDemoEnter'
import styles from './LoginPage.module.css'

type Icon = ComponentType<SVGProps<SVGSVGElement>>

// Только оформление карточек: иконка отрасли/роли и цвет метки. Факты о персонах — в demo/personas.ts.
const iconByLogin: Record<string, Icon> = {
  p3b: PfmCoffeCupMIcon, p1a: CakeMIcon, p1b: ContainerMIcon, p2a: ScrewdriverWrenchMIcon, p2b: HairbrushMIcon,
  p3a: FactoryMIcon, p3a_acc: DocumentStampMIcon, p_stop: PfmTransportMIcon, guest: DoorOpenMIcon,
}
const iconByRole: Record<string, Icon> = { UNDERWRITER: UserTieMIcon, RISK_MANAGER: ShieldMIcon, RULES_ADMIN: SlidersMIcon }

type StatusColor = 'green' | 'orange' | 'red' | 'blue' | 'grey' | 'teal' | 'purple'
const badgeColor: Record<string, StatusColor> = {
  'Одобрение': 'green', 'Рефинансирование': 'green', 'Контрпредложение': 'orange', 'Ручная проверка': 'blue',
  'Больше 5 млн': 'purple', 'По МЧД': 'grey', 'Отказ': 'red', 'Не клиент': 'grey',
}

// Стартовый экран сотрудника после входа (как первый пункт его меню).
const startScreen: Record<string, string> = { UNDERWRITER: 'очередь заявок', RISK_MANAGER: 'согласования', RULES_ADMIN: 'правила' }

// Исход предварительного расчёта клиента из песочницы — словами и цветом метки.
const sandboxOutcome: Record<string, [string, StatusColor]> = {
  APPROVED: ['Одобрение', 'green'], COUNTER_OFFER: ['Контрпредложение', 'orange'], MANUAL_REVIEW: ['Ручная проверка', 'blue'],
  REJECTED: ['Отказ', 'red'], INFO_REQUESTED: ['Нужны документы', 'orange'],
}
const createdText = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `создан ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d)}`
}

type Enter = ReturnType<typeof useDemoEnter>

export function LoginPage() {
  const demo = useDemoEnter()
  const { isBusy, errorFor, enter } = demo
  const heroError = errorFor('hero')
  const main = personas.find(p => p.primary) ?? personasOf('client')[0]
  const clients = personasOf('client')
  const bank = personasOf('bank')
  const guest = personasOf('guest')[0]
  const groupNote = (key: string) => personaGroups.find(g => g.key === key)?.note
  const groupTitle = (key: string) => personaGroups.find(g => g.key === key)?.title

  return <LoginFrame
    eyebrow="Умный кредитный кабинет"
    title={<>Кредит, который<br />объясняет себя</>}
    lead="Банк уже видит обороты по счёту — поэтому не просит справок, а сразу показывает предложение и объясняет его."
    points={[
      { icon: LightningMIcon, title: 'Решение за минуты', text: 'Пара вопросов о цели — остальное банк возьмёт сам из счёта, ФНС и БКИ' },
      { icon: QuestionCircleMIcon, title: 'Почему такая сумма', text: 'Что помогло и что ограничило лимит — простыми словами' },
      { icon: ChartColumnThreeAscArrowMIcon, title: 'Как получить больше', text: 'Конкретные шаги и на сколько вырастет лимит' },
    ]}
    action={<>
      {/* Не блокируем, пока входят по карточке: серая кнопка на тёмном фоне не читается, а повторное нажатие enter и так игнорирует */}
      <Button view="accent" size={56} block loading={isBusy('hero')} aria-busy={isBusy('hero')}
        rightAddons={<ArrowRightMIcon />} onClick={() => enter(main, 'hero')}>
        Начать с главного сценария
      </Button>
      <div className={styles.heroHint}>{main.title} · {main.subtitle.split(' · ')[0]}</div>
      {heroError && <div className={styles.heroError} role="alert">{heroError}</div>}
    </>}
    footnote="Демо-стенд: все данные синтетические · пароль demo · код подписи 0000. В кабинете справа — «Демо-сценарий»: панель ведёт по шагам показа и переключает участников без выхода"
  >
    <header className={styles.head}>
      <Typography.Title tag="h2" view="medium" font="system" weight="bold" className={styles.headTitle}>Кем войти?</Typography.Title>
      <p className={styles.headText}>Вход в один клик, пароль не нужен. Каждая учётка показывает свой сценарий — выберите, что хотите посмотреть.</p>
      <nav className={styles.jump} aria-label="Разделы выбора">
        <a href="#clients">Клиенты банка <span>{clients.length}</span></a>
        <a href="#bank">Сотрудники банка <span>{bank.length}</span></a>
        <a href="#other">Ещё не клиент · песочница</a>
      </nav>
    </header>

    <section className={styles.section} id="clients" aria-labelledby="clients-title">
      <SectionHead id="clients-title" title="Клиенты банка" note={groupNote('client')} />
      <div className={styles.grid}>
        {clients.map(p => <PersonaCard key={p.login} persona={p} demo={demo} />)}
      </div>
    </section>

    <section className={styles.section} id="bank" aria-labelledby="bank-title">
      <SectionHead id="bank-title" title="Сотрудники банка" note="Кабинет банка: очередь ручной проверки, согласования, правила решения и журнал аудита" />
      <div className={styles.grid}>
        {bank.map(p => <PersonaCard key={p.login} persona={p} demo={demo} compact />)}
      </div>
    </section>

    <section className={styles.section} id="other" aria-labelledby="other-title">
      <SectionHead id="other-title" title="Нет подходящего профиля?" note="Посмотрите путь бизнеса без счёта в Альфе или создайте клиента со своими параметрами" />
      <div className={styles.grid}>
        {guest && <Link to={guest.path ?? '/login/guest'} className={`${styles.card} ${styles.option}`}>
          <span className={styles.icon} aria-hidden><DoorOpenMIcon /></span>
          <span className={styles.optionBody}>
            <b className={styles.name}>{groupTitle('guest')}</b>
            <span className={styles.sub}>{guest.subtitle}</span>
            <span className={styles.scenario}>{guest.scenario}</span>
            <span className={styles.go}>Как получить кредит<ArrowRightMIcon aria-hidden /></span>
          </span>
        </Link>}
        <Link to="/login/sandbox" className={`${styles.card} ${styles.option} ${styles.sandbox}`}>
          <span className={styles.icon} aria-hidden><MagicWandMIcon /></span>
          <span className={styles.optionBody}>
            <b className={styles.name}>+ Создать своего клиента</b>
            <span className={styles.sub}>Песочница проверяющего</span>
            <span className={styles.scenario}>Задайте выручку, кредиты и историю — решение посчитает тот же движок, что и для готовых профилей</span>
            <span className={styles.go}>Открыть песочницу<ArrowRightMIcon aria-hidden /></span>
          </span>
        </Link>
      </div>
      <SandboxReturn demo={demo} />
    </section>

  </LoginFrame>
}

function SectionHead({ id, title, note }: { id: string; title: string; note?: string }) {
  return <div className={styles.sectionHead}>
    <Typography.Title tag="h3" view="small" font="system" weight="bold" id={id} className={styles.sectionTitle}>{title}</Typography.Title>
    {note && <p className={styles.sectionNote}>{note}</p>}
  </div>
}

/** Карточка учётки: кто это, что покажет сценарий, ожидаемый исход. Нажатие — сразу вход. */
function PersonaCard({ persona: p, demo, compact }: { persona: Persona; demo: Enter; compact?: boolean }) {
  const Icon = (p.role && iconByRole[p.role]) || iconByLogin[p.login] || UserTieMIcon
  const loading = demo.isBusy('card', p.login)
  const errorText = demo.errorFor('card', p.login)
  const cls = [styles.card, compact ? styles.compact : '', p.primary ? styles.featured : '', loading ? styles.loading : ''].filter(Boolean).join(' ')
  return <button type="button" className={cls} onClick={() => demo.enter(p, 'card')} disabled={demo.busy} aria-busy={loading}
    aria-label={`Войти: ${p.title}, ${p.subtitle}`}>
    <span className={styles.top}>
      <span className={styles.icon} aria-hidden><Icon /></span>
      <span className={styles.who}>
        <b className={styles.name}>{p.title}</b>
        <span className={styles.sub}>{p.subtitle}</span>
      </span>
    </span>
    <span className={styles.scenario}>{p.scenario}</span>
    {errorText && <span className={styles.error} role="alert">{errorText}</span>}
    <span className={styles.bottom}>
      {p.primary
        ? <span className={styles.mainBadge}>{p.badge}</span>
        : compact && p.role && startScreen[p.role]
          ? <span className={styles.start}>Откроется: {startScreen[p.role]}</span>
          : <Status color={badgeColor[p.badge] ?? 'grey'} view="muted-alt" size={24} shape="rounded" uppercase={false} className={styles.badge}>{p.badge}</Status>}
      <span className={styles.enter}>
        <span className={styles.login}>логин <code>{p.login}</code></span>
        {loading
          ? <Spinner label="Входим…" />
          : <span className={styles.go}>Войти<ArrowRightMIcon aria-hidden /></span>}
      </span>
    </span>
  </button>
}

/**
 * Возврат к клиентам песочницы: созданные в этом браузере — списком с входом в один клик,
 * любой другой — по логину (пароль у всех демо-учёток один).
 */
function SandboxReturn({ demo }: { demo: Enter }) {
  const { clients, forget } = useSandboxClients()
  const [value, setValue] = useState('')
  const [empty, setEmpty] = useState(false)
  const typed = value.trim()
  const formError = empty ? 'Введите логин' : demo.errorFor('form')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!typed) { setEmpty(true); return }
    demo.enter({ login: typed }, 'form')
  }

  return <div className={styles.saved} id="sandbox-clients">
    {clients.length > 0 && <>
      <div className={styles.savedHead}>
        <b>Ваши клиенты из песочницы</b>
        <span>Созданы в этом браузере · вход в один клик</span>
      </div>
      <ul className={styles.savedList}>
        {clients.map(c => <SavedRow key={c.login} client={c} demo={demo} onForget={() => forget(c.login)} />)}
      </ul>
    </>}
    <form className={styles.byLogin} onSubmit={submit} noValidate>
      <div className={styles.byLoginText}>
        <b>{clients.length ? 'Другой логин' : 'Уже создавали клиента?'}</b>
        <span>Войдите по логину из песочницы — пароль {DEMO_PASSWORD} подставим сами</span>
      </div>
      <div className={styles.byLoginRow}>
        <Input size={48} block label="Логин" value={value} placeholder="sbx…" autoComplete="off" autoCapitalize="off" spellCheck={false}
          error={formError ?? undefined} disabled={demo.busy && !demo.isBusy('form')}
          onChange={(_, { value: v }) => { setValue(v); setEmpty(false) }} className={styles.byLoginInput} />
        <Button type="submit" view="secondary" size={48} loading={demo.isBusy('form')} disabled={demo.busy && !demo.isBusy('form')}>Войти</Button>
      </div>
    </form>
  </div>
}

function SavedRow({ client: c, demo, onForget }: { client: SavedSandboxClient; demo: Enter; onForget: () => void }) {
  const [label, color] = sandboxOutcome[c.outcome] ?? [null, 'grey' as StatusColor]
  const loading = demo.isBusy('saved', c.login)
  const errorText = demo.errorFor('saved', c.login)
  return <li className={styles.savedItem}>
    <button type="button" className={[styles.savedEnter, loading ? styles.loading : ''].filter(Boolean).join(' ')}
      onClick={() => demo.enter({ login: c.login, role: 'CLIENT' }, 'saved')} disabled={demo.busy} aria-busy={loading}
      aria-label={`Войти: ${c.name}, логин ${c.login}`}>
      <span className={styles.savedIcon} aria-hidden><MagicWandMIcon /></span>
      <span className={styles.savedWho}>
        <b className={styles.name}>{c.name}</b>
        <span className={styles.sub}>логин <code>{c.login}</code>{createdText(c.createdAt) && <> · {createdText(c.createdAt)}</>}</span>
      </span>
      {label && <Status color={color} view="muted-alt" size={24} shape="rounded" uppercase={false} className={styles.badge}>{label}</Status>}
      {loading ? <Spinner label="Входим…" /> : <span className={styles.go}>Войти<ArrowRightMIcon aria-hidden /></span>}
    </button>
    <IconButton icon={CrossMIcon} size={32} view="secondary" aria-label={`Убрать ${c.login} из списка`} title="Убрать из списка"
      onClick={onForget} disabled={loading} className={styles.savedForget} />
    {errorText && <span className={styles.savedError} role="alert">
      {errorText}{!errorText.startsWith('Нет связи') && ' Если стенд перезапускали, этого клиента на нём уже нет — уберите его из списка.'}
    </span>}
  </li>
}
