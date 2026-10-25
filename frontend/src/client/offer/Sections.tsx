import { ReactNode, useState } from 'react'
import { Button } from '@alfalab/core-components/button/esm'
import { Typography } from '@alfalab/core-components/typography/esm'
import { ArrowRightMIcon } from '@alfalab/icons-glyph/ArrowRightMIcon'
import { CheckmarkCircleMIcon } from '@alfalab/icons-glyph/CheckmarkCircleMIcon'
import { CheckmarkMIcon } from '@alfalab/icons-glyph/CheckmarkMIcon'
import { ChevronDownMIcon } from '@alfalab/icons-glyph/ChevronDownMIcon'
import { Document1CMIcon } from '@alfalab/icons-glyph/Document1CMIcon'
import { ExclamationCircleMIcon } from '@alfalab/icons-glyph/ExclamationCircleMIcon'
import { InformationCircleMIcon } from '@alfalab/icons-glyph/InformationCircleMIcon'
import { MagicWandMIcon } from '@alfalab/icons-glyph/MagicWandMIcon'
import { productName } from '../../api'
import { Card, ErrorState, Grid, KeyValue, LoadingState, Money } from '../../ui'
import { OfferContext } from '../offerStore'
import { OfferData, OfferExplanation, formatDate, formatRate, formatShortDate, isExpired, isOverdraft, loanCost, months, nb, overdraftCost, rub } from './offerMath'
import styles from './offer.module.css'

/** «Выписка учтена: было → стало». Показывается на новом расчёте сразу после загрузки выписки. */
export function StatementBanner({ offer, statement }: { offer: OfferData; statement: NonNullable<OfferContext['statement']> }) {
  const grew = offer.limit_kopecks - statement.previousLimitKopecks
  return <div className={styles.uplift} role="status">
    <div className={styles.upliftIcon} aria-hidden><Document1CMIcon /></div>
    <div>
      <div className={styles.upliftTitle}>{grew > 0 ? `Выписка учтена — сумма выросла на ${rub({ kopecks: grew })}` : 'Выписка учтена'}</div>
      <div className={styles.upliftFlow}>
        <span>Было <b>{rub({ kopecks: statement.previousLimitKopecks })}</b></span>
        <ArrowRightMIcon aria-hidden />
        <span>стало <b>{rub({ kopecks: offer.limit_kopecks })}</b></span>
      </div>
      <div className={styles.upliftText}>
        Посчитали по всей выручке: в другом банке за {months(statement.fullMonths)}
        {statement.period ? ` (${formatShortDate(statement.period[0])} – ${formatShortDate(statement.period[1])})` : ''} в среднем {rub({ kopecks: statement.avgRevenueKopecks })} в месяц.
      </div>
    </div>
  </div>
}

/** Полная стоимость в рублях. Кредит — платёж × срок − сумма; овердрафт — проценты за дни использования и пример. */
export function CostCard({ offer, overpaymentRub }: { offer: OfferData; overpaymentRub?: number | null }) {
  const loan = loanCost(offer, overpaymentRub)
  const od = overdraftCost(offer)
  const refinance = offer.product === 'REFINANCE'
  if (loan) {
    const share = loan.total > 0 ? (loan.principal / loan.total) * 100 : 100
    return <Card title="Сколько это стоит" subtitle="Полная стоимость — только проценты: комиссий и страховок нет">
      <div className={styles.costBar} role="img" aria-label={`Из ${rub({ kopecks: loan.total })}: кредит ${rub({ kopecks: loan.principal })}, проценты ${rub({ kopecks: loan.interest })}`}>
        <div className={styles.costBarPrincipal} style={{ width: `${share}%` }} />
        <div className={styles.costBarInterest} style={{ width: `${100 - share}%` }} />
      </div>
      <div className={styles.costLegend}>
        <span><i className={[styles.swatch, styles.swatchPrincipal].join(' ')} />{refinance ? 'долг, который перекрываем' : 'сам кредит'}</span>
        <span><i className={[styles.swatch, styles.swatchInterest].join(' ')} />проценты</span>
      </div>
      <KeyValue items={[
        refinance
          ? { label: 'Перекроем долг в другом банке', value: <Money kopecks={loan.principal} weight="medium" />, hint: 'сразу уйдёт на погашение' }
          : { label: 'Вы получите', value: <Money kopecks={loan.principal} weight="medium" /> },
        { label: `Вернёте за ${months(offer.term_months)}`, value: <Money kopecks={loan.total} weight="medium" />, hint: loan.fromBank ? 'по графику банка: сумма + проценты' : 'расчётно: платёж × срок' },
        { label: 'Переплата (проценты)', value: <Money kopecks={loan.interest} />, hint: loan.fromBank ? 'по графику банка, равными платежами' : 'расчётно, если платить по графику' },
        { label: 'Комиссии и страховки', value: '0 ₽' },
      ]} />
      <div className={styles.costNote}>Погасите раньше — процентов будет меньше: досрочное погашение без штрафа.</div>
    </Card>
  }
  if (od) {
    return <Card title="Сколько это стоит" subtitle="Проценты — только за дни, когда вы пользуетесь деньгами. Не пользуетесь — не платите">
      <KeyValue items={[
        { label: 'Ставка', value: `${formatRate(offer.rate)} годовых` },
        {
          key: 'example',
          label: <>Пример: взяли {rub({ kopecks: od.exampleKopecks })} на {od.exampleDays}{'\u00a0'}дней</>,
          value: <Money kopecks={od.exampleInterest} prefix="≈" weight="medium" />, hint: 'пример, расчётно',
        },
        {
          key: 'max',
          label: <>Весь лимит {rub({ kopecks: offer.limit_kopecks })} весь срок {months(offer.term_months)}</>,
          value: <Money kopecks={od.maxInterest} prefix="≈" />, hint: 'пример-максимум, расчётно',
        },
        { label: 'Комиссии и страховки', value: '0 ₽' },
      ]} />
      <div className={styles.costNote}>
        Если весь лимит использовать весь срок — около {rub({ kopecks: od.maxInterest })} процентов. Это верхняя граница: платите только за дни, когда на счёте минус.
      </div>
    </Card>
  }
  return null
}

/**
 * «Стоимость и условия» одной строкой, подробности — по нажатию (правка ментора 25.10: на экране слишком много блоков).
 * В свёрнутом виде — главное: сколько стоит, комиссий нет, до какого числа действует.
 */
export function CostAndConditions({ offer, overpaymentRub }: { offer: OfferData; overpaymentRub?: number | null }) {
  const [open, setOpen] = useState(false)
  const loan = loanCost(offer, overpaymentRub)
  const od = overdraftCost(offer)
  const cost = loan
    ? `переплата ${rub({ kopecks: loan.interest })} за ${months(offer.term_months)}`
    : od ? `${formatRate(offer.rate)} годовых, ${rub({ kopecks: od.exampleKopecks })} на ${od.exampleDays}\u00a0дней ≈ ${rub({ kopecks: od.exampleInterest })}` : null
  const summary = [cost, 'комиссий и страховок нет', 'досрочно без штрафа',
    !isExpired(offer) && offer.expires_at ? `действует до ${formatDate(offer.expires_at)}` : null].filter(Boolean).join(' · ')
  return <section className={[styles.more, open ? styles.moreOpen : ''].filter(Boolean).join(' ')}>
    <button type="button" className={styles.moreToggle} onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="offer-cost-details">
      <span className={styles.moreText}>
        <Typography.Title tag="h2" view="small" font="system" className={styles.moreTitle}>Стоимость и условия</Typography.Title>
        <span className={styles.moreSummary}>{summary}</span>
      </span>
      <span className={styles.moreAction}>{open ? 'Свернуть' : 'Подробнее'}<ChevronDownMIcon className={styles.moreChevron} aria-hidden /></span>
    </button>
    <div id="offer-cost-details" className={styles.morePanel}>
      <div className={styles.moreInner}>
        <Grid columns={2}>
          <CostCard offer={offer} overpaymentRub={overpaymentRub} />
          <ConditionsCard offer={offer} />
        </Grid>
      </div>
    </div>
  </section>
}

/** Явный блок условий из ТЗ: досрочное погашение, комиссии, страховки, срок действия. */
export function ConditionsCard({ offer }: { offer: OfferData }) {
  const fixed = offer.outcome === 'APPROVED'
  const expired = isExpired(offer)
  const validity = expired
    ? {
        title: `Срок предложения истёк ${formatDate(offer.expires_at)}`,
        text: 'Предложение действует 30 дней. Пересчитайте его — условия обновятся по свежим данным.',
        info: true,
      }
    : {
        title: offer.expires_at ? `Предложение действует 30 дней — до ${formatDate(offer.expires_at)}` : 'Предложение действует 30 дней',
        text: fixed ? 'Условия зафиксированы: в договор попадут без изменений.'
          : offer.outcome === 'COUNTER_OFFER' ? 'Это встречное предложение — окончательные условия банк подтвердит в решении по заявке.'
            : 'Условия предварительные — окончательные назовёт специалист банка.',
        info: !fixed,
      }
  const items: { title: string; text: ReactNode; info?: boolean }[] = [
    { title: 'Досрочное погашение без штрафа', text: isOverdraft(offer) ? 'Гасите минус в любой день — проценты перестают начисляться.' : 'Можно вернуть часть или весь кредит раньше срока — штрафов нет.' },
    { title: 'Комиссии — 0 ₽', text: 'Ни за выдачу, ни за обслуживание, ни за досрочное погашение.' },
    { title: 'Страховка и залог не нужны', text: 'Решение — по оборотам бизнеса, без справок и визита в офис.' },
    validity,
  ]
  return <Card title="Условия">
    <ul className={styles.conditions}>
      {items.map(i => <li key={i.title} className={styles.condition}>
        {i.info ? <InformationCircleMIcon className={[styles.conditionIcon, styles.conditionIconInfo].join(' ')} aria-hidden /> : <CheckmarkCircleMIcon className={styles.conditionIcon} aria-hidden />}
        <div><div className={styles.conditionTitle}>{i.title}</div><div className={styles.conditionText}>{i.text}</div></div>
      </li>)}
    </ul>
  </Card>
}

/** «Почему такая сумма»: текст банка, сильные стороны и что сдерживает (словами, без баллов) и пересказ ИИ, если есть. */
export function WhyCard({ ex, loading, error, onRetry, title = 'Почему такая сумма' }: {
  ex?: OfferExplanation; loading: boolean; error: unknown; onRetry: () => void; title?: string
}) {
  return <Card title={title} subtitle="Считали по оборотам и кредитной истории бизнеса — справки не понадобились">
    {loading && <LoadingState view="skeleton" rows={3} label="Загружаем объяснение…" />}
    {!loading && error != null && <ErrorState error={error} title="Не получилось загрузить объяснение" onRetry={onRetry} />}
    {ex && <>
      {ex.why_amount && <p className={styles.why}>{nb(ex.why_amount)}</p>}
      <Factors {...factorsOf(ex)} />
      {ex.summary && <AiSummary text={nb(ex.summary)} />}
    </>}
  </Card>
}

function Factors({ strengths, weaknesses }: { strengths: string[]; weaknesses: string[] }) {
  if (strengths.length === 0 && weaknesses.length === 0) return null
  const single = strengths.length === 0 || weaknesses.length === 0
  return <div className={[styles.factors, single ? styles.factorsSingle : ''].filter(Boolean).join(' ')}>
    {strengths.length > 0 && <div className={styles.factorCol}>
      <div className={styles.factorTitle}>Что помогло</div>
      <ul className={styles.factorList}>{strengths.map(s => <li key={s} className={styles.factorItem}><CheckmarkMIcon className={styles.plus} aria-hidden /><span>{nb(capitalize(s))}</span></li>)}</ul>
    </div>}
    {weaknesses.length > 0 && <div className={styles.factorCol}>
      <div className={styles.factorTitle}>Что сдерживает</div>
      <ul className={styles.factorList}>{weaknesses.map(s => <li key={s} className={styles.factorItem}><ExclamationCircleMIcon className={styles.minus} aria-hidden /><span>{nb(capitalize(s))}</span></li>)}</ul>
    </div>}
  </div>
}

function AiSummary({ text }: { text: string }) {
  return <div className={styles.ai}>
    <div className={styles.aiHead}><MagicWandMIcon aria-hidden />Коротко</div>
    <p className={styles.aiText}>{text}</p>
    <div className={styles.aiCaption}>Сформулировано ИИ по данным расчёта, все цифры сверены с расчётом банка</div>
  </div>
}

// После загрузки выписки бэк оставляет в «сдерживает» фактор «часть оборотов идёт через другие банки — мы её не видим».
// Выручку из выписки уже учли, значит, она больше не сдерживает: убираем фактор и пишем это в «что помогло».
const otherBanks = /через други[ей] банк/i
function factorsOf(ex: OfferExplanation): { strengths: string[]; weaknesses: string[] } {
  if (!ex.statement_applied) return { strengths: ex.strengths, weaknesses: ex.weaknesses }
  const seen = 'выручку из другого банка учли по выписке 1С'
  return {
    strengths: ex.strengths.includes(seen) ? ex.strengths : [seen, ...ex.strengths],
    weaknesses: ex.weaknesses.filter(w => !otherBanks.test(w)),
  }
}

const capitalize = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s

/** Что будет после «Оформить заявку» — коротко, по шагам. */
export function NextSteps({ offer, reason, canSubmit }: { offer: OfferData; reason: string | null | undefined; canSubmit: boolean }) {
  const manual = offer.outcome === 'MANUAL_REVIEW'
  const docs = 'Если понадобятся документы — попросим в кабинете и в чате заявки. Звонков не будет.'
  const steps: { title: string; text: string }[] = [
    { title: canSubmit ? 'Оформите заявку' : 'Подготовьте заявку', text: 'Данные уже заполнены — проверьте и нажмите одну кнопку.' },
  ]
  if (!canSubmit) steps.push({ title: 'Руководитель отправит', text: 'Заявка будет ждать подписи директора — он отправит её в банк.' })
  if (manual) {
    const why = reason ? nb(reason) : null
    steps.push({ title: 'Решение примет специалист', text: canSubmit ? (why ?? 'Специалист банка проверит данные и примет решение.') : `${why ?? 'Специалист банка проверит данные.'} ${docs}` })
    if (canSubmit) steps.push({ title: 'Документы — только если попросим', text: docs })
  } else {
    steps.push({ title: 'Банк проверит данные', text: 'Статус и срок ответа видны в трекере заявки, он обновляется сам.' })
  }
  steps.push(canSubmit
    ? { title: 'Подпишите кодом — деньги на счёте', text: 'Решение придёт в кабинет. Договор подписывается кодом, без визита в офис.' }
    : { title: 'Директор подпишет — деньги на счёте', text: 'Решение придёт в кабинет. Договор подписывается кодом, без визита в офис.' })
  return <Card title="Что будет дальше" subtitle={manual ? 'Эту заявку смотрит человек, а не только автоматика — вот как это будет' : undefined}>
    <ol className={[styles.steps, steps.length === 3 ? styles.steps3 : ''].filter(Boolean).join(' ')}>
      {steps.map(s => <li key={s.title} className={styles.step}><div className={styles.stepTitle}>{s.title}</div><div className={styles.stepText}>{s.text}</div></li>)}
    </ol>
  </Card>
}

/** Отказ по-человечески: причина словами, что ещё учли и что сделать. Без баллов и порогов. */
export function RejectedCard({ offer, ex, loading, error, onRetry, onRecalculate }: {
  offer: OfferData; ex?: OfferExplanation; loading: boolean; error: unknown; onRetry: () => void; onRecalculate: () => void
}) {
  return <Card>
    <div className={styles.rejectHead}>
      <div className={styles.rejectIcon} aria-hidden><InformationCircleMIcon /></div>
      <div>
        <Typography.Title tag="h2" view="small" font="system" className={styles.rejectTitle}>{ex?.headline ?? 'Сейчас выдать кредит не можем'}</Typography.Title>
        <div className={styles.rejectRequest}>
          Вы запрашивали: {productName(offer.product).toLowerCase()} на {rub({ kopecks: offer.requested_amount_kopecks })}, {months(offer.term_months)}
        </div>
      </div>
    </div>
    {loading && <div className={styles.rejectReason}><LoadingState view="skeleton" rows={2} label="Загружаем причину…" /></div>}
    {!loading && error != null && <div className={styles.rejectState}><ErrorState error={error} title="Не получилось загрузить причину" onRetry={onRetry} /></div>}
    {ex && <>
      <ReasonBlocks text={nb(ex.reason ?? ex.why_amount ?? 'По совокупности данных сейчас выдать кредит не можем.')} />
      {ex.weaknesses.length > 0 && <div className={styles.rejectReason}>
        <div className={styles.rejectLabel}>Что ещё повлияет на следующий расчёт</div>
        <ul className={styles.factorList}>{ex.weaknesses.map(s => <li key={s} className={styles.factorItem}><ExclamationCircleMIcon className={styles.minus} aria-hidden /><span>{nb(capitalize(s))}</span></li>)}</ul>
      </div>}
    </>}
    <div className={styles.rejectActions}>
      <Button view="secondary" size={48} onClick={onRecalculate}>Пересчитать, когда будет готово</Button>
    </div>
    <p className={styles.note}>Когда причина устранена, просто пересчитайте предложение: данные банка и кредитной истории подтянутся заново, справки не нужны.</p>
  </Card>
}

/**
 * Причина отказа от банка — одной фразой «что случилось. Что сделать — и когда вернуться».
 * Делим по первому предложению: слева причина, справа шаг клиента. Не делится — показываем целиком.
 */
function ReasonBlocks({ text }: { text: string }) {
  const m = text.match(/^(.+?[.!])\s+(.+)$/s)
  if (!m) return <div className={styles.rejectReason}>
    <div className={styles.rejectLabel}>Причина</div>
    <p className={styles.rejectText}>{text}</p>
  </div>
  return <div className={styles.reasonGrid}>
    <div className={styles.rejectReason}>
      <div className={styles.rejectLabel}>Причина</div>
      <p className={styles.rejectText}>{m[1]}</p>
    </div>
    <div className={[styles.rejectReason, styles.reasonTodo].join(' ')}>
      <div className={styles.rejectLabel}>Что сделать</div>
      <p className={styles.rejectText}>{m[2]}</p>
    </div>
  </div>
}
