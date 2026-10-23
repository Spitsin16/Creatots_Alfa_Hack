import { Link, useNavigate, useParams } from 'react-router'
import { useSession } from '../auth'
import { Bell } from '../common/Bell'
import { AuditPage } from './AuditPage'
import { ReviewPanel, RiskQueue } from './ReviewPanel'
import { RulesAdmin } from './RulesAdmin'

// Карточка заявки — отдельная страница: на неё ведут очередь, согласования и уведомления.
export function BankApplicationPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  return <div className="page bank-page"><header><div>
    <button className="link dark" onClick={() => (history.length > 1 ? navigate(-1) : navigate('/bank'))}>‹ Назад</button>
    <h1>Карточка заявки</h1></div><Bell /></header>
    <ReviewPanel id={id} />
  </div>
}

export function RiskPage() {
  return <div className="page bank-page"><header><div><span className="eyebrow">Кабинет банка</span><h1>Согласования риска</h1><p>Второе одобрение: суммы свыше 5 млн ₽ и решения вопреки скорингу. <Link className="link" to="/bank">Все заявки ›</Link></p></div><Bell /></header>
    <RiskQueue />
  </div>
}

export function RulesPage() {
  const { token } = useSession()
  return <RulesAdmin token={token} />
}

export function AuditRoute() {
  const { token } = useSession()
  return <AuditPage token={token} />
}
