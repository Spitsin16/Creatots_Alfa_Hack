import { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { request } from '../api'
import { Card, ErrorBoundary, ErrorState, Grid, LoadingState } from '../ui'
import { ForecastCard } from './ForecastCard'
import { OfferContext } from './offerStore'
import { AdviceSection } from './offer/Advice'
import { CounterHero, OfferHero } from './offer/Hero'
import { ApplyTarget, CounterTerms, OfferData, OfferExplanation, SeasonalData, StatementResult, adviceItems, isOverdraft } from './offer/offerMath'
import { SeasonalCard } from './offer/Seasonal'
import { ConditionsCard, CostCard, NextSteps, RejectedCard, StatementBanner, WhyCard } from './offer/Sections'

// Ключи запросов экрана предложения
const offerKeys = {
  explanation: (id: string) => ['pre-offer', id, 'explanation'] as const,
  seasonal: (id: string) => ['pre-offer', id, 'seasonal'] as const,
}

export type OfferPanelProps = {
  token: string
  businessId: string
  offer: OfferData
  /** Способ погашения из анкеты: 'seasonal' — показываем сезонный график */
  repayment: string
  context?: OfferContext
  canFill: boolean
  canSubmit: boolean
  /** Заявка по этому расчёту уже создана — вместо «Оформить» ведём в неё */
  applicationId?: string
  onOpenApplication: (applicationId: string) => void
  creating: boolean
  /** Что сейчас оформляется: как запросили или весь лимит овердрафта */
  creatingTarget?: ApplyTarget
  onContinue: (target: ApplyTarget) => void
  /** Можно оформить весь лимит овердрафта (если в расчёте выписка — её файл ещё в памяти вкладки) */
  fullLimitReady: boolean
  refinancing: boolean
  onRefinance: (terms: CounterTerms) => void
  onStatement: (result: StatementResult, file: Blob) => void
  /** Пересчитать по тем же ответам (истёк срок) */
  recalculating: boolean
  onRecalculate: () => void
  /** Вернуться к анкете и поменять ответы */
  onEditAnswers: () => void
  /** Ошибки действий (создание заявки, пересчёт) — сразу под главной карточкой */
  notice?: ReactNode
}

/**
 * Предложение банка: герой с суммой и кнопкой, полная стоимость и условия, «почему такая сумма»,
 * «как получить больше» (с загрузкой выписки 1С), сезонный график, прогноз для овердрафта, что дальше.
 * Отдельно — встречное предложение (рефинансирование) и отказ.
 */
export function OfferPanel(p: OfferPanelProps) {
  const { offer, token } = p
  const explanation = useQuery({
    queryKey: offerKeys.explanation(offer.id),
    queryFn: () => request<OfferExplanation>(`/api/v1/pre-offers/${offer.id}/explanation`, {}, token),
    staleTime: 60_000,
    // Текст от LLM (если она включена) готовится асинхронно — пока его нет, один раз переспрашиваем через 8 с
    refetchInterval: q => q.state.data && !q.state.data.summary && q.state.dataUpdateCount < 2 ? 8_000 : false,
  })
  const wantsSeasonal = p.repayment === 'seasonal' && !!offer.payment_kopecks && offer.limit_kopecks > 0 && !isOverdraft(offer)
  const seasonal = useQuery({
    queryKey: offerKeys.seasonal(offer.id),
    queryFn: () => request<SeasonalData>(`/api/v1/pre-offers/${offer.id}/seasonal-schedule`, {}, token),
    enabled: wantsSeasonal,
    staleTime: Infinity,
    retry: false,
  })

  // переплата при равных платежах — из графика банка, если он посчитан (одна цифра на весь экран)
  const overpaymentRub = seasonal.data?.annuity_overpayment ?? null
  const ex = explanation.data
  const exLoading = explanation.isPending
  const exError = explanation.error
  const retryEx = () => { void explanation.refetch() }
  const advice = adviceItems(offer, ex)
  const adviceSection = (rejected?: boolean) => <AdviceSection offer={offer} items={advice} loading={exLoading} rejected={rejected}
    canUpload={p.canFill} token={token} onStatement={p.onStatement} onEditAnswers={p.onEditAnswers} />

  if (offer.outcome === 'REJECTED') {
    return <>
      <RejectedCard offer={offer} ex={ex} loading={exLoading} error={exError} onRetry={retryEx} onRecalculate={p.onEditAnswers} />
      {advice.length > 0 && adviceSection(true)}
    </>
  }

  if (offer.limit_kopecks <= 0) {
    const counter = ex?.counter_terms as CounterTerms | null | undefined
    return <>
      {exLoading && <LoadingState view="block" label="Загружаем предложение банка…" />}
      {!exLoading && exError != null && <ErrorState error={exError} title="Не получилось загрузить предложение" onRetry={retryEx} />}
      {counter && <CounterHero offer={offer} terms={counter} canFill={p.canFill}
        busy={p.refinancing} onRefinance={() => p.onRefinance(counter)} />}
      {ex && !counter && <Card title={ex.headline} subtitle={ex.counter ?? ex.reason ?? undefined} />}
      {p.notice}
      {ex && <WhyCard title={counter ? 'Почему не можем выдать запрошенную сумму' : 'Почему так'} ex={ex} loading={false} error={null} onRetry={retryEx} />}
      {adviceSection()}
    </>
  }

  // при ручной проверке «что будет дальше» — главный вопрос клиента, поэтому сразу под суммой
  const manual = offer.outcome === 'MANUAL_REVIEW'
  const nextSteps = <NextSteps offer={offer} reason={ex?.reason} canSubmit={p.canSubmit || !p.canFill} />
  return <>
    {p.context?.statement && <StatementBanner offer={offer} statement={p.context.statement} />}
    <OfferHero offer={offer} context={p.context} overpaymentRub={overpaymentRub} action={{
      canFill: p.canFill, canSubmit: p.canSubmit, applicationId: p.applicationId, onOpenApplication: p.onOpenApplication,
      busy: p.creating, busyTarget: p.creatingTarget, onContinue: p.onContinue, fullLimitReady: p.fullLimitReady,
      recalculating: p.recalculating, onRecalculate: p.onRecalculate, onEditAnswers: p.onEditAnswers,
    }} />
    {p.notice}
    {manual && nextSteps}
    {wantsSeasonal && <SeasonalCard data={seasonal.data} loading={seasonal.isPending} error={seasonal.error} onRetry={() => { void seasonal.refetch() }} />}
    <Grid columns={2}>
      <CostCard offer={offer} overpaymentRub={overpaymentRub} />
      <ConditionsCard offer={offer} />
    </Grid>
    <WhyCard ex={ex} loading={exLoading} error={exError} onRetry={retryEx} />
    {adviceSection()}
    {isOverdraft(offer) && <ErrorBoundary compact>
      <ForecastCard businessId={p.businessId} overdraftKopecks={offer.limit_kopecks} title="Прогноз остатка с этим лимитом" />
    </ErrorBoundary>}
    {!manual && nextSteps}
  </>
}
