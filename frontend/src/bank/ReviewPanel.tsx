import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@alfalab/core-components/button/esm'
import { Plate } from '@alfalab/core-components/plate/esm'
import { DocumentLinesMIcon } from '@alfalab/icons-glyph/DocumentLinesMIcon'
import { ShieldMIcon } from '@alfalab/icons-glyph/ShieldMIcon'
import { homePath, useSession } from '../auth'
import { Chat } from '../common/Chat'
import { DocList } from '../common/Documents'
import { Bell, Card, EmptyState, ErrorState, KeyValue, LoadingState, Money, PageHeader, ScoreBadge, Stack, StatusTag } from '../ui'
import { DecisionPanel } from './workplace/DecisionPanel'
import { HistoryCard } from './workplace/HistoryCard'
import { RiskDecision, RiskResult } from './workplace/RiskDecision'
import { ScoringCard } from './workplace/ScoringCard'
import { SourcesCard } from './workplace/SourcesCard'
import {
  BankDetail, RiskItem, scoringDecision, useApplicationDocuments, useApplicationHistory, useBankApplication, useRiskApprovals, useWorkflow,
} from './workplace/data'
import { bankStatusName, formatDateTime, outcomeName, productName, purposeName, riskReasons, shortStaffName } from './workplace/text'
import styles from './ReviewPanel.module.css'

// Карточка заявки андеррайтера: слева клиент, запрос, скоринг, источники, документы, история;
// справа — панель решения и чат с клиентом. На узком экране панель решения поднимается наверх.
export function ReviewPanel({ id }: { id: string }) {
  const { token, me } = useSession()
  const navigate = useNavigate()
  const detail = useBankApplication(id)
  const history = useApplicationHistory(id)
  const workflow = useWorkflow(history.data?.items)
  const inApp = typeof window !== 'undefined' && (window.history.state?.idx ?? 0) > 0
  const back = {
    label: inApp ? 'Назад' : me.role === 'RISK_MANAGER' ? 'Согласования' : 'Очередь заявок',
    onClick: () => (inApp ? navigate(-1) : navigate(homePath(me.role))),
  }
  const unavailable = useMemo(() => {
    const src = history.data?.items.find(h => h.action === 'SOURCES_REQUESTED')
    const list = src?.after?.unavailable
    return Array.isArray(list) ? list.map(String) : []
  }, [history.data])

  if (detail.isPending) return <Stack gap={24}>
    <PageHeader back={back} title="Карточка заявки" />
    <LoadingState view="block" label="Загружаем заявку…" />
  </Stack>
  if (!detail.data) return <Stack gap={24}>
    <PageHeader back={back} title="Карточка заявки" />
    <ErrorState error={detail.error} title="Не получилось открыть заявку" onRetry={() => detail.refetch()} />
  </Stack>

  const d = detail.data
  return <Stack gap={24}>
    <PageHeader
      back={back}
      title={d.business_name}
      subtitle={<>ИНН {d.inn} · заявка № {d.id.slice(0, 8)}{d.created_at ? ` · подана ${formatDateTime(d.created_at)}` : ''}</>}
      actions={<><StatusTag status={d.status} size={32}>{bankStatusName[d.status] ?? d.status}</StatusTag><Bell /></>}
    />
    {detail.error && <ErrorState error={detail.error} title="Данные не обновились — показываем последние полученные" onRetry={() => detail.refetch()} />}

    <div className={styles.layout}>
      <div className={styles.main}>
        <RequestCard detail={d} />
        <ScoringCard detail={d} unavailableSources={unavailable} />
        <SourcesCard snapshots={d.snapshots} />
        <DocumentsCard id={d.id} token={token} />
        <HistoryCard items={history.data?.items} decisions={d.decisions} isPending={history.isPending} error={history.error} onRetry={() => history.refetch()} />
      </div>
      <div className={styles.side}>
        <div className={styles.decision}><DecisionPanel detail={d} workflow={workflow} /></div>
        {(me.role === 'UNDERWRITER' || me.role === 'RISK_MANAGER') && <div className={styles.chat}>
          <Card title="Чат с клиентом" padding="l">
            <Chat token={token} applicationId={d.id} side="BANK" title={null} />
          </Card>
        </div>}
      </div>
    </div>
  </Stack>
}

function RequestCard({ detail }: { detail: BankDetail }) {
  return <Card title="Запрос клиента">
    <KeyValue view="tiles" columns={2} items={[
      { label: 'Продукт', value: productName[detail.product] ?? detail.product },
      { label: 'Сумма', value: <Money kopecks={detail.amount_kopecks} /> },
      { label: 'Срок', value: `${detail.term_months} мес.` },
      { label: 'Цель', value: purposeName[detail.purpose] ?? detail.purpose },
    ]} />
  </Card>
}

function DocumentsCard({ id, token }: { id: string; token: string }) {
  const docs = useApplicationDocuments(id)
  return <Card title="Документы клиента" subtitle="Приложены к этой заявке">
    {docs.isPending && <LoadingState view="inline" label="Загружаем документы…" />}
    {docs.error && <ErrorState error={docs.error} title="Не получилось загрузить документы" onRetry={() => docs.refetch()} />}
    {docs.data?.length === 0 && <EmptyState compact icon={<DocumentLinesMIcon />} title="Документов нет" text="Клиент ещё ничего не приложил. Нужны документы — запросите их в панели решения." />}
    {!!docs.data?.length && <DocList items={docs.data} token={token} />}
  </Card>
}

// Согласования риск-менеджера: у каждой строки своя форма — комментарий, «Подтвердить», «Вернуть».
export function RiskQueue() {
  const navigate = useNavigate()
  const list = useRiskApprovals()
  const [done, setDone] = useState<{ item: RiskItem; result: RiskResult }[]>([])
  const items = list.data ?? []
  return <Stack gap={20}>
    {done.map(({ item, result }) => <Plate
      key={item.approval_id}
      view={result.action === 'APPROVE' ? 'positive' : 'attention'}
      title={result.action === 'APPROVE' ? `${item.business_name}: решение подтверждено` : `${item.business_name}: решение возвращено андеррайтеру`}
      hasCloser
      onClose={() => setDone(list => list.filter(x => x.item.approval_id !== item.approval_id))}
    >
      {result.action === 'APPROVE' ? `Статус заявки: ${(bankStatusName[result.status] ?? result.status).toLowerCase()}. ` : 'Заявка снова на ручной проверке без исполнителя. '}
      <Link to={`/bank/applications/${item.application_id}`}>Открыть карточку</Link>
    </Plate>)}
    {list.isPending && <LoadingState view="skeleton" rows={3} label="Загружаем согласования…" />}
    {list.error && <ErrorState error={list.error} title="Не получилось загрузить согласования" onRetry={() => list.refetch()} />}
    {list.data && items.length === 0 && <EmptyState
      icon={<ShieldMIcon />}
      title="Согласований нет"
      text="Здесь появятся решения андеррайтеров, которым нужно второе одобрение: суммы больше 5 млн ₽, одобрения вопреки скорингу и выше расчётного лимита."
      action={<Button view="secondary" size={40} onClick={() => navigate('/bank')}>Все заявки</Button>}
    />}
    {items.map(item => <RiskApprovalCard key={item.approval_id} item={item} onDone={result => {
      setDone(list => [{ item, result }, ...list])
      // строка уходит из списка — поднимаем экран к сообщению о результате
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }} />)}
  </Stack>
}

function RiskApprovalCard({ item, onDone }: { item: RiskItem; onDone: (r: RiskResult) => void }) {
  const detail = useBankApplication(item.application_id)
  const d = detail.data
  const scoring = d ? scoringDecision(d.decisions) : undefined
  const outcome = item.proposed_outcome
  // У одобрения в согласование уходит сумма заявки, у контрпредложения — сумма из решения андеррайтера.
  const amount = outcome === 'COUNTER_OFFER' ? item.amount_kopecks : d?.amount_kopecks ?? item.amount_kopecks
  const reasons = d ? riskReasons(outcome === 'COUNTER_OFFER' ? 'COUNTER_OFFER' : 'APPROVE', amount, scoring?.cls, scoring?.limit_kopecks) : []
  return <Card as="article" className={styles.riskCard}>
    <div className={styles.riskGrid}>
      <div className={styles.riskInfo}>
        <div className={styles.riskHead}>
          <div className={styles.riskTitle}>
            <Link to={`/bank/applications/${item.application_id}`} className={styles.riskName}>{item.business_name}</Link>
            <span className={styles.meta}>{d ? `ИНН ${d.inn} · ${productName[d.product] ?? d.product} · ${d.term_months} мес.` : 'Загружаем данные заявки…'}</span>
          </div>
          {scoring && <ScoreBadge cls={scoring.cls} score={scoring.score} size="m" />}
        </div>

        <div className={styles.proposal}>
          <span className={styles.label}>Андеррайтер предлагает</span>
          <div className={styles.proposalRow}>
            <StatusTag status={outcome} size={24}>{outcomeName[outcome] ?? outcome}</StatusTag>
            <Money kopecks={amount} size="l" />
          </div>
        </div>

        {d && <KeyValue view="tiles" columns={3} className={styles.kv} items={[
          { label: 'Запросил клиент', value: <Money kopecks={d.amount_kopecks} /> },
          scoring && scoring.limit_kopecks > 0 ? { label: 'Расчётный лимит', value: <Money kopecks={scoring.limit_kopecks} /> } : null,
          { label: 'Андеррайтер', value: shortStaffName(d.assignee_name) || '—' },
        ]} />}

        {reasons.length > 0 && <div className={styles.reasons}>
          <ShieldMIcon className={styles.reasonIcon} aria-hidden />
          <span>Нужно второе одобрение: {reasons.join(', ')}</span>
        </div>}

        {item.underwriter_comment && <blockquote className={styles.quote}>
          <span className={styles.label}>Комментарий андеррайтера</span>
          {item.underwriter_comment}
        </blockquote>}

        <Link to={`/bank/applications/${item.application_id}`} className={styles.open}>Открыть карточку заявки →</Link>
      </div>
      <div className={styles.riskForm}>
        <RiskDecision approval={item} onDone={onDone} />
      </div>
    </div>
  </Card>
}
