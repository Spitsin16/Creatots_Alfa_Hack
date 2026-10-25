import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Badge } from '@alfalab/core-components/badge/esm'
import { Popover } from '@alfalab/core-components/popover/esm'
import { BellMIcon } from '@alfalab/icons-glyph/BellMIcon'
import { BellOffMIcon } from '@alfalab/icons-glyph/BellOffMIcon'
import { NotificationItem, request } from '../api'
import { isBank, useSession } from '../auth'
import styles from './Bell.module.css'

type Feed = { items: NotificationItem[]; unread_count: number }

const when = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

// Колокольчик: уведомления в кабинете (смена статуса, ответ в чате). Опрос раз в 5 с;
// клик по уведомлению открывает заявку, к которой оно относится.
export function Bell() {
  const { token, me } = useSession()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
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

  // Закрываем по клику мимо панели и по Esc.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (anchor?.contains(target) || panel.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); anchor?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, anchor])

  const unread = data.unread_count
  return <>
    <button ref={setAnchor} type="button" className={[styles.button, open ? styles.active : ''].filter(Boolean).join(' ')} onClick={() => setOpen(!open)}
      aria-label={unread > 0 ? `Уведомления: ${unread} непрочитанных` : 'Уведомления'} aria-expanded={open} aria-haspopup="dialog">
      <BellMIcon className={styles.icon} />
      {unread > 0 && <span className={styles.badge}><Badge view="count" size="m" color="accent" content={unread} /></span>}
    </button>
    <Popover open={open} anchorElement={anchor} position="bottom-end" offset={[0, 8]} popperClassName={styles.popper}>
      <div ref={panel} className={styles.panel} role="dialog" aria-label="Уведомления">
        <div className={styles.head}>
          <b>Уведомления</b>
          {unread > 0 && <button type="button" className={styles.readAll} onClick={readAll}>Прочитать все</button>}
        </div>
        {feed.isPending && <p className={styles.muted}>Загружаем…</p>}
        {feed.error && <p className={styles.muted}>Не удалось загрузить уведомления. Попробуем ещё раз через несколько секунд.</p>}
        {!feed.isPending && !feed.error && data.items.length === 0 && <div className={styles.empty}><BellOffMIcon className={styles.emptyIcon} /><span>Пока ничего нового</span></div>}
        <div className={styles.list}>
          {data.items.map(n => <button key={n.id} type="button" className={[styles.item, n.read ? '' : styles.unread].filter(Boolean).join(' ')} onClick={() => openItem(n)}>
            <span className={styles.dot} aria-hidden />
            <span className={styles.itemBody}>
              <b className={styles.itemTitle}>{n.title}</b>
              <span className={styles.itemText}>{n.text}</span>
              <span className={styles.itemTime}>{when(n.created_at)}</span>
            </span>
          </button>)}
        </div>
      </div>
    </Popover>
  </>
}
