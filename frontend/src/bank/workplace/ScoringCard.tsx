import { Plate } from '@alfalab/core-components/plate/esm'
import { CheckmarkCircleMIcon } from '@alfalab/icons-glyph/CheckmarkCircleMIcon'
import { ExclamationCircleMIcon } from '@alfalab/icons-glyph/ExclamationCircleMIcon'
import { Card, EmptyState, formatMoney, KeyValue, Money, ScoreBadge } from '../../ui'
import { BankDetail, scoringDecision } from './data'
import { bindingText, factorName, outcomeName, percent, RISK_THRESHOLD_KOPECKS, stopFactorName } from './text'
import styles from './ScoringCard.module.css'

/** Скоринг для сотрудника: балл и класс, исход авторасчёта, лимит и чем он ограничен, факторы, стоп-факторы. */
export function ScoringCard({ detail, unavailableSources = [] }: { detail: BankDetail; unavailableSources?: string[] }) {
  const decision = scoringDecision(detail.decisions)
  if (!decision) {
    return <Card title="Скоринг и лимит">
      <EmptyState compact title="Расчёта ещё нет" text="Заявка не дошла до автоматического решения — балл появится после расчёта." />
    </Card>
  }
  const factors = Object.entries(decision.factors).map(([k, v]) => [k, Number(v) || 0] as const)
  const factorSum = factors.reduce((a, [, v]) => a + v, 0)
  const base = decision.score - factorSum
  const binding = decision.binding_constraint ? bindingText[decision.binding_constraint] : undefined
  const overLimit = decision.limit_kopecks > 0 ? detail.amount_kopecks - decision.limit_kopecks : 0
  const manualReasons = decision.outcome === 'MANUAL_REVIEW' ? [
    decision.cls === 'D' && 'Пограничный балл — класс D',
    detail.amount_kopecks > RISK_THRESHOLD_KOPECKS && 'Сумма больше 5 млн ₽ — выше порога автоодобрения',
    detail.snapshots?.REGISTRY?.mass_address && 'Массовый адрес регистрации',
    unavailableSources.length > 0 && `Не ответили источники: ${unavailableSources.join(', ')}`,
  ].filter(Boolean) as string[] : []

  return <Card title="Скоринг и лимит" subtitle={`Автоматический расчёт · правила v${decision.rules_version}`}>
    <div className={styles.top}>
      <ScoreBadge size="l" cls={decision.cls} score={decision.score} status={detail.status} className={styles.badge} />
      <div className={styles.outcome}>
        <span className={styles.label}>Исход авторасчёта</span>
        <span className={styles.outcomeValue}>{outcomeName[decision.outcome] ?? decision.outcome}</span>
        {manualReasons.length > 0 && <ul className={styles.reasons}>{manualReasons.map(r => <li key={r}>{r}</li>)}</ul>}
      </div>
    </div>

    {decision.rating && <div className={styles.rating}>
      <span className={styles.label}>Что значит рейтинг {decision.rating.cls} {decision.rating.score}</span>
      <b className={styles.bindingTitle}>{decision.rating.title}: {decision.rating.conditions}, {decision.rating.route}</b>
      {decision.rating.position && <span className={styles.bindingText}>{capitalize(decision.rating.position)}.</span>}
      <span className={styles.ratingNote}>Буква — класс риска, от него зависят доля лимита, ставка и кто решает. Число — балл: {decision.rating.scale}. Клиент рейтинг не видит.</span>
    </div>}

    <KeyValue
      view="tiles"
      columns={3}
      className={styles.tiles}
      items={[
        { label: 'Сумма заявки', value: <Money kopecks={detail.amount_kopecks} /> },
        { label: 'Макс. лимит по расчёту', value: decision.limit_kopecks > 0 ? <Money kopecks={decision.limit_kopecks} /> : 'не рассчитан' },
        { label: 'Ставка по расчёту', value: decision.rate != null ? percent(decision.rate) : '—', hint: decision.rate != null ? 'годовых' : undefined },
      ]}
    />

    {binding && <div className={styles.binding}>
      <span className={styles.label}>Обоснование лимита</span>
      <b className={styles.bindingTitle}>Ограничен: {binding.title.toLowerCase()}</b>
      <span className={styles.bindingText}>{binding.text}</span>
    </div>}

    {decision.limit_kopecks > 0 && <div className={[styles.compare, overLimit > 0 ? styles.compareOver : styles.compareOk].join(' ')}>
      {overLimit > 0
        ? <><ExclamationCircleMIcon className={styles.compareIcon} aria-hidden />Запрошено на {formatMoney({ kopecks: overLimit })} больше расчётного лимита — одобрение на сумму заявки уйдёт на второе одобрение риск-менеджеру.</>
        : <><CheckmarkCircleMIcon className={styles.compareIcon} aria-hidden />Сумма заявки в пределах расчётного лимита.</>}
    </div>}

    {decision.stop_factors.length > 0 && <Plate view="negative" title="Стоп-факторы" className={styles.plate}>
      <ul className={styles.stopList}>{decision.stop_factors.map(code => <li key={code}>{stopFactorName[code] ?? code}</li>)}</ul>
    </Plate>}

    <div className={styles.factorsHead}>
      <h3 className={styles.h3}>Факторы скоринга</h3>
      <span className={styles.formula}>база {base} {factorSum >= 0 ? '+' : '−'} факторы {Math.abs(factorSum)} = <b>{decision.score}</b></span>
    </div>
    <FactorBars factors={factors} />

    {decision.explanation && <div className={styles.clientText}>
      <span className={styles.label}>Что видит клиент</span>
      <p>{decision.explanation}</p>
    </div>}
  </Card>
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Факторы как расходящиеся полосы: вправо зелёным — повышают балл, влево красным — снижают. */
function FactorBars({ factors }: { factors: (readonly [string, number])[] }) {
  if (factors.length === 0) return <p className={styles.empty}>Факторы не рассчитаны.</p>
  const sorted = [...factors].sort((a, b) => a[1] - b[1])
  const scale = Math.max(20, ...sorted.map(([, v]) => Math.abs(v)))
  return <ul className={styles.factors}>
    {sorted.map(([code, value]) => <li key={code} className={styles.factor}>
      <span className={styles.factorName}>{factorName[code] ?? code}</span>
      <span className={styles.track} aria-hidden>
        <span className={styles.axis} />
        {value !== 0 && <span className={value > 0 ? styles.barPos : styles.barNeg} style={{ width: `${(Math.abs(value) / scale) * 50}%` }} />}
      </span>
      <span className={[styles.factorValue, value > 0 ? styles.pos : value < 0 ? styles.neg : styles.zero].join(' ')}>
        {value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0'}
      </span>
    </li>)}
  </ul>
}
