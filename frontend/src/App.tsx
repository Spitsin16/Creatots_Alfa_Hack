import { FormEvent, useEffect, useState } from 'react'
import { Application, BankItem, Me, Offer, productName, request, rubles } from './api'

const accounts = [
  { login: 'p3b', title: 'Иванов Артём', note: 'Кофейня · главный сценарий', badge: 'Клиент' },
  { login: 'p3a_acc', title: 'Зайцева Марина', note: 'Бухгалтер по МЧД', badge: 'Сотрудник' },
  { login: 'uw1', title: 'Смирнова Е.', note: 'Очередь ручной проверки', badge: 'Андеррайтер' },
  { login: 'risk1', title: 'Волков А.', note: 'Решения свыше 5 млн ₽', badge: 'Риск' },
]
const statusName: Record<string, string> = {
  DRAFT: 'Черновик', AWAITING_SIGNATURE: 'Ждёт подписи', SUBMITTED: 'Отправлена', VALIDATION: 'Проверяем',
  ENRICHMENT: 'Собираем данные', SCORING: 'Рассчитываем', MANUAL_REVIEW: 'Проверяет специалист',
  APPROVED: 'Одобрено', REJECTED: 'Отказ', CONTRACT_SIGNED: 'Договор подписан', ISSUED: 'Деньги выданы',
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('token') ?? '')
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { if (token) request<Me>('/api/v1/me', {}, token).then(setMe).catch(() => logout()) }, [token])
  const logout = () => { sessionStorage.clear(); setToken(''); setMe(null) }
  if (!token || !me) return <Login onLogin={(value) => { sessionStorage.setItem('token', value); setToken(value) }} error={error} setError={setError} />
  const bank = me.role !== 'CLIENT'
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">A</span><span>Альфа-Бизнес</span></div>
      <nav>
        <button className="nav-item active"><span>⌂</span>{bank ? 'Очередь заявок' : 'Кредиты'}</button>
        <button className="nav-item"><span>◫</span>{bank ? 'Согласования' : 'Документы'}</button>
        <button className="nav-item"><span>◎</span>{bank ? 'Журнал аудита' : 'Поддержка'}</button>
      </nav>
      <div className="profile"><div className="avatar">{me.full_name[0]}</div><div><b>{me.full_name}</b><small>{me.role}</small></div><button onClick={logout}>↗</button></div>
    </aside>
    <main>{bank ? <BankDashboard token={token} me={me} /> : <ClientDashboard token={token} me={me} />}</main>
  </div>
}

function Login({ onLogin, error, setError }: { onLogin: (token: string) => void; error: string; setError: (v: string) => void }) {
  const [selected, setSelected] = useState('p3b')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try { const data = await request<{ access_token: string }>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ login: selected, password: 'demo' }) }); onLogin(data.access_token) }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="login-page"><section className="login-copy"><div className="brand large"><span className="brand-mark">A</span><span>Альфа-Бизнес</span></div><div><span className="eyebrow">Умный кредитный кабинет</span><h1>Финансирование,<br/>которое объясняет себя</h1><p>Персональное предложение за несколько минут. Без повторного ввода данных и визита в офис.</p></div><div className="trust"><span>✓ Решение на ваших данных</span><span>✓ Условия зафиксированы на 30 дней</span></div></section>
    <section className="login-panel"><form onSubmit={submit}><span className="eyebrow">Демонстрационный вход</span><h2>Выберите профиль</h2><p className="muted">Каждый профиль показывает отдельный путь кредитования.</p><div className="account-grid">{accounts.map(a => <button type="button" key={a.login} className={`account ${selected === a.login ? 'selected' : ''}`} onClick={() => setSelected(a.login)}><span className="avatar">{a.title[0]}</span><span><b>{a.title}</b><small>{a.note}</small></span><em>{a.badge}</em></button>)}</div>{error && <div className="error">{error}</div>}<button className="primary wide" disabled={busy}>{busy ? 'Входим…' : 'Продолжить'}</button><small className="security">Защищённое соединение · Только синтетические данные</small></form></section></div>
}

function ClientDashboard({ token, me }: { token: string; me: Me }) {
  const business = me.businesses[0]
  const [offer, setOffer] = useState<Offer | null>(null)
  const [application, setApplication] = useState<Application | null>(null)
  const [amount, setAmount] = useState(240000)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const call = async (fn: () => Promise<void>) => { setBusy(true); setMessage(''); try { await fn() } catch (e) { setMessage((e as Error).message) } finally { setBusy(false) } }
  const calculate = () => call(async () => {
    await request(`/api/v1/businesses/${business.id}/consents`, { method: 'POST', body: JSON.stringify({ kinds: ['BKI', 'FNS'] }) }, token)
    setOffer(await request(`/api/v1/businesses/${business.id}/pre-offers`, { method: 'POST', body: JSON.stringify({ purpose: 'cash_gap', amount_kopecks: amount * 100, term_months: 12, frequency: 'always', urgency: 'days' }) }, token))
  })
  const create = () => call(async () => setApplication(await request('/api/v1/applications', { method: 'POST', body: JSON.stringify({ pre_offer_id: offer!.id }) }, token)))
  const submit = () => call(async () => setApplication(await request(`/api/v1/applications/${application!.id}/submit`, { method: 'POST', headers: { 'Idempotency-Key': application!.id } }, token)))
  const refresh = () => call(async () => setApplication(await request(`/api/v1/applications/${application!.id}`, {}, token)))
  return <div className="page"><header><div><span className="eyebrow">{business.name}</span><h1>Добрый день, {me.full_name.split(' ')[1] ?? me.full_name}</h1><p>Подберём финансирование на основе оборотов вашего бизнеса.</p></div><button className="icon-button">●</button></header>
    <section className="hero-card"><div><span className="pill">Предложение на ваших данных</span><h2>Закройте кассовый разрыв<br/>без остановки бизнеса</h2><p>Мы уже знаем обороты и регулярные платежи. Осталось подтвердить сумму.</p><label>Нужная сумма <b>{new Intl.NumberFormat('ru-RU').format(amount)} ₽</b></label><input type="range" min="100000" max="500000" step="10000" value={amount} onChange={e => setAmount(Number(e.target.value))}/><button className="primary" disabled={busy} onClick={calculate}>Рассчитать предложение</button></div><div className="forecast"><span>Прогноз на 30 дней</span><strong>12 ноября</strong><p>возможен кассовый разрыв</p><b>≈ 211 000 ₽</b><div className="spark"><i/><i/><i/><i/><i/></div></div></section>
    {message && <div className="error">{message}</div>}
    {offer && <section className="offer-card"><div><span className="eyebrow">Предварительно одобрено</span><h2>{productName(offer.product)}</h2><strong className="money">{rubles(offer.limit_kopecks)}</strong><p>до {offer.term_months} месяцев · ставка {offer.rate}% годовых</p></div><div className="offer-side"><h3>Как получить больше</h3>{offer.advice.map(a => <div className="advice" key={a.code}><span>↗</span><div><b>{a.text}</b><small>Лимит до {rubles(a.new_limit_kopecks)}</small></div></div>)}{!application && <button className="primary wide" onClick={create}>Продолжить</button>}</div></section>}
    {application && <ApplicationTracker application={application} onSubmit={submit} onRefresh={refresh} busy={busy} />}
  </div>
}

function ApplicationTracker({ application, onSubmit, onRefresh, busy }: { application: Application; onSubmit: () => void; onRefresh: () => void; busy: boolean }) {
  const timeline = application.timeline ?? []
  return <section className="tracker"><div className="section-title"><div><span className="eyebrow">Заявка {application.id.slice(0, 8)}</span><h2>{statusName[application.status] ?? application.status}</h2></div><button className="secondary" onClick={onRefresh}>Обновить</button></div><div className="timeline">{(timeline.length ? timeline : [{ to_status: application.status, comment: 'Заявка создана', at: '' }]).map((item, index) => <div className="timeline-row" key={`${item.to_status}-${index}`}><span className="timeline-dot">✓</span><div><b>{statusName[item.to_status] ?? item.to_status}</b><small>{item.comment}</small></div></div>)}</div>{application.decision && <div className="decision"><span>Решение банка</span><b>{application.decision.explanation}</b></div>}{application.status === 'DRAFT' && <button className="primary" disabled={busy} onClick={onSubmit}>Отправить заявку</button>}{application.status === 'SUBMITTED' && <p className="hint">Воркер обрабатывает заявку. Обновите статус через несколько секунд.</p>}</section>
}

function BankDashboard({ token, me }: { token: string; me: Me }) {
  const [items, setItems] = useState<BankItem[]>([])
  const [selected, setSelected] = useState<BankItem | null>(null)
  const [message, setMessage] = useState('')
  const load = () => request<{ items: BankItem[] }>('/api/v1/bank/applications', {}, token).then(d => setItems(d.items)).catch(e => setMessage(e.message))
  useEffect(() => { void load() }, [])
  const assign = async () => { if (!selected) return; try { await request(`/api/v1/bank/applications/${selected.id}/assign`, { method: 'POST' }, token); setMessage('Заявка назначена вам'); load() } catch (e) { setMessage((e as Error).message) } }
  return <div className="page bank-page"><header><div><span className="eyebrow">Кабинет банка</span><h1>{me.role === 'RISK_MANAGER' ? 'Согласования риска' : 'Очередь заявок'}</h1><p>Решения, которым требуется внимание специалиста.</p></div><div className="metric"><b>{items.filter(i => i.status === 'MANUAL_REVIEW').length}</b><span>на проверке</span></div></header>{message && <div className="notice">{message}</div>}<div className="bank-layout"><section className="queue"><div className="filters"><button className="chip active">Все</button><button className="chip">Ручная проверка</button><button className="chip">Мои</button></div><div className="table-head"><span>Клиент</span><span>Сумма</span><span>Класс</span><span>Статус</span></div>{items.length === 0 && <div className="empty"><b>Очередь пуста</b><span>Заявки появятся после обработки клиентского сценария.</span></div>}{items.map(item => <button className={`table-row ${selected?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setSelected(item)}><span><b>{item.business_name}</b><small>ИНН {item.inn}</small></span><strong>{rubles(item.amount_kopecks)}</strong><em>{item.decision_class ?? '—'}</em><i>{statusName[item.status] ?? item.status}</i></button>)}</section><aside className="review-card">{selected ? <><span className="eyebrow">Заявка {selected.id.slice(0, 8)}</span><h2>{selected.business_name}</h2><div className="score"><span>Класс риска</span><b>{selected.decision_class}</b><small>{selected.score} баллов</small></div><dl><div><dt>Продукт</dt><dd>{productName(selected.product)}</dd></div><div><dt>Сумма</dt><dd>{rubles(selected.amount_kopecks)}</dd></div><div><dt>Сегмент</dt><dd>{selected.segment_code}</dd></div></dl>{selected.status === 'MANUAL_REVIEW' && <button className="primary wide" onClick={assign}>{selected.assignee_id ? 'Открыть решение' : 'Взять в работу'}</button>}</> : <div className="empty"><b>Выберите заявку</b><span>Здесь появятся детали расчёта и действия.</span></div>}</aside></div></div>
}
