import { FormEvent, useEffect, useState } from 'react'
import { Application, BankItem, Me, MyApplications, Offer, productName, request, rubles, scoreTone, toneTitle } from './api'
import { ReviewPanel, RiskQueue } from './bank/ReviewPanel'
import { RulesAdmin } from './bank/RulesAdmin'
import { Assistant } from './client/Assistant'
import { ForecastCard } from './client/ForecastCard'
import { OfferPanel } from './client/OfferPanel'
import { Answers, Questionnaire } from './client/Questionnaire'
import { Sandbox } from './client/Sandbox'
import { AuditPage } from './bank/AuditPage'
import { Bell } from './common/Bell'
import { DocumentsPage, RequestedDocuments } from './common/Documents'
import { Chat } from './common/Chat'
import { Processing, Spinner } from './common/Spinner'

const accountGroups = [
  { key: 'client', title: 'Клиенты Альфа-Банка', note: 'Есть расчётный счёт — данные о бизнесе уже в банке', accounts: [
    { login: 'p3b', title: 'Иванов Артём', note: 'Кофейня · главный сценарий', badge: 'Клиент' },
    { login: 'p3a', title: 'ООО «СтройБаза»', note: 'Рефинансирование 5,5 млн · сезонность', badge: 'Клиент' },
    { login: 'p1b', title: 'Клиент с долгом', note: 'Контрпредложение: рефинансирование', badge: 'Клиент' },
    { login: 'p2b', title: 'Были просрочки', note: 'Ручная проверка и запрос документов', badge: 'Клиент' },
    { login: 'p_stop', title: 'Просрочка в БКИ', note: 'Отказ со стоп-фактором', badge: 'Клиент' },
    { login: 'p3a_acc', title: 'Зайцева Марина', note: 'Бухгалтер ООО «СтройБаза» по МЧД', badge: 'По МЧД' },
  ] },
  { key: 'guest', title: 'Ещё не клиент', note: 'Нет счёта в Альфе', accounts: [
    { login: 'guest', title: 'Новый предприниматель', note: 'Как получить кредит без счёта в Альфе', badge: 'Не клиент' },
  ] },
  { key: 'bank', title: 'Сотрудники банка', note: 'Кабинет банка', accounts: [
    { login: 'uw1', title: 'Смирнова Е.', note: 'Андеррайтер · очередь ручной проверки', badge: 'Андеррайтер' },
    { login: 'uw2', title: 'Петров К.', note: 'Второй андеррайтер', badge: 'Андеррайтер' },
    { login: 'risk1', title: 'Волков А.', note: 'Решения свыше 5 млн ₽', badge: 'Риск' },
    { login: 'admin1', title: 'Ким Д.', note: 'Правила решения', badge: 'Правила' },
  ] },
]
const statusName: Record<string, string> = {
  DRAFT: 'Черновик', AWAITING_SIGNATURE: 'Ждёт подписи', SUBMITTED: 'Отправлена', VALIDATION: 'Проверяем',
  ENRICHMENT: 'Собираем данные', SCORING: 'Рассчитываем', MANUAL_REVIEW: 'Проверяет специалист',
  APPROVED: 'Одобрено', REJECTED: 'Отказ', COUNTER_OFFER: 'Предложение банка', INFO_REQUESTED: 'Нужны документы', CANCELLED: 'Отменена', EXPIRED: 'Срок предложения истёк', CONTRACT_SIGNED: 'Договор подписан', ISSUED: 'Деньги выданы',
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('token') ?? '')
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState('')
  const [section, setSection] = useState('main')
  useEffect(() => { if (token) request<Me>('/api/v1/me', {}, token).then(setMe).catch(() => logout()) }, [token])
  const logout = () => { sessionStorage.clear(); setToken(''); setMe(null); setSection('main') }
  if (!token || !me) return <Login onLogin={(value) => { sessionStorage.setItem('token', value); setToken(value) }} error={error} setError={setError} />
  const bank = me.role !== 'CLIENT'
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">A</span><span>Альфа-Бизнес</span></div>
      <nav>
        {(bank ? [['main', '⌂', me.role === 'RULES_ADMIN' ? 'Правила' : 'Очередь заявок'], ['audit', '◎', 'Журнал аудита']]
          : [['main', '⌂', 'Кредиты'], ['documents', '◫', 'Документы']]).map(([key, icon, label]) =>
          <button key={key} className={`nav-item ${section === key ? 'active' : ''}`} onClick={() => setSection(key)}><span>{icon}</span>{label}</button>)}
      </nav>
      <div className="profile"><div className="avatar">{me.full_name[0]}</div><div><b>{me.full_name}</b><small>{me.role}</small></div><button onClick={logout}>↗</button></div>
    </aside>
    {!bank && <Assistant token={token} onNavigate={() => { setSection('main'); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />}
    <main>{section === 'audit' && bank ? <AuditPage token={token} /> : section === 'documents' && !bank ? <DocumentsPage token={token} businessId={me.businesses[0].id} canUpload={me.businesses[0].permissions.includes('FILL')} /> : me.role === 'RULES_ADMIN' ? <RulesAdmin token={token} /> : bank ? <BankDashboard token={token} me={me} /> : <ClientDashboard token={token} me={me} />}</main>
  </div>
}

function Login({ onLogin, error, setError }: { onLogin: (token: string) => void; error: string; setError: (v: string) => void }) {
  const [group, setGroup] = useState('client')
  const [selected, setSelected] = useState('p3b')
  const [busy, setBusy] = useState(false)
  const [guest, setGuest] = useState(false)
  const [sandbox, setSandbox] = useState(false)
  const current = accountGroups.find(g => g.key === group)!
  const pickGroup = (key: string) => { setGroup(key); setSelected(accountGroups.find(g => g.key === key)!.accounts[0].login); setError('') }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (selected === 'guest') { setGuest(true); return }
    setBusy(true); setError('')
    try { const data = await request<{ access_token: string }>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ login: selected, password: 'demo' }) }); onLogin(data.access_token) }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  if (guest) return <NonClient onBack={() => setGuest(false)} />
  if (sandbox) return <Sandbox onLogin={onLogin} onBack={() => setSandbox(false)} />
  return <div className="login-page"><section className="login-copy"><div className="brand large"><span className="brand-mark">A</span><span>Альфа-Бизнес</span></div><div><span className="eyebrow">Умный кредитный кабинет</span><h1>Финансирование,<br/>которое объясняет себя</h1><p>Персональное предложение за несколько минут. Без повторного ввода данных и визита в офис.</p></div><div className="trust"><span>✓ Решение на ваших данных</span><span>✓ Условия зафиксированы на 30 дней</span></div></section>
    <section className="login-panel"><form onSubmit={submit}><span className="eyebrow">Демонстрационный вход</span><h2>Кто вы?</h2>
      <div className="segmented">{accountGroups.map(g => <button type="button" key={g.key} className={group === g.key ? 'active' : ''} onClick={() => pickGroup(g.key)}>{g.title}</button>)}</div>
      <p className="muted">{current.note}</p>
      <div className="account-grid">{current.accounts.map(a => <button type="button" key={a.login} className={`account ${selected === a.login ? 'selected' : ''}`} onClick={() => setSelected(a.login)}><span className="avatar">{a.title[0]}</span><span><b>{a.title}</b><small>{a.note}</small></span><em>{a.badge}</em></button>)}</div>
      {group === 'client' && <button type="button" className="sandbox-link" onClick={() => setSandbox(true)}><b>+ Создать своего клиента</b><small>Песочница проверяющего: задайте обороты, кредиты и историю — решение посчитает наша модель</small></button>}
      {error && <div className="error">{error}</div>}<button className="primary wide" disabled={busy}>{busy ? <Spinner label="Входим…" light /> : 'Продолжить'}</button><small className="security">Защищённое соединение · Только синтетические данные</small></form></section></div>
}

// Не клиент Альфы: кредит в кабинете доступен только со счётом — показываем путь, а не анкету.
function NonClient({ onBack }: { onBack: () => void }) {
  const steps = [
    ['Откройте расчётный счёт', 'Онлайн за один день: для ИП — по паспорту, для ООО — по документам компании. Обслуживание можно выбрать бесплатное.'],
    ['Проводите обороты через счёт', 'Эквайринг, оплаты от покупателей, платежи поставщикам. Чем больше оборотов в Альфе, тем выше лимит и ниже ставка.'],
    ['Через 3 месяца — предложение', 'Кабинет сам рассчитает кредит по вашим оборотам и покажет, почему сумма такая и как получить больше.'],
    ['Нужно раньше?', 'Загрузите выписку из другого банка в формате 1С после открытия счёта — она тоже учитывается в расчёте.'],
  ]
  return <div className="login-page"><section className="login-copy"><div className="brand large"><span className="brand-mark">A</span><span>Альфа-Бизнес</span></div><div><span className="eyebrow">Ещё не клиент</span><h1>Сначала счёт —<br/>потом кредит</h1><p>Кредитный кабинет считает предложение по реальным оборотам бизнеса. Без счёта в Альфе нам не на что опереться, поэтому начинаем с него.</p></div><div className="trust"><span>✓ Без анкеты о выручке</span><span>✓ Без визита в офис</span></div></section>
    <section className="login-panel"><div className="nonclient"><span className="eyebrow">Ваш путь к кредиту</span><h2>Четыре шага</h2>
      <ol>{steps.map(([t, d]) => <li key={t}><b>{t}</b><small>{d}</small></li>)}</ol>
      <a className="primary wide as-button" href="https://alfabank.ru/sme/" target="_blank" rel="noreferrer">Открыть счёт на сайте банка</a>
      <button className="secondary wide" onClick={onBack}>Назад к выбору профиля</button></div></section></div>
}

function ClientDashboard({ token, me }: { token: string; me: Me }) {
  const business = me.businesses[0]
  const [offer, setOffer] = useState<Offer | null>(null)
  const [answers, setAnswers] = useState<Answers | null>(null)
  const [application, setApplication] = useState<Application | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [stage, setStage] = useState('')
  const call = async (fn: () => Promise<void>) => { setBusy(true); setMessage(''); try { await fn() } catch (e) { setMessage((e as Error).message) } finally { setBusy(false); setStage('') } }
  const run = (label: string, fn: () => Promise<void>) => { setStage(label); return call(fn) }
  const calculate = (a: Answers) => run('Считаем предложение по вашим оборотам…', async () => {
    setAnswers(a); setApplication(null); setOffer(null)
    if (business.permissions.includes('CONSENT')) {
      await request(`/api/v1/businesses/${business.id}/consents`, { method: 'POST', body: JSON.stringify({ kinds: ['BKI', 'FNS'] }) }, token)
    }
    const { amount, ...rest } = a
    setOffer(await request(`/api/v1/businesses/${business.id}/pre-offers`, { method: 'POST', body: JSON.stringify({ ...rest, amount_kopecks: amount * 100 }) }, token))
  })
  const create = () => run('Создаём заявку…', async () => setApplication(await request('/api/v1/applications', { method: 'POST', body: JSON.stringify({ pre_offer_id: offer!.id }) }, token)))
  const submit = () => run('Отправляем заявку в банк…', async () => setApplication(await request(`/api/v1/applications/${application!.id}/submit`, { method: 'POST', headers: { 'Idempotency-Key': application!.id } }, token)))
  const sign = (code: string) => run('Подписываем договор…', async () => setApplication(await request(`/api/v1/applications/${application!.id}/sign`, { method: 'POST', body: JSON.stringify({ code }) }, token)))
  const refresh = () => request<Application>(`/api/v1/applications/${application!.id}`, {}, token).then(setApplication).catch(() => undefined)
  useEffect(() => {
    if (!application || ['DRAFT', 'ISSUED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'INFO_REQUESTED', 'COUNTER_OFFER'].includes(application.status)) return
    const t = setInterval(refresh, 5000); return () => clearInterval(t)
  }, [application?.id, application?.status])
  // После повторного входа показываем последнюю заявку бизнеса — со статусом и решением.
  useEffect(() => {
    request<MyApplications>(`/api/v1/applications?business_id=${business.id}`, {}, token)
      .then(d => { const id = d.active_id ?? d.items[0]?.id; if (id) return request<Application>(`/api/v1/applications/${id}`, {}, token).then(setApplication) })
      .catch(() => undefined)
  }, [business.id])
  const overdraft = offer?.product === 'OVERDRAFT' ? offer.limit_kopecks : undefined
  return <div className="page"><header><div><span className="eyebrow">{business.name}</span><h1>Добрый день, {me.full_name.split(' ')[1] ?? me.full_name}</h1><p>Подберём финансирование по оборотам вашего бизнеса — без справок и визита в офис.</p></div><Bell token={token} /></header>
    <section className="hero-card"><Questionnaire onSubmit={calculate} busy={busy} /><ForecastCard token={token} businessId={business.id} overdraftKopecks={overdraft} /></section>
    {message && <div className="error">{message}</div>}
    {busy && stage && <div className="loading-card"><Spinner label={stage} /></div>}
    {offer && <OfferPanel token={token} offer={offer} onOffer={o => { setOffer(o); setApplication(null) }} onContinue={create}
      onRefinance={answers ? (amount: number, term: number) => calculate({ ...answers, purpose: 'refinance', frequency: 'once', term_months: term, amount }) : undefined}
      canContinue={!application && business.permissions.includes('FILL')} repayment={answers?.repayment ?? 'equal'} />}
    {application && <ApplicationTracker token={token} businessId={business.id} application={application} canSubmit={business.permissions.includes('SUBMIT')}
      onSubmit={submit} onSign={sign} onRefresh={refresh} busy={busy} />}
  </div>
}

function ApplicationTracker({ token, businessId, application, canSubmit, onSubmit, onSign, onRefresh, busy }: {
  token: string; businessId: string; application: Application; canSubmit: boolean; onSubmit: () => void; onSign: (code: string) => void; onRefresh: () => void; busy: boolean
}) {
  const [code, setCode] = useState('')
  const timeline = application.timeline ?? []
  return <section className="tracker"><div className="tracker-grid"><div>
    <div className="section-title"><div><span className="eyebrow">Заявка {application.id.slice(0, 8)}</span><h2>{statusName[application.status] ?? application.status}</h2></div><button className="secondary" onClick={onRefresh}>Обновить</button></div>
    {['MANUAL_REVIEW', 'INFO_REQUESTED', 'COUNTER_OFFER'].includes(application.status) && <div className="assignee">
      <span className="avatar">{(application.assignee_name ?? '…').replace('Андеррайтер ', '')[0]}</span>
      <div><small>{application.assignee_name ? 'Заявку ведёт специалист' : 'Заявка ждёт специалиста'}</small><b>{application.assignee_name?.replace('Андеррайтер ', '') ?? 'Назначим в течение рабочего дня'}</b></div>
      <button className="secondary" onClick={() => { const el = document.getElementById(`chat-${application.id}`) as HTMLInputElement | null; el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus() }}>Написать специалисту</button>
    </div>}
    <div className="timeline">{(timeline.length ? timeline : [{ to_status: application.status, comment: 'Заявка создана', at: '' }]).map((item, index) => <div className="timeline-row" key={`${item.to_status}-${index}`}><span className="timeline-dot">✓</span><div><b>{statusName[item.to_status] ?? item.to_status}</b><small>{item.comment}</small></div></div>)}</div>
    {application.decision && <div className="decision"><span>{application.status === 'INFO_REQUESTED' ? 'Комментарий специалиста' : 'Решение банка'}</span><b>{application.decision.explanation}</b>
      {application.decision.limit_kopecks > 0 && application.status !== 'INFO_REQUESTED' && <small>{rubles(application.decision.limit_kopecks)}{application.decision.rate ? ` · ${application.decision.rate}%` : ''}</small>}</div>}
    {application.status === 'DRAFT' && (canSubmit
      ? <button className="primary" disabled={busy} onClick={onSubmit}>{busy ? <Spinner label="Отправляем…" light /> : 'Отправить заявку'}</button>
      : <p className="hint">Заявка подготовлена. Отправить её может руководитель.</p>)}
    {application.status === 'COUNTER_OFFER' && <CounterOffer token={token} applicationId={application.id} canDecide={canSubmit} onDone={onRefresh} />}
    {canSubmit && ['DRAFT', 'AWAITING_SIGNATURE', 'SUBMITTED', 'INFO_REQUESTED'].includes(application.status) && <button className="link dark" onClick={() => request(`/api/v1/applications/${application.id}/cancel`, { method: 'POST', body: '{}' }, token).then(onRefresh)}>Отменить заявку</button>}
    {application.status === 'INFO_REQUESTED' && <RequestedDocuments token={token} applicationId={application.id} businessId={businessId} onDone={onRefresh} />}
    {application.status === 'APPROVED' && <div className="sign"><input value={code} maxLength={6} onChange={e => setCode(e.target.value)} placeholder="Код из SMS (демо: 0000)" />
      <button className="primary" disabled={busy || code.length < 4} onClick={() => onSign(code)}>{busy ? <Spinner label="Подписываем…" light /> : 'Подписать договор'}</button></div>}
    {['SUBMITTED', 'VALIDATION', 'ENRICHMENT', 'SCORING', 'CONTRACT_SIGNED'].includes(application.status) && <Processing status={application.status} />}
  </div>
  {application.status !== 'DRAFT' && <Chat token={token} applicationId={application.id} side="CLIENT" />}</div></section>
}

function CounterOffer({ token, applicationId, canDecide, onDone }: { token: string; applicationId: string; canDecide: boolean; onDone: () => void }) {
  const [terms, setTerms] = useState<{ product: string; amount_kopecks: number; term_months: number; rate: number | null } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { request<typeof terms>(`/api/v1/applications/${applicationId}/counter-offer`, {}, token).then(setTerms).catch(e => setError(e.message)) }, [applicationId])
  const act = (what: string) => request(`/api/v1/applications/${applicationId}/counter-offer/${what}`, { method: 'POST', body: '{}' }, token).then(onDone).catch(e => setError(e.message))
  return <div className="callout requested"><b>Банк предлагает другие условия</b>
    {terms && <p>{productName(terms.product)} на {rubles(terms.amount_kopecks)} · {terms.term_months} мес.{terms.rate ? ` · ${terms.rate}%` : ''}</p>}
    {canDecide ? <div className="chips"><button className="primary" onClick={() => act('accept')}>Принять</button><button className="secondary" onClick={() => act('decline')}>Отказаться</button></div>
      : <p className="muted">Решение принимает руководитель.</p>}
    {error && <div className="error">{error}</div>}</div>
}

function BankDashboard({ token, me }: { token: string; me: Me }) {
  const [items, setItems] = useState<BankItem[]>([])
  const [selected, setSelected] = useState<BankItem | null>(null)
  const [filter, setFilter] = useState('')
  const [message, setMessage] = useState('')
  const query = filter === 'mine' ? '?mine=true' : filter ? `?status=${filter}` : ''
  const load = () => request<{ items: BankItem[] }>(`/api/v1/bank/applications${query}`, {}, token)
    .then(d => { setItems(d.items); setSelected(s => (s ? d.items.find(i => i.id === s.id) ?? null : null)) }).catch(e => setMessage(e.message))
  useEffect(() => { void load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [filter])
  const changed = (msg: string) => { setMessage(msg); void load() }
  return <div className="page bank-page"><header><div><span className="eyebrow">Кабинет банка</span><h1>{me.role === 'RISK_MANAGER' ? 'Согласования риска' : 'Очередь заявок'}</h1><p>Решения, которым требуется внимание специалиста. Просроченные вопросы клиентов — наверху.</p></div><div className="header-actions"><div className="metric"><b>{items.filter(i => i.status === 'MANUAL_REVIEW').length}</b><span>на проверке</span></div><Bell token={token} /></div></header>
    {message && <div className="notice">{message}</div>}
    {me.role === 'RISK_MANAGER' && <RiskQueue token={token} onChanged={changed} />}
    <div className="bank-layout"><section className="queue"><div className="filters">{[['', 'Все'], ...(me.role === 'UNDERWRITER' ? [['mine', 'Мои заявки']] : []), ['MANUAL_REVIEW', 'Ручная проверка'], ['APPROVED', 'Одобренные'], ['ISSUED', 'Выданные']].map(([c, l]) =>
      <button key={c} className={`chip ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>{l}</button>)}</div>
      <div className="table-head"><span>Клиент</span><span>Сумма</span><span>Балл</span><span>Статус</span></div>
      {items.length === 0 && <div className="empty"><b>Очередь пуста</b><span>Заявки появятся после отправки клиентом.</span></div>}
      {items.map(item => <button className={`table-row ${selected?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setSelected(item)}>
        <span><b>{item.business_name}</b><small>ИНН {item.inn}{item.assignee_name ? ` · ведёт ${item.assignee_name.replace('Андеррайтер ', '')}` : ''}{item.question_overdue ? ' · ⚠ вопрос без ответа' : item.open_question_due_at ? ' · вопрос в чате' : ''}</small></span>
        <strong>{rubles(item.amount_kopecks)}</strong><em className={`score-pill ${scoreTone(item.decision_class, item.status)}`} title={toneTitle[scoreTone(item.decision_class, item.status)]}>{item.score ?? '—'}</em><i>{statusName[item.status] ?? item.status}</i></button>)}</section>
      {selected ? <ReviewPanel token={token} me={me} item={selected} onChanged={changed} /> : <aside className="review-card"><div className="empty"><b>Выберите заявку</b><span>Здесь появятся факторы расчёта, действия и чат.</span></div></aside>}</div></div>
}
