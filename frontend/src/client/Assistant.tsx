import { FormEvent, useEffect, useState } from 'react'
import { request } from '../api'

type Reply = { answer: string; intent: string; action: { label: string; target: string } | null }
type Line = { who: 'me' | 'bot'; text: string; action?: Reply['action'] }

// Ассистент (модуль 16.2): готовые вопросы + свободный ввод; отвечает по данным клиента.
export function Assistant({ token, onNavigate }: { token: string; onNavigate: (target: string) => void }) {
  const [open, setOpen] = useState(false)
  const [suggested, setSuggested] = useState<string[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { request<{ items: string[] }>('/api/v1/assistant/suggestions', {}, token).then(d => setSuggested(d.items)).catch(() => undefined) }, [])
  const ask = async (q: string) => {
    if (!q.trim()) return
    setLines(l => [...l, { who: 'me', text: q }]); setText(''); setBusy(true)
    try { const r = await request<Reply>('/api/v1/assistant/messages', { method: 'POST', body: JSON.stringify({ text: q }) }, token); setLines(l => [...l, { who: 'bot', text: r.answer, action: r.action }]) }
    catch (e) { setLines(l => [...l, { who: 'bot', text: (e as Error).message }]) } finally { setBusy(false) }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(text) }
  if (!open) return <button className="assistant-fab primary" onClick={() => setOpen(true)}>Спросить ассистента</button>
  return <div className="assistant">
    <div className="chat-head"><b>Ассистент</b><button className="link dark" onClick={() => setOpen(false)}>Свернуть</button></div>
    <div className="chat-list">
      {lines.length === 0 && <p className="muted">Отвечаю по данным вашего бизнеса. Решения принимает банк — я подскажу, куда нажать.</p>}
      {lines.map((l, i) => <div key={i} className={`bubble ${l.who === 'me' ? 'mine' : ''}`}>{l.text}
        {l.action && <button className="link" onClick={() => { onNavigate(l.action!.target); setOpen(false) }}>{l.action.label} ›</button>}</div>)}
      {busy && <p className="muted">…</p>}
    </div>
    <div className="chips">{suggested.map(q => <button key={q} className="chip" onClick={() => ask(q)}>{q}</button>)}</div>
    <form onSubmit={submit}><input value={text} maxLength={500} onChange={e => setText(e.target.value)} placeholder="Ваш вопрос" /><button className="primary">→</button></form>
  </div>
}
