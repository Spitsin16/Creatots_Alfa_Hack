import { useEffect, useState } from 'react'
import { request, rubles } from '../api'

type Short = { cls: string | null; score: number | null; product: string; outcome: string; limit: number | null; rate: number | null }
type Row = { persona: string; title: string; before: Short; after: Short; changed: boolean }
type Listing = { active_version: number; active_yaml: string; versions: { version: number; active: boolean; created_at: string }[] }

// Админ правил: правка YAML, прогон на 7 персонах «было/стало», новая версия, откат.
export function RulesAdmin({ token }: { token: string }) {
  const [list, setList] = useState<Listing | null>(null)
  const [text, setText] = useState('')
  const [comment, setComment] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const load = () => request<Listing>('/api/v1/bank/rules', {}, token).then(l => { setList(l); setText(t => t || l.active_yaml) })
  useEffect(() => { void load() }, [])
  const run = async (fn: () => Promise<void>) => { setError(''); setMessage(''); try { await fn() } catch (e) { setError((e as Error).message) } }
  const check = () => run(async () => setRows((await request<{ personas: Row[] }>('/api/v1/bank/rules/simulate', { method: 'POST', body: JSON.stringify({ yaml: text }) }, token)).personas))
  const save = () => run(async () => {
    const r = await request<{ version: number }>('/api/v1/bank/rules', { method: 'POST', body: JSON.stringify({ yaml: text, comment, activate: true }) }, token)
    setMessage(`Версия ${r.version} сохранена и включена. Новые расчёты идут по ней, старые решения хранят свою версию.`); void load()
  })
  const activate = (v: number) => run(async () => { await request(`/api/v1/bank/rules/${v}/activate`, { method: 'POST' }, token); setMessage(`Включена версия ${v}`); void load() })
  const cell = (s: Short) => `${s.outcome}${s.limit ? ` · ${rubles(s.limit * 100)}` : ''}${s.rate ? ` · ${s.rate}%` : ''}${s.cls ? ` · ${s.cls}` : ''}`
  return <div className="page bank-page"><header><div><span className="eyebrow">Кабинет банка</span><h1>Правила решения</h1><p>Изменение = новая версия. До включения проверьте, как поменяются решения по тестовым клиентам.</p></div>
    <div className="metric"><b>v{list?.active_version ?? '…'}</b><span>действует</span></div></header>
    {message && <div className="notice">{message}</div>}{error && <div className="error">{error}</div>}
    <div className="rules-layout"><section className="queue">
      <textarea className="yaml" value={text} onChange={e => { setText(e.target.value); setRows(null) }} spellCheck={false} />
      <div className="rules-actions"><input placeholder="Что меняем и почему" value={comment} onChange={e => setComment(e.target.value)} />
        <button className="secondary" onClick={check}>Проверить на персонах</button>
        <button className="primary" disabled={!rows || comment.trim().length < 3} onClick={save}>Сохранить и включить</button></div>
      {rows && <table className="sim"><thead><tr><th>Клиент</th><th>Было</th><th>Стало</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.persona} className={r.changed ? 'changed' : ''}><td><b>{r.persona}</b><small>{r.title}</small></td><td>{cell(r.before)}</td><td>{cell(r.after)}</td></tr>)}</tbody></table>}
    </section>
    <aside className="review-card"><h3>Версии</h3>{list?.versions.map(v => <div key={v.version} className="version-row">
      <span><b>v{v.version}</b><small>{new Date(v.created_at).toLocaleString('ru-RU')}</small></span>
      {v.active ? <em>действует</em> : <button className="secondary" onClick={() => activate(v.version)}>Включить</button>}</div>)}</aside></div>
  </div>
}
