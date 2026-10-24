import { Application, Forecast, Offer } from '../../api'
import { useMyApplications } from '../../queries'
import type { CurrentOverdraft } from '../ForecastCard'
import type { OfferContext } from '../offerStore'
import { foreignLoans, latestApplication, latestIssued, useApplicationDecision, useLoan } from './data'
import type { RefinanceCardProps } from './RefinanceCard'
import { buildTips, Tip } from './tips'

type SavedOffer = { id: string; offer: Offer; context?: OfferContext } | null

/**
 * Данные для «Перенесите кредит в Альфу» и «Подсказок для бизнеса».
 * Пока что-то грузится или упало — карточки просто не показываются (это дополнения к главной, не основной сценарий).
 */
export function useInsights({ businessId, forecast, saved, canCalc, onRefinance, onCalc, onPickOverdraft, overdraft }: {
  businessId: string
  forecast: Forecast | undefined
  saved: SavedOffer
  canCalc: boolean
  onRefinance: () => void
  onCalc: () => void
  onPickOverdraft: (rubles: number) => void
  /** Овердрафт, который уже выдан или в работе — подсказки не предлагают подобрать новый */
  overdraft?: CurrentOverdraft
}): { refinance: RefinanceCardProps | null; tips: Tip[]; ready: boolean } {
  const apps = useMyApplications(businessId)
  const items = apps.data?.items ?? []

  const issued = latestIssued(items)
  const issuedRefinance = latestIssued(items, 'REFINANCE')
  const loan = useLoan(issued?.id)
  const refinanceLoan = useLoan(issuedRefinance?.id)

  const activeId = apps.data?.active_id ?? items.find(i => i.active)?.id
  const latestId = latestApplication(items)?.id
  const activeApp = useApplicationDecision(activeId)
  const latestApp = useApplicationDecision(latestId !== activeId ? latestId : undefined)

  const loans = foreignLoans(forecast?.recurring)
  const activeRefinance = items.find(i => i.active && i.product === 'REFINANCE') ?? null
  const refinanceOffer = saved?.offer.product === 'REFINANCE' ? saved : null
  const issuedRef = issuedRefinance && refinanceLoan.data ? { item: issuedRefinance, loan: refinanceLoan.data } : null

  const refinance: RefinanceCardProps | null = loans.length
    ? { loans, issued: issuedRef, active: activeRefinance, offer: refinanceOffer, onCalc: onRefinance, canCalc }
    : null
  const loanPaymentShown = !!(refinance && issuedRef?.loan.next_payment && issued?.id === issuedRef.item.id)

  const tips = buildTips({
    forecast,
    refinanceBanks: refinance ? loans.map(l => l.counterparty) : [],
    loan: issued && loan.data ? { item: issued, loan: loan.data } : null,
    loanPaymentShown,
    offer: saved,
    decisions: [activeApp.data, latestApp.data].filter((a): a is Application => !!a),
    canCalc, onCalc, onPickOverdraft, overdraft,
  })

  // Ждём основные запросы, чтобы карточки не «прыгали» по мере загрузки
  const ready = !!forecast && !apps.isPending && !(issued && loan.isPending) && !(issuedRefinance && refinanceLoan.isPending)
    && !(activeId && activeApp.isPending)
  return { refinance: ready ? refinance : null, tips: ready ? tips : [], ready }
}
