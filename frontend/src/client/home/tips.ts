import { Application, Forecast, MyApplicationItem, Offer, productName } from '../../api'
import { formatMoney } from '../../ui'
import { Loan, balanceOn, dayMonth, nextDateInForecast } from './data'

// Лента «Подсказки для бизнеса»: короткие советы только из данных клиента (прогноз, выданный кредит, советы банка).
// Баллы, классы и пороги клиенту не показываем — только суммы, даты и тексты советов.

export type TipAction = { label: string; to?: string; onClick?: () => void }
export type Tip = {
  id: string
  icon: 'calendar' | 'loan' | 'growth'
  /** Маленькая подпись над заголовком: «Скоро списание», «Ваш кредит»… */
  eyebrow: string
  title: string
  /** Крупная сумма под заголовком, ₽ */
  amount?: number
  text: string
  tone: 'ok' | 'warn' | 'info'
  action?: TipAction
}

export type TipsInput = {
  forecast?: Forecast
  /** Банки, кредиты в которых уже показаны в карточке «Перенесите кредит в Альфу» */
  refinanceBanks: string[]
  /** Последний выданный кредит */
  loan?: { item: MyApplicationItem; loan: Loan } | null
  /** Ближайший платёж этого кредита уже показан в карточке переноса — не повторяем */
  loanPaymentShown: boolean
  /** Свежий расчёт из этой вкладки */
  offer?: { id: string; offer: Offer } | null
  /** Решения банка по заявкам (активная, последняя) — источник советов «как получить больше» */
  decisions: Application[]
  canCalc: boolean
  onCalc: () => void
  onPickOverdraft: (rubles: number) => void
}

const MAX_TIPS = 4

const kindWord: Record<string, string> = {
  RENT: 'Аренда', SALARY: 'Зарплата', TAX: 'Налоги', SUPPLIER: 'Оплата поставщику', LOAN_PAYMENT: 'Платёж по кредиту',
}

/** Примерная сумма: до тысячи рублей. */
const approx = (rubles: number) => formatMoney({ rubles: Math.round(rubles / 1000) * 1000 })

const MONTHS_PREP = 'январе|феврале|марте|апреле|мае|июне|июле|августе|сентябре|октябре|ноябре|декабре'
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
/** Тексты бэка: «12.11» / «01.11.2026» → «12 ноября», «выше: мае» → «выше: в мае», суммы — без переноса. */
const fixText = (text: string) => text
  .replace(new RegExp(`: (${MONTHS_PREP})(?=[,\\s.—]|$)`, 'g'), ': в $1')
  .replace(/\b(\d{2})\.(\d{2})(?:\.\d{4})?(?!\d)/g, (m, d: string, mo: string) => (+mo >= 1 && +mo <= 12 ? `${+d} ${MONTHS_GEN[+mo - 1]}` : m))
  .replace(/(\d) (?=\d{3}(?!\d))/g, '$1\u00a0')

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Крупные регулярные списания в ближайшие 30 дней: хватает ли денег на счёте в этот день. */
function paymentTips({ forecast, refinanceBanks, onPickOverdraft }: TipsInput): Tip[] {
  if (!forecast?.series.length || !forecast.recurring?.length) return []
  const gapDate = forecast.gap?.date
  // С разрывом крупные платежи дня разрыва уже расписаны в «Деньгах на счёте» — подсказываем про остальные (до двух).
  // Без разрыва карточка прогноза сама перечисляет крупные платежи — здесь только ближайший, с остатком после него.
  const limit = forecast.gap ? 2 : 1
  return forecast.recurring
    .filter(r => r.kind !== 'OTHER' && !refinanceBanks.includes(r.counterparty))
    .map(r => ({ ...r, date: nextDateInForecast(forecast.series, r.day) }))
    .filter((r): r is typeof r & { date: string } => !!r.date && r.date !== gapDate)
    .sort((a, b) => b.amount - a.amount).slice(0, 4)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit)
    .map(r => {
      const balance = balanceOn(forecast.series, r.date)
      const enough = balance == null || balance >= 0
      const suggestion = forecast.gap?.overdraft_suggestion ?? 0
      return {
        id: `pay-${r.counterparty}-${r.day}`,
        icon: 'calendar',
        eyebrow: 'Скоро списание',
        title: `${dayMonth(r.date)} · ${kindWord[r.kind] ?? 'Регулярный платёж'}`,
        amount: r.amount,
        text: balance == null ? r.counterparty
          : enough ? `${r.counterparty}. Денег на счёте хватает: к вечеру останется примерно ${approx(balance)}.`
            : `${r.counterparty}. На счёте может не хватить примерно ${approx(-balance)}.`,
        tone: enough ? 'ok' : 'warn',
        action: !enough && suggestion > 0 ? { label: 'Подобрать овердрафт', onClick: () => onPickOverdraft(suggestion) } : undefined,
      } satisfies Tip
    })
}

/** Выданный кредит: ближайший платёж и подсказки банка (без повтора того, что уже есть на карточках). */
function loanTips({ loan, loanPaymentShown }: TipsInput): Tip[] {
  if (!loan) return []
  const { item, loan: l } = loan
  const to = { label: 'Открыть кредит', to: `/applications/${item.id}` }
  const name = productName(item.product ?? l.product)
  const tips: Tip[] = []
  if (l.next_payment && !loanPaymentShown) tips.push({
    id: 'loan-next', icon: 'loan', eyebrow: `Ваш кредит · ${name.toLowerCase()}`,
    title: `${dayMonth(l.next_payment.date)} · платёж по кредиту`, amount: l.next_payment.payment,
    text: 'Спишется со счёта автоматически — держите деньги на счёте накануне.', tone: 'info', action: to,
  })
  // Подсказка про ближайший платёж повторяет плитку выше; из остальных первой берём ту, что про прогноз
  const rest = l.tips.filter(t => !/^Ближайший платёж/i.test(t))
  const best = rest.find(t => /прогноз/i.test(t)) ?? rest[0]
  if (best) tips.push({
    id: 'loan-tip', icon: 'loan', eyebrow: 'Ваш кредит',
    title: `${name} ${l.product === 'OVERDRAFT' ? 'с лимитом' : 'на'} ${formatMoney({ rubles: l.amount })}`,
    text: cap(fixText(best)), tone: 'info', action: to,
  })
  return tips
}

/** Советы банка «как получить больше»: только те, где лимит правда растёт или ставка снижается. */
function adviceTips({ offer, decisions, canCalc, onCalc }: TipsInput): Tip[] {
  type Advice = Offer['advice'][number]
  const better = (a: Advice, limit: number, rate: number | null) =>
    !/REFIN/i.test(a.code) && (a.new_limit_kopecks > limit || (a.new_rate != null && rate != null && a.new_rate < rate))
  const sources: { advice: Advice[]; limit: number; action?: TipAction }[] = []
  if (offer && offer.offer.limit_kopecks > 0) sources.push({
    advice: offer.offer.advice.filter(a => better(a, offer.offer.limit_kopecks, offer.offer.rate)),
    limit: offer.offer.limit_kopecks,
    action: { label: 'Открыть предложение', to: `/offer/${offer.id}` },
  })
  for (const app of decisions) {
    const d = app.decision
    if (!d || d.limit_kopecks <= 0) continue
    sources.push({
      advice: d.advice.filter(a => better(a, d.limit_kopecks, d.rate)), limit: d.limit_kopecks,
      action: canCalc ? { label: 'Рассчитать заново', onClick: onCalc } : undefined,
    })
  }
  const src = sources.find(s => s.advice.length)
  if (!src) return []
  return src.advice.slice(0, 2).map(a => {
    const title = a.new_limit_kopecks > src.limit
      ? `Лимит вырастет до ${formatMoney({ kopecks: a.new_limit_kopecks })}`
      : `Ставка снизится до ${String(a.new_rate).replace('.', ',')}%`
    return {
      id: `advice-${a.code}`, icon: 'growth', eyebrow: 'Как получить больше', title,
      text: fixText(a.text), tone: 'ok', action: src.action,
    } satisfies Tip
  })
}

/**
 * Собирает 0–4 подсказки: по очереди берём по одной из каждого источника (списания → кредит → советы),
 * чтобы были разные, а показываем сгруппированными в том же порядке.
 */
export function buildTips(input: TipsInput): Tip[] {
  const groups = [paymentTips(input), loanTips(input), adviceTips(input)]
  const taken = groups.map(() => 0)
  let total = 0
  for (let i = 0; total < MAX_TIPS && groups.some(g => g.length > i); i++)
    groups.forEach((g, gi) => { if (g[i] && total < MAX_TIPS) { taken[gi]++; total++ } })
  return groups.flatMap((g, gi) => g.slice(0, taken[gi]))
}
