import { ReactNode, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Button } from '@alfalab/core-components/button/esm'
import { Checkbox } from '@alfalab/core-components/checkbox/esm'
import { CodeInput } from '@alfalab/core-components/code-input/esm'
import { Plate } from '@alfalab/core-components/plate/esm'
import { Application, productName, request } from '../../api'
import { useSession } from '../../auth'
import { DocList, RequestedDocuments, useApplicationDocuments } from '../../common/Documents'
import { Processing } from '../../common/Spinner'
import { addDays, clientComment, enteredAt, enteredFrom, formatDate, formatDeadline, OFFER_VALID_DAYS, processingStatuses, REVIEW_HOURS, workingDeadline } from '../../common/status'
import { formatMoney, Money } from '../../ui/Money'
import { KeyValue } from '../../ui/KeyValue'
import { annuitySchedule, isAnnuityProduct } from './schedule'
import { useOfferRate } from './terms'
import { ApplicationAction } from './useApplicationAction'
import styles from './Application.module.css'

export type Perms = { canSubmit: boolean; canSign: boolean; canFill: boolean; canConsent: boolean }
type Copy = { headline: string; lead?: ReactNode }

const blank = (s: string | null | undefined) => !s || !s.trim()
/** Комментарий к последнему переходу в status — словами для клиента (системные фразы бэка заменены). */
const lastComment = (a: Application, status: string) => {
  const t = [...(a.timeline ?? [])].reverse().find(x => x.to_status === status)
  return t ? clientComment(t, a.product) : null
}

/** Заголовок трекера: что с заявкой сейчас — одной фразой. */
export function statusCopy(a: Application, p: Perms): Copy {
  const timeline = a.timeline ?? []
  switch (a.status) {
    case 'DRAFT':
      if (p.canSubmit) return { headline: 'Заявка готова к отправке', lead: 'Условия перенесены из предложения — проверьте их и отправьте заявку в банк.' }
      if (p.canFill) return { headline: 'Заявка подготовлена', lead: 'Отправить её в банк может директор — передайте ему заявку.' }
      return { headline: 'Черновик заявки', lead: 'Отправить заявку в банк может директор.' }
    case 'AWAITING_SIGNATURE':
      return p.canSubmit
        ? { headline: 'Заявку подготовил сотрудник', lead: 'Сотрудник по доверенности подготовил заявку — отправить её в банк можете вы.' }
        : { headline: 'Заявка передана директору', lead: 'Он видит её у себя в кабинете и может отправить в банк одним нажатием.' }
    case 'SUBMITTED': case 'VALIDATION': case 'ENRICHMENT': case 'SCORING':
      return { headline: 'Проверяем данные', lead: 'Система автоматически сверяет данные с реестром, ФНС и БКИ.' }
    case 'MANUAL_REVIEW': {
      const since = enteredAt('MANUAL_REVIEW', timeline)
      const due = since ? workingDeadline(since, REVIEW_HOURS) : null
      const late = due && due.getTime() < Date.now()
      return {
        headline: 'Заявку проверяет специалист',
        lead: due
          ? late
            ? <>Ориентир был до {formatDeadline(due)} — проверка идёт дольше обычного. Заявка не потеряется: если специалист не успевает, её берёт другой.</>
            : <>Срок ручной проверки — 1 рабочий день: ориентир <b>до {formatDeadline(due)}</b>.</>
          : 'Срок ручной проверки — 1 рабочий день.',
      }
    }
    case 'INFO_REQUESTED':
      return { headline: 'Банк просит документы', lead: 'Специалисту не хватает документов, чтобы принять решение.' }
    case 'COUNTER_OFFER':
      return { headline: 'Банк предлагает другие условия', lead: blank(a.decision?.explanation) ? 'На исходных условиях одобрить не получилось, но банк готов выдать на других.' : a.decision!.explanation }
    case 'APPROVED':
      return p.canSign
        ? { headline: 'Заявка одобрена — подпишите договор', lead: 'Деньги поступят на счёт сразу после подписания.' }
        : { headline: 'Заявка одобрена', lead: 'Договор подписывает директор — он видит заявку у себя в кабинете.' }
    case 'CONTRACT_SIGNED':
      return { headline: 'Договор подписан', lead: 'Зачисляем деньги на счёт — это займёт несколько секунд.' }
    case 'ISSUED': {
      const at = enteredAt('ISSUED', timeline)
      const amount = formatMoney({ kopecks: a.amount_kopecks })
      return {
        headline: a.product === 'REFINANCE' ? 'Кредит в другом банке погашен' : a.product === 'OVERDRAFT' ? 'Овердрафт подключён' : 'Деньги на счёте',
        lead: a.product === 'REFINANCE'
          ? `${amount} направлены на погашение кредита в другом банке${at ? ` ${formatDate(at)}` : ''}.`
          : a.product === 'OVERDRAFT'
            ? `Лимит овердрафта ${amount} подключён к расчётному счёту${at ? ` ${formatDate(at)}` : ''}.`
            : `${amount} зачислены на расчётный счёт${at ? ` ${formatDate(at)}` : ''}.`,
      }
    }
    case 'REJECTED':
      return { headline: 'Банк отказал по заявке', lead: blank(a.decision?.explanation) ? (lastComment(a, 'REJECTED') ?? undefined) : a.decision!.explanation }
    case 'CANCELLED':
      return { headline: 'Заявка отменена', lead: lastComment(a, 'CANCELLED') ?? undefined }
    case 'EXPIRED':
      // Истечь может и одобрение (договор не подписан), и предложение банка (условия не приняты)
      return enteredFrom('EXPIRED', timeline) === 'COUNTER_OFFER'
        ? { headline: 'Срок предложения истёк', lead: `Предложение банка действует ${OFFER_VALID_DAYS} дней — условия не приняты за это время.` }
        : { headline: 'Срок одобрения истёк', lead: `Одобрение действует ${OFFER_VALID_DAYS} дней — договор не подписан за это время.` }
    default:
      return { headline: a.status }
  }
}

type Props = { a: Application; perms: Perms; action: ApplicationAction; onWrite: () => void }

/** Блок «Что дальше»: понятное ожидание и главное действие для текущего статуса. */
export function NextStep({ a, perms, action, onWrite }: Props) {
  const navigate = useNavigate()
  const { token } = useSession()
  const busy = action.isPending
  // Бэк не отправляет заявку без действующих согласий на БКИ и ФНС (409 CONSENTS_REQUIRED) — даём их прямо здесь.
  const needConsent = !!action.error && ((action.variables?.kind === 'submit' && /соглас/i.test(action.error.message)) || action.variables?.kind === 'consentSubmit')
  const error = action.error && action.variables?.kind !== 'sign' && !(needConsent && action.variables?.kind === 'submit') ? action.error : null
  const restart = <Button view="accent" size={48} onClick={() => navigate('/')}>Рассчитать новое предложение</Button>
  // Документ по запросу банка отправлен: блок запроса исчезает, страница становится короче —
  // показываем подтверждение и возвращаем к началу трекера (на телефоне иначе окажешься в чате).
  const [docSent, setDocSent] = useState(false)
  const showSent = docSent && ['SCORING', 'MANUAL_REVIEW'].includes(a.status)
  useEffect(() => {
    if (showSent) document.getElementById('tracker')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [showSent])
  const onDocumentSent = () => { setDocSent(true); action.refresh() }

  let text: ReactNode = null
  let body: ReactNode = null
  let buttons: ReactNode = null

  switch (a.status) {
    case 'DRAFT':
    case 'AWAITING_SIGNATURE':
      if (perms.canSubmit && needConsent) {
        body = <ConsentNeeded action={action} canConsent={perms.canConsent} />
        buttons = <ConfirmButton action={action} kind="cancel" label="Отменить заявку" question="Отменить заявку?" yes="Да, отменить" />
      } else if (perms.canSubmit) {
        text = 'После отправки система проверит данные в реестре, ФНС и БКИ — обычно за несколько секунд. Решение появится здесь, статус обновится сам.'
        buttons = <>
          <Button view="accent" size={48} loading={action.pendingKind === 'submit'} disabled={busy} onClick={() => action.mutate({ kind: 'submit' })}>Отправить заявку</Button>
          <ConfirmButton action={action} kind="cancel" label="Отменить заявку" question="Отменить заявку?" yes="Да, отменить" />
        </>
      } else if (a.status === 'DRAFT' && perms.canFill) {
        text = 'Директор увидит заявку у себя в кабинете в разделе «Мои заявки» и отправит её в банк одним нажатием. Пока заявка не отправлена, банк её не видит.'
        buttons = <Button view="accent" size={48} loading={action.pendingKind === 'submit'} disabled={busy} onClick={() => action.mutate({ kind: 'submit' })}>Передать директору</Button>
      } else {
        text = a.status === 'AWAITING_SIGNATURE'
          ? 'Как только директор отправит заявку, начнётся проверка — статус здесь обновится сам.'
          : 'Отправить заявку может директор — он видит её у себя в кабинете.'
      }
      break
    case 'SUBMITTED': case 'VALIDATION': case 'ENRICHMENT': case 'SCORING':
      body = <Processing status={a.status} />
      text = 'Дальше — решение: автоматическое или, если нужно, после проверки специалистом.'
      break
    case 'MANUAL_REVIEW':
      if (showSent) body = <Plate view="positive" rounded title="Документ передан специалисту">Заявка снова на проверке — решение или новый вопрос появятся здесь.</Plate>
      text = 'Специалист изучит данные и примет решение: одобрит, предложит другие условия или попросит документы. Если понадобятся документы, здесь появится запрос, а в колокольчике — уведомление. Вопрос специалисту можно задать в чате ниже.'
      break
    case 'INFO_REQUESTED': {
      const note = lastComment(a, 'INFO_REQUESTED') ?? a.decision?.explanation
      body = <>
        {!blank(note) && <blockquote className={styles.quote}><span className={styles.quoteLabel}>Комментарий специалиста</span>{note}</blockquote>}
        <RequestedDocuments token={token} applicationId={a.id} businessId={a.business_id} onDone={onDocumentSent} canFill={perms.canFill} />
      </>
      text = 'Как только документ придёт, заявка сразу вернётся к специалисту. Непонятно, что приложить, — спросите в чате.'
      buttons = <Button view="transparent" size={40} onClick={onWrite}>Спросить в чате</Button>
      break
    }
    case 'COUNTER_OFFER':
      body = <CounterTerms a={a} />
      text = (() => {
        const since = enteredAt('COUNTER_OFFER', a.timeline ?? [])
        const until = since ? ` — до ${formatDate(addDays(since, OFFER_VALID_DAYS), true)}` : ''
        return perms.canSubmit
          ? `Примите условия — заявка перейдёт к подписанию договора. Предложение действует ${OFFER_VALID_DAYS} дней${until}.`
          : `Ответить на предложение может директор — он видит заявку у себя в кабинете. Предложение действует ${OFFER_VALID_DAYS} дней${until}.`
      })()
      if (perms.canSubmit) buttons = <>
        <Button view="accent" size={48} loading={action.pendingKind === 'accept'} disabled={busy} onClick={() => action.mutate({ kind: 'accept' })}>Принять условия</Button>
        <ConfirmButton action={action} kind="decline" label="Отказаться" question="Отказаться от предложения? Заявка будет закрыта." yes="Да, отказаться" />
      </>
      break
    case 'APPROVED': {
      const since = enteredAt('APPROVED', a.timeline ?? [])
      const until = since ? ` до ${formatDate(addDays(since, OFFER_VALID_DAYS), true)}` : ''
      if (perms.canSign) body = <SignForm action={action} />
      text = perms.canSign
        ? `Код подтверждает подпись договора на условиях этой заявки — они в блоке «Условия». Одобрение действует${until || ` ${OFFER_VALID_DAYS} дней`}.`
        : `Подписать договор может директор. Одобрение действует${until || ` ${OFFER_VALID_DAYS} дней`}.`
      break
    }
    case 'CONTRACT_SIGNED':
      body = <Processing status="CONTRACT_SIGNED" />
      break
    case 'ISSUED':
      body = <ContractLink token={token} applicationId={a.id} />
      text = a.product === 'OVERDRAFT'
        ? 'Пользуйтесь лимитом, когда на счёте не хватает денег, — как он гасится, смотрите ниже.'
        : 'Платить — по графику ниже. Досрочное погашение — без штрафа.'
      buttons = <Button view="secondary" size={40} onClick={() => navigate('/documents')}>Все документы</Button>
      break
    case 'REJECTED': {
      const advice = a.decision?.advice ?? []
      body = advice.length > 0 && <div className={styles.advice}>
        <div className={styles.adviceTitle}>Что можно сделать</div>
        {/* Лимиты «что если» посчитаны автоматическим решением до отказа специалиста — клиенту их не обещаем */}
        <ul className={styles.adviceList}>{advice.map(x => <li key={x.code}>{x.text}</li>)}</ul>
      </div>
      text = 'Новую заявку можно подать в любой момент — условия посчитаются заново по свежим данным.'
      buttons = restart
      break
    }
    case 'CANCELLED':
    case 'EXPIRED':
      text = 'Рассчитайте предложение заново — условия посчитаются по свежим данным, заявка оформляется в один клик.'
      buttons = restart
      break
  }

  if (!text && !body && !buttons) return null
  return <div className={styles.next}>
    <div className={styles.nextLabel}>Что дальше</div>
    {body}
    {text && <p className={styles.nextText}>{text}</p>}
    {error && <Plate view="negative" rounded title="Не получилось">{error.message}</Plate>}
    {buttons && <div className={styles.buttons}>{buttons}</div>}
  </div>
}

/** Необратимое действие (отменить заявку, отказаться от предложения) — с подтверждением прямо на месте. */
function ConfirmButton({ action, kind, label, question, yes }: { action: ApplicationAction; kind: 'cancel' | 'decline'; label: string; question: string; yes: string }) {
  const [ask, setAsk] = useState(false)
  if (!ask) return <Button view={kind === 'cancel' ? 'transparent' : 'secondary'} size={48} disabled={action.isPending} onClick={() => setAsk(true)}>{label}</Button>
  return <span className={styles.confirm} role="group" aria-label={question}>
    <span>{question}</span>
    <span className={styles.confirmButtons}>
      <Button view="secondary" size={40} loading={action.pendingKind === kind} disabled={action.isPending && action.pendingKind !== kind} onClick={() => action.mutate({ kind })}>{yes}</Button>
      <Button view="transparent" size={40} disabled={action.isPending} onClick={() => setAsk(false)}>Нет</Button>
    </span>
  </span>
}

/** Согласия на БКИ/ФНС нет или оно истекло — дать его и сразу отправить заявку. */
function ConsentNeeded({ action, canConsent }: { action: ApplicationAction; canConsent: boolean }) {
  const [agree, setAgree] = useState(false)
  if (!canConsent) return <Plate view="attention" rounded title="Нужно согласие на запрос в БКИ и ФНС">
    Перед отправкой банк проверяет кредитную историю и налоговые данные компании. Согласие даёт руководитель — после этого заявку можно отправить.
  </Plate>
  return <div className={styles.consent}>
    <div className={styles.consentTitle}>Нужно согласие на запрос в БКИ и ФНС</div>
    <p className={styles.consentText}>Перед отправкой банк проверяет кредитную историю и налоговые данные компании. Согласия нет или срок его действия истёк.</p>
    <Checkbox size={24} checked={agree} disabled={action.isPending} onChange={(_, { checked }) => setAgree(checked)}
      label="Согласен на запрос данных в БКИ и ФНС" hint="Действует год. Паспорт и справки не нужны — данные по счёту у банка уже есть." />
    <Button view="accent" size={48} className={styles.consentButton} disabled={!agree || action.isPending} loading={action.pendingKind === 'consentSubmit'}
      onClick={() => action.mutate({ kind: 'consentSubmit' })}>Дать согласие и отправить</Button>
  </div>
}

/** Подпись договора кодом (кит CodeInput на 4 цифры). */
function SignForm({ action }: { action: ApplicationAction }) {
  const [code, setCode] = useState('')
  const signError = action.variables?.kind === 'sign' && action.error ? action.error.message : undefined
  const sign = () => action.mutate({ kind: 'sign', body: { code } })
  return <div className={styles.sign}>
    <div className={styles.signLabel}>Код подтверждения</div>
    <CodeInput
      fields={4}
      className={styles.code}
      error={signError}
      onChange={value => { setCode(value); if (action.error) action.reset() }}
      onComplete={value => setCode(value)}
      onErrorAnimationEnd={() => setCode('')}
      disabled={action.isPending}
    />
    <div className={styles.signHint}>Демо-код <b>0000</b> — в настоящем банке он пришёл бы в SMS или пуш.</div>
    <Button view="accent" size={48} className={styles.signButton} disabled={code.length !== 4 || action.isPending} loading={action.pendingKind === 'sign'} onClick={sign}>Подписать договор</Button>
  </div>
}

type CounterOffer = { product: string; amount_kopecks: number; term_months: number; rate: number | null }

/** Условия контрпредложения банка — рядом с тем, что было в заявке, чтобы было с чем сравнить. */
function CounterTerms({ a }: { a: Application }) {
  const { token } = useSession()
  const terms = useQuery({
    queryKey: ['counter-offer', a.id],
    queryFn: () => request<CounterOffer>(`/api/v1/applications/${a.id}/counter-offer`, {}, token),
  })
  // Ставка исходной заявки — из предложения, из которого она создана (тот же запрос, что в «Условиях заявки»)
  const wasRate = useOfferRate(a, true)
  if (terms.isPending) return <div className={styles.inlineNote}>Загружаем условия банка…</div>
  if (terms.error) return <Plate view="negative" rounded title="Не загрузили условия" buttons={[<Button key="r" size={32} onClick={() => void terms.refetch()}>Повторить</Button>]}>{terms.error.message}</Plate>
  const t = terms.data
  const pct = (r: number) => `${String(r).replace('.', ',')}%`
  // Платёж по условиям банка — только для кредитов с ежемесячным платежом, считаем сами (подписываем «расчётно»)
  const payment = t.rate != null && isAnnuityProduct(t.product) ? annuitySchedule(t.amount_kopecks / 100, t.rate, t.term_months, null).payment : null
  const wasPayment = wasRate != null && isAnnuityProduct(a.product) ? annuitySchedule(a.amount_kopecks / 100, wasRate, a.term_months, null).payment : null
  const changed = (x: number) => Math.abs(x) > 0.5
  const tiles = [
    { label: t.product === 'OVERDRAFT' ? 'Лимит' : 'Сумма', value: <Money kopecks={t.amount_kopecks} />, hint: t.amount_kopecks !== a.amount_kopecks ? `в заявке ${formatMoney({ kopecks: a.amount_kopecks })}` : undefined },
    { label: 'Срок', value: <span className={styles.nowrap}>{t.term_months} мес.</span>, hint: t.term_months !== a.term_months ? `в заявке ${a.term_months} мес.` : undefined },
    t.rate != null ? { label: 'Ставка', value: <span className={styles.nowrap}>{pct(t.rate)}</span>, hint: wasRate != null && wasRate !== t.rate ? `годовых · в заявке ${pct(wasRate)}` : 'годовых' } : null,
    payment != null ? { label: 'Платёж в месяц', value: <Money rubles={payment} prefix="≈" />, hint: wasPayment != null && changed(wasPayment - payment) ? `в заявке ≈\u00a0${formatMoney({ rubles: wasPayment })}` : 'расчётно' } : null,
  ]
  const count = tiles.filter(Boolean).length as 2 | 3 | 4
  return <div className={styles.counter}>
    <div className={styles.counterProduct}>
      <span>{productName(t.product)}</span>
      {t.product !== a.product && <small>вместо: {productName(a.product).toLowerCase()}</small>}
    </div>
    <KeyValue view="tiles" columns={count} className={styles.counterTiles} items={tiles} />
  </div>
}

/** Подписанный договор из документов заявки — скачать прямо из трекера. */
function ContractLink({ token, applicationId }: { token: string; applicationId: string }) {
  const docs = useApplicationDocuments(token, applicationId)
  const contract = docs.data?.find(d => d.kind === 'CONTRACT')
  if (docs.isPending) return <div className={styles.inlineNote}>Ищем договор в документах…</div>
  if (!contract) return <div className={styles.inlineNote}>Договор появится в разделе «Документы» через несколько секунд.</div>
  return <div className={styles.contract}><DocList items={[contract]} token={token} /></div>
}

export const isProcessing = (status: string) => processingStatuses.includes(status) || status === 'CONTRACT_SIGNED'
