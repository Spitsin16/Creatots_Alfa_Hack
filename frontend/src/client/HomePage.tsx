import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Button } from '@alfalab/core-components/button/esm'
import { Status } from '@alfalab/core-components/status/esm'
import { ArrowRightMIcon } from '@alfalab/icons-glyph/ArrowRightMIcon'
import { DocumentLinesMIcon } from '@alfalab/icons-glyph/DocumentLinesMIcon'
import { InformationCircleMIcon } from '@alfalab/icons-glyph/InformationCircleMIcon'
import { Offer, productName } from '../api'
import { useSession } from '../auth'
import { useMyApplications } from '../queries'
import { Bell, Card, EmptyState, ErrorState, Grid, LoadingState, Money, PageHeader, Stack, StatusTag } from '../ui'
import { consentUntil, useCalculateOffer } from './calculate'
import { ForecastCard, useForecast } from './ForecastCard'
import { lastOfferId, loadOffer } from './offerStore'
import { Answers, defaultAnswers, Questionnaire } from './Questionnaire'
import { RefinanceCard } from './home/RefinanceCard'
import { TipsCard } from './home/TipsCard'
import { useInsights } from './home/useInsights'
import styles from './HomePage.module.css'

const CALC_ID = 'calculator'

const greeting = () => {
  const h = new Date().getHours()
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'
}

// Главная клиента: деньги на счёте (прогноз), «доступно сейчас», активная заявка, «перенесите кредит в Альфу»,
// анкета расчёта и подсказки для бизнеса.
export function HomePage() {
  const { me } = useSession()
  const business = me.businesses[0]
  const location = useLocation()
  const calculate = useCalculateOffer({ minDuration: 1600 })
  const forecast = useForecast(business.id)
  const lastId = lastOfferId()
  const last = lastId ? loadOffer(lastId) : null
  const [answers, setAnswers] = useState<Answers>(() => last?.answers ?? defaultAnswers)
  const [prefilled, setPrefilled] = useState(!!last)
  const calcRef = useRef<HTMLDivElement>(null)
  const firstName = me.full_name.split(' ')[1] ?? me.full_name

  const scrollToCalc = () => calcRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // Ссылка «/#calculator» (например, из ассистента) сразу ведёт к анкете.
  useEffect(() => { if (location.hash === `#${CALC_ID}`) scrollToCalc() }, [location.hash, forecast.isPending])

  // «Подобрать овердрафт» из прогноза: заполняем анкету под кассовый разрыв и ведём к ней.
  const pickFromForecast = (rubles: number) => {
    setAnswers(a => ({ ...a, purpose: 'cash_gap', frequency: 'always', urgency: 'days', amount: rubles, term_months: Math.min(a.term_months || 12, 12) }))
    setPrefilled(true)
    scrollToCalc()
  }

  // «Перенесите кредит в Альфу»: цель «Снизить платёж по кредиту», сумму (остаток долга) клиент вводит сам.
  // Частота «постоянно под рукой» превратила бы расчёт в овердрафт — сбрасываем её на «один раз».
  const pickRefinance = () => {
    setAnswers(a => ({ ...a, purpose: 'refinance', frequency: a.frequency === 'always' ? 'once' : a.frequency }))
    scrollToCalc()
  }

  const insights = useInsights({
    businessId: business.id, forecast: forecast.data, saved: last && lastId ? { id: lastId, offer: last.offer, context: last.context } : null,
    canCalc: business.permissions.includes('FILL'), onRefinance: pickRefinance, onCalc: scrollToCalc, onPickOverdraft: pickFromForecast,
  })

  return <Stack>
    <PageHeader eyebrow={business.name} title={`${greeting()}, ${firstName}`}
      subtitle="Подберём финансирование по оборотам вашего бизнеса — без справок и визита в офис." actions={<Bell />} />

    <ProxyNotice />

    <Grid columns="minmax(0, 1.55fr) minmax(0, 1fr)" align="stretch" className={styles.top}>
      <ForecastCard businessId={business.id} onPick={pickFromForecast} className={styles.forecast} />
      <div className={styles.side}>
        <AvailableCard offerId={lastId} offer={last?.offer ?? null} onCalc={scrollToCalc} />
        <ApplicationCard businessId={business.id} />
      </div>
    </Grid>

    {insights.refinance && <RefinanceCard {...insights.refinance} />}

    <div ref={calcRef} id={CALC_ID} className={styles.anchor}>
      <Questionnaire value={answers} onChange={setAnswers} onSubmit={a => calculate.mutate(a)}
        busy={calculate.isPending} error={calculate.error} permissions={business.permissions}
        consentUntil={consentUntil(business.id)} gap={forecast.data?.gap ?? null} prefilled={prefilled} />
    </div>

    <TipsCard tips={insights.tips} />
  </Stack>
}

/** «a, b и c» */
const listRu = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}` : items[0] ?? '')

/** Сотрудник по доверенности: честно говорим, что он может, а что сделает руководитель. */
function ProxyNotice() {
  const { me } = useSession()
  const b = me.businesses[0]
  if (b.membership_kind !== 'MCHD' && b.permissions.includes('SUBMIT')) return null
  const can = [
    b.permissions.includes('FILL') && 'рассчитать предложение',
    b.permissions.includes('FILL') && 'подготовить заявку',
    b.permissions.includes('CONSENT') && 'дать согласие на запрос в БКИ и ФНС',
  ].filter(Boolean) as string[]
  const leader = [!b.permissions.includes('SUBMIT') && 'отправит', !b.permissions.includes('SIGN') && 'подпишет'].filter(Boolean) as string[]
  const until = b.valid_to ? ` до ${new Date(b.valid_to).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''
  return <div className={styles.notice} role="note">
    <InformationCircleMIcon className={styles.noticeIcon} aria-hidden />
    <div>
      <b>Вы работаете по доверенности (МЧД){until}{until.endsWith('.') ? '' : '.'}</b>{' '}
      {can.length ? `Вы можете ${listRu(can)}.` : 'Вы можете смотреть данные кабинета.'}
      {leader.length ? ` Заявку ${leader.join(' и ')} руководитель — она появится у него в кабинете.` : ''}
    </div>
  </div>
}

type SavedOffer = Offer

const offerState = (o: SavedOffer): { color: 'green' | 'blue' | 'orange' | 'red'; text: string } =>
  o.outcome === 'REJECTED' || o.limit_kopecks <= 0 ? { color: 'red', text: 'Сейчас не одобрим' }
    : o.outcome === 'APPROVED' ? { color: 'green', text: 'Предварительно одобрено' }
      : o.outcome === 'COUNTER_OFFER' ? { color: 'orange', text: 'Банк предлагает другой вариант' }
        : o.outcome === 'MANUAL_REVIEW' ? { color: 'blue', text: 'Решит специалист' }
          : { color: 'blue', text: 'Предварительный расчёт' }

/** «Доступно сейчас»: последний расчёт из этой вкладки или приглашение посчитать. */
function AvailableCard({ offerId, offer, onCalc }: { offerId: string | null; offer: SavedOffer | null; onCalc: () => void }) {
  if (!offer || !offerId) return <Card title="Доступно сейчас" className={styles.sideCard}>
    <div className={styles.invite}>
      <div className={styles.inviteTitle}>Узнайте лимит за минуту</div>
      <p className={styles.muted}>Ответьте на два вопроса — посчитаем сумму и ставку по оборотам вашего счёта. Заявка не создаётся, пока вы сами не решите.</p>
      <Button view="secondary" size={40} onClick={onCalc} className={styles.inviteButton}>Рассчитать лимит</Button>
    </div>
  </Card>

  const state = offerState(offer)
  const noLimit = offer.outcome === 'REJECTED' || offer.limit_kopecks <= 0
  const terms = [
    offer.rate != null && `${String(offer.rate).replace('.', ',')}% годовых`,
    offer.term_months && `${offer.term_months} мес.`,
  ].filter(Boolean).join(' · ')
  const expires = offer.expires_at ? new Date(offer.expires_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : null
  return <Card title="Доступно сейчас" subtitle="По последнему расчёту" className={styles.sideCard}>
    <div className={styles.offer}>
      <Status color={state.color} view="muted-alt" size={24} shape="rounded" uppercase={false} className={styles.offerStatus}>{state.text}</Status>
      {noLimit
        ? <p className={styles.offerNo}>Посмотрите причину и что сделать, чтобы получить деньги.</p>
        : <>
          <span className={styles.product}>{productName(offer.product)}</span>
          <Money kopecks={offer.limit_kopecks} size="l" prefix="до" />
          {terms && <span className={styles.muted}>{terms}{expires ? ` · условия действуют до ${expires}` : ''}</span>}
        </>}
      <Link to={`/offer/${offerId}`} className={styles.arrowLink}>{noLimit ? 'Узнать причину' : 'Открыть предложение'}<ArrowRightMIcon aria-hidden /></Link>
    </div>
  </Card>
}

const activeWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'активная' : 'активных')


/** «Моя заявка»: активная заявка со статусом или короткий текст, если заявок нет. */
function ApplicationCard({ businessId }: { businessId: string }) {
  const apps = useMyApplications(businessId)
  const all = (text: string) => <Link to="/applications" className={styles.headLink}>{text}</Link>
  if (apps.isPending) return <Card title="Моя заявка" className={styles.sideCard}><LoadingState view="skeleton" rows={2} label="Загружаем заявки…" /></Card>
  if (apps.error) return <Card title="Моя заявка" className={styles.sideCard}><ErrorState error={apps.error} onRetry={() => apps.refetch()} /></Card>

  const items = apps.data.items
  const active = items.find(i => i.id === apps.data.active_id) ?? items.find(i => i.active)
  const otherActive = items.filter(i => i.active && i.id !== active?.id).length

  if (!active) {
    const latest = items[0]
    return <Card title="Моя заявка" className={styles.sideCard} actions={latest ? all('Все заявки') : undefined}>
      {latest
        ? <div className={styles.app}>
          <p className={styles.muted}>Активных заявок нет. Последняя:</p>
          <div className={styles.appRow}>
            <StatusTag status={latest.status} size={20} />
            <span className={styles.appTitle}>{latest.product ? productName(latest.product) : 'Заявка'}{latest.amount_kopecks ? <> · <Money kopecks={latest.amount_kopecks} weight="medium" /></> : null}</span>
          </div>
          <Link to={`/applications/${latest.id}`} className={styles.arrowLink}>Открыть заявку<ArrowRightMIcon aria-hidden /></Link>
        </div>
        : <EmptyState compact className={styles.empty} icon={<DocumentLinesMIcon />} title="Заявок пока нет" text="Рассчитайте предложение — заявка оформляется в один клик." />}
    </Card>
  }

  const created = active.created_at ? new Date(active.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : null
  return <Card title="Моя заявка" className={styles.sideCard} actions={all('Все заявки')}>
    <div className={styles.app}>
      <StatusTag status={active.status} />
      <span className={styles.product}>{active.product ? productName(active.product) : 'Заявка'}</span>
      <div className={styles.appSum}>
        {active.amount_kopecks ? <Money kopecks={active.amount_kopecks} size="m" /> : null}
        {active.term_months ? <span className={styles.muted}> · {active.term_months} мес.</span> : null}
      </div>
      {(created || otherActive > 0) && <span className={styles.muted}>
        {created ? `Создана ${created}` : ''}{created && otherActive ? ' · ' : ''}{otherActive ? `ещё ${otherActive} ${activeWord(otherActive)}` : ''}
      </span>}
      <Link to={`/applications/${active.id}`} className={styles.arrowLink}>Открыть заявку<ArrowRightMIcon aria-hidden /></Link>
    </div>
  </Card>
}
