import { useState } from 'react'
import { request, rubles, scoreTone, toneTitle } from '../api'
import { Spinner } from '../common/Spinner'
import { rememberSandboxClient } from '../common/demoSession'

type Params = {
  type: string; industry: string; age_months: number; revenue: number; seasonality: string; alfa_share: number
  alfa_credit: string; external_balance: number; external_payment: number; credit_history: string
  current_overdue_days: number; tax_debt: number; real_estate_value: number
}
type Created = {
  login: string; access_token: string; business: { name: string; inn: string }; transactions: number
  preview: { score: number; cls: string; product: string; outcome: string; limit: number | null; rate: number | null; reason: string | null; stop_factors: string[] }
}

const defaults: Params = {
  type: 'IP', industry: 'medium', age_months: 36, revenue: 1_000_000, seasonality: 'none', alfa_share: 1,
  alfa_credit: 'none', external_balance: 0, external_payment: 0, credit_history: 'clean',
  current_overdue_days: 0, tax_debt: 0, real_estate_value: 0,
}
const outcomeTitle: Record<string, string> = { APPROVED: 'Одобрение', COUNTER_OFFER: 'Контрпредложение', MANUAL_REVIEW: 'Ручная проверка', REJECTED: 'Отказ' }
const productTitle: Record<string, string> = { OVERDRAFT: 'Овердрафт', WORKING_CAPITAL: 'Оборотный кредит', CREDIT_LINE: 'Кредитная линия', REFINANCE: 'Рефинансирование' }
const reasonTitle: Record<string, string> = {
  BUSINESS_TOO_YOUNG: 'бизнесу меньше 3 месяцев', CURRENT_OVERDUE: 'текущая просрочка 30+ дней', CLASS_E: 'низкий балл',
  CLASS_D: 'пограничный балл', AMOUNT_ABOVE_AUTO: 'сумма выше порога автоодобрения', NO_CAPACITY: 'не хватает платёжеспособности',
}
const fmt = (v: number) => new Intl.NumberFormat('ru-RU').format(v)

function Choice({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return <div className="chips">{options.map(([c, l]) => <button type="button" key={c} className={`chip ${value === c ? 'active' : ''}`} onClick={() => onChange(c)}>{l}</button>)}</div>
}

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return <label className="slider light">{label} <b>{format(value)}</b><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} /></label>
}

// Песочница проверяющего: вы играете роль банка и источников данных — задаёте, что знают
// Альфа, ФНС и БКИ. Клиент дальше проходит обычный путь, решение считает тот же движок.
export function Sandbox({ onLogin, onBack }: { onLogin: (token: string) => void; onBack: () => void }) {
  const [p, setP] = useState<Params>(defaults)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Created | null>(null)
  const set = (patch: Partial<Params>) => setP(prev => ({ ...prev, ...patch }))
  const hasExternal = p.external_balance > 0
  const createClient = async () => {
    setBusy(true); setError('')
    try {
      const c = await request<Created>('/api/v1/sandbox/clients', { method: 'POST', body: JSON.stringify(p) })
      rememberSandboxClient({ login: c.login, name: c.business.name, score: c.preview.score, outcome: c.preview.outcome, cls: c.preview.cls })
      setCreated(c)
    }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const steps = [
    <div key="b"><h3>Бизнес</h3>
      <Choice value={p.type} options={[['IP', 'ИП'], ['LLC', 'ООО']]} onChange={v => set({ type: v })} />
      <h3>Отрасль</h3>
      <Choice value={p.industry} options={[['low', 'Торговля — низкий риск'], ['medium', 'Услуги — средний'], ['high', 'Строительство — высокий']]} onChange={v => set({ industry: v })} />
      <Slider label="Сколько работает бизнес" value={p.age_months} min={1} max={120} step={1} format={v => `${v} мес.`} onChange={v => set({ age_months: v })} />
    </div>,
    <div key="a"><h3>Обороты — что видит Альфа</h3>
      <Slider label="Средняя выручка в месяц" value={p.revenue} min={100_000} max={20_000_000} step={50_000} format={v => `${fmt(v)} ₽`} onChange={v => set({ revenue: v })} />
      <h3>Сезонность</h3>
      <Choice value={p.seasonality} options={[['none', 'Ровная'], ['moderate', 'Умеренная'], ['strong', 'Сильная (сезонный бизнес)']]} onChange={v => set({ seasonality: v })} />
      <Slider label="Доля оборотов через Альфу" value={Math.round(p.alfa_share * 100)} min={20} max={100} step={5} format={v => `${v}%`} onChange={v => set({ alfa_share: v / 100 })} />
      <Slider label="Недвижимость для залога (0 — нет)" value={p.real_estate_value} min={0} max={50_000_000} step={500_000} format={v => (v ? `${fmt(v)} ₽` : 'нет')} onChange={v => set({ real_estate_value: v })} />
    </div>,
    <div key="c"><h3>Кредит в Альфе</h3>
      <Choice value={p.alfa_credit} options={[['none', 'Нет'], ['good', 'Есть, платит вовремя'], ['overdue', 'Есть, были просрочки']]} onChange={v => set({ alfa_credit: v })} />
      <h3>Кредит в другом банке — что видит БКИ</h3>
      <Slider label="Остаток долга" value={p.external_balance} min={0} max={20_000_000} step={100_000} format={v => (v ? `${fmt(v)} ₽` : 'нет')} onChange={v => set({ external_balance: v, external_payment: v ? Math.max(p.external_payment, Math.round(v / 24 / 1000) * 1000) : 0 })} />
      {hasExternal && <Slider label="Платёж в месяц" value={p.external_payment} min={10_000} max={2_000_000} step={10_000} format={v => `${fmt(v)} ₽`} onChange={v => set({ external_payment: v })} />}
      <h3>Кредитная история за 12 месяцев</h3>
      <Choice value={p.credit_history} options={[['clean', 'Без просрочек'], ['none', 'Нет истории'], ['past_lt30', 'Просрочка до 30 дн.'], ['past_gte30', 'Просрочка 30+ дн.']]} onChange={v => set({ credit_history: v })} />
      <Slider label="Текущая просрочка" value={p.current_overdue_days} min={0} max={90} step={1} format={v => (v ? `${v} дн.` : 'нет')} onChange={v => set({ current_overdue_days: v })} />
      <h3>Налоги — что видит ФНС</h3>
      <Slider label="Налоговый долг" value={p.tax_debt} min={0} max={1_000_000} step={10_000} format={v => (v ? `${fmt(v)} ₽` : 'нет')} onChange={v => set({ tax_debt: v })} />
    </div>,
  ]
  const titles = ['Бизнес', 'Обороты', 'Кредиты и налоги']

  return <div className="login-page"><section className="login-copy"><div className="brand large"><span className="brand-mark">A</span><span>Альфа-Бизнес</span></div>
    <div><span className="eyebrow">Песочница проверяющего</span><h1>Создайте<br/>своего клиента</h1>
      <p>Здесь вы играете роль банка и источников данных: задаёте, что Альфа, ФНС и БКИ знают о бизнесе. Сам клиент выручку и долги не вводит — анкета у него обычная. Решение считает тот же движок, что и для готовых профилей.</p></div>
    <div className="trust"><span>✓ Синтетические данные</span><span>✓ 12 месяцев оборотов генерируются по вашим параметрам</span></div></section>
    <section className="login-panel"><div className="sandbox">
      {!created ? <>
        <div className="segmented">{titles.map((t, i) => <button type="button" key={t} className={step === i ? 'active' : ''} onClick={() => setStep(i)}>{i + 1}. {t}</button>)}</div>
        {steps[step]}
        {error && <div className="error">{error}</div>}
        <div className="sandbox-actions">
          <button type="button" className="secondary" onClick={step === 0 ? onBack : () => setStep(step - 1)}>{step === 0 ? 'Назад' : '← Назад'}</button>
          {step < 2 ? <button type="button" className="primary" onClick={() => setStep(step + 1)}>Дальше →</button>
            : <button type="button" className="primary" disabled={busy} onClick={createClient}>{busy ? <Spinner label="Генерируем обороты…" light /> : 'Создать клиента'}</button>}
        </div>
      </> : <div className="sandbox-result">
        <span className="eyebrow">Клиент создан</span><h2>{created.business.name}</h2>
        <p className="muted">ИНН {created.business.inn} · логин <b>{created.login}</b> / demo · {created.transactions} операций по счёту</p>
        <div className={`score tone-${scoreTone(created.preview.cls, created.preview.outcome)}`}><span>Предварительный расчёт банка · {toneTitle[scoreTone(created.preview.cls, created.preview.outcome)]}</span>
          <b>{created.preview.score}</b><small>{outcomeTitle[created.preview.outcome] ?? created.preview.outcome}</small></div>
        <dl>
          <div><dt>Продукт</dt><dd>{productTitle[created.preview.product] ?? created.preview.product}</dd></div>
          <div><dt>Максимальный лимит</dt><dd>{created.preview.limit ? rubles(created.preview.limit * 100) : '—'}</dd></div>
          {created.preview.rate != null && <div><dt>Ставка</dt><dd>{created.preview.rate}%</dd></div>}
          {created.preview.reason && <div><dt>Причина</dt><dd>{reasonTitle[created.preview.reason] ?? created.preview.reason}</dd></div>}
        </dl>
        <p className="muted">Это видит банк. Клиент увидит предложение после анкеты — войдите под ним и пройдите путь до заявки.</p>
        <button className="primary wide" onClick={() => onLogin(created.access_token)}>Войти под этим клиентом</button>
        <button className="secondary wide" onClick={() => { setCreated(null); setStep(0) }}>Создать ещё одного</button>
      </div>}
    </div></section></div>
}
