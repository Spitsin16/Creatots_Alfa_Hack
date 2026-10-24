import { useNavigate, useParams } from 'react-router'
import { Button } from '@alfalab/core-components/button/esm'
import { IconButton } from '@alfalab/core-components/icon-button/esm'
import { Typography } from '@alfalab/core-components/typography/esm'
import { DocumentLinesMIcon } from '@alfalab/icons-glyph/DocumentLinesMIcon'
import { RepeatMIcon } from '@alfalab/icons-glyph/RepeatMIcon'
import { productName } from '../api'
import { useSession } from '../auth'
import { Bell } from '../common/Bell'
import { Chat } from '../common/Chat'
import { clientAction, enteredAt, finalStatuses, formatDate, settledStatuses, trackOf } from '../common/status'
import { useApplication } from '../queries'
import { Card } from '../ui/Card'
import { Grid, Stack } from '../ui/Layout'
import { formatMoney } from '../ui/Money'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../ui/States'
import { StatusTag } from '../ui/StatusTag'
import { NextStep, statusCopy } from './application/NextStep'
import { ConditionsCard, DecisionCard, hasDecision, hasSchedule, HistoryCard, ScheduleCard, SpecialistCard } from './application/Panels'
import { purposeName } from './application/schedule'
import { TrackSteps } from './application/TrackSteps'
import { useApplicationAction } from './application/useApplicationAction'
import { ForecastCard } from './ForecastCard'
import { IssuedCelebration, useIssuedCelebration } from './loan/IssuedCelebration'
import { LoanCard, LoanError, LoanPending, LoanTips } from './loan/LoanCard'
import { useLoan } from './loan/useLoan'
import styles from './application/Application.module.css'

// Трекер заявки «как посылка»: этапы, что дальше, решение, подпись кодом, график, чат с банком.
export function ApplicationPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { token, me } = useSession()
  const business = me.businesses[0]
  const app = useApplication(id)
  const action = useApplicationAction(id, business.id)
  const issued = app.data?.status === 'ISSUED'
  // Кабинет кредита после выдачи: график договора (сезонный, если выбран), прогноз и подсказки — с бэка
  const loan = useLoan(id, issued)
  const celebration = useIssuedCelebration(id, app.data?.status, app.isFetchedAfterMount)

  if (app.isPending) return <LoadingState view="page" label="Загружаем заявку…" />
  if (app.error || !app.data) {
    const notFound = /не найдена|not found/i.test(app.error?.message ?? '')
    return <Stack>
      <PageHeader back={{ to: '/applications', label: 'Мои заявки' }} title={notFound ? 'Заявка не найдена' : 'Заявка'} />
      {notFound
        ? <EmptyState icon={<DocumentLinesMIcon />} title="Такой заявки нет" text="Возможно, ссылка устарела или заявка принадлежит другой организации."
          action={<Button view="secondary" size={48} onClick={() => navigate('/applications')}>К моим заявкам</Button>} />
        : <ErrorState error={app.error} onRetry={() => void app.refetch()} />}
    </Stack>
  }

  const a = app.data
  const createdAt = a.created_at ?? a.timeline?.[0]?.at
  const perms = {
    canSubmit: business.permissions.includes('SUBMIT'),
    canSign: business.permissions.includes('SIGN'),
    canFill: business.permissions.includes('FILL'),
    canConsent: business.permissions.includes('CONSENT'),
  }
  const track = trackOf(a.status, a.timeline ?? [])
  // Подпись текущего шага по правам: действие за этим пользователем — «Ждём вас»,
  // за директором (сотрудник по МЧД без права подписи/отправки) — «Ждёт директора».
  const waitingFor = a.status === 'AWAITING_SIGNATURE'
    ? (perms.canSubmit ? 'Ждём вас' : 'Ждёт директора')
    : ['APPROVED', 'COUNTER_OFFER', 'INFO_REQUESTED'].includes(a.status) && !clientAction(a.status, business.permissions) ? 'Ждёт директора' : undefined
  const copy = statusCopy(a, perms)
  const withChat = !['DRAFT', 'AWAITING_SIGNATURE'].includes(a.status)
  const final = finalStatuses.includes(a.status)
  const showSpecialist = (!!a.assignee_name && !final) || ['MANUAL_REVIEW', 'INFO_REQUESTED'].includes(a.status)
  const live = !settledStatuses.includes(a.status)
  const updated = new Date(app.dataUpdatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const writeToSpecialist = () => {
    const el = document.getElementById(`chat-${a.id}`) as HTMLTextAreaElement | null
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // После выдачи вместо расчётного графика — «Мой кредит» над колонками, прогноз денег в основной колонке
  const loanBlock = issued && (loan.isPending ? <LoanPending />
    : loan.error ? <LoanError error={loan.error} onRetry={() => void loan.refetch()} />
      : <LoanCard loan={loan.data} issuedAt={enteredAt('ISSUED', a.timeline ?? [])?.toISOString()} purpose={purposeName[a.purpose]} />)
  const forecast = issued && loan.data?.forecast && <ForecastCard key="forecast" businessId={a.business_id} title="Прогноз денег на 30 дней"
    overdraftKopecks={a.product === 'OVERDRAFT' ? a.amount_kopecks : undefined} />

  const main = [
    forecast,
    hasDecision(a) && <DecisionCard key="decision" a={a} />,
    !issued && hasSchedule(a) && <ScheduleCard key="schedule" a={a} />,
    withChat && <Card key="chat" padding="m" id="chat"><Chat token={token} applicationId={a.id} side="CLIENT" title="Чат с банком" /></Card>,
    withChat && <HistoryCard key="history" a={a} />,
  ].filter(Boolean)
  const side = [
    issued && loan.data && <LoanTips key="tips" tips={loan.data.tips} />,
    // После выдачи условия уже в «Моём кредите» — карточку не дублируем (пока он не загрузился — показываем)
    !(issued && loan.data) && <ConditionsCard key="conditions" a={a} />,
    showSpecialist && withChat && <SpecialistCard key="specialist" a={a} onWrite={writeToSpecialist} />,
    !withChat && <HistoryCard key="history" a={a} />,
  ].filter(Boolean)

  return <Stack>
    <PageHeader
      back={{ to: '/applications', label: 'Мои заявки' }}
      title={`${productName(a.product)} на ${formatMoney({ kopecks: a.amount_kopecks })}`}
      subtitle={`Заявка № ${a.id.slice(0, 8)}${createdAt ? ` от ${formatDate(createdAt)}` : ''} · срок ${a.term_months} мес.`}
      actions={<Bell />}
    />

    <Card className={styles.tracker} padding="l" id="tracker">
      <div className={styles.trackerTop}>
        <StatusTag status={a.status} size={24} />
        <span className={styles.updated}>
          {live ? 'Статус обновляется сам' : 'Обновлено'} · {updated}
          <IconButton icon={RepeatMIcon} size={24} view="secondary" aria-label="Обновить статус" title="Обновить" onClick={() => { void app.refetch(); action.refresh() }} />
        </span>
      </div>
      <Typography.Title tag="h2" view="medium" font="system" className={styles.headline}>{copy.headline}</Typography.Title>
      {copy.lead && <p className={styles.lead}>{copy.lead}</p>}
      <TrackSteps track={track} status={a.status} waitingFor={waitingFor} />
      <NextStep a={a} perms={perms} action={action} onWrite={writeToSpecialist} />
    </Card>

    {loanBlock}

    {main.length > 0
      ? <Grid columns="minmax(0, 1fr) 340px" align="start">
        <Stack>{main}</Stack>
        <Stack>{side}</Stack>
      </Grid>
      : <Grid columns={2} align="start">{side}</Grid>}

    <IssuedCelebration open={celebration.open} onClose={celebration.close} product={a.product} amountKopecks={a.amount_kopecks} />
  </Stack>
}
