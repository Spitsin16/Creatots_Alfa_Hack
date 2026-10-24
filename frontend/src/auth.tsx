import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, Me, request } from './api'

type Auth = {
  token: string; me: Me | null; loading: boolean
  /** Профиль не загрузился, но сессия жива (обрыв связи, сбой сервера) — можно повторить */
  error: Error | null; retry: () => void
  login: (token: string) => void; logout: () => void
}

const AuthContext = createContext<Auth | null>(null)

// Пользователь сам нажал «Выйти»: тогда экран входа открываем без ?next= — иначе следующая
// персона после входа попала бы на страницу предыдущей (чужая заявка → ошибка).
let signedOut = false
export const wasSignedOut = () => signedOut

// Токен живёт в sessionStorage вкладки: в соседней вкладке можно войти другим пользователем.
export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const [token, setToken] = useState(() => sessionStorage.getItem('token') ?? '')
  const reset = useCallback(() => { sessionStorage.clear(); client.clear(); setToken('') }, [client])
  const logout = useCallback(() => { signedOut = true; reset() }, [reset])
  const login = useCallback((value: string) => { signedOut = false; client.clear(); sessionStorage.setItem('token', value); setToken(value) }, [client])
  // Сессию сбрасываем, только если бэк её не принял (401/403). Обрыв запроса (обновили страницу
  // сразу после входа, нет связи, сервер перезапускается) не должен выкидывать на экран входа.
  const me = useQuery({
    queryKey: ['me', token],
    queryFn: () => request<Me>('/api/v1/me', {}, token).catch(e => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) reset()
      throw e
    }),
    enabled: !!token,
    staleTime: Infinity,
    retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
  })
  const { refetch } = me
  const retry = useCallback(() => { void refetch() }, [refetch])
  const error = token && !me.data && me.error ? me.error : null
  const loading = !!token && (me.isPending || (me.isFetching && !me.data))
  const value = useMemo(() => ({ token, me: me.data ?? null, loading, error, retry, login, logout }),
    [token, me.data, loading, error, retry, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth вне AuthProvider')
  return auth
}

// Вошедший пользователь — для страниц внутри кабинета (вход уже проверен в RequireAuth).
export function useSession() {
  const { token, me } = useAuth()
  return { token, me: me! }
}

export const isBank = (role: string) => role !== 'CLIENT'

// Стартовая страница роли: клиенту — кредиты, риск-менеджеру — согласования, админу — правила.
export const homePath = (role: string) =>
  ({ CLIENT: '/', UNDERWRITER: '/bank', RISK_MANAGER: '/bank/risk', RULES_ADMIN: '/bank/rules' }[role] ?? '/')
