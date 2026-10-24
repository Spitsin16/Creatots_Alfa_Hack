import { ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@alfalab/core-components/button/esm'
import { Radio } from '@alfalab/core-components/radio/esm'
import { RadioGroup } from '@alfalab/core-components/radio-group/esm'
import { Typography } from '@alfalab/core-components/typography/esm'
import { ArrowRightMIcon } from '@alfalab/icons-glyph/ArrowRightMIcon'
import { CalendarMIcon } from '@alfalab/icons-glyph/CalendarMIcon'
import { CheckmarkCircleMIcon } from '@alfalab/icons-glyph/CheckmarkCircleMIcon'
import { ArrowsCwMIcon } from '@alfalab/icons-glyph/ArrowsCwMIcon'
import { InformationCircleMIcon } from '@alfalab/icons-glyph/InformationCircleMIcon'
import { LightningMIcon } from '@alfalab/icons-glyph/LightningMIcon'
import { UsersMIcon } from '@alfalab/icons-glyph/UsersMIcon'
import { productName } from '../../api'
import { Card, Money, StatusTag } from '../../ui'
import { OfferContext } from '../offerStore'
import { ApplyTarget, CounterTerms, OfferData, amountLabel, creditKopecks, formatDate, formatRate, hasHeadroom, isExpired, isOverdraft, loanCost, months, rub } from './offerMath'
import styles from './offer.module.css'

const badge: Record<string, { status: string; text: string }> = {
  APPROVED: { status: 'APPROVED', text: 'Предварительно одобрено' },
  MANUAL_REVIEW: { status: 'MANUAL_REVIEW', text: 'Решение примет специалист' },
  COUNTER_OFFER: { status: 'COUNTER_OFFER', text: 'Встречное предложение' },
}

export type HeroAction = {
  /** Есть право готовить заявку (FILL) */
  canFill: boolean
  /** Есть право отправить заявку (SUBMIT) — иначе это бухгалтер по МЧД */
  canSubmit: boolean
  /** Заявка по этому расчёту уже создана */
  applicationId?: string
  onOpenApplication: (applicationId: string) => void
  busy: boolean
  busyTarget?: ApplyTarget
  onContinue: (target: ApplyTarget) => void
  /** Весь лимит овердрафта можно оформить сразу (файл выписки, если она была, ещё в памяти вкладки) */
  fullLimitReady: boolean
  /** Срок расчёта истёк — заявку по нему не создать, пересчитываем по тем же ответам */
  recalculating: boolean
  onRecalculate: () => void
  onEditAnswers: () => void
}

/**
 * Каркас героя: шапка (продукт, сумма), правая колонка с кнопкой и детали (плитки, сравнение).
 * На телефоне кнопка встаёт сразу под суммой, детали — ниже.
 */
function HeroLayout({ head, aside, details }: { head: ReactNode; aside: ReactNode; details: ReactNode }) {
  return <Card view="dark" as="section">
    <div className={styles.heroGrid}>
      <div className={styles.heroHead}>{head}</div>
      {aside}
      <div className={styles.heroDetails}>{details}</div>
    </div>
  </Card>
}

/** Главная карточка предложения: продукт, крупная сумма, «вы запросили», ставка/срок/платёж и кнопка «Оформить заявку». */
export function OfferHero({ offer, context, overpaymentRub, action }: {
  offer: OfferData; context?: OfferContext; overpaymentRub?: number | null; action: HeroAction
}) {
  const overdraft = isOverdraft(offer)
  const amount = overdraft ? offer.limit_kopecks : creditKopecks(offer)
  const requested = offer.requested_amount_kopecks
  const fits = requested <= offer.limit_kopecks
  const preliminary = offer.outcome === 'MANUAL_REVIEW'
  const b = isExpired(offer) && !action.applicationId ? { status: 'EXPIRED', text: 'Срок расчёта истёк' } : badge[offer.outcome] ?? badge.APPROVED
  const uplift = context?.statement && context.statement.previousLimitKopecks < offer.limit_kopecks ? context.statement : null
  const refinance = context?.refinance && offer.payment_kopecks != null ? context.refinance : null
  const newPaymentRub = (offer.payment_kopecks ?? 0) / 100
  const cost = loanCost(offer, overpaymentRub)

  let requestLine: ReactNode
  if (refinance) {
    requestLine = <>Перекрываем долг в другом банке — платёж станет меньше на {rub({ rubles: Math.max(0, refinance.oldPaymentRub - newPaymentRub) })} в месяц</>
  } else if (fits && !overdraft && offer.limit_kopecks > requested) {
    requestLine = <>Вы запросили {rub({ kopecks: requested })} — укладываемся. {preliminary ? 'Предварительно доступно' : 'Доступно'} до {rub({ kopecks: offer.limit_kopecks })} — <Link className={styles.heroLink} to="/">изменить сумму</Link></>
  } else if (hasHeadroom(offer)) {
    requestLine = <>Вы запросили {rub({ kopecks: requested })} — укладываемся с запасом. Оформить можно столько, сколько просили, или весь лимит</>
  } else if (fits) {
    requestLine = <>Вы запросили {rub({ kopecks: requested })} — укладываемся</>
  } else {
    requestLine = <>Вы запросили {rub({ kopecks: requested })} — {preliminary ? 'предварительно можем' : 'можем'} меньше: до {rub({ kopecks: offer.limit_kopecks })}</>
  }

  const head = <>
    <div className={styles.heroTopRow}>
      <StatusTag status={b.status} view="contrast">{b.text}</StatusTag>
      <Typography.Title tag="h2" view="xsmall" font="system" className={styles.heroProduct}>{productName(offer.product)}</Typography.Title>
    </div>
    <div className={styles.heroLabel}>{amountLabel(offer.product)}{preliminary ? ', предварительно' : ''}</div>
    <div className={styles.heroAmountRow}>
      <div className={styles.heroAmount}><Money kopecks={amount} tone="inverted" /></div>
      {uplift && <>
        <span className={styles.wasAmount} aria-label={`было ${rub({ kopecks: uplift.previousLimitKopecks })}`}>{rub({ kopecks: uplift.previousLimitKopecks })}</span>
        <span className={styles.upliftPill}>+{rub({ kopecks: offer.limit_kopecks - uplift.previousLimitKopecks })} по выписке</span>
      </>}
    </div>
    <div className={styles.heroRequest}>
      {fits || refinance ? <CheckmarkCircleMIcon className={styles.iconPositiveInv} aria-hidden /> : <InformationCircleMIcon className={styles.iconAttentionInv} aria-hidden />}
      <span>{requestLine}</span>
    </div>
  </>

  const details = <>
    <div className={styles.heroTiles}>
      <HeroTile label="Ставка годовых" value={formatRate(offer.rate)} hint={preliminary ? 'предварительно' : undefined} />
      <HeroTile label={overdraft ? 'Срок лимита' : 'Срок'} value={months(offer.term_months)} />
      {overdraft
        ? <HeroTile label="Проценты" value="по дням" hint="только за дни, когда на счёте минус" />
        : refinance && cost
          ? <HeroTile label="Переплата за срок" value={<Money kopecks={cost.interest} tone="inverted" />} hint={cost.fromBank ? 'по графику банка, только проценты' : 'расчётно, только проценты'} />
          : <HeroTile label="Платёж в месяц" value={offer.payment_kopecks ? <Money kopecks={offer.payment_kopecks} tone="inverted" /> : '—'} hint="равными платежами" />}
    </div>
    {refinance && <PaymentCompare oldRub={refinance.oldPaymentRub} newRub={newPaymentRub} savingRub={Math.max(0, refinance.oldPaymentRub - newPaymentRub)} termMonths={offer.term_months} />}
  </>

  return <HeroLayout head={head} details={details} aside={<HeroAside offer={offer} action={action} />} />
}

function HeroTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return <div className={styles.heroTile}>
    <div className={styles.heroTileLabel}>{label}</div>
    <div className={styles.heroTileValue}>{value}</div>
    {hint && <div className={styles.heroTileHint}>{hint}</div>}
  </div>
}

/** Правая колонка героя: главная кнопка экрана, выбор суммы овердрафта и срок действия предложения. */
function HeroAside({ offer, action }: { offer: OfferData; action: HeroAction }) {
  const [target, setTarget] = useState<ApplyTarget>('requested')
  const accountant = action.canFill && !action.canSubmit

  // Заявка из этого расчёта уже есть («назад» после оформления) — второй не создаём
  if (action.applicationId) {
    const appId = action.applicationId
    return <aside className={styles.heroAside} aria-label="Оформление">
      <Button view="accent" size={48} block onClick={() => action.onOpenApplication(appId)}>Открыть заявку</Button>
      <div className={styles.asideNote}><CheckmarkCircleMIcon aria-hidden /><span><span className={styles.asideStrong}>Заявка уже создана</span> по этому предложению — она в «Моих заявках». Вторую создавать не нужно.</span></div>
    </aside>
  }

  if (isExpired(offer)) return <aside className={styles.heroAside} aria-label="Оформление">
    {action.canFill && <Button view="accent" size={48} block loading={action.recalculating} disabled={action.recalculating} onClick={action.onRecalculate}>Пересчитать предложение</Button>}
    <div className={styles.asideNote}><CalendarMIcon aria-hidden /><span>Расчёт действовал до {formatDate(offer.expires_at)} — <span className={styles.asideStrong}>срок истёк</span>. Пересчитаем по тем же ответам и свежим данным за несколько секунд.</span></div>
  </aside>

  // Овердрафт с запасом: бэк заводит заявку на запрошенную сумму — даём явно выбрать, на сколько оформить
  const headroom = action.canFill && hasHeadroom(offer)
  const requested = offer.requested_amount_kopecks
  const choice = headroom && action.fullLimitReady ? target : 'requested'
  const busyLimit = action.busy && action.busyTarget === 'limit'

  return <aside className={styles.heroAside} aria-label="Оформление">
    {headroom && (action.fullLimitReady
      ? <div className={styles.amountChoice}>
          <div className={styles.amountChoiceLabel} id="offer-amount-choice">В заявку пойдёт</div>
          <RadioGroup name="offer-amount" value={choice} onChange={(_, { value }) => setTarget(value === 'limit' ? 'limit' : 'requested')}
            disabled={action.busy} aria-labelledby="offer-amount-choice" className={styles.amountRadios}>
            <Radio value="requested" colors="inverted" size={24} label={<span className={styles.amountOption}>{rub({ kopecks: requested })}</span>} hint="как вы запросили" />
            <Radio value="limit" colors="inverted" size={24} label={<span className={styles.amountOption}>{rub({ kopecks: offer.limit_kopecks })}</span>} hint="весь лимит — проценты всё равно только за дни с минусом" />
          </RadioGroup>
        </div>
      : <div className={styles.asideNote}><InformationCircleMIcon aria-hidden /><span>В заявку пойдёт <span className={styles.asideStrong}>{rub({ kopecks: requested })}</span> — как вы запросили. Чтобы оформить весь лимит {rub({ kopecks: offer.limit_kopecks })}, укажите эту сумму в <button type="button" className={styles.inlineLink} onClick={action.onEditAnswers}>анкете</button> и загрузите выписку ещё раз.</span></div>)}
    {action.canFill
      ? <Button view="accent" size={48} block loading={action.busy} disabled={action.busy} onClick={() => action.onContinue(choice)}>
          {accountant ? 'Подготовить заявку' : 'Оформить заявку'}
        </Button>
      : <div className={styles.asideNote}><InformationCircleMIcon aria-hidden /><span>Оформить заявку может владелец бизнеса или сотрудник с правом подготовки заявок.</span></div>}
    {busyLimit && <div className={styles.asideNote} role="status"><ArrowsCwMIcon aria-hidden /><span>Пересчитываем на весь лимит {rub({ kopecks: offer.limit_kopecks })} и создаём заявку…</span></div>}
    {accountant && <div className={styles.asideNote}><UsersMIcon aria-hidden /><span><span className={styles.asideStrong}>Отправит руководитель.</span> Вы готовите заявку, а директор проверяет и отправляет её в банк.</span></div>}
    {action.canFill && !busyLimit && <div className={styles.asideNote}><LightningMIcon aria-hidden /><span>{choice === 'limit'
      ? 'Сначала пересчитаем предложение на весь лимит, затем создадим заявку — пара секунд.'
      : 'Анкета и данные о бизнесе уже заполнены — заявка создаётся за секунду.'}</span></div>}
    {offer.expires_at && <div className={styles.asideNote}><CalendarMIcon aria-hidden /><span>Предложение действует до <span className={styles.asideStrong}>{formatDate(offer.expires_at)}</span></span></div>}
  </aside>
}

/**
 * «Платёж сейчас → у нас» и экономия в месяц (числа — из встречного предложения банка).
 * Экономию за срок бэк не отдаёт (неизвестен остаток срока долга в другом банке), поэтому честно
 * показываем расчётный пример за год и напоминаем, что срок длиннее (переплата — в плитках выше).
 */
function PaymentCompare({ oldRub, newRub, savingRub, termMonths }: { oldRub: number; newRub: number; savingRub: number; termMonths: number }) {
  return <>
    <div className={styles.compare}>
      <div className={styles.compareCell}>
        <div className={styles.heroTileLabel}>Платёж сейчас</div>
        <div className={styles.heroTileValue}><span className={styles.compareValueOld}>{rub({ rubles: oldRub })}</span></div>
        <div className={styles.heroTileHint}>в другом банке</div>
      </div>
      <ArrowRightMIcon className={styles.compareArrow} aria-hidden />
      <div className={styles.compareCell}>
        <div className={styles.heroTileLabel}>Платёж у нас</div>
        <div className={styles.heroTileValue}><Money rubles={newRub} tone="inverted" /></div>
        <div className={styles.heroTileHint}>в месяц</div>
      </div>
      <div className={[styles.compareCell, styles.compareCellSaving].join(' ')}>
        <div className={styles.heroTileLabel}>Экономия в месяц</div>
        <div className={[styles.heroTileValue, styles.compareValueSaving].join(' ')}>{rub({ rubles: savingRub })}</div>
        <div className={styles.heroTileHint}>по расчёту банка</div>
      </div>
    </div>
    <p className={styles.compareNote}>
      За первый год отдадите на <b>≈ {rub({ rubles: savingRub * 12 })}</b> меньше (расчётно: {rub({ rubles: savingRub })} × 12).
      {' '}Платёж ниже ещё и потому, что срок длиннее — {months(termMonths)}: переплата за весь срок указана выше.
    </p>
  </>
}

/**
 * Встречное предложение без суммы по исходному запросу (p1b): банк не даёт новый кредит,
 * но предлагает рефинансировать чужой долг — показываем его условия и «платёж сейчас → после».
 */
export function CounterHero({ offer, terms, canFill, busy, onRefinance }: {
  offer: OfferData; terms: CounterTerms; canFill: boolean; busy: boolean; onRefinance: () => void
}) {
  const refinance = terms.product === 'REFINANCE'
  // переплата по встречному предложению: платёж × срок − сумма (расчётно)
  const overpay = terms.new_payment != null ? Math.max(0, terms.new_payment * terms.term - terms.amount) : null

  const head = <>
    <div className={styles.heroTopRow}>
      <StatusTag status="COUNTER_OFFER" view="contrast">Встречное предложение</StatusTag>
      <Typography.Title tag="h2" view="xsmall" font="system" className={styles.heroProduct}>{productName(terms.product)}</Typography.Title>
    </div>
    <p className={styles.counterWhy}>
      <b>{productName(offer.product)} на {rub({ kopecks: offer.requested_amount_kopecks })} сейчас не выдадим</b> — почему, рассказываем ниже.
      {refinance ? ' Зато можем снизить платёж по долгу в другом банке, и появится место для новых целей.' : ''}
    </p>
    <div className={styles.heroLabel}>{amountLabel(terms.product)}</div>
    <div className={styles.heroAmountRow}><div className={styles.heroAmount}><Money rubles={terms.amount} tone="inverted" /></div></div>
  </>

  const details = <>
    <div className={styles.heroTiles}>
      <HeroTile label="Ставка годовых" value={formatRate(terms.rate)} hint="предварительно" />
      <HeroTile label="Срок" value={months(terms.term)} />
      {overpay != null && <HeroTile label="Переплата за срок" value={<Money rubles={overpay} tone="inverted" />} hint="расчётно, только проценты" />}
    </div>
    {terms.old_payment != null && terms.new_payment != null && <PaymentCompare
      oldRub={terms.old_payment} newRub={terms.new_payment} savingRub={terms.saving_per_month ?? Math.max(0, terms.old_payment - terms.new_payment)}
      termMonths={terms.term} />}
  </>

  const aside = <aside className={styles.heroAside} aria-label="Рефинансирование">
    {canFill && refinance && <Button view="accent" size={48} block className={styles.asideButton} loading={busy} disabled={busy} onClick={onRefinance}>Рассчитать рефинансирование</Button>}
    {!canFill && <div className={styles.asideNote}><InformationCircleMIcon aria-hidden /><span>Пересчитать предложение может владелец бизнеса или сотрудник с правом подготовки заявок.</span></div>}
    <div className={styles.asideNote}><LightningMIcon aria-hidden /><span>Посчитаем точные условия по вашим данным за несколько секунд. Заявка при этом не создаётся.</span></div>
    {offer.expires_at && <div className={styles.asideNote}><CalendarMIcon aria-hidden /><span>Расчёт действует до <span className={styles.asideStrong}>{formatDate(offer.expires_at)}</span></span></div>}
  </aside>

  return <HeroLayout head={head} details={details} aside={aside} />
}
