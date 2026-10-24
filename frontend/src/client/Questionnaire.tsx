import { ChangeEvent, ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from '@alfalab/core-components/button/esm'
import { Checkbox } from '@alfalab/core-components/checkbox/esm'
import { Collapse } from '@alfalab/core-components/collapse/esm'
import { SliderInput } from '@alfalab/core-components/slider-input/esm'
import { Tag } from '@alfalab/core-components/tag/esm'
import { ArrowsCwMIcon } from '@alfalab/icons-glyph/ArrowsCwMIcon'
import { BoxMIcon } from '@alfalab/icons-glyph/BoxMIcon'
import { CheckmarkCircleMIcon } from '@alfalab/icons-glyph/CheckmarkCircleMIcon'
import { CheckmarkMIcon } from '@alfalab/icons-glyph/CheckmarkMIcon'
import { ChevronDownMIcon } from '@alfalab/icons-glyph/ChevronDownMIcon'
import { ClockCoinMIcon } from '@alfalab/icons-glyph/ClockCoinMIcon'
import { DotsHorizontalMIcon } from '@alfalab/icons-glyph/DotsHorizontalMIcon'
import { InformationCircleMIcon } from '@alfalab/icons-glyph/InformationCircleMIcon'
import { LockClosedMIcon } from '@alfalab/icons-glyph/LockClosedMIcon'
import { ScrewdriverWrenchMIcon } from '@alfalab/icons-glyph/ScrewdriverWrenchMIcon'
import { ShopMIcon } from '@alfalab/icons-glyph/ShopMIcon'
import { Card, EmptyState, ErrorState, formatMoney } from '../ui'
import styles from './Questionnaire.module.css'

// Коды ответов — как в ТЗ 5.2 и rules.yaml. Обязательны только цель и сумма/срок.
export type Answers = {
  /** '' — цель ещё не выбрана */
  purpose: string; amount: number; term_months: number; frequency: string; urgency: string
  priority: string; repayment: string; assets: string[]
}

const purposes: { code: string; title: string; hint: string; icon: ReactNode }[] = [
  { code: 'cash_gap', title: 'Закрыть кассовый разрыв', hint: 'Платежи раньше поступлений', icon: <ClockCoinMIcon /> },
  { code: 'inventory', title: 'Закупка товара или сырья', hint: 'Товар, сырьё, материалы', icon: <BoxMIcon /> },
  { code: 'equipment', title: 'Оборудование или ремонт', hint: 'Купить, заменить, отремонтировать', icon: <ScrewdriverWrenchMIcon /> },
  { code: 'expansion', title: 'Новая точка, расширение', hint: 'Филиал, новое направление', icon: <ShopMIcon /> },
  { code: 'refinance', title: 'Снизить платёж по кредиту', hint: 'Перенести кредит другого банка', icon: <ArrowsCwMIcon /> },
  { code: 'other', title: 'Другое', hint: 'Любая другая цель бизнеса', icon: <DotsHorizontalMIcon /> },
]

type OptionKey = 'frequency' | 'urgency' | 'priority' | 'repayment'
const optional: { key: OptionKey; title: string; options: [string, string][] }[] = [
  { key: 'frequency', title: 'Деньги нужны один раз или регулярно?', options: [['once', 'Один раз'], ['several_per_year', 'Несколько раз в год'], ['always', 'Постоянно под рукой']] },
  { key: 'urgency', title: 'Когда нужны деньги?', options: [['days', 'В ближайшие дни'], ['month', 'В течение месяца'], ['planned', 'Планирую заранее']] },
  { key: 'priority', title: 'Что для вас важнее?', options: [['small_payment', 'Маленький платёж'], ['low_overpayment', 'Меньше переплата'], ['max_amount', 'Максимальная сумма']] },
  { key: 'repayment', title: 'Как планируете возвращать?', options: [['equal', 'Равными платежами'], ['seasonal', 'Больше в сезон'], ['bullet', 'Одной суммой после сделки']] },
]
const assets: [string, string][] = [['real_estate', 'Недвижимость'], ['vehicle', 'Транспорт, спецтехника'], ['equipment', 'Оборудование'], ['none', 'Нет / не хочу']]

const label = (key: OptionKey, code: string) => optional.find(q => q.key === key)?.options.find(([c]) => c === code)?.[1] ?? code

export const defaultAnswers: Answers = {
  purpose: '', amount: 500_000, term_months: 12, frequency: 'once', urgency: 'month',
  priority: 'small_payment', repayment: 'equal', assets: ['none'],
}

// Сумма: от 100 тыс. до 30 млн ₽ (максимум продуктов, ТЗ 6). Шкала неравномерная, чтобы небольшие суммы
// тоже было удобно выбрать ползунком; подписи стоят ровно на третях шкалы.
const AMOUNT_MIN = 100_000
const AMOUNT_MAX = 30_000_000
const amountRange = { min: [AMOUNT_MIN, 10_000] as [number, number], '33.33%': [1_000_000, 50_000] as [number, number], '66.67%': [5_000_000, 100_000] as [number, number], max: [AMOUNT_MAX] as [number] }
const TERM_MIN = 3
const TERM_MAX = 60
const termRange = { min: [TERM_MIN, 1] as [number, number], '33.33%': [12, 1] as [number, number], '66.67%': [36, 1] as [number, number], max: [TERM_MAX] as [number] }

const digits = (n: number) => new Intl.NumberFormat('ru-RU').format(n).replace(/[  ]/g, ' ')
const onlyDigits = (text: string) => text.replace(/\D/g, '')
/** Позиция в отформатированной строке сразу после count-й цифры (пробелы между разрядами пропускаем). */
function caretAfterDigits(text: string, count: number) {
  if (count <= 0) return 0
  let seen = 0
  for (let i = 0; i < text.length; i++) if (/\d/.test(text[i]) && ++seen === count) return i + 1
  return text.length
}
const months = (n: number) => {
  const m10 = n % 10, m100 = n % 100
  return m10 === 1 && m100 !== 11 ? 'месяц' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'месяца' : 'месяцев'
}

/** Частота «по умолчанию» для цели: кассовый разрыв — деньги постоянно под рукой, остальное — один раз. */
const frequencyFor = (purpose: string) => (purpose === 'cash_gap' ? 'always' : 'once')

/** Рекомендация из прогноза: «12 ноября не хватит 211 060 ₽ → овердрафт на 240 000 ₽». */
export type GapHint = { date: string; shortfall: number; overdraft_suggestion: number }

export type QuestionnaireProps = {
  value: Answers
  onChange: (next: Answers) => void
  onSubmit: (a: Answers) => void
  busy: boolean
  /** Ошибка расчёта (useMutation.error) */
  error?: unknown
  /** Права пользователя в бизнесе: FILL — может считать, CONSENT — дать согласие, SUBMIT — отправить заявку */
  permissions: string[]
  /** Согласие на БКИ/ФНС уже дано в этой вкладке — дата окончания */
  consentUntil: string | null
  /** Разрыв из прогноза — подсказка суммы для «кассового разрыва» */
  gap?: GapHint | null
  /** Ответы уже менялись (прошлый расчёт или кнопка из прогноза) — не перезаписывать сумму подсказкой */
  prefilled?: boolean
  id?: string
}

/** Анкета ТЗ 5.2: цель → сумма и срок → (по желанию) уточнения → согласие → расчёт. */
export function Questionnaire({ value: a, onChange, onSubmit, busy, error, permissions, consentUntil, gap, prefilled, id }: QuestionnaireProps) {
  const [more, setMore] = useState(false)
  /** Менял ли человек ответы в раскрытом блоке «Расскажите больше» — тогда кнопка «Готово», а не «Пропустить» */
  const [moreChanged, setMoreChanged] = useState(false)
  const [consent, setConsent] = useState(false)
  const [amountTouched, setAmountTouched] = useState(!!prefilled)
  // Частота, которую человек выбрал сам (кликом в этом блоке): пока она стоит, смена цели её не трогает.
  // Ответы прошлого расчёта и кнопка «Подобрать овердрафт» частоту выбранной вручную не делают.
  const [userFrequency, setUserFrequency] = useState<string | null>(null)
  useEffect(() => { if (prefilled) setAmountTouched(true) }, [prefilled])
  const set = (patch: Partial<Answers>) => onChange({ ...a, ...patch })

  const canFill = permissions.includes('FILL')
  const canConsent = permissions.includes('CONSENT')
  const canSubmit = permissions.includes('SUBMIT')
  const needConsent = canConsent && !consentUntil

  if (!canFill) return <Card id={id} title="Рассчитать предложение">
    <EmptyState compact icon={<LockClosedMIcon />} title="Расчёт доступен руководителю"
      text="По вашей доверенности можно только смотреть данные. Рассчитать предложение и подготовить заявку может руководитель или сотрудник с правом заполнять заявки." />
  </Card>

  const pickPurpose = (code: string) => {
    const patch: Partial<Answers> = { purpose: code }
    // Частота «постоянно под рукой» превращает любой продукт в овердрафт (rules.yaml, by_frequency_override),
    // поэтому при смене цели пересчитываем её — если человек не выбирал её сам и она осталась «по умолчанию» для прежней цели.
    const chosenByUser = userFrequency !== null && a.frequency === userFrequency
    if (!chosenByUser && (!a.purpose || a.frequency === frequencyFor(a.purpose))) patch.frequency = frequencyFor(code)
    if (code === 'cash_gap' && gap && !amountTouched) patch.amount = gap.overdraft_suggestion
    set(patch)
  }

  // Сумма с пробелами между разрядами: после форматирования возвращаем курсор туда, где человек печатал,
  // а не в конец строки. Стёрли пробел между разрядами — стираем соседнюю цифру.
  const onAmount = (event: ChangeEvent<HTMLInputElement> | null, value: number | '') => {
    setAmountTouched(true)
    if (!event) { set({ amount: value === '' ? 0 : value }); return }
    const el = event.target
    const raw = el.value
    let before = onlyDigits(raw.slice(0, el.selectionStart ?? raw.length)).length
    let next = onlyDigits(raw)
    const prev = a.amount ? String(a.amount) : ''
    const inputType = (event.nativeEvent as InputEvent).inputType
    if (next === prev && inputType === 'deleteContentBackward' && before > 0) { next = next.slice(0, before - 1) + next.slice(before); before -= 1 }
    else if (next === prev && inputType === 'deleteContentForward') next = next.slice(0, before) + next.slice(before + 1)
    const trimmed = next.replace(/^0+/, '')
    before = Math.max(0, before - (next.length - trimmed.length))
    set({ amount: trimmed ? Math.min(parseInt(trimmed, 10), 999_999_999) : 0 })
    // React перерисует поле синхронно в этом же событии — курсор ставим сразу после него.
    queueMicrotask(() => {
      if (document.activeElement !== el) return
      const pos = caretAfterDigits(el.value, before)
      el.setSelectionRange(pos, pos)
    })
  }
  const amountError = !a.amount ? 'Укажите сумму' : a.amount < AMOUNT_MIN ? `Минимум ${formatMoney({ rubles: AMOUNT_MIN })}` : a.amount > AMOUNT_MAX ? `Максимум ${formatMoney({ rubles: AMOUNT_MAX })}` : null
  const termError = !a.term_months ? 'Укажите срок' : a.term_months < 1 || a.term_months > 120 ? 'Срок — от 1 до 120 месяцев' : null
  const missing = !a.purpose ? 'Выберите, на что нужны деньги' : amountError || termError ? 'Проверьте сумму и срок' : needConsent && !consent ? 'Отметьте согласие на запрос в БКИ и ФНС' : null
  const showGapHint = a.purpose === 'cash_gap' && gap && gap.overdraft_suggestion > 0
  const summary = [label('frequency', a.frequency), label('urgency', a.urgency), label('priority', a.priority), label('repayment', a.repayment),
    a.assets.includes('none') || !a.assets.length ? 'без залога' : `залог: ${a.assets.map(c => assets.find(([k]) => k === c)?.[1].toLowerCase() ?? c).join(', ')}`]

  return <Card id={id} className={styles.card} title="Рассчитать предложение"
    subtitle="Обязательны только два вопроса — остальное возьмём из данных по вашему счёту. Расчёт ни к чему не обязывает.">
    <div className={[styles.form, busy ? styles.formBusy : ''].join(' ')} aria-busy={busy}>
      <section className={styles.step} aria-labelledby="q-purpose">
        <h3 id="q-purpose" className={styles.stepTitle}><span className={styles.stepNum}>1</span>На что нужны деньги?</h3>
        <div className={styles.purposes} role="radiogroup" aria-labelledby="q-purpose">
          {purposes.map(p => {
            const selected = a.purpose === p.code
            return <button key={p.code} type="button" role="radio" aria-checked={selected} disabled={busy}
              className={[styles.purpose, selected ? styles.purposeSelected : ''].join(' ')} onClick={() => pickPurpose(p.code)}>
              <span className={styles.purposeIcon} aria-hidden>{p.icon}</span>
              <span className={styles.purposeText}>
                <span className={styles.purposeTitle}>{p.title}</span>
                <span className={styles.purposeHint}>{p.hint}</span>
              </span>
              {selected && <span className={styles.purposeCheck} aria-hidden><CheckmarkMIcon /></span>}
            </button>
          })}
        </div>
      </section>

      <section className={styles.step} aria-labelledby="q-amount">
        <h3 id="q-amount" className={styles.stepTitle}><span className={styles.stepNum}>2</span>Сколько и на какой срок?</h3>
        <div className={styles.sliders}>
          <div className={styles.slider}>
            <SliderInput block size={56} label="Сумма" info="₽" disabled={busy}
              value={a.amount ? digits(a.amount) : ''} sliderValue={Math.min(Math.max(a.amount, AMOUNT_MIN), AMOUNT_MAX)}
              min={AMOUNT_MIN} max={AMOUNT_MAX} range={amountRange}
              steps={['100 тыс.', '1 млн', '5 млн', '30 млн']}
              error={amountError ?? undefined}
              onChange={(event, { value }) => onAmount(event, value)} />
            {showGapHint && <p className={styles.fieldHint}>
              По прогнозу {new Date(`${gap.date}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} может не хватить {formatMoney({ rubles: gap.shortfall })}.{' '}
              {a.amount !== gap.overdraft_suggestion
                ? <button type="button" className={styles.inlineLink} onClick={() => { setAmountTouched(true); set({ amount: gap.overdraft_suggestion }) }}>Подставить {formatMoney({ rubles: gap.overdraft_suggestion })}</button>
                : <>Сумма подобрана, чтобы закрыть разрыв.</>}
            </p>}
            {a.purpose === 'refinance' && <p className={styles.fieldHint}>Укажите остаток долга по кредиту, который хотите перенести.</p>}
          </div>
          <div className={styles.slider}>
            <SliderInput block size={56} label="Срок" info={months(a.term_months)} disabled={busy}
              value={a.term_months ? String(a.term_months) : ''} sliderValue={Math.min(Math.max(a.term_months, TERM_MIN), TERM_MAX)}
              min={TERM_MIN} max={TERM_MAX} range={termRange}
              steps={['3 мес.', '1 год', '3 года', '5 лет']}
              error={termError ?? undefined}
              onChange={(_, { value }) => set({ term_months: value === '' ? 0 : value })} />
            {a.purpose === 'cash_gap' && <p className={styles.fieldHint}>Для овердрафта срок — до 12 месяцев, каждый транш гасится поступлениями на счёт.</p>}
          </div>
        </div>
      </section>

      <section className={styles.more}>
        <button type="button" className={styles.moreToggle} aria-expanded={more} aria-controls="q-more" onClick={() => { setMoreChanged(false); setMore(m => !m) }} disabled={busy}>
          <span className={styles.moreText}>
            <span className={styles.moreTitle}>Расскажите больше — подберём точнее</span>
            <span className={styles.moreSummary}>{more ? 'Необязательно: можно пропустить и посчитать по ответам выше' : `Сейчас: ${summary.join(' · ').toLowerCase()}`}</span>
          </span>
          <ChevronDownMIcon className={[styles.moreChevron, more ? styles.moreChevronOpen : ''].join(' ')} aria-hidden />
        </button>
        <Collapse expanded={more} id="q-more">
          <div className={styles.moreBody}>
            {optional.map(q => <div key={q.key} className={styles.question} role="group" aria-label={q.title}>
              <div className={styles.questionTitle}>{q.title}</div>
              <div className={styles.tags}>{q.options.map(([code, text]) =>
                <Tag key={code} size={40} shape="rounded" view="filled" checked={a[q.key] === code} disabled={busy}
                  onClick={() => { if (q.key === 'frequency') setUserFrequency(code); setMoreChanged(true); set({ [q.key]: code }) }}>{text}</Tag>)}
              </div>
            </div>)}
            <div className={styles.question} role="group" aria-label="Залог">
              <div className={styles.questionTitle}>Есть имущество, которое можно оформить в залог?</div>
              <div className={styles.tags}>{assets.map(([code, text]) =>
                <Tag key={code} size={40} shape="rounded" view="filled" checked={a.assets.includes(code)} disabled={busy}
                  onClick={() => { setMoreChanged(true); set({ assets: toggleAsset(a.assets, code) }) }}>{text}</Tag>)}
              </div>
              <p className={styles.questionHint}>Можно выбрать несколько. С залогом сумма может быть больше, а ставка — ниже; оформлять залог сейчас не нужно.</p>
            </div>
            <Button view="outlined" size={40} className={styles.skip} onClick={() => setMore(false)}>{moreChanged ? 'Готово' : 'Пропустить'}</Button>
          </div>
        </Collapse>
      </section>

      <section className={styles.consent}>
        {needConsent && <Checkbox size={24} checked={consent} disabled={busy} onChange={(_, { checked }) => setConsent(checked)}
          label="Согласен на запрос данных в БКИ и ФНС"
          hint="Нужно для расчёта и заявки, действует год. Паспорт и справки не нужны — данные по счёту у банка уже есть." />}
        {canConsent && consentUntil && <div className={styles.consentGiven}>
          <CheckmarkCircleMIcon className={styles.consentIcon} aria-hidden />
          <span>Согласие на запрос в БКИ и ФНС действует до {new Date(consentUntil).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>}
        {!canConsent && <div className={styles.consentInfo}>
          <InformationCircleMIcon className={styles.consentInfoIcon} aria-hidden />
          <span>Согласие на запрос в БКИ и ФНС даёт руководитель — без него заявку не отправить. Рассчитать предложение можно уже сейчас.</span>
        </div>}
      </section>
    </div>

    {!!error && !busy && <ErrorState className={styles.error} title="Не получилось рассчитать предложение" error={error} onRetry={() => onSubmit(a)} retryLabel="Попробовать ещё раз" />}

    {busy
      ? <Progress withConsent={needConsent} />
      : <div className={styles.footer}>
        <Button view="accent" size={48} disabled={!!missing} onClick={() => onSubmit(a)} className={styles.submit}>Рассчитать предложение</Button>
        <span className={styles.footerNote}>{missing ?? (canSubmit
          ? 'Займёт несколько секунд. Заявку вы отправите сами, когда решите.'
          : 'Займёт несколько секунд. Подготовленную заявку отправит руководитель.')}</span>
      </div>}
  </Card>
}

function toggleAsset(current: string[], code: string) {
  if (code === 'none') return ['none']
  const rest = current.filter(c => c !== 'none')
  const next = rest.includes(code) ? rest.filter(c => c !== code) : [...rest, code]
  return next.length ? next : ['none']
}

/** Что сейчас делаем: шаги расчёта по очереди (расчёт быстрый, шаги — пояснение, а не замер). */
function Progress({ withConsent }: { withConsent: boolean }) {
  const steps = [
    withConsent && 'Сохраняем согласие на запрос в БКИ и ФНС',
    'Смотрим обороты по вашему счёту в Альфе',
    'Сверяем данные ФНС и кредитную историю',
    'Подбираем продукт, сумму и ставку',
  ].filter(Boolean) as string[]
  const [current, setCurrent] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  // Кнопка была внизу экрана — показываем блок ожидания целиком (на телефоне он ниже края).
  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [])
  useEffect(() => {
    const timer = setInterval(() => setCurrent(c => Math.min(c + 1, steps.length - 1)), 420)
    return () => clearInterval(timer)
  }, [steps.length])
  return <div ref={ref} className={styles.progress} role="status" aria-live="polite">
    <div className={styles.progressTitle}>Считаем предложение…</div>
    <ol className={styles.progressSteps}>
      {steps.map((s, i) => <li key={s} className={i < current ? styles.stepDone : i === current ? styles.stepActive : styles.stepWaiting}>
        <span className={styles.progressMark} aria-hidden>{i < current ? <CheckmarkMIcon /> : null}</span>
        <span>{s}</span>
      </li>)}
    </ol>
  </div>
}
