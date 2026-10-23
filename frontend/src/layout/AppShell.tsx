import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { homePath, isBank, useAuth, useSession } from '../auth'
import { Assistant } from '../client/Assistant'
import { lastOfferId } from '../client/offerStore'
import { Spinner } from '../common/Spinner'
import { useMyApplications } from '../queries'

const roleName: Record<string, string> = {
  CLIENT: 'Клиент', UNDERWRITER: 'Андеррайтер', RISK_MANAGER: 'Риск-менеджер', RULES_ADMIN: 'Администратор правил',
}

const navByRole: Record<string, [string, string, string][]> = {
  CLIENT: [['/', '⌂', 'Кредиты'], ['/applications', '☰', 'Мои заявки'], ['/documents', '◫', 'Документы']],
  UNDERWRITER: [['/bank', '⌂', 'Очередь заявок'], ['/bank/audit', '◎', 'Журнал аудита']],
  RISK_MANAGER: [['/bank/risk', '⚑', 'Согласования'], ['/bank', '☰', 'Все заявки'], ['/bank/audit', '◎', 'Журнал аудита']],
  RULES_ADMIN: [['/bank/rules', '⚙', 'Правила'], ['/bank/audit', '◎', 'Журнал аудита']],
}

// Пускает внутрь кабинета только после входа; иначе — на экран входа с возвратом обратно.
export function RequireAuth() {
  const { token, me, loading } = useAuth()
  const location = useLocation()
  if (!token) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (loading || !me) return <div className="page-loading"><Spinner label="Загружаем кабинет…" /></div>
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

export function AppShell() {
  const { logout } = useAuth()
  const { me } = useSession()
  const navigate = useNavigate()
  const items = navByRole[me.role] ?? []
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">A</span><span>Альфа-Бизнес</span></div>
      <nav>{items.map(([to, icon, label]) =>
        <NavLink key={to} to={to} end={to === '/' || to === '/bank'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><span>{icon}</span>{label}</NavLink>)}
      </nav>
      <div className="profile"><div className="avatar">{me.full_name[0]}</div><div><b>{me.full_name}</b><small>{roleName[me.role] ?? me.role}</small></div>
        <button title="Выйти" onClick={() => { logout(); navigate('/login') }}>↗</button></div>
    </aside>
    {!isBank(me.role) && <ClientAssistant />}
    <main><Outlet /></main>
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
    else navigate('/')
  }
  return <Assistant token={token} onNavigate={go} />
}
