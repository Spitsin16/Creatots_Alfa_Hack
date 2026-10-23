import { useState } from 'react'
import { Spinner } from '../common/Spinner'

// Коды ответов — как в ТЗ 5.2 и rules.yaml. Обязательны только цель и сумма/срок.
export type Answers = {
  purpose: string; amount: number; term_months: number; frequency: string; urgency: string
  priority: string; repayment: string; assets: string[]
}

const purposes = [
  ['cash_gap', 'Закрыть кассовый разрыв'], ['inventory', 'Закупка товара или сырья'], ['equipment', 'Оборудование или ремонт'],
  ['expansion', 'Новая точка, расширение'], ['refinance', 'Снизить платёж по другому кредиту'], ['other', 'Другое'],
]
const optional: { key: keyof Answers; title: string; options: string[][] }[] = [
  { key: 'frequency', title: 'Деньги нужны один раз или регулярно?', options: [['once', 'Один раз'], ['several_per_year', 'Несколько раз в год'], ['always', 'Постоянно под рукой']] },
  { key: 'urgency', title: 'Когда нужны деньги?', options: [['days', 'В ближайшие дни'], ['month', 'В течение месяца'], ['planned', 'Планирую заранее']] },
  { key: 'priority', title: 'Что для вас важнее?', options: [['small_payment', 'Маленький платёж'], ['low_overpayment', 'Меньше переплата'], ['max_amount', 'Максимальная сумма']] },
  { key: 'repayment', title: 'Как планируете возвращать?', options: [['equal', 'Равными платежами'], ['seasonal', 'Больше в сезон'], ['bullet', 'Одной суммой после сделки']] },
]
const assets = [['real_estate', 'Недвижимость'], ['vehicle', 'Транспорт, спецтехника'], ['equipment', 'Оборудование'], ['none', 'Нет / не хочу']]

export const defaultAnswers: Answers = {
  purpose: 'cash_gap', amount: 240000, term_months: 12, frequency: 'always', urgency: 'days',
  priority: 'small_payment', repayment: 'equal', assets: ['none'],
}

export function Questionnaire({ onSubmit, busy }: { onSubmit: (a: Answers) => void; busy: boolean }) {
  const [a, setA] = useState<Answers>(defaultAnswers)
  const [more, setMore] = useState(false)
  const [consent, setConsent] = useState(false)
  const set = (patch: Partial<Answers>) => setA(prev => ({ ...prev, ...patch }))
  const maxAmount = a.purpose === 'refinance' ? 30_000_000 : 10_000_000
  return <section className="quiz">
    <div className="quiz-step"><span className="eyebrow">Шаг 1 из 2</span><h2>На что нужны деньги?</h2>
      <div className="option-grid">{purposes.map(([code, label]) => <button key={code} type="button"
        className={`option ${a.purpose === code ? 'selected' : ''}`}
        onClick={() => set({ purpose: code, frequency: code === 'cash_gap' ? 'always' : 'once' })}>{label}</button>)}</div>
    </div>
    <div className="quiz-step"><span className="eyebrow">Шаг 2 из 2</span><h2>Сколько и на какой срок?</h2>
      <label className="slider">Сумма <b>{new Intl.NumberFormat('ru-RU').format(a.amount)} ₽</b>
        <input type="range" min={100000} max={maxAmount} step={10000} value={Math.min(a.amount, maxAmount)} onChange={e => set({ amount: Number(e.target.value) })} /></label>
      <label className="slider">Срок <b>{a.term_months} мес.</b>
        <input type="range" min={3} max={60} step={1} value={a.term_months} onChange={e => set({ term_months: Number(e.target.value) })} /></label>
    </div>
    {!more && <button type="button" className="link" onClick={() => setMore(true)}>Расскажите больше — подберём точнее ›</button>}
    {more && <div className="quiz-more">
      {optional.map(q => <div key={q.key}><h3>{q.title}</h3><div className="chips">{q.options.map(([code, label]) =>
        <button type="button" key={code} className={`chip ${a[q.key] === code ? 'active' : ''}`} onClick={() => set({ [q.key]: code } as Partial<Answers>)}>{label}</button>)}</div></div>)}
      <div><h3>Есть имущество, которое можно оформить в залог?</h3><div className="chips">{assets.map(([code, label]) =>
        <button type="button" key={code} className={`chip ${a.assets.includes(code) ? 'active' : ''}`} onClick={() => set({ assets: [code] })}>{label}</button>)}</div></div>
    </div>}
    <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> Согласен на запрос данных в БКИ и ФНС для расчёта (действует год)</label>
    <button className="primary" disabled={busy || !consent} onClick={() => onSubmit(a)}>{busy ? <Spinner label="Считаем…" light /> : 'Рассчитать предложение'}</button>
  </section>
}
