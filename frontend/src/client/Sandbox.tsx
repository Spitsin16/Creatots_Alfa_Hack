import { ReactNode, useState } from 'react'
import { Alert } from '@alfalab/core-components/alert/esm'
import { Button } from '@alfalab/core-components/button/esm'
import { SliderInput, type SliderInputProps } from '@alfalab/core-components/slider-input/esm'
import { Steps } from '@alfalab/core-components/steps/esm'
import { Tag } from '@alfalab/core-components/tag/esm'
import { Typography } from '@alfalab/core-components/typography/esm'
import { ArrowBackMIcon } from '@alfalab/icons-glyph/ArrowBackMIcon'
import { ArrowRightMIcon } from '@alfalab/icons-glyph/ArrowRightMIcon'
import { CheckmarkCircleMIcon } from '@alfalab/icons-glyph/CheckmarkCircleMIcon'
import { isNetworkError, productName, request } from '../api'
import { rememberSandboxClient } from '../login/sandboxClients'
import { KeyValue } from '../ui/KeyValue'
import { Money } from '../ui/Money'
import { ScoreBadge } from '../ui/ScoreBadge'
import styles from '../login/Sandbox.module.css'

type Params = {
  type: string; industry: string; age_months: number; revenue: number; seasonality: string; alfa_share: number
  alfa_credit: string; external_balance: number; external_payment: number; credit_history: string
  current_overdue_days: number; tax_debt: number; real_estate_value: number; asset_kind: string
}
// Встречное предложение движка. Сейчас API песочницы его не отдаёт — если начнёт, покажем суммы переноса.
type Counter = {
  product: string; amount: number; term: number; rate?: number | null
  new_payment?: number; old_payment?: number; saving_per_month?: number
}
type Preview = {
  score: number; cls: string; product: string; outcome: string; limit: number | null; rate: number | null
  reason: string | null; stop_factors: string[]; binding_constraint?: string | null; counter?: Counter | null
}
type Created = {
  login: string; password?: string; access_token: string; business: { name: string; inn: string }; transactions: number; preview: Preview
}
/** Ответ сервера + параметры, с которыми клиента создали (для честных подписей в итоге). */
type CreatedWithParams = Created & { params: Params }

const defaults: Params = {
  type: 'IP', industry: 'medium', age_months: 36, revenue: 1_000_000, seasonality: 'none', alfa_share: 1,
  alfa_credit: 'none', external_balance: 0, external_payment: 0, credit_history: 'clean',
  current_overdue_days: 0, tax_debt: 0, real_estate_value: 0, asset_kind: 'real_estate',
}

// Предварительный расчёт — это взгляд банка (проверяющий играет банк), поэтому здесь можно назвать балл и причину кодом словами.
const outcomeView: Record<string, { title: string; tone: 'positive' | 'attention' | 'info' | 'negative'; text: string }> = {
  APPROVED: { title: 'Одобрение', tone: 'positive', text: 'Типовой запрос проходит автоматически: клиент получит предложение и сможет сразу оформить заявку.' },
  COUNTER_OFFER: { title: 'Контрпредложение', tone: 'attention', text: 'Запрошенная сумма больше доступной — клиенту предложат меньшую сумму или перенос кредита другого банка в Альфу.' },
  MANUAL_REVIEW: { title: 'Ручная проверка', tone: 'info', text: 'Решение примет специалист: после отправки заявка попадёт в очередь андеррайтера (вход uw1).' },
  REJECTED: { title: 'Отказ', tone: 'negative', text: 'Клиент увидит отказ с понятной причиной и подсказкой, что сделать, чтобы вернуться.' },
  INFO_REQUESTED: { title: 'Нужны документы', tone: 'attention', text: 'Банк попросит клиента загрузить документы.' },
}
const reasonTitle: Record<string, string> = {
  BUSINESS_TOO_YOUNG: 'Бизнес работает меньше 3 месяцев', LIQUIDATION: 'Бизнес ликвидируется или закрыт', BANKRUPTCY: 'Сведения о банкротстве',
  CURRENT_OVERDUE: 'Текущая просрочка 30+ дней в другом банке', TAX_ACCOUNT_BLOCK: 'ФНС заблокировала операции по счетам',
  INVALID_LEGAL_ADDRESS: 'Недостоверный адрес в ЕГРЮЛ', CLASS_E: 'Низкий балл скоринга', CLASS_D: 'Пограничный балл — нужен взгляд специалиста',
  AMOUNT_ABOVE_AUTO: 'Сумма больше 5 млн ₽ — решение принимает специалист', MASS_ADDRESS: 'Адрес массовой регистрации',
  NO_CAPACITY: 'Не хватает платёжеспособности: выручки не хватит на ещё один платёж',
}
const bindingTitle: Record<string, [string, string]> = {
  REVENUE: ['выручка', 'лимит считается от оборотов'], CAPACITY: ['платежи по кредитам', 'на новый платёж остаётся меньше'],
  PRODUCT_MAX: ['максимум продукта', 'больше по этому продукту не выдаём'], REFINANCE_BALANCE: ['остаток долга', 'переносим столько, сколько осталось'],
}
const industryTitle: Record<string, string> = { low: 'торговля', medium: 'услуги', high: 'строительство' }
const seasonTitle: Record<string, string> = { none: 'ровная выручка', moderate: 'умеренная сезонность', strong: 'сильная сезонность' }

const fmt = (v: number) => new Intl.NumberFormat('ru-RU').format(v)
const monthsWord = (n: number) => {
  const d = n % 10, h = n % 100
  return d === 1 && h !== 11 ? 'месяц' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'месяца' : 'месяцев'
}
// Генератор строит операции только с даты открытия счёта: у молодого бизнеса их меньше 12 месяцев.
const historyText = (age: number) => { const m = Math.min(12, age); return `${m} ${monthsWord(m)}` }
const short = (v: number) => v >= 1_000_000 ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(v / 1_000_000)} млн` : `${fmt(Math.round(v / 1000))} тыс.`
const ageText = (m: number) => m < 12 ? `${m} мес.` : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(m / 12)} г.`

// Платёж по чужому кредиту, пока его не поправили руками: остаток на 2 года, шаг 10 тыс.
const suggestPayment = (balance: number) => Math.min(2_000_000, Math.max(10_000, Math.round(balance / 24 / 10_000) * 10_000))

// Неравномерные шкалы ползунков: мелкий шаг внизу, крупный наверху (объекты вне компонента — кит сравнивает их по ссылке).
const revenueRange = { min: [100_000, 50_000] as [number, number], '50%': [2_000_000, 100_000] as [number, number], '80%': [8_000_000, 500_000] as [number, number], max: [20_000_000] as [number] }
const estateRange = { min: [0, 500_000] as [number, number], '60%': [10_000_000, 1_000_000] as [number, number], max: [50_000_000] as [number] }
const balanceRange = { min: [0, 100_000] as [number, number], '60%': [5_000_000, 500_000] as [number, number], max: [20_000_000] as [number] }
const paymentRange = { min: [10_000, 10_000] as [number, number], '60%': [300_000, 50_000] as [number, number], max: [2_000_000] as [number] }

type NumberFieldProps = {
  label: string; value: number; min: number; max: number; step: number; unit: string
  marks: [string, string]; range?: SliderInputProps['range']; hint?: string; onChange: (v: number) => void
}

// Ползунок кита с полем ввода: тянуть или вписать число; вне диапазона — подрежем при выходе из поля.
function NumberField({ label, value, min, max, step, unit, marks, range, hint, onChange }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  return <SliderInput block size={56} label={label} value={draft ?? fmt(value)} sliderValue={value}
    min={min} max={max} step={step} range={range} info={unit} steps={marks} hint={hint}
    className={styles.field} stepsClassName={styles.marks}
    onInputChange={(_, { value: v }) => {
      setDraft(v === '' ? '' : fmt(v))
      if (v !== '' && v >= min && v <= max) onChange(v)
    }}
    onSliderChange={({ value: v }) => { setDraft(null); onChange(v) }}
    onBlur={() => {
      if (draft === null) return
      const n = Number(draft.replace(/\D/g, ''))
      onChange(clamp(draft === '' || !Number.isFinite(n) ? min : n))
      setDraft(null)
    }} />
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return <div className={styles.choice} role="radiogroup" aria-label={label}>
    <div className={styles.choiceLabel}>{label}</div>
    <div className={styles.tags}>
      {options.map(([code, text]) => <Tag key={code} size={40} shape="rounded" checked={value === code} role="radio" aria-checked={value === code}
        onClick={() => onChange(code)}>{text}</Tag>)}
    </div>
  </div>
}

function Group({ title, source, children }: { title: string; source?: string; children: ReactNode }) {
  return <fieldset className={styles.group}>
    <legend className={styles.groupHead}><b>{title}</b>{source && <span className={styles.source}>{source}</span>}</legend>
    <div className={styles.groupBody}>{children}</div>
  </fieldset>
}

const stepTitles = ['Бизнес', 'Обороты', 'Кредиты и налоги']

// Песочница проверяющего: вы играете роль банка и источников данных — задаёте, что знают
// Альфа, ФНС и БКИ. Клиент дальше проходит обычный путь, решение считает тот же движок.
export function Sandbox({ onLogin }: { onLogin: (token: string) => void }) {
  const [p, setP] = useState<Params>(defaults)
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<CreatedWithParams | null>(null)
  const [paymentTouched, setPaymentTouched] = useState(false)
  const set = (patch: Partial<Params>) => setP(prev => ({ ...prev, ...patch }))
  const last = stepTitles.length

  const createClient = async () => {
    setBusy(true); setError('')
    try {
      const res = await request<Created>('/api/v1/sandbox/clients', { method: 'POST', body: JSON.stringify(p) })
      rememberSandboxClient({
        login: res.login, name: res.business.name, inn: res.business.inn, outcome: res.preview.outcome, createdAt: new Date().toISOString(),
      })
      setCreated({ ...res, params: p })
    } catch (e) {
      setError(isNetworkError(e) ? 'Нет связи с сервером. Проверьте, что стенд запущен, и попробуйте ещё раз.' : (e as Error).message)
    } finally { setBusy(false) }
  }

  if (created) return <Result created={created} onLogin={onLogin} onAgain={() => { setCreated(null); setStep(1) }} />

  const summary = [
    p.type === 'IP' ? 'ИП' : 'ООО', industryTitle[p.industry], `работает ${ageText(p.age_months)}`,
    `выручка ${short(p.revenue)} ₽/мес`, seasonTitle[p.seasonality], `${Math.round(p.alfa_share * 100)}% оборотов в Альфе`,
    p.real_estate_value ? `залог ${short(p.real_estate_value)} ₽` : null,
    p.alfa_credit === 'none' ? null : p.alfa_credit === 'good' ? 'кредит в Альфе без просрочек' : 'кредит в Альфе с просрочками',
    p.external_balance ? `долг в другом банке ${short(p.external_balance)} ₽` : null,
    { clean: 'история без просрочек', none: 'нет кредитной истории', past_lt30: 'были просрочки до 30 дн.', past_gte30: 'были просрочки 30+ дн.' }[p.credit_history],
    p.current_overdue_days ? `просрочка сейчас ${p.current_overdue_days} дн.` : null,
    p.tax_debt ? `налоговый долг ${short(p.tax_debt)} ₽` : null,
  ].filter(Boolean).join(' · ')

  return <section className={styles.card} aria-labelledby="sandbox-title">
    <Typography.Title tag="h2" view="small" font="system" weight="bold" id="sandbox-title" className={styles.title}>Параметры клиента</Typography.Title>
    <Steps activeStep={step} onChange={setStep} ordered interactive minSpaceBetweenSteps={16} className={styles.steps}>
      {stepTitles.map((t, i) => <span key={t} className={[styles.stepLabel, i + 1 === step ? styles.stepCurrent : ''].filter(Boolean).join(' ')}>{t}</span>)}
    </Steps>

    <div className={styles.body}>
      {step === 1 && <>
        <Group title="Компания" source="ЕГРЮЛ / ЕГРИП">
          <Choice label="Форма бизнеса" value={p.type} options={[['IP', 'ИП'], ['LLC', 'ООО']]} onChange={v => set({ type: v })} />
          <Choice label="Отрасль" value={p.industry} options={[['low', 'Торговля'], ['medium', 'Услуги'], ['high', 'Строительство']]} onChange={v => set({ industry: v })} />
          <p className={styles.note}>Отрасль влияет на риск: у торговли он ниже, у строительства — выше.</p>
          <NumberField label="Сколько работает бизнес" value={p.age_months} min={1} max={120} step={1} unit="мес." marks={['1 мес.', '10 лет']}
            onChange={v => set({ age_months: v })} />
        </Group>
      </>}

      {step === 2 && <>
        <Group title="Счёт в Альфе" source="Альфа-Банк">
          <NumberField label="Средняя выручка в месяц" value={p.revenue} min={100_000} max={20_000_000} step={50_000} range={revenueRange} unit="₽"
            marks={['100 тыс.', '20 млн']} onChange={v => set({ revenue: v })} />
          <Choice label="Сезонность" value={p.seasonality} options={[['none', 'Ровная'], ['moderate', 'Умеренная'], ['strong', 'Сильная']]} onChange={v => set({ seasonality: v })} />
          <NumberField label="Доля оборотов через Альфу" value={Math.round(p.alfa_share * 100)} min={20} max={100} step={5} unit="%"
            marks={['20%', '100%']} hint="Остальное клиент проводит через другой банк" onChange={v => set({ alfa_share: v / 100 })} />
        </Group>
        <Group title="Залог" source="Данные клиента">
          <NumberField label="Имущество для залога, оценка" value={p.real_estate_value} min={0} max={50_000_000} step={500_000} range={estateRange} unit="₽"
            marks={['нет', '50 млн']} onChange={v => set({ real_estate_value: v })} />
          {p.real_estate_value > 0 && <Choice label="Что это за имущество" value={p.asset_kind}
            options={[['real_estate', 'Недвижимость'], ['vehicle', 'Транспорт, спецтехника'], ['equipment', 'Оборудование']]}
            onChange={v => set({ asset_kind: v })} />}
        </Group>
      </>}

      {step === 3 && <>
        <Group title="Кредит в Альфе" source="Альфа-Банк">
          <Choice label="Есть ли кредит" value={p.alfa_credit} options={[['none', 'Нет'], ['good', 'Есть, платит вовремя'], ['overdue', 'Есть, были просрочки']]} onChange={v => set({ alfa_credit: v })} />
        </Group>
        <Group title="Другие банки" source="БКИ">
          <NumberField label="Остаток долга в другом банке" value={p.external_balance} min={0} max={20_000_000} step={100_000} range={balanceRange} unit="₽"
            marks={['нет', '20 млн']}
            onChange={v => {
              if (!v) setPaymentTouched(false)
              set({ external_balance: v, external_payment: !v ? 0 : paymentTouched ? p.external_payment || suggestPayment(v) : suggestPayment(v) })
            }} />
          {p.external_balance > 0 && <NumberField label="Платёж по нему в месяц" value={p.external_payment} min={10_000} max={2_000_000} step={10_000} range={paymentRange} unit="₽"
            marks={['10 тыс.', '2 млн']} hint={paymentTouched ? undefined : 'Подставили из расчёта погашения за 2 года — поправьте, если нужно'}
            onChange={v => { setPaymentTouched(true); set({ external_payment: v }) }} />}
          <Choice label="Кредитная история за 12 месяцев" value={p.credit_history}
            options={[['clean', 'Без просрочек'], ['none', 'Нет истории'], ['past_lt30', 'Просрочка до 30 дн.'], ['past_gte30', 'Просрочка 30+ дн.']]}
            onChange={v => set({ credit_history: v })} />
          <NumberField label="Текущая просрочка" value={p.current_overdue_days} min={0} max={90} step={1} unit="дн." marks={['нет', '90 дн.']}
            onChange={v => set({ current_overdue_days: v })} />
        </Group>
        <Group title="Налоги" source="ФНС">
          <NumberField label="Долг по налогам" value={p.tax_debt} min={0} max={1_000_000} step={10_000} unit="₽" marks={['нет', '1 млн']}
            onChange={v => set({ tax_debt: v })} />
        </Group>
      </>}
    </div>

    <div className={styles.summary}><span>Ваш клиент</span>{summary}</div>

    {error && <Alert view="negative" rounded title="Не получилось создать клиента" className={styles.alert}>{error}</Alert>}

    <div className={styles.actions}>
      {step > 1 && <Button view="secondary" size={48} leftAddons={<ArrowBackMIcon />} onClick={() => setStep(step - 1)}>Назад</Button>}
      {step < last
        ? <Button view="accent" size={48} rightAddons={<ArrowRightMIcon />} onClick={() => setStep(step + 1)}>Дальше: {stepTitles[step].toLowerCase()}</Button>
        : <Button view="accent" size={48} loading={busy} onClick={createClient}>Создать клиента</Button>}
    </div>
    {step === last && busy && <p className={styles.busyNote} role="status">Генерируем операции по счёту за {historyText(p.age_months)} и считаем решение…</p>}
  </section>
}

const rateText = (rate: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(rate)}% годовых`

function Result({ created, onLogin, onAgain }: { created: CreatedWithParams; onLogin: (token: string) => void; onAgain: () => void }) {
  const { preview, params } = created
  const outcome = outcomeView[preview.outcome] ?? { title: preview.outcome, tone: 'info' as const, text: '' }
  const rejected = preview.outcome === 'REJECTED'
  const counter = preview.counter ?? null
  // Контрпредложение без нового лимита: платежи по чужому кредиту съели свободную выручку,
  // движок предлагает перенести этот кредит в Альфу (рефинансирование), а не выдать новый.
  const refinance = preview.outcome === 'COUNTER_OFFER' && (counter ? counter.product === 'REFINANCE' : !preview.limit)
  const reasons = [preview.reason, ...(preview.stop_factors ?? [])].filter((r, i, all): r is string => !!r && all.indexOf(r) === i)
  const outcomeText = refinance
    ? 'Нового лимита нет: платежи по кредиту в другом банке уже съедают свободную выручку. Клиенту предложат перенести этот кредит в Альфу с меньшим платежом.'
    : preview.outcome === 'COUNTER_OFFER'
      ? 'Запрошенная сумма больше доступной — клиенту предложат меньшую сумму: столько, сколько позволяют обороты и текущие платежи.'
      : outcome.text
  const requestRow = { label: 'Запрос для расчёта', value: <><Money rubles={params.revenue} weight="medium" /> на 12 мес.</>, hint: 'как будто клиент просит месячную выручку' }

  return <section className={styles.card} aria-labelledby="sandbox-done">
    <div className={styles.done}>
      <span className={styles.doneIcon} aria-hidden><CheckmarkCircleMIcon /></span>
      <div>
        <div className={styles.doneEyebrow}>Клиент создан</div>
        <Typography.Title tag="h2" view="small" font="system" weight="bold" id="sandbox-done" className={styles.title}>{created.business.name}</Typography.Title>
        <div className={styles.doneMeta}>ИНН {created.business.inn} · {fmt(created.transactions)} операций по счёту за {historyText(params.age_months)}</div>
      </div>
    </div>

    <div className={styles.creds}>
      <span>Логин <code>{created.login}</code></span>
      <span>Пароль <code>{created.password ?? 'demo'}</code></span>
      <span className={styles.credsNote}>Клиент сохранён на экране входа в этом браузере. С другого устройства — вход по логину.</span>
    </div>

    <div className={`${styles.outcome} ${styles[`tone-${outcome.tone}`]}`}>
      <div className={styles.outcomeHead}>
        <div>
          <div className={styles.outcomeLabel}>Предварительный расчёт банка</div>
          <div className={styles.outcomeTitle}>{outcome.title}</div>
        </div>
        <div className={styles.score}>
          <span>Видит только банк</span>
          <ScoreBadge cls={preview.cls} score={preview.score} status={preview.outcome} size="m" />
        </div>
      </div>
      {outcomeText && <p className={styles.outcomeText}>{outcomeText}</p>}

      {refinance
        ? <>
          {counter && <KeyValue view="tiles" columns={3} className={styles.tiles} items={[
            { label: 'Перенести в Альфу', value: <Money rubles={counter.amount} /> },
            { label: 'Новый платёж', value: counter.new_payment ? <><Money rubles={counter.new_payment} /> в мес.</> : '—', hint: counter.old_payment ? <>вместо <Money rubles={counter.old_payment} /></> : undefined },
            { label: 'Ставка', value: counter.rate != null ? rateText(counter.rate) : '—', hint: `на ${counter.term} мес.` },
          ]} />}
          <KeyValue view="rows" className={styles.rows} items={[
            { label: 'Что предложат', value: 'Рефинансирование кредита другого банка' },
            counter || !params.external_balance ? null : { label: 'Долг в другом банке', value: <Money rubles={params.external_balance} weight="medium" />, hint: 'как задали на шаге 3' },
            counter || !params.external_payment ? null : { label: 'Платёж по нему сейчас', value: <><Money rubles={params.external_payment} weight="medium" /> в месяц</>, hint: 'условия переноса клиент увидит после отправки заявки' },
            requestRow,
          ]} />
        </>
        : <>
          {!rejected && <KeyValue view="tiles" columns={3} className={styles.tiles} items={[
            { label: 'Продукт', value: productName(preview.product) },
            { label: preview.outcome === 'COUNTER_OFFER' ? 'Можно предложить' : 'Максимальный лимит', value: preview.limit ? <Money rubles={preview.limit} prefix="до" /> : '—' },
            { label: 'Ставка', value: preview.rate != null ? rateText(preview.rate) : '—' },
          ]} />}
          <KeyValue view="rows" className={styles.rows} items={[
            rejected ? { label: 'Продукт', value: productName(preview.product) } : null,
            requestRow,
            preview.binding_constraint && preview.limit
              ? { label: 'Что ограничило сумму', value: bindingTitle[preview.binding_constraint]?.[0] ?? preview.binding_constraint, hint: bindingTitle[preview.binding_constraint]?.[1] }
              : null,
            reasons.length ? { label: reasons.length > 1 ? 'Причины' : 'Причина', value: reasons.map(r => reasonTitle[r] ?? r).join('; ') } : null,
          ]} />
        </>}
    </div>
    <p className={styles.hintText}>Клиент балл и класс не увидит — только исход, объяснение словами и советы. Войдите под ним и пройдите путь: анкета → предложение → заявка.</p>

    <div className={styles.actions}>
      <Button view="secondary" size={48} onClick={onAgain}>Изменить и создать ещё</Button>
      <Button view="accent" size={48} rightAddons={<ArrowRightMIcon />} onClick={() => onLogin(created.access_token)}>Войти под этим клиентом</Button>
    </div>
  </section>
}
