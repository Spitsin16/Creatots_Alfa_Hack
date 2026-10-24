import { ComponentType, ReactNode, SVGProps, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Attach } from '@alfalab/core-components/attach/esm'
import { Button } from '@alfalab/core-components/button/esm'
import { CalendarInput } from '@alfalab/core-components/calendar-input/esm'
import { Dropzone } from '@alfalab/core-components/dropzone/esm'
import { IconButton } from '@alfalab/core-components/icon-button/esm'
import { Plate } from '@alfalab/core-components/plate/esm'
import { Select } from '@alfalab/core-components/select/esm'
import { Status } from '@alfalab/core-components/status/esm'
import { Tag } from '@alfalab/core-components/tag/esm'
import { DocumentDocMIcon } from '@alfalab/icons-glyph/DocumentDocMIcon'
import { DocumentExcelMIcon } from '@alfalab/icons-glyph/DocumentExcelMIcon'
import { DocumentImageMIcon } from '@alfalab/icons-glyph/DocumentImageMIcon'
import { DocumentLinesMIcon } from '@alfalab/icons-glyph/DocumentLinesMIcon'
import { DocumentPdfMIcon } from '@alfalab/icons-glyph/DocumentPdfMIcon'
import { DocumentStampMIcon } from '@alfalab/icons-glyph/DocumentStampMIcon'
import { DocumentTxtMIcon } from '@alfalab/icons-glyph/DocumentTxtMIcon'
import { DocumentsLinesMIcon } from '@alfalab/icons-glyph/DocumentsLinesMIcon'
import { DownloadMIcon } from '@alfalab/icons-glyph/DownloadMIcon'
import { PaperclipMIcon } from '@alfalab/icons-glyph/PaperclipMIcon'
import { DocItem, downloadFile, request, uploadFile } from '../api'
import { Bell } from './Bell'
import { Spinner } from './Spinner'
import { Card } from '../ui/Card'
import { Grid, Stack } from '../ui/Layout'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../ui/States'
import styles from './Documents.module.css'

/** Виды документов — как на бэке (backend/app/services/documents/storage.py: KINDS). */
export const documentKinds: [string, string][] = [
  ['CHARTER', 'Устав'], ['MCHD', 'МЧД'], ['STATEMENT', 'Выписка'], ['CONTRACT', 'Договор'], ['CERTIFICATE', 'Справка'], ['OTHER', 'Прочее'],
]
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.txt,.docx,.xlsx'
const ACCEPT_TEXT = 'PDF, JPG, PNG, TXT, DOCX или XLSX — до 10 МБ'

export const documentKeys = {
  business: (businessId: string) => ['business-documents', businessId] as const,
  application: (applicationId: string) => ['application-documents', applicationId] as const,
}

/** Документы бизнеса (хранилище). */
export function useBusinessDocuments(token: string, businessId: string) {
  return useQuery({
    queryKey: documentKeys.business(businessId),
    queryFn: () => request<{ items: DocItem[] }>(`/api/v1/businesses/${businessId}/documents`, {}, token).then(d => d.items),
  })
}

/** Документы, приложенные к заявке (в т.ч. подписанный договор). */
export function useApplicationDocuments(token: string, applicationId: string, enabled = true) {
  return useQuery({
    queryKey: documentKeys.application(applicationId),
    queryFn: () => request<{ items: DocItem[] }>(`/api/v1/applications/${applicationId}/documents`, {}, token).then(d => d.items),
    enabled,
  })
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
const sizeText = (size: number | null) => (size == null ? '' : size < 1024 ? `${size} Б` : size < 1024 * 1024 ? `${Math.ceil(size / 1024)} КБ` : `${(size / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`)

function iconFor(d: DocItem): ComponentType<SVGProps<SVGSVGElement>> {
  if (d.kind === 'CONTRACT' && d.status === 'SIGNED') return DocumentStampMIcon
  const ext = (d.filename ?? '').split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return DocumentPdfMIcon
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') return DocumentImageMIcon
  if (ext === 'txt') return DocumentTxtMIcon
  if (ext === 'docx' || ext === 'doc') return DocumentDocMIcon
  if (ext === 'xlsx' || ext === 'xls') return DocumentExcelMIcon
  return DocumentLinesMIcon
}

type DocRowProps = {
  doc: DocItem
  token: string
  /** Кнопка справа от названия (на узкой ширине — под ним): «Приложить» */
  action?: ReactNode
  /** Заявки, к которым приложен этот файл (в хранилище бизнеса) — покажем номера со ссылками */
  attachedTo?: string[]
}

/** Одна строка документа: иконка, название, вид · файл · размер, срок действия, скачать. */
export function DocRow({ doc, token, action, attachedTo }: DocRowProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const Icon = iconFor(doc)
  const download = async () => {
    setState('loading')
    try { await downloadFile(`/api/v1/documents/${doc.id}/file`, doc.filename ?? 'file', token); setState('idle') }
    catch { setState('error') }
  }
  const meta = [doc.kind_title, doc.filename && doc.filename !== doc.title ? doc.filename : null, sizeText(doc.size)].filter(Boolean).join(' · ')
  const tag = (color: 'green' | 'red' | 'grey' | 'blue', text: ReactNode) => <Status color={color} view="muted-alt" size={20} shape="rounded" uppercase={false} className={styles.tag}>{text}</Status>
  return <div className={[styles.row, doc.expired ? styles.expired : '', action ? styles.withAction : ''].join(' ')}>
    <span className={styles.icon} aria-hidden><Icon /></span>
    <div className={styles.main}>
      <div className={styles.name}>{doc.title}</div>
      <div className={styles.meta}>{meta}{doc.created_at ? ` · загружен ${shortDate(doc.created_at)}` : ''}</div>
      <div className={styles.tags}>
        {doc.status === 'SIGNED' && tag('green', 'Подписан')}
        {doc.expired && doc.valid_to && tag('red', `Срок истёк ${shortDate(doc.valid_to)}`)}
        {!doc.expired && doc.valid_to && tag('grey', `Действует до ${shortDate(doc.valid_to)}`)}
        {attachedTo && attachedTo.length > 0 && <span className={styles.attached}>
          Приложен к {attachedTo.length === 1 ? 'заявке' : 'заявкам'}{' '}
          {attachedTo.map((id, i) => <span key={id}>{i > 0 && ', '}<Link to={`/applications/${id}`}>№ {id.slice(0, 8)}</Link></span>)}
        </span>}
        {state === 'error' && <span className={styles.rowError}>Не удалось скачать — попробуйте ещё раз</span>}
      </div>
    </div>
    <div className={styles.actions}>
      {action}
      <IconButton icon={DownloadMIcon} size={40} view="secondary" aria-label={`Скачать «${doc.title}»`} title="Скачать" loading={state === 'loading'} onClick={() => void download()} />
    </div>
  </div>
}

/** Список документов (клиент и карточка заявки в банке). */
export function DocList({ items, token, emptyText = 'Документов пока нет' }: { items: DocItem[]; token: string; emptyText?: string }) {
  if (items.length === 0) return <div className={styles.emptyLine}>{emptyText}</div>
  return <div className={styles.list}>{items.map(d => <DocRow key={d.id} doc={d} token={token} />)}</div>
}

/** Зона загрузки: перетащить файл или выбрать кнопкой (кит Dropzone + Attach). */
function FileDrop({ onFile, busy, label = 'Выбрать файл', disabled }: { onFile: (file: File) => void; busy: boolean; label?: string; disabled?: boolean }) {
  return <Dropzone block text="Отпустите файл — загрузим" onDrop={files => { if (files[0] && !busy && !disabled) onFile(files[0]) }} disabled={disabled || busy} className={styles.drop}>
    <div className={styles.dropInner}>
      <span className={styles.dropIcon} aria-hidden><PaperclipMIcon /></span>
      <div className={styles.dropText}>
        <b>Перетащите файл сюда</b>
        <span>{ACCEPT_TEXT}</span>
      </div>
      {busy
        ? <Spinner label="Загружаем…" />
        : <Attach
          accept={ACCEPT}
          size={40}
          value={null}
          disabled={disabled}
          noFileText=""
          buttonContent={label}
          buttonProps={{ view: 'secondary', size: 40 }}
          onChange={(_, { files }) => { if (files[0]) onFile(files[0]) }}
          className={styles.attach}
        />}
    </div>
  </Dropzone>
}

/** Ключ «тот же файл»: копия, созданная при «Приложить», совпадает с оригиналом по этим полям. */
const copyKey = (d: DocItem) => `${d.kind}|${d.title}|${d.filename}|${d.size}|${d.valid_to}`

/** Схлопнуть копии одного файла: оригинал из хранилища + номера заявок, к которым он приложен. */
function groupCopies(list: DocItem[]): { doc: DocItem; attachedTo: string[] }[] {
  const byKey = new Map<string, DocItem[]>()
  for (const d of list) {
    // Договоры — у каждой заявки свой, не схлопываем
    const key = d.kind === 'CONTRACT' ? `contract|${d.id}` : copyKey(d)
    byKey.set(key, [...(byKey.get(key) ?? []), d])
  }
  return [...byKey.values()].map(copies => {
    const doc = copies.find(d => !d.application_id) ?? copies[0]
    const attachedTo = doc.kind === 'CONTRACT' ? [] : [...new Set(copies.map(d => d.application_id).filter((x): x is string => !!x))]
    return { doc, attachedTo }
  })
}

const kindOptions = documentKinds.map(([key, content]) => ({ key, content }))

/**
 * Поле «Действует до»: пусто — срока нет; иначе дата целиком и настоящая (31.13.2027 бэк не примет).
 * Прошедшая дата допустима (например, загружают старую справку), но документ сразу будет истёкшим.
 */
function checkValidTo(value: string): { iso: string; error?: string; warning?: string } {
  const v = value.trim()
  if (!v) return { iso: '' }
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v)
  if (!m) return { iso: '', error: 'Введите дату полностью: ДД.ММ.ГГГГ' }
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return { iso: '', error: 'Такой даты нет — проверьте день и месяц' }
  if (y < 1990 || y > 2100) return { iso: '', error: 'Проверьте год' }
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return { iso: `${m[3]}-${m[2]}-${m[1]}`, warning: date < today ? 'Дата уже прошла — документ сразу будет отмечен истёкшим' : undefined }
}

// Хранилище документов бизнеса (модуль 16.3): загрузить, список, скачать, срок действия.
export function DocumentsPage({ token, businessId, canUpload, businessName }: { token: string; businessId: string; canUpload: boolean; businessName?: string }) {
  const client = useQueryClient()
  const docs = useBusinessDocuments(token, businessId)
  const [kind, setKind] = useState('CHARTER')
  const [validTo, setValidTo] = useState('')
  // Ошибку незаконченной даты показываем, когда поле потеряло фокус, а не на каждой цифре
  const [dateTouched, setDateTouched] = useState(false)
  const [filter, setFilter] = useState('')
  const [done, setDone] = useState('')
  const upload = useMutation({
    mutationFn: (file: File) => {
      const { iso } = checkValidTo(validTo)
      return uploadFile<DocItem>(`/api/v1/businesses/${businessId}/documents?kind=${kind}${iso ? `&valid_to=${iso}` : ''}`, file, token)
    },
    onMutate: () => setDone(''),
    onSuccess: doc => { setDone(`«${doc.title}» сохранён в хранилище`); setValidTo(''); setDateTouched(false); void client.invalidateQueries({ queryKey: documentKeys.business(businessId) }) },
  })
  // «Приложить из хранилища» создаёт копию файла у заявки — в хранилище показываем файл один раз
  // и пишем, к каким заявкам он приложен.
  const groups = groupCopies(docs.data ?? [])
  const items = groups.map(g => g.doc)
  const expired = items.filter(d => d.expired).length
  const presentKinds = documentKinds.filter(([k]) => items.some(d => d.kind === k))
  const shown = filter ? groups.filter(g => g.doc.kind === filter) : groups
  const date = checkValidTo(validTo)
  // Неполная или несуществующая дата — загрузку не даём (иначе файл уйдёт без срока или бэк ответит 422)
  const validBad = !!date.error
  // Полностью введённую неверную дату показываем сразу, незаконченную — после ухода из поля
  const dateError = date.error && (dateTouched || validTo.trim().length >= 10) ? date.error : undefined

  const list = <Card title="Хранилище" subtitle={docs.data ? `${items.length} ${plural(items.length, 'документ', 'документа', 'документов')}${expired ? ` · ${expired} с истёкшим сроком` : ''}` : undefined}>
    {docs.isPending && <LoadingState view="skeleton" rows={4} label="Загружаем документы…" />}
    {docs.error && <ErrorState error={docs.error} onRetry={() => void docs.refetch()} />}
    {docs.data && items.length === 0 && <EmptyState compact icon={<DocumentsLinesMIcon />} title="Документов пока нет"
      text={canUpload ? 'Загрузите устав, МЧД или справки — потом их можно приложить к любой заявке без повторной загрузки.' : 'Подписанные договоры появятся здесь сами после выдачи.'} />}
    {presentKinds.length > 1 && <div className={styles.filters} role="group" aria-label="Вид документа">
      <Tag size={32} shape="rounded" view="filled" checked={!filter} onClick={() => setFilter('')}>Все</Tag>
      {presentKinds.map(([k, label]) => <Tag key={k} size={32} shape="rounded" view="filled" checked={filter === k} onClick={() => setFilter(filter === k ? '' : k)}>{label}</Tag>)}
    </div>}
    {shown.length > 0 && <div className={styles.list}>{shown.map(g => <DocRow key={g.doc.id} doc={g.doc} token={token} attachedTo={g.attachedTo} />)}</div>}
  </Card>

  return <Stack>
    <PageHeader eyebrow={businessName} title="Документы" subtitle="Загрузите один раз — прикладывайте к заявкам без повторной загрузки. Подписанные договоры появляются здесь сами." actions={<Bell />} />
    {expired > 0 && <Plate view="attention" rounded title={`${expired} ${plural(expired, 'документ', 'документа', 'документов')} с истёкшим сроком`}>
      К заявкам можно прикладывать только действующие документы — загрузите новую версию.
    </Plate>}
    {canUpload
      ? <Grid columns="minmax(0, 1fr) 340px" align="start">
        {list}
        <Card title="Загрузить документ" subtitle="Срок действия укажите, если он есть: истёкшие документы отметим." className={styles.uploadCard}>
          <div className={styles.form}>
            <Select options={kindOptions} selected={kind} onChange={({ selected }) => setKind(selected?.key ?? 'OTHER')} label="Вид документа" labelView="outer" size={48} block />
            {/* onChange кит вызывает только для пустой или «правильной» даты, поэтому ввод берём из onInputChange */}
            <CalendarInput value={validTo} onChange={(_, { value }) => setValidTo(value)} onInputChange={(_, { value }) => setValidTo(value)}
              onBlur={() => setDateTouched(true)} label="Действует до" labelView="outer" placeholder="ДД.ММ.ГГГГ" size={48} block
              error={dateError} hint={dateError ? undefined : date.warning ?? (validBad ? 'Допишите дату — ДД.ММ.ГГГГ' : 'Необязательно')} />
            <FileDrop onFile={f => upload.mutate(f)} busy={upload.isPending} disabled={validBad} />
            {upload.error && <Plate view="negative" rounded title="Файл не загружен">{upload.error.message}</Plate>}
            {done && !upload.isPending && <Plate view="positive" rounded title="Готово">{done}</Plate>}
          </div>
        </Card>
      </Grid>
      : list}
  </Stack>
}

// Ответ на запрос банка: загрузить файл или приложить из хранилища.
export function RequestedDocuments({ token, applicationId, businessId, onDone, canFill = true }: {
  token: string; applicationId: string; businessId: string; onDone: () => void; canFill?: boolean
}) {
  const client = useQueryClient()
  const stored = useBusinessDocuments(token, businessId)
  const [kind, setKind] = useState('CERTIFICATE')
  const after = () => {
    void client.invalidateQueries({ queryKey: documentKeys.business(businessId) })
    void client.invalidateQueries({ queryKey: documentKeys.application(applicationId) })
    onDone()
  }
  const upload = useMutation({
    mutationFn: (file: File) => uploadFile(`/api/v1/applications/${applicationId}/documents?kind=${kind}`, file, token),
    onSuccess: after,
  })
  const attach = useMutation({
    mutationFn: (documentId: string) => request(`/api/v1/applications/${applicationId}/documents/attach`, { method: 'POST', body: JSON.stringify({ document_id: documentId }) }, token),
    onSuccess: after,
  })
  if (!canFill) return <div className={styles.note}>Загрузить документы может сотрудник с правом заполнять заявки.</div>
  // Из хранилища — всё, кроме договоров и того, что уже приложено к этой заявке; копии одного файла — один раз.
  const candidates = groupCopies(stored.data ?? [])
    .filter(g => g.doc.kind !== 'CONTRACT' && !g.attachedTo.includes(applicationId))
    .map(g => g.doc)
  const busy = upload.isPending || attach.isPending
  const error = upload.error ?? attach.error
  return <div className={styles.requested}>
    <div className={styles.requestedForm}>
      <Select options={kindOptions} selected={kind} onChange={({ selected }) => setKind(selected?.key ?? 'OTHER')}
        label="Что прикладываете" labelView="outer" size={48} block className={styles.kindSelect} />
      <FileDrop onFile={f => upload.mutate(f)} busy={upload.isPending} disabled={attach.isPending} label="Загрузить файл" />
    </div>
    {candidates.length > 0 && <div className={styles.stored}>
      <div className={styles.storedTitle}>Или приложите из хранилища</div>
      <div className={styles.list}>
        {candidates.map(d => <DocRow key={d.id} doc={d} token={token} action={d.expired
          ? <span className={styles.expiredNote}>Нельзя: срок истёк</span>
          : <Button view="secondary" size={32} disabled={busy} loading={attach.isPending && attach.variables === d.id} onClick={() => attach.mutate(d.id)}>Приложить</Button>} />)}
      </div>
    </div>}
    {stored.isPending && <LoadingState view="inline" label="Проверяем хранилище…" />}
    {error && <Plate view="negative" rounded title="Не получилось отправить документ">{error.message}</Plate>}
  </div>
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}
