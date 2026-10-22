import { FormEvent, useEffect, useState } from 'react'
import { Chat as ChatData, request } from '../api'

// Чат по заявке: клиент спрашивает, банк отвечает. Решения — только кнопками, не в чате.
export function Chat({ token, applicationId, side }: { token: string; applicationId: string; side: 'CLIENT' | 'BANK' }) {
  const [chat, setChat] = useState<ChatData | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const load = () => request<ChatData>(`/api/v1/applications/${applicationId}/messages`, {}, token).then(setChat).catch(e => setError(e.message))
  useEffect(() => { void load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [applicationId])
  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    try { setChat(await request<ChatData>(`/api/v1/applications/${applicationId}/messages`, { method: 'POST', body: JSON.stringify({ text }) }, token)); setText('') }
    catch (err) { setError((err as Error).message) }
  }
  return <div className="chat">
    <div className="chat-head"><b>Чат по заявке</b>
      {chat?.open_question_due_text && <span className={chat.overdue ? 'due overdue' : 'due'}>{chat.overdue ? 'Срок ответа прошёл' : chat.open_question_due_text}</span>}</div>
    <div className="chat-list">
      {chat?.items.length === 0 && <p className="muted">{side === 'CLIENT' ? 'Задайте вопрос — специалист ответит в рабочее время.' : 'Сообщений нет.'}</p>}
      {chat?.items.map(m => <div key={m.id} className={`bubble ${m.author_side === side ? 'mine' : ''}`}>
        <small>{m.author_name} · {new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small>{m.text}</div>)}
    </div>
    {error && <div className="error">{error}</div>}
    <form onSubmit={send}><input value={text} maxLength={2000} onChange={e => setText(e.target.value)} placeholder={side === 'CLIENT' ? 'Ваш вопрос' : 'Ответ клиенту'} />
      <button className="primary">Отправить</button></form>
  </div>
}
