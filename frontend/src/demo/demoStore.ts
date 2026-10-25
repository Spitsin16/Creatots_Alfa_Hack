import { useCallback, useEffect, useRef, useState } from 'react'
import type { Snapshot } from './scenarios'

// Состояние демо-панели живёт в sessionStorage вкладки под ключом 'demo':
// вход другим участником через панель (useAuth().login) его не трогает, а «Выйти» (logout) очищает всё.
// Панель размонтируется на время загрузки профиля нового участника — поэтому всё, что должно пережить
// переключение, пишем в хранилище сразу, синхронно.

export type DemoState = {
  /** Выбранный сценарий (null — показываем список сценариев) */
  scenarioId: string | null
  /** К какому сценарию относится прогон ниже: вернулись к списку и выбрали тот же — продолжаем, а не начинаем заново */
  runOf: string | null
  /** Когда начали сценарий (мс): заявки, созданные раньше, панель не подхватывает */
  startedAt: number
  /** Заявка сценария */
  appId: string | null
  /** Заявки, которые этому прогону не принадлежат: прошлый прогон, чужая или старая из адреса — их не подхватываем */
  skip: string[]
  /** ИНН бизнеса клиента сценария — чтобы найти его заявку в очереди банка */
  inn: string | null
  /** Название бизнеса клиента сценария — для подсказок банку */
  businessName: string | null
  /** Последний расчёт предложения (из адреса /offer/:id) */
  offerId: string | null
  /** Последнее, что панель знала о заявке */
  snapshot: Snapshot | null
  /** Решение, которое риск-менеджер вернул андеррайтеру: пока оно последнее, второе одобрение не ждём */
  returnedKey: string | null
  /** Отмеченные шаги (по посещённой странице или вручную) */
  marks: string[]
  /** Клиента сценария играет свой клиент из песочницы */
  client: { login: string; name: string } | null
  /** Панель раскрыта */
  open: boolean
}

const KEY = 'demo'
const HIDDEN_KEY = 'demo:hidden'

const empty: DemoState = { scenarioId: null, runOf: null, startedAt: 0, appId: null, skip: [], inn: null, businessName: null, offerId: null, snapshot: null, returnedKey: null, marks: [], client: null, open: false }

export function readDemo(): DemoState {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? { ...empty, ...(JSON.parse(raw) as Partial<DemoState>) } : empty
  } catch {
    return empty
  }
}

function writeDemo(state: DemoState) {
  try { sessionStorage.setItem(KEY, JSON.stringify(state)) } catch { /* хранилище недоступно — панель просто забудет сценарий */ }
}

const SKIP_LIMIT = 30

/** Запомнить заявку как «не нашу» (последние SKIP_LIMIT штук). */
export const skipped = (s: DemoState, ...ids: (string | null)[]) =>
  [...new Set([...s.skip, ...ids.filter((id): id is string => !!id)])].slice(-SKIP_LIMIT)

/**
 * Новый прогон сценария: заявку, расчёт и отметки начинаем с чистого листа.
 * Заявку прошлого прогона запоминаем как чужую — иначе «Пройти заново» сразу после выдачи подхватил бы её снова.
 * inn — ИНН клиента сценария, если он известен заранее (демо-персона): банк сразу узнает его заявку.
 */
export const freshRun = (s: DemoState, scenarioId: string | null, inn: string | null): Partial<DemoState> =>
  ({ scenarioId, runOf: scenarioId, startedAt: Date.now(), appId: null, skip: skipped(s, s.appId), inn, businessName: null, offerId: null, snapshot: null, returnedKey: null, marks: [] })

export type DemoUpdate = Partial<DemoState> | ((state: DemoState) => Partial<DemoState> | null)

export function useDemoStore(): [DemoState, (update: DemoUpdate) => void] {
  const [state, setState] = useState(readDemo)
  const ref = useRef(state)
  const update = useCallback((change: DemoUpdate) => {
    const patch = typeof change === 'function' ? change(ref.current) : change
    if (!patch) return
    const next = { ...ref.current, ...patch }
    ref.current = next
    writeDemo(next)
    setState(next)
  }, [])
  return [state, update]
}

/**
 * Перед входом другим участником убираем из вкладки данные прошлого пользователя
 * (расчёты предложений и т. п.) — как это сделал бы «Выйти», но состояние сценария оставляем.
 */
export function clearTabExceptDemo() {
  try {
    const keep = sessionStorage.getItem(KEY)
    sessionStorage.clear()
    if (keep) sessionStorage.setItem(KEY, keep)
  } catch { /* нечего чистить */ }
}

// ——— Скрыть панель целиком (для чистых скриншотов). Запоминается в браузере. ———

function readHidden() {
  try {
    // ?demo в адресе возвращает скрытую панель (читаем адрес при загрузке: страницы могут переписать свои параметры)
    if (new URLSearchParams(window.location.search).has('demo')) { localStorage.removeItem(HIDDEN_KEY); return false }
    return localStorage.getItem(HIDDEN_KEY) === '1'
  } catch { return false }
}

// Флаг читают несколько мест (панель и пункт «Показать демо-панель» в меню) — сообщаем им об изменении событием.
const HIDDEN_EVENT = 'demo:hidden-change'

/** shortcut — слушать Alt+Shift+D (только в одном месте — в самой панели, иначе нажатие переключит флаг дважды). */
export function useHiddenFlag({ shortcut = false } = {}): [boolean, (value: boolean) => void] {
  const [hidden, setHidden] = useState(readHidden)
  const set = useCallback((value: boolean) => {
    try { if (value) localStorage.setItem(HIDDEN_KEY, '1'); else localStorage.removeItem(HIDDEN_KEY) } catch { /* без хранилища — только до перезагрузки */ }
    setHidden(value)
    window.dispatchEvent(new CustomEvent<boolean>(HIDDEN_EVENT, { detail: value }))
  }, [])
  useEffect(() => {
    const onChange = (e: Event) => setHidden((e as CustomEvent<boolean>).detail)
    window.addEventListener(HIDDEN_EVENT, onChange)
    return () => window.removeEventListener(HIDDEN_EVENT, onChange)
  }, [])
  // Вернуть панель: Alt+Shift+D или ?demo в адресе.
  useEffect(() => {
    if (!shortcut) return
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyD') { e.preventDefault(); set(!readHidden()) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [set, shortcut])
  return [hidden, set]
}
