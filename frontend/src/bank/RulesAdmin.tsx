import { useEffect, useState } from 'react'
import { request, rubles } from '../api'

type Rules = any
type Short = { cls: string | null; score: number | null; product: string; outcome: string; limit: number | null; rate: number | null }
type Row = { persona: string; title: string; before: Short; after: Short; changed: boolean }
type Listing = { active_version: number; active_rules: Rules; versions: { version: number; active: boolean; created_at: string }[] }

const factorTitle: Record<string, string> = {
  BUSINESS_AGE: 'Срок работы бизнеса, мес.', REVENUE_STABILITY: 'Стабильность выручки (коэф. вариации)',
  DEBT_LOAD: 'Долговая нагрузка (платежи / выручка)', CREDIT_HISTORY: 'Кредитная история (БКИ)',
  ALFA_HISTORY: 'История в Альфе', TAX_DEBT: 'Налоговый долг, ₽', INDUSTRY_RISK: 'Отраслевой риск',
  ALFA_SHARE: 'Доля оборотов в Альфе', DATA_QUALITY: 'Полнота данных',
}
const valueTitle: Record<string, string> = {
  CLEAN_12M: 'без просрочек 12 мес.', NO_HISTORY: 'нет истории', PAST_OVERDUE_LT_30: 'просрочка < 30 дн.',
  PAST_OVERDUE_GTE_30: 'просрочка ≥ 30 дн.', GOOD_BORROWER: 'хороший заёмщик', NOT_BORROWER: 'не заёмщик',
  HAD_OVERDUE: 'были просрочки', low: 'низкий', medium: 'средний', high: 'высокий', ALFA_12M: 'Альфа 12 мес.',
  ALFA_LT_12M: 'Альфа < 12 мес.', STATEMENT_12M: 'выписка 12 мес.', STATEMENT_6_11M: 'выписка 6–11 мес.', FNS_ONLY: 'только ФНС',
}
const routeTitle: Record<string, string> = { AUTO: 'автоматически', MANUAL_REVIEW: 'ручная проверка', REJECTED: 'отказ' }
const outcomeTitle: Record<string, string> = { APPROVED: 'одобрено', COUNTER_OFFER: 'контрпредложение', MANUAL_REVIEW: 'ручная проверка', REJECTED: 'отказ' }
const assetTitle: Record<string, string> = { real_estate: 'Недвижимость', vehicle: 'Транспорт', equipment: 'Оборудование' }

const bandLabel = (b: Record<string, number>) =>
  b.eq !== undefined ? `= ${b.eq}` : b.lt !== undefined ? `< ${b.lt}` : b.lte !== undefined ? `≤ ${b.lte}` : b.gt !== undefined ? `> ${b.gt}` : `≥ ${b.gte}`

function Num({ value, onChange, step = 1, suffix }: { value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return <span className="num"><input type="number" step={step} value={value} onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />{suffix && <em>{suffix}</em>}</span>
}

// Админ правил: форма вместо YAML. Изменение = новая версия; до включения — прогон «было/стало» на персонах.
export function RulesAdmin({ token }: { token: string }) {
  const [list, setList] = useState<Listing | null>(null)
  const [rules, setRules] = useState<Rules | null>(null)
  const [comment, setComment] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [tab, setTab] = useState('market')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const load = () => request<Listing>('/api/v1/bank/rules', {}, token).then(l => { setList(l); setRules((r: Rules) => r ?? structuredClone(l.active_rules)) })
  useEffect(() => { void load() }, [])

  // Изменить значение по пути и сбросить устаревший прогон.
  const set = (path: (string | number)[], value: number) => {
    setRules((prev: Rules) => {
      const next = structuredClone(prev)
      let node = next
      for (const key of path.slice(0, -1)) node = node[key]
      node[path[path.length - 1]] = value
      return next
    })
    setRows(null)
  }
  const run = async (fn: () => Promise<void>) => { setError(''); setMessage(''); setBusy(true); try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  const check = () => run(async () => setRows((await request<{ personas: Row[] }>('/api/v1/bank/rules/simulate', { method: 'POST', body: JSON.stringify({ rules }) }, token)).personas))
  const save = () => run(async () => {
    const r = await request<{ version: number }>('/api/v1/bank/rules', { method: 'POST', body: JSON.stringify({ rules, comment, activate: true }) }, token)
    setMessage(`Версия ${r.version} сохранена и включена. Новые расчёты идут по ней, прежние решения хранят свою версию.`); setComment(''); setRows(null); void load()
  })
  const reset = () => { if (list) { setRules(structuredClone(list.active_rules)); setRows(null) } }
  const activate = (v: number) => run(async () => {
    await request(`/api/v1/bank/rules/${v}/activate`, { method: 'POST' }, token)
    const l = await request<Listing>('/api/v1/bank/rules', {}, token); setList(l); setRules(structuredClone(l.active_rules)); setRows(null)
    setMessage(`Включена версия ${v}`)
  })
  const travel = () => run(async () => {
    const r = await request<{ expired: string[] }>('/api/v1/bank/admin/time-travel', { method: 'POST', body: JSON.stringify({ days: 31 }) }, token)
    setMessage(r.expired.length ? `Через 31 день истекут одобрения: ${r.expired.length} — статус «Срок предложения истёк»` : 'Через 31 день просроченных одобрений нет')
  })
  const cell = (s: Short) => <>{outcomeTitle[s.outcome] ?? s.outcome}{s.limit ? ` · ${rubles(s.limit * 100)}` : ''}{s.rate ? ` · ${s.rate}%` : ''}{s.score != null ? <small>балл {s.score}</small> : null}</>

  if (!rules) return <div className="page bank-page"><p className="muted">Загружаем правила…</p></div>
  const tabs = [['market', 'Ставки и лимиты'], ['classes', 'Классы'], ['products', 'Продукты'], ['factors', 'Факторы скоринга'], ['collateral', 'Залог']]
  return <div className="page bank-page"><header><div><span className="eyebrow">Кабинет банка</span><h1>Правила решения</h1><p>Изменение = новая версия. До включения проверьте, как поменяются решения по тестовым клиентам.</p></div>
    <div className="metric"><b>v{list?.active_version ?? '…'}</b><span>действует</span></div></header>
    {message && <div className="notice">{message}</div>}{error && <div className="error">{error}</div>}
    <div className="rules-layout"><section className="queue">
      <div className="filters">{tabs.map(([k, l]) => <button key={k} className={`chip ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === 'market' && <div className="form-grid">
        <label>Ключевая ставка ЦБ<Num value={rules.market.key_rate} step={0.25} suffix="%" onChange={v => set(['market', 'key_rate'], v)} /></label>
        <label>Минимальная ставка: ключевая +<Num value={rules.market.rate_floor_over_key} step={0.5} suffix="п.п." onChange={v => set(['market', 'rate_floor_over_key'], v)} /></label>
        <label>Платежи по всем кредитам, не больше<Num value={Math.round(rules.debt_load.max_payment_share * 100)} suffix="% выручки" onChange={v => set(['debt_load', 'max_payment_share'], v / 100)} /></label>
        <label>Второе одобрение риск-менеджера от<Num value={rules.outcome.risk_manager_above} step={100000} suffix="₽" onChange={v => set(['outcome', 'risk_manager_above'], v)} /></label>
        <label>Округление лимита вниз до<Num value={rules.limit.round_down_to} step={1000} suffix="₽" onChange={v => set(['limit', 'round_down_to'], v)} /></label>
        <label>Срок действия предложения<Num value={rules.outcome.offer_valid_days} suffix="дн." onChange={v => set(['outcome', 'offer_valid_days'], v)} /></label>
        <h3>Скидка к ставке за обороты в Альфе</h3>
        {rules.rate.alfa_share_discount.map((d: { gte: number; pp: number }, i: number) => <label key={i}>Доля оборотов ≥ {Math.round(d.gte * 100)}%<Num value={d.pp} step={0.5} suffix="п.п." onChange={v => set(['rate', 'alfa_share_discount', i, 'pp'], v)} /></label>)}
      </div>}

      {tab === 'classes' && <table className="sim rules-table"><thead><tr><th>Класс</th><th>Балл от</th><th>Коэф. лимита</th><th>Надбавка к ставке</th><th>Решение</th></tr></thead><tbody>
        {rules.classes.map((c: { name: string; min: number; limit_coef: number; rate_premium: number | null; route: string }, i: number) => <tr key={c.name}>
          <td><b>{c.name}</b></td>
          <td><Num value={c.min} onChange={v => set(['classes', i, 'min'], v)} /></td>
          <td>{c.route === 'REJECTED' ? '—' : <Num value={c.limit_coef} step={0.05} onChange={v => set(['classes', i, 'limit_coef'], v)} />}</td>
          <td>{c.rate_premium === null ? '—' : <Num value={c.rate_premium} step={0.5} suffix="п.п." onChange={v => set(['classes', i, 'rate_premium'], v)} />}</td>
          <td>{routeTitle[c.route] ?? c.route}</td></tr>)}
      </tbody></table>}

      {tab === 'products' && <table className="sim rules-table"><thead><tr><th>Продукт</th><th>Базовая ставка</th><th>Сумма от</th><th>Сумма до</th><th>Срок, мес.</th><th>Лимит от выручки</th></tr></thead><tbody>
        {Object.entries(rules.products).map(([code, p]) => { const pr = p as Rules; return <tr key={code}>
          <td><b>{pr.title}</b></td>
          <td><Num value={pr.base_rate} step={0.5} suffix="%" onChange={v => set(['products', code, 'base_rate'], v)} /></td>
          <td><Num value={pr.min_amount} step={50000} onChange={v => set(['products', code, 'min_amount'], v)} /></td>
          <td><Num value={pr.max_amount} step={100000} onChange={v => set(['products', code, 'max_amount'], v)} /></td>
          <td className="pair"><Num value={pr.term_months.min} onChange={v => set(['products', code, 'term_months', 'min'], v)} />–<Num value={pr.term_months.max} onChange={v => set(['products', code, 'term_months', 'max'], v)} /></td>
          <td>{pr.revenue_coef === null ? 'остаток долга' : <Num value={pr.revenue_coef} step={0.1} suffix="× выручка" onChange={v => set(['products', code, 'revenue_coef'], v)} />}</td></tr> })}
      </tbody></table>}

      {tab === 'factors' && <div className="factor-editor"><p className="muted">Балл = {rules.scoring.base} + сумма баллов факторов.</p>
        <label className="inline">База<Num value={rules.scoring.base} onChange={v => set(['scoring', 'base'], v)} /></label>
        {Object.entries(rules.scoring.factors).map(([code, f]) => { const fx = f as Rules; return <div key={code} className="factor-card"><b>{factorTitle[code] ?? code}</b>
          <div className="chips">{fx.bands ? fx.bands.map((b: Record<string, number>, i: number) => <label key={i} className="band">{bandLabel(b)}<Num value={b.points} onChange={v => set(['scoring', 'factors', code, 'bands', i, 'points'], v)} /></label>)
            : Object.entries(fx.values).map(([k, v]) => <label key={k} className="band">{valueTitle[k] ?? k}<Num value={v as number} onChange={nv => set(['scoring', 'factors', code, 'values', k], nv)} /></label>)}</div></div> })}
      </div>}

      {tab === 'collateral' && <div className="form-grid">
        {Object.entries(rules.collateral.ltv).map(([k, v]) => <label key={k}>{assetTitle[k] ?? k}: доля от оценки<Num value={Math.round((v as number) * 100)} suffix="%" onChange={nv => set(['collateral', 'ltv', k], nv / 100)} /></label>)}
        <label>Скидка к ставке за залог<Num value={rules.rate.collateral_discount_pp} step={0.5} suffix="п.п." onChange={v => set(['rate', 'collateral_discount_pp'], v)} /></label>
        <label>Максимум с залогом<Num value={rules.collateral.secured_max_amount} step={1000000} suffix="₽" onChange={v => set(['collateral', 'secured_max_amount'], v)} /></label>
        <label>Максимальный срок с залогом<Num value={rules.collateral.secured_max_term_months} suffix="мес." onChange={v => set(['collateral', 'secured_max_term_months'], v)} /></label>
      </div>}

      <div className="rules-actions"><input placeholder="Что меняем и почему" value={comment} onChange={e => setComment(e.target.value)} />
        <button className="secondary" onClick={reset} disabled={busy}>Сбросить</button>
        <button className="secondary" onClick={check} disabled={busy}>Проверить на персонах</button>
        <button className="primary" disabled={busy || !rows || comment.trim().length < 3} onClick={save}>Сохранить и включить</button></div>
      {!rows && <p className="muted">Сохранить можно после проверки на персонах и с комментарием.</p>}
      {rows && <table className="sim"><thead><tr><th>Клиент</th><th>Было</th><th>Стало</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.persona} className={r.changed ? 'changed' : ''}><td><b>{r.persona}</b><small>{r.title}</small></td><td>{cell(r.before)}</td><td>{cell(r.after)}</td></tr>)}</tbody></table>}
    </section>
    <aside className="review-card"><h3>Версии</h3>{list?.versions.map(v => <div key={v.version} className="version-row">
      <span><b>v{v.version}</b><small>{new Date(v.created_at).toLocaleString('ru-RU')}</small></span>
      {v.active ? <em>действует</em> : <button className="secondary" onClick={() => activate(v.version)}>Включить</button>}</div>)}
      <h3>Демо</h3><p className="muted">Одобрение действует 30 дней. Покажите, что будет с неподписанными заявками.</p>
      <button className="secondary wide" onClick={travel}>Перемотать время на 31 день</button></aside></div>
  </div>
}
