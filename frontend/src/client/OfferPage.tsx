import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'
import { Button } from '@alfalab/core-components/button/esm'
import { CalculatorMIcon } from '@alfalab/icons-glyph/CalculatorMIcon'
import { apiErrorCode, Application, request } from '../api'
import { useSession } from '../auth'
import { keys } from '../queries'
import { Bell, EmptyState, ErrorState, PageHeader, Stack } from '../ui'
import { OfferPanel } from './OfferPanel'
import { OfferContext, loadOffer, markApplied, rememberStatementFile, saveOffer, statementFileFor } from './offerStore'
import { Answers } from './Questionnaire'
import { ApplyTarget, CounterTerms, OfferData, StatementResult } from './offer/offerMath'

const titles: Record<string, string> = {
  APPROVED: 'Ваше предложение',
  MANUAL_REVIEW: 'Предварительное предложение',
  COUNTER_OFFER: 'Встречное предложение',
  REJECTED: 'Результат расчёта',
}

const statementContext = (r: StatementResult): NonNullable<OfferContext['statement']> => ({
  previousLimitKopecks: r.previous_limit_kopecks, fullMonths: r.statement.full_months,
  avgRevenueKopecks: r.statement.avg_revenue_kopecks, period: r.statement.period ?? null,
})

// Бэк: 409 PRE_OFFER_EXPIRED. Текст — запасной признак, если код вдруг не пришёл.
const expiredError = (e: unknown) => apiErrorCode(e) === 'PRE_OFFER_EXPIRED' || (e instanceof Error && /истёк|истек/i.test(e.message))

// Предложение банка: сумма и полная стоимость, объяснение, «как получить больше» → оформить заявку.
export function OfferPage() {
  const { id = '' } = useParams()
  const { token, me } = useSession()
  const business = me.businesses[0]
  const navigate = useNavigate()
  const client = useQueryClient()
  const saved = useMemo(() => loadOffer(id), [id])
  // заявка, созданная в этом экземпляре страницы: при быстром «назад» страница может не перемонтироваться
  // и не перечитать хранилище — тогда «Открыть заявку» показываем по этому состоянию
  const [applied, setApplied] = useState<{ offerId: string; applicationId: string }>()
  const applicationId = applied?.offerId === id ? applied.applicationId : saved?.applicationId
  const canFill = business.permissions.includes('FILL')
  const canSubmit = business.permissions.includes('SUBMIT')
  // выписка 1С, учтённая в этом расчёте, — чтобы пересчёт (весь лимит, истёкший срок) её не потерял
  const statementFile = saved?.context?.statement ? statementFileFor(id) : undefined

  const open = (offerId: string, replace = false) => {
    navigate(`/offer/${offerId}`, { replace })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /** Новый расчёт по ответам анкеты; если была выписка — сразу учитываем её снова. Заявка не создаётся. */
  const calculate = async (answers: Answers, file?: Blob) => {
    const { amount, ...rest } = answers
    let offer = await request<OfferData>(`/api/v1/businesses/${business.id}/pre-offers`,
      { method: 'POST', body: JSON.stringify({ ...rest, amount_kopecks: Math.round(amount * 100) }) }, token)
    let statement: StatementResult | undefined
    if (file) {
      statement = await request<StatementResult>(`/api/v1/pre-offers/${offer.id}/statement`,
        { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } }, token)
      offer = statement.pre_offer
      rememberStatementFile(offer.id, file)
    }
    return { offer, statement }
  }

  const createFrom = async (preOfferId: string) => {
    const app = await request<Application>('/api/v1/applications', { method: 'POST', body: JSON.stringify({ pre_offer_id: preOfferId }) }, token)
    client.setQueryData(keys.application(app.id), app)
    void client.invalidateQueries({ queryKey: keys.myApplications(business.id) })
    return app
  }

  const create = useMutation({
    mutationFn: async (target: ApplyTarget): Promise<{ application?: Application; offerId?: string }> => {
      if (!saved) throw new Error('Расчёт не найден — пересчитайте предложение')
      if (target === 'requested') return { application: await createFrom(id) }
      // Весь лимит овердрафта: бэк заводит заявку на запрошенную сумму, поэтому сначала считаем
      // предложение на сумму лимита (с той же выпиской), и только если банк подтвердил её — создаём заявку.
      const wanted = saved.offer.limit_kopecks
      const answers = { ...saved.answers, amount: wanted / 100 }
      const { offer } = await calculate(answers, statementFile)
      saveOffer(offer, answers, saved.context)
      const confirmed = offer.limit_kopecks >= wanted && offer.requested_amount_kopecks >= wanted
        && (offer.outcome === 'APPROVED' || offer.outcome === 'MANUAL_REVIEW')
      if (!confirmed) return { offerId: offer.id }
      const application = await createFrom(offer.id)
      markApplied(offer.id, application.id)
      return { application }
    },
    onSuccess: ({ application, offerId }) => {
      if (application) {
        markApplied(id, application.id)
        setApplied({ offerId: id, applicationId: application.id })
        navigate(`/applications/${application.id}`)
      } else if (offerId) {
        // условия изменились — показываем новый расчёт, заявку клиент оформит уже по нему
        open(offerId)
      }
    },
  })

  // Пересчёт по тем же ответам (истёк срок или бэк ответил «срок предложения истёк»)
  const recalc = useMutation({
    mutationFn: async () => {
      if (!saved) throw new Error('Расчёт не найден — пересчитайте предложение')
      return calculate(saved.answers, statementFile)
    },
    onSuccess: ({ offer, statement }) => {
      if (!saved) return
      const context = statement ? { ...saved.context, statement: statementContext(statement) } : saved.context?.refinance ? { refinance: saved.context.refinance } : undefined
      saveOffer(offer, saved.answers, context)
      open(offer.id, true)
    },
  })

  // Встречное предложение «рефинансирование»: считаем новое предложение по его условиям (заявка не создаётся)
  const refinance = useMutation({
    mutationFn: async (terms: CounterTerms) => {
      if (!saved) throw new Error('Расчёт не найден — пересчитайте предложение')
      const answers = { ...saved.answers, purpose: 'refinance', frequency: 'once', term_months: terms.term, amount: terms.amount }
      const { offer } = await calculate(answers)
      return { offer, answers }
    },
    onSuccess: ({ offer, answers }, terms) => {
      const context = terms.old_payment != null && terms.new_payment != null ? {
        refinance: {
          oldPaymentRub: terms.old_payment, newPaymentRub: terms.new_payment,
          savingPerMonthRub: terms.saving_per_month ?? terms.old_payment - terms.new_payment,
          requestedKopecks: saved?.offer.requested_amount_kopecks ?? 0,
        },
      } : undefined
      saveOffer(offer, answers, context)
      open(offer.id)
    },
  })

  // Выписка 1С из другого банка учтена → бэк вернул новое предложение: показываем его с «было → стало»
  const onStatement = (r: StatementResult, file: Blob) => {
    if (!saved) return
    rememberStatementFile(r.pre_offer.id, file)
    saveOffer(r.pre_offer, saved.answers, { statement: statementContext(r) })
    open(r.pre_offer.id, true)
  }

  // ошибки действий относятся к конкретному расчёту — при переходе на другой расчёт их сбрасываем
  const { reset: resetCreate } = create
  const { reset: resetRefinance } = refinance
  const { reset: resetRecalc } = recalc
  useEffect(() => { resetCreate(); resetRefinance(); resetRecalc() }, [id, resetCreate, resetRefinance, resetRecalc])

  if (!saved) return <Stack>
    <PageHeader back={{ to: '/', label: 'На главную' }} title="Предложение" actions={<Bell />} />
    <EmptyState icon={<CalculatorMIcon />} title="Расчёт не найден"
      text="Расчёт хранится только в этой вкладке браузера. Посчитайте предложение заново — по свежим данным это займёт несколько секунд."
      action={<Button view="accent" size={48} onClick={() => navigate('/')}>Рассчитать предложение</Button>} />
  </Stack>

  const { offer, answers, context } = saved
  const recalcNow = () => recalc.mutate()
  const notice = create.error
    ? expiredError(create.error)
      ? <ErrorState error={new Error('Расчёт действует 30 дней, и этот срок прошёл. Пересчитаем по тем же ответам и свежим данным — это несколько секунд.')}
          title="Срок предложения истёк" onRetry={recalcNow} retryLabel="Пересчитать предложение" />
      : <ErrorState error={create.error} title="Не получилось оформить заявку" onRetry={() => create.variables && create.mutate(create.variables)} />
    : recalc.error
      ? <ErrorState error={recalc.error} title="Не получилось пересчитать предложение" onRetry={recalcNow} />
      : refinance.error
        ? <ErrorState error={refinance.error} title="Не получилось рассчитать рефинансирование" onRetry={() => refinance.variables && refinance.mutate(refinance.variables)} />
        : null

  return <Stack>
    <PageHeader back={{ to: '/', label: 'Изменить ответы' }} title={titles[offer.outcome] ?? 'Ваше предложение'} subtitle={business.name} actions={<Bell />} />
    <OfferPanel key={offer.id} token={token} businessId={business.id} offer={offer as OfferData} repayment={answers.repayment} context={context}
      canFill={canFill} canSubmit={canSubmit}
      applicationId={applicationId} onOpenApplication={appId => navigate(`/applications/${appId}`)}
      creating={create.isPending} creatingTarget={create.isPending ? create.variables : undefined} onContinue={target => create.mutate(target)}
      fullLimitReady={!context?.statement || !!statementFile}
      refinancing={refinance.isPending} onRefinance={terms => refinance.mutate(terms)}
      onStatement={onStatement}
      recalculating={recalc.isPending} onRecalculate={recalcNow} onEditAnswers={() => navigate('/')}
      notice={notice} />
  </Stack>
}
