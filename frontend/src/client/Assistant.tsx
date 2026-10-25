import { FormEvent, useEffect, useRef, useState } from 'react'
import { Button } from '@alfalab/core-components/button/esm'
import { IconButton } from '@alfalab/core-components/icon-button/esm'
import { Input } from '@alfalab/core-components/input/esm'
import { Tag } from '@alfalab/core-components/tag/esm'
import { ArrowUpMIcon } from '@alfalab/icons-glyph/ArrowUpMIcon'
import { ChevronDownMIcon } from '@alfalab/icons-glyph/ChevronDownMIcon'
import { NavigationChatMIcon } from '@alfalab/icons-glyph/NavigationChatMIcon'
import { request } from '../api'
import { Spinner } from '../common/Spinner'
import styles from './Assistant.module.css'

type Reply = { answer: string; intent: string; action: { label: string; target: string } | null }
type Line = { who: 'me' | 'bot'; text: string; action?: Reply['action'] }

// Ассистент (модуль 16.2): готовые вопросы + свободный ввод; отвечает по данным клиента.
// Плавающая кнопка справа внизу (место зарезервировано оболочкой: --app-fab-offset, --z-assistant).
export function Assistant({ token, onNavigate }: { token: string; onNavigate: (target: string) => void }) {
  const [open, setOpen] = useState(false)
  const [suggested, setSuggested] = useState<string[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { request<{ items: string[] }>('/api/v1/assistant/suggestions', {}, token).then(d => setSuggested(d.items)).catch(() => undefined) }, [])
  // Пока окно открыто, на <body> стоит data-assistant-open: демо-панель по нему уступает место (DemoPanel.module.css).
  useEffect(() => {
    if (!open) return
    document.body.setAttribute('data-assistant-open', '')
    return () => document.body.removeAttribute('data-assistant-open')
  }, [open])
  // Новое сообщение — прокручиваем ленту вниз.
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }) }, [lines.length, busy, open])
  const ask = async (q: string) => {
    if (!q.trim() || busy) return
    setLines(l => [...l, { who: 'me', text: q }]); setText(''); setBusy(true)
    try { const r = await request<Reply>('/api/v1/assistant/messages', { method: 'POST', body: JSON.stringify({ text: q }) }, token); setLines(l => [...l, { who: 'bot', text: r.answer, action: r.action }]) }
    catch (e) { setLines(l => [...l, { who: 'bot', text: (e as Error).message }]) } finally { setBusy(false) }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(text) }

  if (!open) return <div className={styles.fab}>
    <Button view="primary" shape="rounded" size={48} leftAddons={<NavigationChatMIcon />} onClick={() => setOpen(true)} className={styles.fabButton}>
      <span className={styles.fabLabel}>Спросить ассистента</span>
    </Button>
  </div>

  return <section className={styles.window} aria-label="Ассистент">
    <header className={styles.head}>
      <span className={styles.avatar} aria-hidden><NavigationChatMIcon /></span>
      <div className={styles.headText}>
        <b>Ассистент</b>
        <small>Отвечает по данным вашего бизнеса</small>
      </div>
      <IconButton icon={ChevronDownMIcon} size={32} view="secondary" aria-label="Свернуть ассистента" onClick={() => setOpen(false)} />
    </header>
    <div className={styles.list} ref={list}>
      <div className={styles.bubble}>Отвечаю по данным вашего бизнеса. Решения принимает банк — я подскажу, куда нажать.</div>
      {lines.map((l, i) => <div key={i} className={[styles.bubble, l.who === 'me' ? styles.mine : ''].filter(Boolean).join(' ')}>
        {l.text}
        {l.action && <Button view="secondary" size={32} className={styles.action} onClick={() => { onNavigate(l.action!.target); setOpen(false) }}>{l.action.label}</Button>}
      </div>)}
      {busy && <div className={styles.typing}><Spinner label="Ассистент печатает…" /></div>}
    </div>
    {suggested.length > 0 && <div className={styles.chips}>
      {suggested.map(q => <Tag key={q} size={32} shape="rounded" view="filled" disabled={busy} onClick={() => ask(q)}>{q}</Tag>)}
    </div>}
    <form className={styles.form} onSubmit={submit}>
      {/* Input кита не пробрасывает aria-label — подписываем поле скрытым <label> */}
      <label htmlFor="assistant-question" className={styles.srOnly}>Ваш вопрос ассистенту</label>
      <Input id="assistant-question" block size={48} value={text} maxLength={500} onChange={(_, { value }) => setText(value)} placeholder="Ваш вопрос" autoComplete="off"
        rightAddons={<IconButton icon={ArrowUpMIcon} size={32} view="primary" type="submit" aria-label="Отправить" disabled={busy || !text.trim()} />} />
    </form>
  </section>
}
