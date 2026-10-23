import { ChangeEvent, useEffect, useState } from 'react'
import { DocItem, downloadFile, request, uploadFile } from '../api'

const kinds: [string, string][] = [['CHARTER', 'Устав'], ['MCHD', 'МЧД'], ['STATEMENT', 'Выписка'], ['CONTRACT', 'Договор'], ['CERTIFICATE', 'Справка'], ['OTHER', 'Прочее']]

export function DocList({ items, token }: { items: DocItem[]; token: string }) {
  if (items.length === 0) return <p className="muted">Документов пока нет</p>
  return <div className="doc-list">{items.map(d => <div key={d.id} className={`doc ${d.expired ? 'expired' : ''}`}>
    <span className="doc-kind">{d.kind_title}</span>
    <div><b>{d.title}</b><small>{d.filename}{d.size ? ` · ${Math.ceil(d.size / 1024)} КБ` : ''}{d.valid_to ? ` · до ${new Date(d.valid_to).toLocaleDateString('ru-RU')}` : ''}{d.expired ? ' · срок истёк' : ''}{d.status === 'SIGNED' ? ' · подписан' : ''}</small></div>
    <button className="secondary" onClick={() => downloadFile(`/api/v1/documents/${d.id}/file`, d.filename ?? 'file', token)}>Скачать</button>
  </div>)}</div>
}

// Хранилище документов бизнеса (модуль 16.3): загрузить, список, скачать, срок действия.
export function DocumentsPage({ token, businessId, canUpload }: { token: string; businessId: string; canUpload: boolean }) {
  const [items, setItems] = useState<DocItem[]>([])
  const [kind, setKind] = useState('CHARTER')
  const [validTo, setValidTo] = useState('')
  const [message, setMessage] = useState('')
  const load = () => request<{ items: DocItem[] }>(`/api/v1/businesses/${businessId}/documents`, {}, token).then(d => setItems(d.items)).catch(e => setMessage(e.message))
  useEffect(() => { void load() }, [businessId])
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setMessage('')
    try {
      await uploadFile(`/api/v1/businesses/${businessId}/documents?kind=${kind}${validTo ? `&valid_to=${validTo}` : ''}`, file, token)
      setMessage(`«${file.name}» сохранён`); void load()
    } catch (err) { setMessage((err as Error).message) } finally { e.target.value = '' }
  }
  return <div className="page"><header><div><span className="eyebrow">Хранилище</span><h1>Документы бизнеса</h1><p>Загрузите один раз — прикладывайте к заявкам без повторной загрузки. Подписанные договоры появляются здесь сами.</p></div></header>
    {canUpload && <section className="tracker upload-bar">
      <select value={kind} onChange={e => setKind(e.target.value)}>{kinds.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>
      <label>Действует до <input type="date" value={validTo} onChange={e => setValidTo(e.target.value)} /></label>
      <label className="primary upload">Выбрать файл<input type="file" hidden onChange={onFile} accept=".pdf,.jpg,.jpeg,.png,.txt,.docx,.xlsx" /></label>
    </section>}
    {message && <div className="notice">{message}</div>}
    <section className="tracker"><DocList items={items} token={token} /></section>
  </div>
}

// Ответ на запрос банка: загрузить файл или приложить из хранилища.
export function RequestedDocuments({ token, applicationId, businessId, onDone }: { token: string; applicationId: string; businessId: string; onDone: () => void }) {
  const [stored, setStored] = useState<DocItem[]>([])
  const [error, setError] = useState('')
  useEffect(() => { request<{ items: DocItem[] }>(`/api/v1/businesses/${businessId}/documents`, {}, token).then(d => setStored(d.items.filter(i => !i.expired && i.kind !== 'CONTRACT'))).catch(() => undefined) }, [businessId])
  const run = async (fn: () => Promise<unknown>) => { setError(''); try { await fn(); onDone() } catch (e) { setError((e as Error).message) } }
  const onFile = (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) void run(() => uploadFile(`/api/v1/applications/${applicationId}/documents?kind=OTHER`, f, token)) }
  return <div className="callout requested"><b>Банк запросил документы</b><p>Посмотрите комментарий специалиста в решении выше или спросите в чате.</p>
    <label className="primary upload">Загрузить файл<input type="file" hidden onChange={onFile} /></label>
    {stored.length > 0 && <div className="chips">{stored.map(d => <button key={d.id} className="chip" onClick={() => run(() => request(`/api/v1/applications/${applicationId}/documents/attach`, { method: 'POST', body: JSON.stringify({ document_id: d.id }) }, token))}>Приложить «{d.title}»</button>)}</div>}
    {error && <div className="error">{error}</div>}</div>
}
