import { useQuery } from '@tanstack/react-query'
import { Application, request } from '../../api'
import { useSession } from '../../auth'
import { loadOffer } from '../offerStore'
import { Annuity, isAnnuityProduct, ScheduleRow } from './schedule'

// Условия заявки, которые бэк отдаёт не в самой заявке, а в предложении, из которого она создана:
// ставка до решения и сезонный график платежей.

/** Предложение, из которого создана заявка. */
export const preOfferIdOf = (a: Application) => a.pre_offer_id ?? null

type Explanation = { terms?: string | null }

/**
 * Ставка из предложения, пока решения ещё нет (черновик, проверка). Бэк отдаёт её только строкой
 * условий («Ставка 24%, платёж …»), поэтому берём число из неё; не нашли — значит, «в решении банка».
 */
export function useOfferRate(a: Application, enabled: boolean): number | null {
  const { token } = useSession()
  const id = preOfferIdOf(a)
  const ex = useQuery({
    // Тот же ключ и тот же ответ, что на экране предложения, — кэш общий
    queryKey: ['pre-offer', id, 'explanation'],
    queryFn: () => request<Explanation>(`/api/v1/pre-offers/${id}/explanation`, {}, token),
    enabled: enabled && !!id,
    staleTime: Infinity,
    retry: 1,
  })
  const m = /Ставка\s+([\d]+(?:[.,]\d+)?)\s*%/.exec(ex.data?.terms ?? '')
  return m ? Number(m[1].replace(',', '.')) : null
}

type SeasonalApi = {
  schedule: { date: string; payment: number; interest: number; principal: number; balance: number }[]
  amount: number; rate: number; term_months: number; annuity_payment: number
}

/**
 * Ждём ли сезонный график у этой заявки. Спрашиваем бэк только тогда, когда клиент его выбирал
 * (как на экране предложения): у несезонного бизнеса бэк отвечает 409, и браузер пишет ошибку в консоль.
 * Только до подписи: договор бэк пока всегда оформляет равными платежами (contract.schedule.type = ANNUITY),
 * поэтому у подписанной и выданной заявки показываем график договора, без вариантов.
 */
export const seasonalExpected = (a: Application) =>
  a.status === 'APPROVED' && a.decision?.rate != null && isAnnuityProduct(a.product) && !!preOfferIdOf(a) && preferredRepayment(a) === 'seasonal'

/** Сезонный график предложения (платёж следует за выручкой месяца); null — расчёта нет. */
export function useSeasonalApi(a: Application) {
  const { token } = useSession()
  const id = preOfferIdOf(a)
  return useQuery({
    queryKey: ['application-seasonal', id],
    queryFn: () => request<SeasonalApi>(`/api/v1/pre-offers/${id}/seasonal-schedule`, {}, token).catch(() => null),
    enabled: seasonalExpected(a),
    staleTime: Infinity,
  })
}

/**
 * Сезонный график под условия решения. Платежи сезонного графика пропорциональны сумме кредита
 * (backend/app/services/seasonal/schedule.py: и пол платежа, и множитель линейны по сумме), поэтому
 * под другую сумму при той же ставке и сроке его можно честно пересчитать. Ставка или срок
 * поменялись — пересчитать нельзя, возвращаем null.
 */
export function seasonalFor(api: SeasonalApi | null | undefined, amountRub: number, ratePct: number, months: number): Annuity & { min: number; max: number } | null {
  if (!api || !api.schedule.length || !api.amount) return null
  if (Math.abs(api.rate - ratePct) > 0.001 || api.term_months !== months || api.schedule.length !== months) return null
  const scale = amountRub / api.amount
  const r = ratePct / 100 / 12
  let balance = amountRub
  const rows: ScheduleRow[] = api.schedule.map((x, t) => {
    const interest = balance * r
    const payment = t === months - 1 ? balance + interest : x.payment * scale
    const principal = payment - interest
    balance = Math.max(0, balance - principal)
    return { n: t + 1, date: new Date(`${x.date}T00:00:00`), payment, interest, principal, balance }
  })
  const total = rows.reduce((s, x) => s + x.payment, 0)
  const pays = rows.map(x => x.payment)
  return { payment: api.annuity_payment * scale, total, overpayment: total - amountRub, rows, min: Math.min(...pays), max: Math.max(...pays) }
}

/**
 * Какой график клиент выбрал в анкете. Бэк способ погашения в заявке пока не хранит, поэтому:
 * ответы анкеты из этой вкладки → упоминание сезонного графика в решении специалиста → «равными».
 */
export function preferredRepayment(a: Application): 'seasonal' | 'equal' {
  const id = preOfferIdOf(a)
  const answers = id ? loadOffer(id)?.answers as { repayment?: string } | undefined : undefined
  if (answers?.repayment) return answers.repayment === 'seasonal' ? 'seasonal' : 'equal'
  // «Сезонный график», «по сезонному графику» — но не «сезонность не подтверждена»
  return /сезонн\S*\s+график/i.test(a.decision?.explanation ?? '') ? 'seasonal' : 'equal'
}
