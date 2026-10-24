import { CSSProperties, ReactNode } from 'react'
import { KeyValue } from '../../ui'
import {
  assetTitle, Band, bandLabels, ClassRule, factorInfo, flagTitle, hasScoringErrors, num, OFFER_VALID_DAYS, Product, productTitle,
  purposeTitle, routeTitle, scoreRange, sourceTitle, stopTitle, valueTitle,
} from './meta'
import { RuleField, useRulesForm } from './RuleField'
import styles from './Sections.module.css'

// Содержимое вкладок формы правил. Каждая вкладка — заголовок, короткое пояснение и поля кита.

function Block({ title, text, children, aside }: { title: ReactNode; text?: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return <section className={styles.block}>
    <div className={styles.blockHead}>
      <div>
        <h3 className={styles.blockTitle}>{title}</h3>
        {text && <p className={styles.blockText}>{text}</p>}
      </div>
      {aside && <div className={styles.blockAside}>{aside}</div>}
    </div>
    {children}
  </section>
}

function Fields({ children, min = 200 }: { children: ReactNode; min?: number }) {
  return <div className={styles.fields} style={{ '--field-min': `${min}px` } as CSSProperties}>{children}</div>
}

function Note({ children }: { children: ReactNode }) {
  return <div className={styles.note}>{children}</div>
}

const signedInt = (v: number) => (v < 0 ? `−${Math.abs(v)}` : String(v))

const toneOf = (cls: string) => (cls === 'A' || cls === 'B' ? 'green' : cls === 'C' ? 'yellow' : cls === 'D' ? 'red' : 'black')

export function ClassPill({ name }: { name: string }) {
  return <span className={[styles.classPill, styles[`tone-${toneOf(name)}`]].join(' ')}>{name}</span>
}

// ——— Факторы скоринга ———

export function FactorsSection() {
  const { draft, base, errors } = useRulesForm()
  // При пустом или неверном поле скоринга диапазон не считаем — иначе цифра вводит в заблуждение
  const broken = hasScoringErrors(errors)
  const range = scoreRange(draft)
  const was = scoreRange(base)
  const rangeChanged = !broken && (range.min !== was.min || range.max !== was.max)
  return <>
    <Block
      title="Как считается балл"
      text="Балл клиента = базовый балл + баллы по каждому фактору. По баллу определяется класс риска — пороги во вкладке «Классы»."
      aside={<div className={styles.stat}>
        <span className={styles.statLabel}>Возможный балл</span>
        <b className={styles.statValue}>{broken ? '—' : `${signedInt(range.min)} … ${signedInt(range.max)}`}</b>
        {rangeChanged && <span className={styles.statWas}>было {signedInt(was.min)} … {signedInt(was.max)}</span>}
      </div>}
    >
      <Fields min={220}><RuleField path={['scoring', 'base']} hint="Начальный балл до учёта факторов" /></Fields>
    </Block>
    {Object.entries<Record<string, unknown>>(draft.scoring.factors).map(([code, f]) => {
      const info = factorInfo[code] ?? { title: code, text: '' }
      const bands = f.bands as Band[] | undefined
      const values = f.values as Record<string, number> | undefined
      const groups = f.okved_groups as Record<string, string[]> | undefined
      const labels = bands ? bandLabels(bands, info.unit) : []
      return <Block
        key={code}
        title={info.title}
        text={info.text}
        aside={<div className={styles.tags}>
          <span className={styles.tag}>{sourceTitle[String(f.source)] ?? String(f.source)}</span>
          {f.improvable === true && <span className={[styles.tag, styles.tagPositive].join(' ')}>клиент может улучшить</span>}
        </div>}
      >
        <Fields min={130}>
          {bands?.map((_, i) => <RuleField key={i} path={['scoring', 'factors', code, 'bands', i, 'points']} label={labels[i]} />)}
          {values && Object.keys(values).map(k => <RuleField key={k} path={['scoring', 'factors', code, 'values', k]} label={valueTitle[k] ?? k} />)}
          {typeof f.only_fns_points === 'number' && <RuleField path={['scoring', 'factors', code, 'only_fns_points']} label="только данные ФНС" />}
        </Fields>
        {groups && <Note>
          Отрасли по ОКВЭД: низкий риск — {groups.low?.join(', ')}; высокий — {groups.high?.join(', ')}; остальные — средний.
        </Note>}
      </Block>
    })}
  </>
}

// ——— Классы и пороги ———

const rangeText = (classes: ClassRule[], i: number) => {
  const prev = classes[i - 1]
  const min = classes[i].min
  if (!prev) return `${min} и выше`
  if (typeof min !== 'number' || typeof prev.min !== 'number') return ''
  return prev.min - 1 > min ? `${min} – ${prev.min - 1}` : `${min}`
}

export function ClassesSection() {
  const { draft } = useRulesForm()
  const classes: ClassRule[] = draft.classes
  return <Block
    title="Классы риска"
    text="Клиент получает первый класс сверху, порог которого набрал. Класс задаёт долю лимита от выручки и надбавку к ставке; что происходит с заявкой — во вкладке «Маршруты»."
  >
    <div className={styles.classTable} role="table" aria-label="Классы риска">
      <div className={[styles.classRow, styles.classHead].join(' ')} role="row">
        <span role="columnheader">Класс</span>
        <span role="columnheader">Балл от</span>
        <span role="columnheader">Доля лимита</span>
        <span role="columnheader">Надбавка к ставке</span>
        <span role="columnheader">Решение</span>
      </div>
      {classes.map((c, i) => <div key={c.name} className={styles.classRow} role="row">
        <div className={styles.className} role="cell">
          <ClassPill name={c.name} />
          <span className={styles.classRange}>{rangeText(classes, i)}</span>
        </div>
        <div role="cell"><span className={styles.mLabel}>Балл от</span><RuleField path={['classes', i, 'min']} hideLabel /></div>
        <div role="cell"><span className={styles.mLabel}>Доля лимита</span>
          {c.route === 'REJECTED' && c.limit_coef === 0 ? <span className={styles.dash}>—</span> : <RuleField path={['classes', i, 'limit_coef']} hideLabel />}
        </div>
        <div role="cell"><span className={styles.mLabel}>Надбавка к ставке</span>
          {c.rate_premium === null ? <span className={styles.dash}>—</span> : <RuleField path={['classes', i, 'rate_premium']} hideLabel />}
        </div>
        <div role="cell" className={styles.routeCell}><span className={styles.mLabel}>Решение</span>
          <span className={[styles.route, styles[`route-${c.route}`]].join(' ')}>{routeTitle[c.route] ?? c.route}</span>
        </div>
      </div>)}
    </div>
    <Note>Порог класса — минимальный балл. Пороги идут по убыванию сверху вниз. У последнего класса порог всегда 0: иначе клиенту с низким баллом класс не найдётся.</Note>
  </Block>
}

// ——— Лимиты по продуктам ———

export function LimitsSection() {
  const { draft } = useRulesForm()
  const purposes = Object.entries<string>(draft.product_choice?.by_purpose ?? {})
  return <>
    <Block title="Общие ограничения" text="Действуют для всех продуктов. Лимит — минимум из лимита от выручки, платёжеспособности и максимальной суммы продукта.">
      <Fields min={240}>
        <RuleField path={['debt_load', 'max_payment_share']} hint="Доля выручки на платежи по всем кредитам" />
        <RuleField path={['limit', 'round_down_to']} hint="Лимит округляется вниз до этого шага" />
      </Fields>
    </Block>
    {Object.entries<Product>(draft.products).map(([code, p]) => {
      const fits = purposes.filter(([, prod]) => prod === code).map(([purpose]) => purposeTitle[purpose] ?? purpose)
      return <Block key={code} title={productTitle(draft, code)} text={fits.length ? `Предлагаем, если цель: ${fits.join(', ').toLowerCase()}.` : undefined}>
        <Fields min={150}>
          <RuleField path={['products', code, 'min_amount']} label="Сумма от" />
          <RuleField path={['products', code, 'max_amount']} label="Сумма до" />
          {p.revenue_coef === null
            ? <div className={styles.static}><span className={styles.staticLabel}>Лимит</span><span>по остатку долга в другом банке</span></div>
            : <RuleField path={['products', code, 'revenue_coef']} label="Лимит от выручки" />}
          <RuleField path={['products', code, 'term_months', 'min']} label="Срок от" />
          <RuleField path={['products', code, 'term_months', 'max']} label="Срок до" />
        </Fields>
      </Block>
    })}
    {draft.seasonal_schedule && <Block title="Сезонный график платежей" text="Для оборотного кредита, кредитной линии и рефинансирования, если выручка сильно проседает по месяцам.">
      <Fields min={240}>
        <RuleField path={['seasonal_schedule', 'enabled_if_min_month_share_below']} label="Предлагаем, если слабый месяц ниже" hint="Доля от средней месячной выручки" />
        <RuleField path={['seasonal_schedule', 'min_payment_share']} label="Платёж в слабый месяц не меньше" hint="Доля от обычного (аннуитетного) платежа" />
      </Fields>
    </Block>}
  </>
}

// ——— Ставки ———

export function RatesSection() {
  const { draft } = useRulesForm()
  const floor = Number(draft.market.key_rate) + Number(draft.market.rate_floor_over_key)
  const products = Object.entries<Product>(draft.products)
  const classes = (draft.classes as ClassRule[]).filter(c => c.rate_premium !== null && c.route !== 'REJECTED')
  const discounts = draft.rate.alfa_share_discount as { gte: number; pp: number }[]
  return <>
    <Block
      title="Ключевая ставка и минимум"
      text="Итоговая ставка не опускается ниже ключевой ставки ЦБ плюс минимальная надбавка."
      aside={<div className={styles.stat}>
        <span className={styles.statLabel}>Ставка не ниже</span>
        <b className={styles.statValue}>{Number.isFinite(floor) ? `${num(floor)}%` : '—'}</b>
      </div>}
    >
      <Fields min={240}>
        <RuleField path={['market', 'key_rate']} />
        <RuleField path={['market', 'rate_floor_over_key']} />
      </Fields>
    </Block>
    <Block title="Базовые ставки продуктов" text="Ставка = базовая ставка продукта + надбавка класса − скидки, но не ниже минимума.">
      <Fields min={170}>
        {products.map(([code]) => <RuleField key={code} path={['products', code, 'base_rate']} label={productTitle(draft, code)} />)}
      </Fields>
    </Block>
    <Block title="Скидки к ставке" text="Скидка за обороты — по наибольшему порогу, который клиент проходит. Скидка за залог — если кредит с залогом.">
      <Fields min={200}>
        {discounts.map((d, i) => <RuleField key={i} path={['rate', 'alfa_share_discount', i, 'pp']} label={`Обороты в Альфе от ${num(d.gte * 100, 1)}%`} />)}
        <RuleField path={['rate', 'collateral_discount_pp']} label="Кредит с залогом" />
      </Fields>
    </Block>
    <Block title="Ставка до скидок" text="Расчёт по текущим значениям формы: базовая ставка продукта + надбавка класса, с учётом минимума.">
      <div className={styles.matrixWrap}>
        <table className={styles.matrix}>
          <thead><tr><th>Продукт</th>{classes.map(c => <th key={c.name}><ClassPill name={c.name} /></th>)}</tr></thead>
          <tbody>{products.map(([code, p]) => <tr key={code}>
            <td>{productTitle(draft, code)}</td>
            {classes.map(c => {
              const r = Math.max(Number(p.base_rate) + Number(c.rate_premium ?? 0), floor)
              return <td key={c.name}>{Number.isFinite(r) ? `${num(r)}%` : '—'}</td>
            })}
          </tr>)}</tbody>
        </table>
      </div>
    </Block>
  </>
}

// ——— Маршрутизация ———

export function RoutingSection() {
  const { draft } = useRulesForm()
  const classes: ClassRule[] = draft.classes
  const flags = (draft.manual_review_flags ?? []) as { code: string }[]
  const stops = (draft.stop_factors ?? []) as { code: string; outcome: string }[]
  const purposes = Object.entries<string>(draft.product_choice?.by_purpose ?? {})
  return <>
    <Block title="Маршрутизация: что происходит с заявкой по классу" text="Автоматически — решение сразу, без сотрудника. Ручная проверка — заявка попадает в очередь андеррайтера. Отказ — сразу с объяснением.">
      <Fields min={150}>
        {classes.map((c, i) => <RuleField key={c.name} path={['classes', i, 'route']} label={<span className={styles.routeLabel}><ClassPill name={c.name} /> класс {c.name}</span>} />)}
      </Fields>
    </Block>
    <Block title="Порог второго одобрения и срок действия одобрения" text="Заявки на сумму выше порога всегда идут на ручную проверку и требуют согласования риск-менеджера.">
      <Fields min={240}>
        <RuleField path={['outcome', 'risk_manager_above']} label="Второе одобрение — для сумм больше" />
        <div className={styles.static}>
          <span className={styles.staticLabelOuter}>Срок действия одобрения</span>
          <span className={styles.staticBox}>{OFFER_VALID_DAYS} дней</span>
          <span className={styles.staticHint}>После этого одобрение без подписи истекает. Пока не настраивается: срок задан в коде расчёта.</span>
        </div>
      </Fields>
    </Block>
    <Block title="Всегда ручная проверка" text="Не зависит от балла. Меняется разработчиками в файле правил.">
      <ul className={styles.list}>{flags.map(f => <li key={f.code}>{flagTitle[f.code] ?? f.code}</li>)}</ul>
    </Block>
    <Block title="Стоп-факторы" text="Проверяются до скоринга: заявка сразу получает отказ или запрос документов.">
      <ul className={styles.list}>{stops.map(s => <li key={s.code}>{stopTitle[s.code] ?? s.code}</li>)}</ul>
    </Block>
    <Block title="Какой продукт предлагаем" text="По цели кредита из анкеты.">
      <KeyValue items={purposes.map(([purpose, product]) => ({ key: purpose, label: purposeTitle[purpose] ?? purpose, value: productTitle(draft, product) }))} />
    </Block>
  </>
}

// ——— Залог ———

export function CollateralSection() {
  const { draft } = useRulesForm()
  const ltv = Object.keys(draft.collateral.ltv ?? {})
  return <>
    <Block title="Сколько засчитываем от оценки" text="Доля оценочной стоимости имущества, на которую можно увеличить лимит с залогом.">
      <Fields min={180}>
        {ltv.map(k => <RuleField key={k} path={['collateral', 'ltv', k]} label={assetTitle[k] ?? k} />)}
      </Fields>
    </Block>
    <Block title="Ограничения кредита с залогом" text="Скидка к ставке за залог — во вкладке «Ставки». Овердрафт без залога.">
      <Fields min={240}>
        <RuleField path={['collateral', 'secured_max_amount']} />
        <RuleField path={['collateral', 'secured_max_term_months']} />
      </Fields>
      {typeof draft.collateral.costs_text === 'string' && <Note>Клиент видит: «{draft.collateral.costs_text}»</Note>}
    </Block>
  </>
}
