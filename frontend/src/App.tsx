import { Navigate, Route, Routes } from 'react-router'
import { homePath, useAuth } from './auth'
import { BankApplicationPage, AuditRoute, RiskPage, RulesPage } from './bank/BankPages'
import { QueuePage } from './bank/QueuePage'
import { ApplicationPage } from './client/ApplicationPage'
import { ApplicationsPage } from './client/ApplicationsPage'
import { DocumentsRoute } from './client/DocumentsRoute'
import { HomePage } from './client/HomePage'
import { OfferPage } from './client/OfferPage'
import { AppShell, RequireAuth, RequireRole, RequireSide } from './layout/AppShell'
import { LoginPage, NonClientPage, SandboxPage } from './login/LoginPage'

// Карта экранов. Права здесь только прячут чужие страницы — проверяет доступ бэк.
export default function App() {
  return <Routes>
    <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
    <Route path="/login/guest" element={<NonClientPage />} />
    <Route path="/login/sandbox" element={<GuestOnly><SandboxPage /></GuestOnly>} />
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
          </Route>
          <Route path="risk" element={<RequireRole roles={['RISK_MANAGER']} />}><Route index element={<RiskPage />} /></Route>
          <Route path="rules" element={<RequireRole roles={['RULES_ADMIN']} />}><Route index element={<RulesPage />} /></Route>
          <Route path="audit" element={<AuditRoute />} />
        </Route>
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}

// Уже вошедшего пользователя экран входа сразу отправляет в его кабинет.
function GuestOnly({ children }: { children: React.ReactNode }) {
  const { token, me } = useAuth()
  if (token && me) return <Navigate to={homePath(me.role)} replace />
  return children
}
