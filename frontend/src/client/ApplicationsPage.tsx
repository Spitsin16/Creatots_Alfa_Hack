import { useQueries } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Application, productName, request, rubles } from '../api'
import { useSession } from '../auth'
import { Bell } from '../common/Bell'
import { Spinner } from '../common/Spinner'
import { statusName } from '../common/status'
import { keys, useMyApplications } from '../queries'

// Все заявки бизнеса: активная сверху, к любой можно вернуться.
export function ApplicationsPage() {
  const { token, me } = useSession()
  const business = me.businesses[0]
  const list = useMyApplications(business.id)
  const items = list.data?.items ?? []
  const details = useQueries({
    queries: items.map(i => ({ queryKey: keys.application(i.id), queryFn: () => request<Application>(`/api/v1/applications/${i.id}`, {}, token) })),
  })
  return <div className="page"><header><div><span className="eyebrow">{business.name}</span><h1>Мои заявки</h1><p>Статус каждой заявки обновляется сам. Новую можно оформить на главной.</p></div><Bell /></header>
    {list.isPending && <div className="loading-card"><Spinner label="Загружаем заявки…" /></div>}
    {list.error && <div className="error">{list.error.message}</div>}
    {list.data && items.length === 0 && <div className="empty"><b>Заявок пока нет</b><span>Рассчитайте предложение — заявка оформляется в один клик.</span><Link className="primary as-button" to="/">Рассчитать предложение</Link></div>}
    {items.length > 0 && <section className="queue">
      <div className="table-head"><span>Заявка</span><span>Сумма</span><span>Срок</span><span>Статус</span></div>
      {items.map((i, index) => {
        const a = details[index]?.data
        return <Link className="table-row" key={i.id} to={`/applications/${i.id}`}>
          <span><b>{a ? productName(a.product) : '…'}{i.active ? ' · активная' : ''}</b><small>№ {i.id.slice(0, 8)}</small></span>
          <strong>{a ? rubles(a.amount_kopecks) : ''}</strong><em>{a ? `${a.term_months} мес.` : ''}</em><i>{statusName[i.status] ?? i.status}</i></Link>
      })}</section>}
  </div>
}
