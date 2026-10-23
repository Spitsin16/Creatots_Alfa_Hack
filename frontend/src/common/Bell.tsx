import { useEffect, useState } from 'react'
import { NotificationItem, request } from '../api'

// Колокольчик: уведомления в кабинете (смена статуса, ответ в чате). Опрос раз в 5 с.
export function Bell({ token }: { token: string }) {
  const [data, setData] = useState<{ items: NotificationItem[]; unread_count: number }>({ items: [], unread_count: 0 })
  const [open, setOpen] = useState(false)
  const load = () => request<{ items: NotificationItem[]; unread_count: number }>('/api/v1/notifications', {}, token).then(setData).catch(() => undefined)
  useEffect(() => { void load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [token])
  const readAll = async () => { await request('/api/v1/notifications/read-all', { method: 'POST' }, token).catch(() => undefined); void load() }
  return <div className="bell">
    <button className="icon-button" onClick={() => setOpen(!open)} aria-label="Уведомления">🔔{data.unread_count > 0 && <em>{data.unread_count}</em>}</button>
    {open && <div className="bell-panel">
      <div className="chat-head"><b>Уведомления</b>{data.unread_count > 0 && <button className="link" onClick={readAll}>Прочитать все</button>}</div>
      {data.items.length === 0 && <p className="muted">Пока ничего нового</p>}
      {data.items.map(n => <div key={n.id} className={`note ${n.read ? '' : 'unread'}`}><b>{n.title}</b><small>{n.text}</small></div>)}
    </div>}
  </div>
}
