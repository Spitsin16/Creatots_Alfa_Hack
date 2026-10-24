import { useCallback, useEffect, useState } from 'react'

// Клиенты, созданные в песочнице в этом браузере, — чтобы вернуться к ним с экрана входа одним нажатием.
// Это только удобство одного проверяющего: сами клиенты живут на стенде, здесь — их логины.
// localStorage может быть недоступен (приватный режим, запрет cookies) — тогда список просто пуст.

export type SavedSandboxClient = {
  login: string
  /** «ИП Песочница-Q78XQ» / «ООО «Песочница-3DIS»» */
  name: string
  inn: string
  /** Исход предварительного расчёта: APPROVED, COUNTER_OFFER, MANUAL_REVIEW, REJECTED… */
  outcome: string
  /** ISO-время создания */
  createdAt: string
}

const KEY = 'alfa-credit:sandbox-clients'
const LIMIT = 12
const EVENT = 'sandbox-clients-changed'

function read(): SavedSandboxClient[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list)
      ? list.filter((c): c is SavedSandboxClient => !!c && typeof c.login === 'string' && typeof c.name === 'string')
      : []
  } catch {
    return []
  }
}

function write(list: SavedSandboxClient[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, LIMIT)))
    window.dispatchEvent(new Event(EVENT))
  } catch {
    // нет доступа к хранилищу — клиент всё равно создан, логин показан на экране
  }
}

export function rememberSandboxClient(client: SavedSandboxClient) {
  write([client, ...read().filter(c => c.login !== client.login)])
}

export function forgetSandboxClient(login: string) {
  write(read().filter(c => c.login !== login))
}

/** Список созданных в этом браузере клиентов песочницы, свежие сверху. */
export function useSandboxClients() {
  const [list, setList] = useState<SavedSandboxClient[]>(read)
  useEffect(() => {
    const sync = () => setList(read())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync) }
  }, [])
  const forget = useCallback((login: string) => forgetSandboxClient(login), [])
  return { clients: list, forget }
}
