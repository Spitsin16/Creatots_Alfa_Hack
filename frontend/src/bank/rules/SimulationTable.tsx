import { ReactNode, useContext } from 'react'
import { Table } from '@alfalab/core-components/table/esm'
import { useMatchMedia } from '@alfalab/core-components/mq/esm'
import { findPersona } from '../../demo/personas'
import { num, outcomeTitle, productTitle, reasonTitle, rub } from './meta'
import { RulesFormContext } from './RuleField'
import { ClassPill } from './Sections'
import styles from './SimulationTable.module.css'

/** Короткий итог расчёта по персоне (ответ POST /bank/rules/simulate) */
export type Short = { cls: string | null; score: number | null; product: string; outcome: string; limit: number | null; rate: number | null; reason?: string | null }
export type SimRow = { persona: string; title: string; before: Short; after: Short; changed: boolean }

const outcomeRank: Record<string, number> = { APPROVED: 3, COUNTER_OFFER: 2, MANUAL_REVIEW: 1, INFO_REQUESTED: 1, REJECTED: 0 }

/** Что именно поменялось у персоны */
export function rowDiff(r: SimRow) {
  const { before: b, after: a } = r
  return {
    outcome: b.outcome !== a.outcome || (b.reason ?? null) !== (a.reason ?? null),
    limit: (b.limit ?? 0) !== (a.limit ?? 0),
    rate: (b.rate ?? null) !== (a.rate ?? null),
    score: b.cls !== a.cls || b.score !== a.score,
  }
}

export const isDemoPersona = (id: string) => findPersona(id)?.group === 'client'

const limitText = (v: number | null) => (v ? rub(v) : '—')
const rateText = (v: number | null) => (v === null || v === undefined ? '—' : `${num(v)}%`)

function Change({ changed, before, after, tone, delta }: { changed: boolean; before: ReactNode; after: ReactNode; tone?: 'positive' | 'negative' | 'neutral'; delta?: ReactNode }) {
  if (!changed) return <span className={styles.same}>{after}</span>
  return <span className={styles.change}>
    <span className={styles.old}>{before}</span>
    <span className={styles.arrow} aria-label="стало">→</span>
    <b className={styles[`tone-${tone ?? 'neutral'}`]}>{after}</b>
    {delta && <span className={[styles.delta, styles[`tone-${tone ?? 'neutral'}`]].join(' ')}>{delta}</span>}
  </span>
}

function cells(r: SimRow) {
  const d = rowDiff(r)
  const { before: b, after: a } = r
  const outcomeTone = (outcomeRank[a.outcome] ?? 0) > (outcomeRank[b.outcome] ?? 0) ? 'positive' : (outcomeRank[a.outcome] ?? 0) < (outcomeRank[b.outcome] ?? 0) ? 'negative' : 'neutral'
  const limitDelta = (a.limit ?? 0) - (b.limit ?? 0)
  const rateDelta = (a.rate ?? 0) - (b.rate ?? 0)
  const outcome = <div>
    <Change changed={d.outcome} before={outcomeTitle[b.outcome] ?? b.outcome} after={outcomeTitle[a.outcome] ?? a.outcome} tone={outcomeTone} />
    {a.reason && <div className={styles.reason}>{reasonTitle[a.reason] ?? a.reason}</div>}
  </div>
  const limit = <Change changed={d.limit} before={limitText(b.limit)} after={limitText(a.limit)} tone={limitDelta > 0 ? 'positive' : 'negative'}
    delta={b.limit && a.limit ? `${limitDelta > 0 ? '+' : '−'}${rub(Math.abs(limitDelta))}` : undefined} />
  const rate = <Change changed={d.rate} before={rateText(b.rate)} after={rateText(a.rate)} tone={rateDelta < 0 ? 'positive' : 'negative'}
    delta={b.rate !== null && a.rate !== null ? `${rateDelta > 0 ? '+' : '−'}${num(Math.abs(rateDelta))} п.п.` : undefined} />
  const score = <Change changed={d.score}
    before={<span className={styles.score}>{b.cls && <ClassPill name={b.cls} />}{b.score ?? '—'}</span>}
    after={<span className={styles.score}>{a.cls && <ClassPill name={a.cls} />}{a.score ?? '—'}</span>} />
  return { d, outcome, limit, rate, score }
}

function Who({ r }: { r: SimRow }) {
  const p = findPersona(r.persona)
  const rules = useContext(RulesFormContext)?.base
  return <div className={styles.who}>
    <b>{p?.title || r.title || r.persona}</b>
    <span>{r.persona} · {productTitle(rules, r.after.product)}</span>
  </div>
}

/** Таблица «было → стало» по клиентам: подсвечены изменившиеся решения, лимиты, ставки и баллы. */
export function SimulationTable({ rows }: { rows: SimRow[] }) {
  const [mobile] = useMatchMedia('(max-width: 700px)')
  if (mobile) {
    return <ul className={styles.cards}>
      {rows.map(r => {
        const c = cells(r)
        return <li key={r.persona} className={[styles.card, r.changed ? styles.cardChanged : ''].join(' ')}>
          <div className={styles.cardHead}><Who r={r} />{r.changed ? <span className={styles.badge}>изменится</span> : <span className={styles.badgeSame}>без изменений</span>}</div>
          <dl className={styles.cardList}>
            <div className={c.d.outcome ? styles.hl : ''}><dt>Решение</dt><dd>{c.outcome}</dd></div>
            <div className={c.d.limit ? styles.hl : ''}><dt>Лимит</dt><dd>{c.limit}</dd></div>
            <div className={c.d.rate ? styles.hl : ''}><dt>Ставка</dt><dd>{c.rate}</dd></div>
            <div className={c.d.score ? styles.hl : ''}><dt>Балл</dt><dd>{c.score}</dd></div>
          </dl>
        </li>
      })}
    </ul>
  }
  return <div className={styles.tableWrap}>
    <Table wrapper={false} className={styles.table}>
      <Table.THead>
        <Table.THeadCell width="26%">Клиент</Table.THeadCell>
        <Table.THeadCell width="24%">Решение</Table.THeadCell>
        <Table.THeadCell width="20%">Лимит</Table.THeadCell>
        <Table.THeadCell width="15%">Ставка</Table.THeadCell>
        <Table.THeadCell width="15%">Балл</Table.THeadCell>
      </Table.THead>
      <Table.TBody>
        {rows.map(r => {
          const c = cells(r)
          return <Table.TRow key={r.persona} className={r.changed ? styles.rowChanged : undefined}>
            <Table.TCell className={styles.cell}><Who r={r} /></Table.TCell>
            <Table.TCell className={[styles.cell, c.d.outcome ? styles.hl : ''].join(' ')}>{c.outcome}</Table.TCell>
            <Table.TCell className={[styles.cell, c.d.limit ? styles.hl : ''].join(' ')}>{c.limit}</Table.TCell>
            <Table.TCell className={[styles.cell, c.d.rate ? styles.hl : ''].join(' ')}>{c.rate}</Table.TCell>
            <Table.TCell className={[styles.cell, c.d.score ? styles.hl : ''].join(' ')}>{c.score}</Table.TCell>
          </Table.TRow>
        })}
      </Table.TBody>
    </Table>
  </div>
}

/** Итог прогона: у скольких клиентов что поменяется */
export function SimulationSummary({ rows }: { rows: SimRow[] }) {
  const diffs = rows.map(rowDiff)
  const changed = rows.filter(r => r.changed).length
  const count = (k: keyof ReturnType<typeof rowDiff>) => diffs.filter(d => d[k]).length
  return <div className={styles.summary}>
    <div className={styles.summaryMain}>
      <span className={styles.summaryLabel}>Изменится у</span>
      <b className={styles.summaryValue}>{changed} из {rows.length}</b>
      <span className={styles.summaryLabel}>тестовых клиентов</span>
    </div>
    <ul className={styles.summaryList}>
      <li><span>Решение</span><b>{count('outcome')}</b></li>
      <li><span>Лимит</span><b>{count('limit')}</b></li>
      <li><span>Ставка</span><b>{count('rate')}</b></li>
      <li><span>Балл или класс</span><b>{count('score')}</b></li>
    </ul>
  </div>
}
