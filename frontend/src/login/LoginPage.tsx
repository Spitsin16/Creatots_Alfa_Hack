import { FormEvent, ReactNode, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { request } from '../api'
import { useAuth } from '../auth'
import { Sandbox } from '../client/Sandbox'
import { Spinner } from '../common/Spinner'

export const accountGroups = [
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

// Вход по демо-логину: пароль у всех тестовых пользователей один.
export async function demoLogin(login: string) {
  const data = await request<{ access_token: string }>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ login, password: 'demo' }) })
  return data.access_token
}

function LoginFrame({ eyebrow, title, text, trust, children }: { eyebrow: string; title: ReactNode; text: string; trust: string[]; children: ReactNode }) {
  return <div className="login-page"><section className="login-copy"><div className="brand large"><span className="brand-mark">A</span><span>Альфа-Бизнес</span></div>
    <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>
    <div className="trust">{trust.map(t => <span key={t}>✓ {t}</span>)}</div></section>
    <section className="login-panel">{children}</section></div>
}

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [group, setGroup] = useState('client')
  const [selected, setSelected] = useState('p3b')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = accountGroups.find(g => g.key === group)!
  const pickGroup = (key: string) => { setGroup(key); setSelected(accountGroups.find(g => g.key === key)!.accounts[0].login); setError('') }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (selected === 'guest') { navigate('/login/guest'); return }
    setBusy(true); setError('')
    try { login(await demoLogin(selected)); navigate(params.get('next') ?? '/', { replace: true }) }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <LoginFrame eyebrow="Умный кредитный кабинет" title={<>Финансирование,<br/>которое объясняет себя</>}
    text="Персональное предложение за несколько минут. Без повторного ввода данных и визита в офис."
    trust={['Решение на ваших данных', 'Условия зафиксированы на 30 дней']}>
    <form onSubmit={submit}><span className="eyebrow">Демонстрационный вход</span><h2>Кто вы?</h2>
      <div className="segmented">{accountGroups.map(g => <button type="button" key={g.key} className={group === g.key ? 'active' : ''} onClick={() => pickGroup(g.key)}>{g.title}</button>)}</div>
      <p className="muted">{current.note}</p>
      <div className="account-grid">{current.accounts.map(a => <button type="button" key={a.login} className={`account ${selected === a.login ? 'selected' : ''}`} onClick={() => setSelected(a.login)}><span className="avatar">{a.title[0]}</span><span><b>{a.title}</b><small>{a.note}</small></span><em>{a.badge}</em></button>)}</div>
      {group === 'client' && <Link className="sandbox-link" to="/login/sandbox"><b>+ Создать своего клиента</b><small>Песочница проверяющего: задайте обороты, кредиты и историю — решение посчитает наша модель</small></Link>}
      {error && <div className="error">{error}</div>}<button className="primary wide" disabled={busy}>{busy ? <Spinner label="Входим…" light /> : 'Продолжить'}</button><small className="security">Защищённое соединение · Только синтетические данные</small></form>
  </LoginFrame>
}

// Не клиент Альфы: кредит в кабинете доступен только со счётом — показываем путь, а не анкету.
export function NonClientPage() {
  const steps = [
    ['Откройте расчётный счёт', 'Онлайн за один день: для ИП — по паспорту, для ООО — по документам компании. Обслуживание можно выбрать бесплатное.'],
    ['Проводите обороты через счёт', 'Эквайринг, оплаты от покупателей, платежи поставщикам. Чем больше оборотов в Альфе, тем выше лимит и ниже ставка.'],
    ['Через 3 месяца — предложение', 'Кабинет сам рассчитает кредит по вашим оборотам и покажет, почему сумма такая и как получить больше.'],
    ['Нужно раньше?', 'Загрузите выписку из другого банка в формате 1С после открытия счёта — она тоже учитывается в расчёте.'],
  ]
  return <LoginFrame eyebrow="Ещё не клиент" title={<>Сначала счёт —<br/>потом кредит</>}
    text="Кредитный кабинет считает предложение по реальным оборотам бизнеса. Без счёта в Альфе нам не на что опереться, поэтому начинаем с него."
    trust={['Без анкеты о выручке', 'Без визита в офис']}>
    <div className="nonclient"><span className="eyebrow">Ваш путь к кредиту</span><h2>Четыре шага</h2>
      <ol>{steps.map(([t, d]) => <li key={t}><b>{t}</b><small>{d}</small></li>)}</ol>
      <a className="primary wide as-button" href="https://alfabank.ru/sme/" target="_blank" rel="noreferrer">Открыть счёт на сайте банка</a>
      <Link className="secondary wide as-button" to="/login">Назад к выбору профиля</Link></div>
  </LoginFrame>
}

export function SandboxPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  return <Sandbox onLogin={token => { login(token); navigate('/', { replace: true }) }} onBack={() => navigate('/login')} />
}
