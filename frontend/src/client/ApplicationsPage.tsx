import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@alfalab/core-components/button/esm'
import { Tag } from '@alfalab/core-components/tag/esm'
import { ChevronForwardMIcon } from '@alfalab/icons-glyph/ChevronForwardMIcon'
import { DocumentLinesMIcon } from '@alfalab/icons-glyph/DocumentLinesMIcon'
import { MyApplicationItem, productName } from '../api'
import { useSession } from '../auth'
import { Bell } from '../common/Bell'
import { clientAction, clientActionGo, formatDate, trackLabels, trackOf, trackSteps } from '../common/status'
import { useMyApplications } from '../queries'
import { Card } from '../ui/Card'
import { Stack } from '../ui/Layout'
import { Money } from '../ui/Money'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../ui/States'
import { StatusTag } from '../ui/StatusTag'
import styles from './ApplicationsPage.module.css'

/** Строка списка: бэк отдаёт продукт, сумму, срок и дату прямо в списке. */
type Item = MyApplicationItem
type Filter = 'all' | 'active' | 'done'
const heroOrder = ['APPROVED', 'COUNTER_OFFER', 'INFO_REQUESTED', 'AWAITING_SIGNATURE', 'DRAFT']

// Все заявки бизнеса: активная сверху, к любой можно вернуться.
export function ApplicationsPage() {
  const { me } = useSession()
  const navigate = useNavigate()
  const business = me.businesses[0]
  const list = useMyApplications(business.id)
  const [filter, setFilter] = useState<Filter>('all')
  const items = ((list.data?.items ?? []) as Item[]).slice().sort((x, y) =>
    Number(y.active) - Number(x.active) || (y.created_at ?? '').localeCompare(x.created_at ?? ''))
  const activeCount = items.filter(i => i.active).length
  const shown = items.filter(i => filter === 'all' || (filter === 'active' ? i.active : !i.active))
  // Крупно — заявка, где от клиента что-то нужно: сначала то, что ждёт банк и имеет срок (подпись,
  // предложение, документы), потом черновики; ничего не нужно — активная с бэка.
  const activeId = list.data?.active_id
  const hero = items
    .filter(i => i.active && clientAction(i.status, business.permissions))
    .sort((x, y) => heroOrder.indexOf(x.status) - heroOrder.indexOf(y.status) || Number(y.id === activeId) - Number(x.id === activeId))[0]
    ?? items.find(i => i.id === activeId) ?? items.find(i => i.active)
  const open = (id: string) => navigate(`/applications/${id}`)

  return <Stack>
    <PageHeader eyebrow={business.name} title="Мои заявки" subtitle="Статус каждой заявки обновляется сам. Новую заявку можно оформить на главной."
      actions={<><Button view="secondary" size={40} onClick={() => navigate('/')}>Новая заявка</Button><Bell /></>} />

    {list.isPending && <LoadingState view="skeleton" rows={5} label="Загружаем заявки…" />}
    {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
    {list.data && items.length === 0 && <EmptyState icon={<DocumentLinesMIcon />} title="Заявок пока нет"
      text="Рассчитайте предложение — заявка оформляется в один клик, все данные уже заполнены."
      action={<Button view="accent" size={48} onClick={() => navigate('/')}>Рассчитать предложение</Button>} />}

    {hero && <ActiveCard item={hero} permissions={business.permissions} onOpen={() => open(hero.id)} />}

    {items.length > 0 && <Card title="Все заявки" padding="m">
      {activeCount > 0 && activeCount < items.length && <div className={styles.filters} role="group" aria-label="Фильтр заявок">
        <Tag size={32} shape="rounded" view="filled" checked={filter === 'all'} onClick={() => setFilter('all')}>Все · {items.length}</Tag>
        <Tag size={32} shape="rounded" view="filled" checked={filter === 'active'} onClick={() => setFilter('active')}>В работе · {activeCount}</Tag>
        <Tag size={32} shape="rounded" view="filled" checked={filter === 'done'} onClick={() => setFilter('done')}>Завершённые · {items.length - activeCount}</Tag>
      </div>}
      <div className={styles.table}>
        <div className={[styles.row, styles.head].join(' ')} aria-hidden>
          <span>Заявка</span><span className={styles.right}>Сумма</span>
          <span>Срок</span><span>Создана</span><span>Статус</span><span aria-hidden />
        </div>
        {shown.map(i => {
          const todo = clientAction(i.status, business.permissions)
          return <Link key={i.id} to={`/applications/${i.id}`} className={[styles.row, styles.item, i.id === hero?.id ? styles.current : ''].join(' ')}>
            <span className={styles.product}>
              <b>{i.product ? productName(i.product) : 'Заявка'}</b>
              <small>№ {i.id.slice(0, 8)}</small>
            </span>
            <span className={[styles.amount, styles.right].join(' ')}>{i.amount_kopecks != null ? <Money kopecks={i.amount_kopecks} weight="medium" /> : '—'}</span>
            <span className={styles.term}>{i.term_months ? `${i.term_months} мес.` : '—'}</span>
            <span className={styles.date}>
              {i.created_at ? formatDate(i.created_at) : '—'}
              {/* На узком экране отдельной графы «Срок» нет — срок дописываем к дате */}
              {i.term_months ? <span className={styles.dateTerm}> · {i.term_months} мес.</span> : null}
            </span>
            <span className={styles.status}>
              <StatusTag status={i.status} size={24} />
              {todo && <small className={styles.todo}>{todo}</small>}
            </span>
            <ChevronForwardMIcon className={styles.chevron} aria-hidden />
          </Link>
        })}
        {shown.length === 0 && <div className={styles.none}>Под фильтр ничего не попало.</div>}
      </div>
    </Card>}
  </Stack>
}

/** Активная заявка крупно: где она на пути и что сделать. */
function ActiveCard({ item, permissions, onOpen }: { item: Item; permissions: string[]; onOpen: () => void }) {
  const track = trackOf(item.status, [])
  const labels = trackLabels(track)
  const todo = clientAction(item.status, permissions)
  const go = clientActionGo(item.status, permissions)
  return <Card padding="l" className={styles.hero}>
    <div className={styles.heroTop}>
      <div className={styles.heroMain}>
        <span className={styles.heroEyebrow}>Активная заявка · № {item.id.slice(0, 8)}</span>
        <div className={styles.heroTitle}>
          {item.product ? productName(item.product) : 'Заявка'}
          {item.amount_kopecks != null && <> на <Money kopecks={item.amount_kopecks} /></>}
        </div>
        <div className={styles.heroMeta}>
          <StatusTag status={item.status} size={24} />
          {item.term_months ? <span>срок {item.term_months} мес.</span> : null}
          {item.created_at && <span>от {formatDate(item.created_at)}</span>}
        </div>
        {todo && <div className={styles.heroTodo}>Нужно ваше действие: {todo.charAt(0).toLowerCase() + todo.slice(1)}</div>}
      </div>
      <Button view={go ? 'accent' : 'secondary'} size={48} onClick={onOpen} className={styles.heroButton}>{go ?? 'Открыть трекер'}</Button>
    </div>
    <ol className={styles.mini} aria-label="Этапы заявки">
      {labels.map((label, i) => {
        const mode = track.modes[i]
        return <li key={label} className={[styles.miniStep, styles[`mini-${mode}`]].join(' ')} aria-current={i + 1 === track.active ? 'step' : undefined}>
          <span className={styles.miniBar} />
          <span className={styles.miniLabel}>{label}</span>
        </li>
      })}
    </ol>
    <div className={styles.miniCaption}>Этап {track.active} из {trackSteps.length}: {labels[track.active - 1]}{item.status === 'DRAFT' ? ' · черновик' : ''}</div>
  </Card>
}
