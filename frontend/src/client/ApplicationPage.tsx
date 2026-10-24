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
import { clientAction, finalStatuses, formatDate, settledStatuses, trackOf } from '../common/status'
import { useApplication } from '../queries'
import { Card } from '../ui/Card'
import { Grid, Stack } from '../ui/Layout'
import { formatMoney } from '../ui/Money'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../ui/States'
import { StatusTag } from '../ui/StatusTag'
import { NextStep, statusCopy } from './application/NextStep'
import { ConditionsCard, DecisionCard, hasDecision, hasSchedule, HistoryCard, ScheduleCard, SpecialistCard } from './application/Panels'
import { TrackSteps } from './application/TrackSteps'
import { useApplicationAction } from './application/useApplicationAction'
import styles from './application/Application.module.css'

// Трекер заявки «как посылка»: этапы, что дальше, решение, подпись кодом, график, чат с банком.
export function ApplicationPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { token, me } = useSession()
  const business = me.businesses[0]
  const app = useApplication(id)
  const action = useApplicationAction(id, business.id)

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

  const main = [
    a.status === 'ISSUED' && hasSchedule(a) && <ScheduleCard key="schedule" a={a} />,
    hasDecision(a) && <DecisionCard key="decision" a={a} />,
    a.status !== 'ISSUED' && hasSchedule(a) && <ScheduleCard key="schedule" a={a} />,
    withChat && <Card key="chat" padding="m" id="chat"><Chat token={token} applicationId={a.id} side="CLIENT" title="Чат с банком" /></Card>,
    withChat && <HistoryCard key="history" a={a} />,
  ].filter(Boolean)
  const side = [
    <ConditionsCard key="conditions" a={a} />,
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

    {main.length > 0
      ? <Grid columns="minmax(0, 1fr) 340px" align="start">
        <Stack>{main}</Stack>
        <Stack>{side}</Stack>
      </Grid>
      : <Grid columns={2} align="start">{side}</Grid>}
  </Stack>
}
