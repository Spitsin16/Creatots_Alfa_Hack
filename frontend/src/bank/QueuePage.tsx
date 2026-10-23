import { Link, useSearchParams } from 'react-router'
import { productName, rubles, scoreTone, toneTitle } from '../api'
import { useSession } from '../auth'
import { Bell } from '../common/Bell'
import { Spinner } from '../common/Spinner'
import { statusName } from '../common/status'
import { useBankQueue } from '../queries'

const PAGE_SIZE = 20
const statusFilters = [['', 'Все'], ['MANUAL_REVIEW', 'Ручная проверка'], ['INFO_REQUESTED', 'Ждём документы'], ['APPROVED', 'Одобренные'], ['ISSUED', 'Выданные'], ['REJECTED', 'Отказы']]
const productFilters = [['', 'Все продукты'], ['OVERDRAFT', 'Овердрафт'], ['WORKING_CAPITAL', 'Оборотный кредит'], ['CREDIT_LINE', 'Кредитная линия'], ['REFINANCE', 'Рефинансирование']]

// Очередь банка: фильтры и номер страницы живут в адресе — их видно в ссылке и они переживают «назад».
export function QueuePage() {
  const { me } = useSession()
  const [params, setParams] = useSearchParams()
  const filter = { status: params.get('status') ?? '', product: params.get('product') ?? '', mine: params.get('mine') === '1', page: Number(params.get('page') ?? 1) }
  const queue = useBankQueue(filter, PAGE_SIZE)
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    if (!('page' in patch)) next.delete('page')
    setParams(next)
  }
  const data = queue.data
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  return <div className="page bank-page"><header><div><span className="eyebrow">Кабинет банка</span><h1>Очередь заявок</h1><p>Решения, которым требуется внимание специалиста. Просроченные вопросы клиентов — наверху.</p></div>
    <div className="header-actions"><div className="metric"><b>{data?.total ?? '…'}</b><span>заявок</span></div><Bell /></div></header>
    <section className="queue">
      <div className="filters">
        {statusFilters.map(([c, l]) => <button key={c} className={`chip ${!filter.mine && filter.status === c ? 'active' : ''}`} onClick={() => set({ status: c, mine: '' })}>{l}</button>)}
        {me.role === 'UNDERWRITER' && <button className={`chip ${filter.mine ? 'active' : ''}`} onClick={() => set({ mine: filter.mine ? '' : '1', status: '' })}>Мои заявки</button>}
        <select value={filter.product} onChange={e => set({ product: e.target.value })}>{productFilters.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>
      </div>
      <div className="table-head"><span>Клиент</span><span>Сумма</span><span>Балл</span><span>Статус</span></div>
      {queue.isPending && <div className="empty"><Spinner label="Загружаем очередь…" /></div>}
      {queue.error && <div className="error">{queue.error.message}</div>}
      {data?.items.length === 0 && <div className="empty"><b>Заявок нет</b><span>Под этот фильтр ничего не попало.</span></div>}
      {data?.items.map(item => <Link className="table-row" key={item.id} to={`/bank/applications/${item.id}`}>
        <span><b>{item.business_name}</b><small>{productName(item.product)} · ИНН {item.inn}{item.assignee_name ? ` · ведёт ${item.assignee_name.replace('Андеррайтер ', '')}` : ''}{item.question_overdue ? ' · ⚠ вопрос без ответа' : item.open_question_due_at ? ' · вопрос в чате' : ''}</small></span>
        <strong>{rubles(item.amount_kopecks)}</strong><em className={`score-pill ${scoreTone(item.decision_class, item.status)}`} title={toneTitle[scoreTone(item.decision_class, item.status)]}>{item.score ?? '—'}</em><i>{statusName[item.status] ?? item.status}</i></Link>)}
      {data && pages > 1 && <div className="pager">
        <button className="secondary" disabled={filter.page <= 1} onClick={() => set({ page: String(filter.page - 1) })}>‹ Назад</button>
        <span>Страница {filter.page} из {pages}</span>
        <button className="secondary" disabled={filter.page >= pages} onClick={() => set({ page: String(filter.page + 1) })}>Дальше ›</button>
      </div>}
    </section></div>
}
