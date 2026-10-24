import { ReactNode, useMemo } from 'react'
import { Card, EmptyState, KeyValue, KeyValueItem, Money } from '../../ui'
import { alfaRevenue, Snapshots } from './data'
import { ageText, formatDate, formatDateShort, percent, taxRegimeName } from './text'
import styles from './SourcesCard.module.css'

const legalType: Record<string, string> = { IP: 'ИП', LLC: 'ООО' }

/** Условные строки: пустые значения (false, '', null) выкидываем. */
const kv = (items: (KeyValueItem | null | undefined | false | '' | 0)[]) => items.filter(Boolean) as KeyValueItem[]

/** Что банк получил из источников: реестр, ФНС, БКИ, счёт в Альфе. Показываем только то, что пришло. */
export function SourcesCard({ snapshots }: { snapshots: Snapshots | undefined }) {
  const revenue = useMemo(() => alfaRevenue(snapshots), [snapshots])
  const reg = snapshots?.REGISTRY
  const fns = snapshots?.FNS
  const bki = snapshots?.BKI
  const alfa = snapshots?.ALFA
  const assets = snapshots?.PROFILE?.assets_owned?.filter(a => a.title) ?? []
  if (!reg && !fns && !bki && !alfa) {
    return <Card title="Данные источников">
      <EmptyState compact title="Данных из источников нет" text="Реестр, ФНС и БКИ ещё не ответили по этому клиенту." />
    </Card>
  }

  const regFlags = reg ? [
    reg.bankruptcy && 'банкротство',
    reg.mass_address && 'массовый адрес',
    reg.address_invalid && 'недостоверный адрес',
    reg.status && reg.status !== 'ACTIVE' && `статус: ${reg.status}`,
  ].filter(Boolean) as string[] : []
  const years = fns?.annual_revenue ? Object.keys(fns.annual_revenue).sort() : []
  const lastYear = years[years.length - 1]

  return <Card title="Данные источников" subtitle="Что банк получил по клиенту на момент расчёта">
    <div className={styles.grid}>
      {reg && <Block title="Реестр (ЕГРЮЛ / ЕГРИП)" flags={regFlags} ok="Негативных отметок нет">
        <KeyValue items={kv([
          reg.type && { label: 'Форма', value: legalType[reg.type] ?? reg.type },
          reg.reg_date && { label: 'Регистрация', value: formatDateShort(reg.reg_date), hint: ageText(reg.reg_date) },
          reg.okved && { label: 'ОКВЭД', value: reg.okved },
          reg.region && { label: 'Регион', value: reg.region },
          reg.director?.full_name && { label: 'Руководитель', value: reg.director.full_name },
        ])} className={styles.kv} />
      </Block>}

      {fns && <Block
        title="ФНС"
        flags={[fns.account_block && 'блокировка операций по счетам', (fns.tax_debt ?? 0) > 0 && 'есть налоговый долг'].filter(Boolean) as string[]}
        ok="Долгов и блокировок нет"
      >
        <KeyValue items={kv([
          fns.regime && { label: 'Налоговый режим', value: taxRegimeName[fns.regime] ?? fns.regime },
          lastYear && { label: `Выручка за ${lastYear} год`, value: <Money rubles={fns.annual_revenue![lastYear]} weight="medium" /> },
          { label: 'Налоговый долг', value: fns.tax_debt ? <Money rubles={fns.tax_debt} weight="medium" tone="negative" /> : 'нет' },
        ])} className={styles.kv} />
      </Block>}

      {bki && <Block
        title="БКИ"
        flags={[
          (bki.current_overdue_days ?? 0) > 0 && `текущая просрочка ${bki.current_overdue_days} дн.`,
          (bki.past_max_overdue_days_12m ?? 0) > 0 && `просрочка до ${bki.past_max_overdue_days_12m} дн. за 12 мес.`,
        ].filter(Boolean) as string[]}
        ok={bki.has_history === false ? 'Кредитной истории нет' : 'Просрочек нет'}
      >
        {(bki.external?.length ?? 0) === 0
          ? <p className={styles.note}>Кредитов в других банках нет.</p>
          : <ul className={styles.loans}>{bki.external!.map((loan, i) => <li key={i} className={styles.loan}>
            <div className={styles.loanHead}>
              <b>{loan.bank ?? 'Другой банк'}</b>
              {loan.balance != null && <Money rubles={loan.balance} weight="bold" />}
            </div>
            <span className={styles.loanMeta}>
              {[loan.product, loan.monthly_payment != null && `платёж ${new Intl.NumberFormat('ru-RU').format(loan.monthly_payment)} ₽/мес.`,
                loan.rate != null && percent(loan.rate), loan.months_left != null && `ещё ${loan.months_left} мес.`,
                (loan.overdue_days ?? 0) > 0 && `просрочка ${loan.overdue_days} дн.`].filter(Boolean).join(' · ')}
            </span>
          </li>)}</ul>}
      </Block>}

      {alfa && <Block title="Счёт в Альфе">
        <KeyValue items={kv([
          alfa.account?.opened && { label: 'Счёт открыт', value: formatDateShort(alfa.account.opened), hint: ageText(alfa.account.opened) },
          alfa.account?.balance != null && { label: 'Остаток', value: <Money rubles={alfa.account.balance} weight="medium" />, hint: alfa.account.balance_as_of ? `на ${formatDate(alfa.account.balance_as_of)}` : undefined },
          revenue && { label: 'Выручка в месяц', value: <Money rubles={revenue.avg} weight="medium" />, hint: `расчётно: среднее за ${revenue.months} полных мес. по операциям` },
          { label: 'Кредиты в Альфе', value: alfa.credits?.length ? `${alfa.credits.length}` : 'нет' },
        ] as (KeyValueItem | false | undefined | null | '')[] as KeyValueItem[])} className={styles.kv} />
      </Block>}

      {assets.length > 0 && <Block title="Имущество клиента">
        <KeyValue items={assets.map((a, i) => ({ key: String(i), label: a.title, value: a.value ? <Money rubles={a.value} weight="medium" /> : '—', hint: a.value ? 'оценка клиента' : undefined }))} className={styles.kv} />
      </Block>}
    </div>
  </Card>
}

function Block({ title, flags, ok, children }: { title: string; flags?: string[]; ok?: string; children: ReactNode }) {
  return <section className={styles.block}>
    <h3 className={styles.blockTitle}>{title}</h3>
    {flags && (flags.length > 0
      ? <div className={styles.flags}>{flags.map(f => <span key={f} className={styles.flagBad}>{f}</span>)}</div>
      : ok && <div className={styles.flags}><span className={styles.flagOk}>{ok}</span></div>)}
    {children}
  </section>
}
