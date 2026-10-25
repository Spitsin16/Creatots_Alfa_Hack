import { ComponentType, Suspense, SVGProps, useEffect, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { Button } from '@alfalab/core-components/button/esm'
import { BanknotesMIcon } from '@alfalab/icons-glyph/BanknotesMIcon'
import { BurgerMIcon } from '@alfalab/icons-glyph/BurgerMIcon'
import { ChartColumnThreeMIcon } from '@alfalab/icons-glyph/ChartColumnThreeMIcon'
import { ClockLineMIcon } from '@alfalab/icons-glyph/ClockLineMIcon'
import { CrossMIcon } from '@alfalab/icons-glyph/CrossMIcon'
import { DocumentLinesMIcon } from '@alfalab/icons-glyph/DocumentLinesMIcon'
import { DocumentsLinesMIcon } from '@alfalab/icons-glyph/DocumentsLinesMIcon'
import { ListBulletedMIcon } from '@alfalab/icons-glyph/ListBulletedMIcon'
import { LogOutMIcon } from '@alfalab/icons-glyph/LogOutMIcon'
import { RouteLineMIcon } from '@alfalab/icons-glyph/RouteLineMIcon'
import { ShieldMIcon } from '@alfalab/icons-glyph/ShieldMIcon'
import { SlidersMIcon } from '@alfalab/icons-glyph/SlidersMIcon'
import { Me } from '../api'
import { homePath, isBank, useAuth, useSession, wasSignedOut } from '../auth'
import { Assistant } from '../client/Assistant'
import { lastOfferId } from '../client/offerStore'
import { DemoPanel } from '../demo/DemoPanel'
import { useHiddenFlag } from '../demo/demoStore'
import { roleTitle } from '../demo/personas'
import { useMyApplications } from '../queries'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { ErrorState, LoadingState } from '../ui/States'
import styles from './AppShell.module.css'

type Icon = ComponentType<SVGProps<SVGSVGElement>>
type NavItem = { to: string; icon: Icon; label: string }

const navByRole: Record<string, NavItem[]> = {
  CLIENT: [
    { to: '/', icon: BanknotesMIcon, label: 'Кредиты' },
    { to: '/applications', icon: DocumentLinesMIcon, label: 'Мои заявки' },
    { to: '/documents', icon: DocumentsLinesMIcon, label: 'Документы' },
  ],
  UNDERWRITER: [
    { to: '/bank', icon: ListBulletedMIcon, label: 'Очередь заявок' },
    { to: '/bank/stats', icon: ChartColumnThreeMIcon, label: 'Сводка' },
    { to: '/bank/audit', icon: ClockLineMIcon, label: 'Журнал аудита' },
  ],
  RISK_MANAGER: [
    { to: '/bank/risk', icon: ShieldMIcon, label: 'Согласования' },
    { to: '/bank', icon: ListBulletedMIcon, label: 'Все заявки' },
    { to: '/bank/stats', icon: ChartColumnThreeMIcon, label: 'Сводка' },
    { to: '/bank/audit', icon: ClockLineMIcon, label: 'Журнал аудита' },
  ],
  RULES_ADMIN: [
    { to: '/bank/rules', icon: SlidersMIcon, label: 'Правила' },
    { to: '/bank/audit', icon: ClockLineMIcon, label: 'Журнал аудита' },
  ],
}

// Пускает внутрь кабинета только после входа; иначе — на экран входа с возвратом обратно.
export function RequireAuth() {
  const { token, me, loading, error, retry, logout } = useAuth()
  const location = useLocation()
  if (!token) return <Navigate to={wasSignedOut() ? '/login' : `/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (error && !loading) return <div className={styles.authError}>
    <ErrorState title="Не удалось открыть кабинет" error={error} onRetry={retry} />
    <button type="button" className={styles.authErrorExit} onClick={logout}>Выйти и войти заново</button>
  </div>
  if (loading || !me) return <LoadingState view="page" label="Загружаем кабинет…" />
  return <Outlet />
}

// Разводит роли: клиент не попадает в /bank, сотрудник — в кабинет клиента.
export function RequireSide({ bank }: { bank: boolean }) {
  const { me } = useSession()
  if (isBank(me.role) !== bank) return <Navigate to={homePath(me.role)} replace />
  return <Outlet />
}

export function RequireRole({ roles }: { roles: string[] }) {
  const { me } = useSession()
  if (!roles.includes(me.role)) return <Navigate to={homePath(me.role)} replace />
  return <Outlet />
}

// Имя для профиля: у сотрудников в full_name есть должность («Андеррайтер Смирнова Е.») — убираем её.
const displayName = (me: Me) => {
  if (!isBank(me.role)) return me.full_name.split(' ').slice(0, 2).join(' ')
  return me.full_name.replace(/^(Андеррайтер|Риск-менеджер|Админ правил)\s+/, '')
}

const profileNote = (me: Me) => {
  if (isBank(me.role)) return roleTitle[me.role] ?? me.role
  const business = me.businesses[0]
  if (!business) return roleTitle.CLIENT
  return business.membership_kind === 'MCHD' ? `${business.name} · по МЧД` : business.name
}

/** Оболочка кабинета: сайдбар (на узком экране — верхняя панель с меню), контент, ассистент, демо-панель. */
export function AppShell() {
  const { logout } = useAuth()
  const { me } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [demoHidden, setDemoHidden] = useHiddenFlag()
  const items = navByRole[me.role] ?? []
  const bank = isBank(me.role)

  // Меню на телефоне закрывается при переходе и по Esc.
  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const exit = () => { logout(); navigate('/login', { replace: true }) }

  return <div className={styles.shell}>
    <aside className={[styles.sidebar, menuOpen ? styles.menuOpen : ''].filter(Boolean).join(' ')}>
      <div className={styles.top}>
        <Link to={homePath(me.role)} className={styles.brand} aria-label="Альфа-Бизнес — на главную">
          <span className={styles.brandMark} aria-hidden>А</span>
          <span className={styles.brandText}>
            <b>Альфа-Бизнес</b>
            <small>{bank ? 'Кабинет банка' : 'Кредиты для бизнеса'}</small>
          </span>
        </Link>
        <button type="button" className={styles.menuButton} onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={menuOpen} aria-controls="app-menu">
          {menuOpen ? <CrossMIcon /> : <BurgerMIcon />}
        </button>
      </div>

      <div className={styles.menu} id="app-menu">
        <nav className={styles.nav} aria-label="Разделы кабинета">
          {items.map(({ to, icon: NavIcon, label }) =>
            <NavLink key={to} to={to} end={to === '/' || to === '/bank'} className={({ isActive }) => [styles.navItem, isActive ? styles.active : ''].filter(Boolean).join(' ')}>
              <NavIcon className={styles.navIcon} aria-hidden />
              <span>{label}</span>
            </NavLink>)}
        </nav>

        {/* Демо-панель скрыли (для чистых скриншотов) — вернуть её можно и без горячей клавиши */}
        {demoHidden && <button type="button" className={styles.demoReturn} onClick={() => setDemoHidden(false)}>
          <RouteLineMIcon aria-hidden />Показать демо-панель
        </button>}

        {/* Правка ментора 25.10: выход — подписанной кнопкой, а не иконкой-стрелкой */}
        <div className={styles.profile}>
          <div className={styles.profileRow}>
            <span className={styles.avatar} aria-hidden>{displayName(me)[0]}</span>
            <span className={styles.who}>
              <b title={me.full_name}>{displayName(me)}</b>
              <small title={profileNote(me)}>{profileNote(me)}</small>
            </span>
          </div>
          <Button view="secondary" size={40} block leftAddons={<LogOutMIcon aria-hidden />} onClick={exit} className={styles.logoutButton}>
            Выйти из кабинета
          </Button>
        </div>
      </div>
    </aside>
    {menuOpen && <div className={styles.scrim} onClick={() => setMenuOpen(false)} aria-hidden />}

    <main className={styles.content}>
      <div className={styles.inner}>
        <ErrorBoundary resetKey={location.pathname}>
          {/* экраны грузятся по маршруту (React.lazy в App.tsx) — пока часть кода не пришла, крутим загрузку */}
          <Suspense fallback={<LoadingState view="page" />}><Outlet /></Suspense>
        </ErrorBoundary>
      </div>
    </main>

    {!bank && <ClientAssistant />}
    <DemoPanel />
  </div>
}

// Ассистент ведёт либо к активной заявке, либо к последнему расчёту.
function ClientAssistant() {
  const { token, me } = useSession()
  const navigate = useNavigate()
  const apps = useMyApplications(me.businesses[0].id)
  const go = (target: string) => {
    const active = apps.data?.active_id
    if (target === 'application' && active) navigate(`/applications/${active}`)
    else if (target === 'offer' && lastOfferId()) navigate(`/offer/${lastOfferId()}`)
    else if (target === 'offer') navigate('/#calculator')
    else navigate('/')
  }
  return <Assistant token={token} onNavigate={go} />
}
