import { Button } from '@alfalab/core-components/button/esm'
import { DocumentLinesMIcon } from '@alfalab/icons-glyph/DocumentLinesMIcon'
import { Bell } from '../common/Bell'
import { Processing } from '../common/Spinner'
import { Card } from './Card'
import { ErrorBoundary } from './ErrorBoundary'
import { Grid, Stack } from './Layout'
import { Money } from './Money'
import { PageHeader } from './PageHeader'
import { ScoreBadge } from './ScoreBadge'
import { EmptyState, ErrorState, LoadingState } from './States'
import { StatusTag } from './StatusTag'
import { KeyValue } from './KeyValue'

// Витрина примитивов — только в dev-сборке (адрес /dev/ui). Данные здесь — образцы для вёрстки, не из API.
const statuses = ['DRAFT', 'AWAITING_SIGNATURE', 'SUBMITTED', 'MANUAL_REVIEW', 'INFO_REQUESTED', 'COUNTER_OFFER', 'APPROVED', 'CONTRACT_SIGNED', 'ISSUED', 'REJECTED', 'CANCELLED', 'EXPIRED']

function Boom(): never {
  throw new Error('Пример падения виджета')
}

export default function Showcase() {
  return <Stack gap={20}>
    <PageHeader eyebrow="Витрина src/ui" title="Примитивы интерфейса" subtitle="Образцы для вёрстки экранов. Страница есть только в режиме разработки." actions={<Bell />} />
    <PageHeader back={{ to: '/', label: 'Назад' }} title="Шапка со ссылкой «назад»" subtitle="Для вложенных экранов: заявка, предложение, карточка в банке." />

    <Grid columns="minmax(0, 1fr) 360px">
      <Card title="Card: белая секция" subtitle="Заголовок, пояснение, действия справа" actions={<Button view="secondary" size={40}>Действие</Button>}>
        <KeyValue items={[
          { label: 'Продукт', value: 'Овердрафт' },
          { label: 'Лимит', value: <Money kopecks={27000000} /> },
          { label: 'Ставка', value: '24% годовых' },
          { label: 'Платёж', value: <Money rubles={8123.4} />, hint: 'расчётный' },
        ]} />
      </Card>
      <Card title="Главная сумма" view="dark">
        <Money kopecks={27000000} size="xl" tone="inverted" prefix="до" />
        <div style={{ marginTop: 16 }}><Button view="accent" size={48} block>Одна accent-кнопка</Button></div>
      </Card>
    </Grid>

    <Card title="KeyValue tiles">
      <KeyValue view="tiles" columns={4} items={[
        { label: 'Сумма', value: <Money kopecks={27000000} /> },
        { label: 'Ставка', value: '24%' },
        { label: 'Срок', value: '12 мес.' },
        { label: 'Переплата', value: <Money rubles={34560} />, hint: 'примерно' },
      ]} />
    </Card>

    <Grid columns={2}>
      <Card title="StatusTag">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{statuses.map(s => <StatusTag key={s} status={s} />)}</div>
      </Card>
      <Card title="ScoreBadge (только банк)">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <ScoreBadge cls="A" score={105} /><ScoreBadge cls="B" score={80} /><ScoreBadge cls="C" score={58} /><ScoreBadge cls="D" score={45} />
          <ScoreBadge cls="E" score={20} /><ScoreBadge cls="C" score={58} status="REJECTED" /><ScoreBadge cls={null} score={null} /><ScoreBadge cls="C" score={58} size="m" />
        </div>
        <Grid columns={2} gap={12}><ScoreBadge cls="C" score={58} size="l" /><ScoreBadge cls="A" score={90} size="l" /></Grid>
      </Card>
    </Grid>

    <Grid columns={3}>
      <Card title="Money"><Stack gap={8}>
        <Money kopecks={27000000} size="xl" />
        <Money kopecks={36000000} size="l" tone="positive" />
        <Money rubles={-211060} size="m" tone="negative" />
        <span>В тексте: <Money kopecks={24000000} weight="medium" /> на 12 мес.</span>
      </Stack></Card>
      <Card title="LoadingState"><Stack gap={12}>
        <LoadingState view="inline" label="Загружаем заявку…" />
        <LoadingState view="skeleton" rows={3} />
      </Stack></Card>
      <Card title="Processing"><Processing status="ENRICHMENT" /></Card>
    </Grid>

    <LoadingState label="LoadingState block — вместо карточки" />
    <ErrorState error={new Error('Сервер не ответил за 10 секунд')} onRetry={() => undefined} />
    <EmptyState icon={<DocumentLinesMIcon />} title="Заявок пока нет" text="Рассчитайте предложение — заявка оформляется в один клик." action={<Button view="secondary" size={48}>Рассчитать предложение</Button>} />
    <Card title="ErrorBoundary compact"><ErrorBoundary compact><Boom /></ErrorBoundary></Card>
  </Stack>
}
