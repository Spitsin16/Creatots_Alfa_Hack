import { ComponentType, FormEvent, ReactNode, SVGProps, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@alfalab/core-components/button/esm'
import { IconButton } from '@alfalab/core-components/icon-button/esm'
import { Input } from '@alfalab/core-components/input/esm'
import { CakeMIcon } from '@alfalab/icons-glyph/CakeMIcon'
import { ChevronDownMIcon } from '@alfalab/icons-glyph/ChevronDownMIcon'
import { ChevronForwardMIcon } from '@alfalab/icons-glyph/ChevronForwardMIcon'
import { ContainerMIcon } from '@alfalab/icons-glyph/ContainerMIcon'
import { CrossMIcon } from '@alfalab/icons-glyph/CrossMIcon'
import { DocumentStampMIcon } from '@alfalab/icons-glyph/DocumentStampMIcon'
import { DoorOpenMIcon } from '@alfalab/icons-glyph/DoorOpenMIcon'
import { FactoryMIcon } from '@alfalab/icons-glyph/FactoryMIcon'
import { HairbrushMIcon } from '@alfalab/icons-glyph/HairbrushMIcon'
import { MagicWandMIcon } from '@alfalab/icons-glyph/MagicWandMIcon'
import { PfmCoffeCupMIcon } from '@alfalab/icons-glyph/PfmCoffeCupMIcon'
import { PfmTransportMIcon } from '@alfalab/icons-glyph/PfmTransportMIcon'
import { ScrewdriverWrenchMIcon } from '@alfalab/icons-glyph/ScrewdriverWrenchMIcon'
import { ShieldMIcon } from '@alfalab/icons-glyph/ShieldMIcon'
import { SlidersMIcon } from '@alfalab/icons-glyph/SlidersMIcon'
import { UserTieMIcon } from '@alfalab/icons-glyph/UserTieMIcon'
import { Spinner } from '../common/Spinner'
import { DEMO_PASSWORD, DEMO_SIGN_CODE, Persona, personas, personasOf } from '../demo/personas'
import { LoginFrame } from './LoginFrame'
import { SavedSandboxClient, useSandboxClients } from './sandboxClients'
import { useDemoEnter } from './useDemoEnter'
import styles from './LoginPage.module.css'

type Icon = ComponentType<SVGProps<SVGSVGElement>>

// Иконка отрасли (клиент) или роли (сотрудник). Факты о персонах — в demo/personas.ts.
const iconByLogin: Record<string, Icon> = {
  p3b: PfmCoffeCupMIcon, p1a: CakeMIcon, p1b: ContainerMIcon, p2a: ScrewdriverWrenchMIcon, p2b: HairbrushMIcon,
  p3a: FactoryMIcon, p3a_acc: DocumentStampMIcon, p_stop: PfmTransportMIcon, guest: DoorOpenMIcon,
}
const iconByRole: Record<string, Icon> = { UNDERWRITER: UserTieMIcon, RISK_MANAGER: ShieldMIcon, RULES_ADMIN: SlidersMIcon }

// Ожидаемый исход у клиента — тоном точки рядом со словом (зелёный — деньги, жёлтый — другие условия,
// синий — решает человек, красный — отказ, серый — особая роль).
type Tone = 'positive' | 'attention' | 'info' | 'negative' | 'neutral'
const toneByBadge: Record<string, Tone> = {
  'Одобрение': 'positive', 'Рефинансирование': 'positive', 'Контрпредложение': 'attention', 'Ручная проверка': 'info',
  'Больше 5 млн': 'info', 'По МЧД': 'neutral', 'Отказ': 'negative', 'Главный сценарий': 'positive',
}
const startScreen: Record<string, string> = { UNDERWRITER: 'Очередь заявок', RISK_MANAGER: 'Согласования', RULES_ADMIN: 'Правила' }

const sandboxOutcome: Record<string, [string, Tone]> = {
  APPROVED: ['Одобрение', 'positive'], COUNTER_OFFER: ['Контрпредложение', 'attention'], MANUAL_REVIEW: ['Ручная проверка', 'info'],
  REJECTED: ['Отказ', 'negative'], INFO_REQUESTED: ['Нужны документы', 'attention'],
}
const createdText = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `создан ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d)}`
}

type Enter = ReturnType<typeof useDemoEnter>

/**
 * Выбор демо-учётки. Правка ментора 25.10 («выглядит навайбкоженно»): вместо тёмного героя
 * и стены одинаковых карточек — один главный сценарий и списки, как выбор организации в интернет-банке.
 */
export function LoginPage() {
  const demo = useDemoEnter()
  const main = personas.find(p => p.primary) ?? personasOf('client')[0]
  const clients = personasOf('client')
  const bank = personasOf('bank')
  const guest = personasOf('guest')[0]
  const heroError = demo.errorFor('hero')

  return <LoginFrame
    title="Вход в демо-стенд"
    lead={<>Выберите, кем войти, пароль подставится сам. Договор подписывается кодом {DEMO_SIGN_CODE}.</>}
    footnote="Все компании, люди и операции на стенде вымышленные. В кабинете слева внизу — переход между клиентом и сотрудниками банка в одно нажатие, справа — панель «Демо-сценарий» с шагами показа."
  >
    <section className={styles.start} aria-labelledby="start-title">
      <span className={styles.startIcon} aria-hidden><PfmCoffeCupMIcon /></span>
      <div className={styles.startBody}>
        <h2 id="start-title" className={styles.startTitle}>Начните с кофейни Артёма Иванова</h2>
        <p className={styles.startText}>
          12 ноября на счёте кофейни не хватит денег на регулярные платежи. Кабинет заметит это заранее, предложит овердрафт
          270&nbsp;000&nbsp;₽ и объяснит сумму. С выпиской из другого банка лимит вырастет до 360&nbsp;000&nbsp;₽.
        </p>
        {heroError && <p className={styles.error} role="alert">{heroError}</p>}
      </div>
      <Button view="accent" size={48} className={styles.startButton} loading={demo.isBusy('hero')} aria-busy={demo.isBusy('hero')}
        onClick={() => demo.enter(main, 'hero')}>
        Начать с главного сценария
      </Button>
    </section>

    <Group id="clients" title="Клиенты банка" count={clients.length}
      note="Кофейня, пекарня, опт, автосервис, салон, стройматериалы, грузоперевозки — у каждого свой исход">
      {clients.map(p => <PersonaRow key={p.login} persona={p} demo={demo} />)}
    </Group>

    <Group id="bank" title="Сотрудники банка" count={bank.length}
      note="Андеррайтеры, риск-менеджер и администратор правил">
      {bank.map(p => <PersonaRow key={p.login} persona={p} demo={demo} />)}
    </Group>

    <OtherGroup demo={demo} guest={guest} />
  </LoginFrame>
}

// Какие плашки раскрыты — помним до закрытия вкладки, чтобы после «Выйти из кабинета» список был там же
const OPEN_KEY = 'login.openGroups'
function readOpen(): string[] {
  try { return JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? '[]') as string[] } catch { return [] }
}
function useOpenGroup(id: string) {
  const [open, setOpen] = useState(() => readOpen().includes(id))
  const toggle = () => setOpen(was => {
    const next = !was
    try {
      const rest = readOpen().filter(g => g !== id)
      sessionStorage.setItem(OPEN_KEY, JSON.stringify(next ? [...rest, id] : rest))
    } catch { /* приватный режим — просто не запоминаем */ }
    return next
  })
  return [open, toggle] as const
}

/**
 * Плашка со списком учёток (просьба команды 25.10: «три плашки, которые раскрываются»).
 * Закрыта — видно только, кто внутри; нажатие раскрывает список, повторное — сворачивает.
 */
function Group({ id, title, note, count, children, after }: {
  id: string; title: string; note?: string; count?: number; children: ReactNode; after?: ReactNode
}) {
  const [open, toggle] = useOpenGroup(id)
  return <section className={[styles.group, open ? styles.groupOpen : ''].filter(Boolean).join(' ')} aria-labelledby={`${id}-title`}>
    <h2 className={styles.groupHeading}>
      <button type="button" className={styles.groupToggle} onClick={toggle} aria-expanded={open} aria-controls={`${id}-list`}
        data-login-group={id}>
        <span className={styles.groupText}>
          <span id={`${id}-title`} className={styles.groupTitle}>{title}</span>
          {note && <span className={styles.groupNote}>{note}</span>}
        </span>
        {count != null ? <span className={styles.groupCount}>{count}</span> : <span aria-hidden />}
        <ChevronDownMIcon className={styles.groupChevron} aria-hidden />
      </button>
    </h2>
    <div id={`${id}-list`} className={styles.panel}>
      <div className={styles.panelInner}>
        <ul className={styles.list}>{children}</ul>
        {after}
      </div>
    </div>
  </section>
}

/** Третья плашка: путь без счёта в Альфе, свой клиент в песочнице и вход по логину. */
function OtherGroup({ demo, guest }: { demo: Enter; guest?: Persona }) {
  const { clients, forget } = useSandboxClients()
  return <Group id="other" title="Ещё не клиент или свой клиент"
    note="Путь без счёта в Альфе, свой клиент с заданной выручкой и историей, вход по логину"
    after={<LoginByName demo={demo} />}>
    {guest && <li><Link to={guest.path ?? '/login/guest'} className={styles.row}>
      <span className={styles.icon} aria-hidden><DoorOpenMIcon /></span>
      <span className={styles.who}><b className={styles.name}>Ещё не клиент</b><span className={styles.hint}>{guest.hint}</span></span>
      <ChevronForwardMIcon className={styles.chevron} aria-hidden />
    </Link></li>}
    <li><Link to="/login/sandbox" className={styles.row}>
      <span className={styles.icon} aria-hidden><MagicWandMIcon /></span>
      <span className={styles.who}><b className={styles.name}>Создать своего клиента</b>
        <span className={styles.hint}>Задайте выручку, кредиты и историю, решение посчитает тот же движок</span></span>
      <ChevronForwardMIcon className={styles.chevron} aria-hidden />
    </Link></li>
    {clients.map(c => <SavedRow key={c.login} client={c} demo={demo} onForget={() => forget(c.login)} />)}
  </Group>
}

function Outcome({ text, tone }: { text: string; tone: Tone }) {
  return <span className={`${styles.outcome} ${styles[tone]}`}><i aria-hidden />{text}</span>
}

/** Строка учётки: кто это и что покажет. Нажатие — сразу вход. */
function PersonaRow({ persona: p, demo }: { persona: Persona; demo: Enter }) {
  const Icon = (p.role && iconByRole[p.role]) || iconByLogin[p.login] || UserTieMIcon
  const loading = demo.isBusy('card', p.login)
  const errorText = demo.errorFor('card', p.login)
  const staff = p.group === 'bank'
  return <li>
    <button type="button" className={[styles.row, loading ? styles.loading : ''].filter(Boolean).join(' ')}
      onClick={() => demo.enter(p, 'card')} disabled={demo.busy} aria-busy={loading}
      aria-label={`Войти: ${p.title}, ${p.subtitle}`}>
      <span className={styles.icon} aria-hidden><Icon /></span>
      <span className={styles.who}>
        <span className={styles.nameLine}><b className={styles.name}>{p.title}</b><span className={styles.sub}>{p.subtitle}</span></span>
        <span className={styles.hint}>{p.hint}</span>
        {errorText && <span className={styles.error} role="alert">{errorText}</span>}
      </span>
      <span className={styles.side}>
        {staff
          ? <span className={styles.opens}>{p.role ? startScreen[p.role] : ''}</span>
          : <Outcome text={p.badge} tone={toneByBadge[p.badge] ?? 'neutral'} />}
        <span className={styles.login}>{p.login}</span>
      </span>
      {loading ? <Spinner label="Входим" /> : <ChevronForwardMIcon className={styles.chevron} aria-hidden />}
    </button>
  </li>
}

/** Вход по логину — например, клиента песочницы, созданного в другом браузере (пароль у всех демо-учёток один). */
function LoginByName({ demo }: { demo: Enter }) {
  const [value, setValue] = useState('')
  const [empty, setEmpty] = useState(false)
  const typed = value.trim()
  const formError = empty ? 'Введите логин' : demo.errorFor('form')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!typed) { setEmpty(true); return }
    demo.enter({ login: typed }, 'form')
  }

  return <form className={styles.byLogin} onSubmit={submit} noValidate>
    <div className={styles.byLoginText}>
      <b>Войти по логину</b>
      <span>Например, клиента из песочницы. Пароль {DEMO_PASSWORD} подставим сами</span>
    </div>
    <div className={styles.byLoginRow}>
      <Input size={48} block label="Логин" value={value} placeholder="sbx…" autoComplete="off" autoCapitalize="off" spellCheck={false}
        error={formError ?? undefined} disabled={demo.busy && !demo.isBusy('form')}
        onChange={(_, { value: v }) => { setValue(v); setEmpty(false) }} className={styles.byLoginInput} />
      <Button type="submit" view="secondary" size={48} loading={demo.isBusy('form')} disabled={demo.busy && !demo.isBusy('form')}>Войти</Button>
    </div>
  </form>
}

function SavedRow({ client: c, demo, onForget }: { client: SavedSandboxClient; demo: Enter; onForget: () => void }) {
  const [label, tone] = sandboxOutcome[c.outcome] ?? [null, 'neutral' as Tone]
  const loading = demo.isBusy('saved', c.login)
  const errorText = demo.errorFor('saved', c.login)
  return <li className={styles.savedItem}>
    <button type="button" className={[styles.row, loading ? styles.loading : ''].filter(Boolean).join(' ')}
      onClick={() => demo.enter({ login: c.login, role: 'CLIENT' }, 'saved')} disabled={demo.busy} aria-busy={loading}
      aria-label={`Войти: ${c.name}, логин ${c.login}`}>
      <span className={styles.icon} aria-hidden><MagicWandMIcon /></span>
      <span className={styles.who}>
        <b className={styles.name}>{c.name}</b>
        <span className={styles.hint}>{createdText(c.createdAt)}</span>
        {errorText && <span className={styles.error} role="alert">
          {errorText}{!errorText.startsWith('Нет связи') && ' Если стенд перезапускали, этого клиента на нём уже нет — уберите его из списка.'}
        </span>}
      </span>
      <span className={styles.side}>
        {label && <Outcome text={label} tone={tone} />}
        <span className={styles.login}>{c.login}</span>
      </span>
      {loading ? <Spinner label="Входим" /> : <ChevronForwardMIcon className={styles.chevron} aria-hidden />}
    </button>
    <IconButton icon={CrossMIcon} size={32} view="secondary" aria-label={`Убрать ${c.login} из списка`} title="Убрать из списка"
      onClick={onForget} disabled={loading} className={styles.savedForget} />
  </li>
}
