import { useState } from 'react'
import { Button } from '@alfalab/core-components/button/esm'
import { Card, EmptyState, ErrorState, formatMoney, LoadingState } from '../../ui'
import { AuditItem, InternalDecision } from './data'
import { bankStatusName, formatDateTime, rejectReasonName } from './text'
import styles from './HistoryCard.module.css'

type Tone = 'neutral' | 'positive' | 'negative' | 'attention' | 'info'
type Entry = { title: string; detail?: string; quote?: string; tone: Tone }

const statusOf = (v: unknown) => (typeof v === 'string' ? bankStatusName[v] ?? v : '')

// Журнал по заявке словами: кто, что и когда сделал. Сообщения чата и вопросы ассистенту не дублируем.
const hidden = new Set(['CHAT_MESSAGE', 'ASSISTANT_ASKED'])

function describe(item: AuditItem, decisions: Map<string, InternalDecision>): Entry {
  const after = item.after ?? {}
  const before = item.before ?? {}
  const decision = typeof after.decision_id === 'string' ? decisions.get(after.decision_id) : undefined
  const risk = after.risk_required === true ? 'нужно второе одобрение риск-менеджера' : undefined
  switch (item.action) {
    case 'APPLICATION_CREATED': return { title: 'Заявка создана', tone: 'neutral' }
    case 'APPLICATION_AWAITS_SIGNATURE': return { title: 'Передана на подпись руководителю', tone: 'neutral' }
    case 'APPLICATION_SUBMITTED': return { title: 'Клиент отправил заявку в банк', tone: 'info' }
    case 'SOURCES_REQUESTED': {
      const failed = [...(Array.isArray(after.unavailable) ? after.unavailable : []), ...(Array.isArray(after.not_found) ? after.not_found : [])]
      return { title: 'Запрошены данные: Альфа, реестр, ФНС, БКИ', detail: failed.length ? `не ответили: ${failed.join(', ')}` : 'все источники ответили', tone: failed.length ? 'attention' : 'neutral' }
    }
    case 'AUTOMATIC_DECISION_CREATED': return { title: `Автоматическое решение: ${statusOf(after.status).toLowerCase()}`, detail: after.rules_version ? `правила v${after.rules_version}` : undefined, tone: 'info' }
    case 'EXPLANATION_GENERATED': return { title: 'Сформировано объяснение для клиента', tone: 'neutral' }
    case 'APPLICATION_ASSIGNED': return { title: 'Взята в работу', tone: 'info' }
    case 'APPLICATION_UNASSIGNED_SLA': return { title: 'Снята с исполнителя: истёк срок рассмотрения', tone: 'attention' }
    case 'UNDERWRITER_APPROVE': return { title: 'Андеррайтер: одобрить', detail: risk, quote: decision?.explanation ?? undefined, tone: 'positive' }
    case 'UNDERWRITER_COUNTER_OFFER': return {
      title: `Андеррайтер: контрпредложение${decision ? ` на ${formatMoney({ kopecks: decision.limit_kopecks })}` : ''}`,
      detail: risk, quote: decision?.explanation ?? undefined, tone: 'attention',
    }
    case 'UNDERWRITER_REQUEST_INFO': return { title: 'Андеррайтер: запрос документов', quote: decision?.explanation ?? undefined, tone: 'attention' }
    case 'UNDERWRITER_REJECT': return {
      title: 'Андеррайтер: отказ',
      detail: typeof after.reason_code === 'string' ? `причина: ${(rejectReasonName[after.reason_code] ?? after.reason_code).toLowerCase()}` : undefined,
      quote: decision?.explanation ?? undefined, tone: 'negative',
    }
    case 'RISK_APPROVE': return { title: 'Риск-менеджер подтвердил решение', detail: after.status ? `статус: ${statusOf(after.status).toLowerCase()}` : undefined, tone: 'positive' }
    case 'RISK_RETURN': return { title: 'Риск-менеджер вернул решение андеррайтеру', tone: 'attention' }
    case 'APPLICATION_DOCUMENT_ADDED': return { title: 'Клиент приложил документ', tone: 'info' }
    case 'DOCUMENT_UPLOADED': return { title: 'Загружен документ', tone: 'neutral' }
    case 'STATEMENT_APPLIED': return { title: 'Учтена выписка из другого банка', tone: 'info' }
    case 'COUNTER_OFFER_ACCEPTED': return { title: 'Клиент принял контрпредложение', tone: 'positive' }
    case 'COUNTER_OFFER_DECLINED': return { title: 'Клиент отказался от контрпредложения', tone: 'negative' }
    case 'CONTRACT_SIGNED': return { title: 'Клиент подписал договор', tone: 'positive' }
    case 'CREDIT_ISSUED': return { title: 'Деньги выданы', tone: 'positive' }
    case 'OFFER_EXPIRED': return { title: 'Срок предложения истёк', tone: 'neutral' }
    case 'APPLICATION_CANCELLED': return { title: 'Клиент отменил заявку', tone: 'neutral' }
    case 'SMS_STUB': return { title: 'SMS клиенту (заглушка, только в журнал)', tone: 'neutral' }
    case 'DEMO_TIME_TRAVEL': return { title: 'Демо: перемотка времени', tone: 'neutral' }
    default: {
      const change = before.status && after.status && before.status !== after.status ? `${statusOf(before.status)} → ${statusOf(after.status)}` : undefined
      return { title: item.action, detail: change, tone: 'neutral' }
    }
  }
}

const COLLAPSED = 6

/** История заявки из журнала аудита — от новых событий к старым. */
export function HistoryCard({ items, decisions, isPending, error, onRetry }: {
  items: AuditItem[] | undefined; decisions: InternalDecision[]; isPending: boolean; error: unknown; onRetry: () => void
}) {
  const [all, setAll] = useState(false)
  const byId = new Map(decisions.map(d => [d.id, d]))
  const list = (items ?? []).filter(i => !hidden.has(i.action))
  const shown = all ? list : list.slice(0, COLLAPSED)
  return <Card title="История заявки" subtitle="Из журнала аудита: решения, действия сотрудников и клиента">
    {isPending && <LoadingState view="skeleton" rows={4} label="Загружаем историю…" />}
    {!!error && !items && <ErrorState error={error} onRetry={onRetry} title="Не получилось загрузить историю" />}
    {items && list.length === 0 && <EmptyState compact title="Событий пока нет" />}
    {shown.length > 0 && <ol className={styles.list}>
      {shown.map(item => {
        const e = describe(item, byId)
        return <li key={item.id} className={styles.item}>
          <span className={[styles.dot, styles[e.tone]].join(' ')} aria-hidden />
          <div className={styles.body}>
            <div className={styles.title}>{e.title}</div>
            <div className={styles.meta}>
              {formatDateTime(item.at)}{item.actor_name ? ` · ${item.actor_name}` : ' · система'}{e.detail ? ` · ${e.detail}` : ''}
            </div>
            {e.quote && <blockquote className={styles.quote}>{e.quote}</blockquote>}
          </div>
        </li>
      })}
    </ol>}
    {list.length > COLLAPSED && <Button view="text" size={32} className={styles.more} onClick={() => setAll(v => !v)}>
      {all ? 'Свернуть' : `Показать всю историю (${list.length})`}
    </Button>}
  </Card>
}
