import { KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@alfalab/core-components/button/esm'
import { Textarea } from '@alfalab/core-components/textarea/esm'
import { ClockLineMIcon } from '@alfalab/icons-glyph/ClockLineMIcon'
import { ExclamationCircleMIcon } from '@alfalab/icons-glyph/ExclamationCircleMIcon'
import { SendMIcon } from '@alfalab/icons-glyph/SendMIcon'
import { Chat as ChatData, ChatMessage, isNetworkError, request } from '../api'
import { Spinner } from './Spinner'
import { CHAT_ANSWER_HOURS } from './status'
import styles from './Chat.module.css'

type Message = ChatMessage
type ChatResponse = ChatData
type Pending = { key: string; text: string; state: 'sending' | 'failed'; error?: string }

const time = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
const day = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export type ChatProps = {
  token: string
  applicationId: string
  /** Чья это сторона: свои сообщения — справа */
  side: 'CLIENT' | 'BANK'
  /** Заголовок блока; null — без заголовка */
  title?: string | null
}

/**
 * Чат по заявке: клиент спрашивает, банк отвечает. Решения — только кнопками, не в чате.
 * Опрос раз в 5 секунд, отправка с состоянием «отправляется / не отправлено — повторить».
 * Поле ввода имеет id `chat-<applicationId>` — по нему кнопка «Написать специалисту» ставит фокус.
 */
export function Chat({ token, applicationId, side, title = 'Чат по заявке' }: ChatProps) {
  const client = useQueryClient()
  const key = ['chat', applicationId] as const
  const chat = useQuery({
    queryKey: key,
    queryFn: () => request<ChatResponse>(`/api/v1/applications/${applicationId}/messages`, {}, token),
    refetchInterval: 5000,
  })
  const [text, setText] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const listRef = useRef<HTMLDivElement>(null)

  const items = chat.data?.items ?? []
  const count = items.length + pending.length
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count])

  const deliver = async (p: Pending) => {
    setPending(list => list.map(x => (x.key === p.key ? { ...x, state: 'sending', error: undefined } : x)))
    try {
      const data = await request<ChatResponse>(`/api/v1/applications/${applicationId}/messages`, { method: 'POST', body: JSON.stringify({ text: p.text }) }, token)
      client.setQueryData(key, data)
      setPending(list => list.filter(x => x.key !== p.key))
    } catch (err) {
      setPending(list => list.map(x => (x.key === p.key ? { ...x, state: 'failed', error: isNetworkError(err) ? 'нет соединения' : (err as Error).message } : x)))
    }
  }
  const send = () => {
    const value = text.trim()
    if (!value) return
    const p: Pending = { key: `${Date.now()}-${Math.random()}`, text: value, state: 'sending' }
    setPending(list => [...list, p])
    setText('')
    void deliver(p)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }

  const due = chat.data?.open_question_due_text
  const overdue = chat.data?.overdue
  const dueLabel = due && (side === 'CLIENT' ? capitalize(due) : `Ответить ${due.replace(/^ответим\s*/, '')}`)
  // Последний вопрос клиента без ответа — под ним пишем «ждёт ответа».
  const lastOpen = [...items].reverse().find(m => m.author_side === 'CLIENT' && !m.answered_at)

  let lastDay = ''
  return <div className={styles.chat}>
    {(title || dueLabel) && <div className={styles.head}>
      {title && <h3 className={styles.title}>{title}</h3>}
      {dueLabel && <span className={[styles.due, overdue ? styles.overdue : ''].join(' ')}>
        {overdue ? <ExclamationCircleMIcon className={styles.dueIcon} /> : <ClockLineMIcon className={styles.dueIcon} />}
        {overdue ? 'Срок ответа прошёл — вопрос поднят в очереди банка' : dueLabel}
      </span>}
    </div>}

    <div className={styles.list} ref={listRef} aria-live="polite">
      {chat.isPending && <div className={styles.placeholder}><Spinner label="Загружаем переписку…" /></div>}
      {chat.error && !chat.data && <div className={styles.placeholder}>
        <span className={styles.errorText}>Не получилось загрузить чат: {chat.error.message}</span>
        <button type="button" className={styles.retry} onClick={() => void chat.refetch()}>Повторить</button>
      </div>}
      {chat.data && count === 0 && <div className={styles.placeholder}>
        {side === 'CLIENT'
          ? `Задайте вопрос по заявке — специалист ответит в течение ${CHAT_ANSWER_HOURS} рабочих часов (пн–пт, 9:00–18:00 мск).`
          : 'Сообщений пока нет. Решения по заявке — только кнопками действий, не в чате.'}
      </div>}
      {items.map(m => {
        const mine = m.author_side === side
        const d = day(m.created_at)
        const sep = d !== lastDay ? d : null
        lastDay = d
        return <div key={m.id} className={styles.group}>
          {sep && <div className={styles.day}>{sep}</div>}
          <div className={[styles.row, mine ? styles.mine : ''].join(' ')}>
            <div className={styles.bubble}>
              {!mine && <div className={styles.author}>{m.author_name || (m.author_side === 'BANK' ? 'Специалист банка' : 'Клиент')}</div>}
              <div className={styles.text}>{m.text}</div>
              <div className={styles.meta}>{time(m.created_at)}</div>
            </div>
            {m === lastOpen && <div className={styles.status}>{side === 'CLIENT' ? 'Ждёт ответа специалиста' : 'Клиент ждёт ответа'}</div>}
          </div>
        </div>
      })}
      {pending.map(p => <div key={p.key} className={[styles.row, styles.mine].join(' ')}>
        <div className={[styles.bubble, p.state === 'failed' ? styles.failed : styles.sending].join(' ')}>
          <div className={styles.text}>{p.text}</div>
        </div>
        <div className={[styles.status, p.state === 'failed' ? styles.statusFailed : ''].join(' ')}>
          {p.state === 'sending' ? <Spinner label="Отправляется…" /> : <>
            Не отправлено{p.error ? `: ${p.error}` : ''} ·{' '}
            <button type="button" className={styles.retry} onClick={() => void deliver(p)}>Повторить</button>{' '}·{' '}
            <button type="button" className={styles.retry} onClick={() => setPending(list => list.filter(x => x.key !== p.key))}>Удалить</button>
          </>}
        </div>
      </div>)}
    </div>

    <div className={styles.composer}>
      <Textarea
        id={`chat-${applicationId}`}
        className={styles.input}
        value={text}
        maxLength={2000}
        autosize
        minRows={1}
        maxRows={4}
        size={48}
        block
        placeholder={side === 'CLIENT' ? 'Ваш вопрос специалисту' : 'Ответ клиенту'}
        onChange={(_, { value }) => setText(value)}
        onKeyDown={onKeyDown}
      />
      <Button view="primary" size={48} aria-label="Отправить сообщение" title="Отправить" disabled={!text.trim()} onClick={send} className={styles.send}>
        <SendMIcon className={styles.sendIcon} />
      </Button>
    </div>
    <div className={styles.hint}>Enter — отправить, Shift+Enter — новая строка</div>
  </div>
}
