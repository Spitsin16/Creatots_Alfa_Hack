import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { NotificationItem, request } from '../api'
import { isBank, useSession } from '../auth'

type Feed = { items: NotificationItem[]; unread_count: number }

// Колокольчик: уведомления в кабинете (смена статуса, ответ в чате). Опрос раз в 5 с;
// клик по уведомлению открывает заявку, к которой оно относится.
export function Bell() {
  const { token, me } = useSession()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const feed = useQuery({
    queryKey: ['notifications', token],
    queryFn: () => request<Feed>('/api/v1/notifications', {}, token),
    refetchInterval: 5000,
  })
  const data = feed.data ?? { items: [], unread_count: 0 }
  const refresh = () => client.invalidateQueries({ queryKey: ['notifications'] })
  const readAll = () => request('/api/v1/notifications/read-all', { method: 'POST' }, token).catch(() => undefined).then(refresh)
  const openItem = (n: NotificationItem) => {
    if (!n.read) void request(`/api/v1/notifications/${n.id}/read`, { method: 'POST' }, token).catch(() => undefined).then(refresh)
    if (n.application_id) { navigate(isBank(me.role) ? `/bank/applications/${n.application_id}` : `/applications/${n.application_id}`); setOpen(false) }
  }
  return <div className="bell">
    <button className="icon-button" onClick={() => setOpen(!open)} aria-label="Уведомления">🔔{data.unread_count > 0 && <em>{data.unread_count}</em>}</button>
    {open && <div className="bell-panel">
      <div className="chat-head"><b>Уведомления</b>{data.unread_count > 0 && <button className="link" onClick={readAll}>Прочитать все</button>}</div>
      {data.items.length === 0 && <p className="muted">Пока ничего нового</p>}
      {data.items.map(n => <button key={n.id} type="button" className={`note ${n.read ? '' : 'unread'}`} onClick={() => openItem(n)}><b>{n.title}</b><small>{n.text}</small></button>)}
    </div>}
  </div>
}
