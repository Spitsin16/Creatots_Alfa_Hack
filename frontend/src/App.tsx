import { ComponentType, lazy, ReactNode, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { homePath, useAuth } from './auth'
import { AppShell, RequireAuth, RequireRole, RequireSide } from './layout/AppShell'
import { LoginPage } from './login/LoginPage'
import { LoadingState } from './ui/States'

// Экран входа — в основной части (его жюри видит первым). Остальные экраны грузятся по маршруту отдельными частями:
// клиенту не нужен код кабинета банка, а сотруднику — графики клиента.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then(m => ({ default: m[name] })))

const NonClientPage = page(() => import('./login/NonClientPage'), 'NonClientPage')
const SandboxPage = page(() => import('./login/SandboxPage'), 'SandboxPage')
const HomePage = page(() => import('./client/HomePage'), 'HomePage')
const OfferPage = page(() => import('./client/OfferPage'), 'OfferPage')
const ApplicationsPage = page(() => import('./client/ApplicationsPage'), 'ApplicationsPage')
const ApplicationPage = page(() => import('./client/ApplicationPage'), 'ApplicationPage')
const DocumentsRoute = page(() => import('./client/DocumentsRoute'), 'DocumentsRoute')
const QueuePage = page(() => import('./bank/QueuePage'), 'QueuePage')
const BankApplicationPage = page(() => import('./bank/BankPages'), 'BankApplicationPage')
const RiskPage = page(() => import('./bank/BankPages'), 'RiskPage')
const StatsPage = page(() => import('./bank/stats/StatsPage'), 'StatsPage')
const RulesPage = page(() => import('./bank/RulesAdmin'), 'RulesPage')
const AuditRoute = page(() => import('./bank/AuditPage'), 'AuditRoute')
// Витрина примитивов src/ui — только в dev-сборке (в production вырезается целиком).
const Showcase = import.meta.env.DEV ? lazy(() => import('./ui/Showcase')) : null

// Карта экранов. Права здесь только прячут чужие страницы — проверяет доступ бэк.
// Внутри кабинета ожидание загрузки экрана показывает оболочка (Suspense вокруг Outlet в AppShell).
export default function App() {
  return <Routes>
    <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
    <Route path="/login/guest" element={<Loading><NonClientPage /></Loading>} />
    <Route path="/login/sandbox" element={<GuestOnly><Loading><SandboxPage /></Loading></GuestOnly>} />
    <Route element={<RequireAuth />}>
      <Route element={<AppShell />}>
        <Route element={<RequireSide bank={false} />}>
          <Route index element={<HomePage />} />
          <Route path="offer/:id" element={<OfferPage />} />
          <Route path="applications" element={<ApplicationsPage />} />
          <Route path="applications/:id" element={<ApplicationPage />} />
          <Route path="documents" element={<DocumentsRoute />} />
        </Route>
        <Route path="bank" element={<RequireSide bank />}>
          <Route element={<RequireRole roles={['UNDERWRITER', 'RISK_MANAGER']} />}>
            <Route index element={<QueuePage />} />
            <Route path="applications/:id" element={<BankApplicationPage />} />
            <Route path="stats" element={<StatsPage />} />
          </Route>
          <Route path="risk" element={<RequireRole roles={['RISK_MANAGER']} />}><Route index element={<RiskPage />} /></Route>
          <Route path="rules" element={<RequireRole roles={['RULES_ADMIN']} />}><Route index element={<RulesPage />} /></Route>
          <Route path="audit" element={<AuditRoute />} />
        </Route>
        {Showcase && <Route path="dev/ui" element={<Showcase />} />}
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}

function Loading({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingState view="page" />}>{children}</Suspense>
}

// Уже вошедшего пользователя экран входа сразу отправляет в его кабинет.
function GuestOnly({ children }: { children: ReactNode }) {
  const { token, me } = useAuth()
  if (token && me) return <Navigate to={homePath(me.role)} replace />
  return children
}
