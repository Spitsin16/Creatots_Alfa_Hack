import { useEffect, useState } from 'react'
import { Me, request } from '../api'
import { lastClient } from './demoSession'

const staff = [
  { login: 'uw1', title: 'Андеррайтер', note: 'Смирнова Е.' },
  { login: 'risk1', title: 'Риск-менеджер', note: 'Волков А.' },
  { login: 'admin1', title: 'Админ правил', note: 'Ким Д.' },
]

// Слева внизу: быстрый переход между клиентом и сотрудниками банка. Кабинет, куда пришло
// новое уведомление, подсвечивается (опрос раз в 5 с).
export function CabinetSwitcher({ me, onSwitch }: { me: Me; onSwitch: (token: string) => void }) {
  const client = me.role === 'CLIENT' ? { login: me.login, name: me.full_name } : lastClient()
  const cabinets = [{ login: client.login, title: 'Клиент', note: client.name }, ...staff]
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState('')
  useEffect(() => {
    const load = () => request<{ unread: Record<string, number> }>(`/api/v1/demo/unread?logins=${cabinets.map(c => c.login).join(',')}`)
      .then(d => setUnread(d.unread)).catch(() => undefined)
    void load(); const t = setInterval(load, 5000); return () => clearInterval(t)
  }, [client.login])
  const go = async (login: string) => {
    if (login === me.login) return
    setBusy(login)
    try { const d = await request<{ access_token: string }>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ login, password: 'demo' }) }); onSwitch(d.access_token) }
    finally { setBusy('') }
  }
  return <div className="switcher"><span className="switcher-title">Кабинеты демо</span>
    {cabinets.map(c => { const n = unread[c.login] ?? 0; const active = c.login === me.login
      return <button key={c.title} className={`switch ${active ? 'active' : ''} ${n > 0 && !active ? 'lit' : ''}`} onClick={() => go(c.login)} disabled={!!busy}>
        <span className="dot" /><span><b>{c.title}</b><small>{busy === c.login ? 'Входим…' : c.note}</small></span>{n > 0 && <em>{n}</em>}
      </button> })}
  </div>
}
