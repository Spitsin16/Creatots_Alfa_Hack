import { useEffect, useState } from 'react'
import { request } from '../api'

type Item = { id: string; actor_name: string | null; action: string; entity: string; entity_id: string; after: Record<string, unknown> | null; at: string }

// Журнал аудита: кто, что и когда сделал (решения, назначения, правила, SMS-заглушка, чат).
export function AuditPage({ token }: { token: string }) {
  const [items, setItems] = useState<Item[]>([])
  const [error, setError] = useState('')
  useEffect(() => { request<{ items: Item[] }>('/api/v1/bank/audit?page_size=100', {}, token).then(d => setItems(d.items)).catch(e => setError(e.message)) }, [])
  return <div className="page bank-page"><header><div><span className="eyebrow">Кабинет банка</span><h1>Журнал аудита</h1><p>Последние 100 событий.</p></div></header>
    {error && <div className="error">{error}</div>}
    <section className="queue"><table className="sim"><thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Детали</th></tr></thead><tbody>
      {items.map(i => <tr key={i.id}><td>{new Date(i.at).toLocaleString('ru-RU')}</td><td>{i.actor_name ?? 'система'}</td><td><b>{i.action}</b><small>{i.entity} {i.entity_id.slice(0, 8)}</small></td><td><small>{i.after ? JSON.stringify(i.after).slice(0, 140) : ''}</small></td></tr>)}
    </tbody></table></section></div>
}
