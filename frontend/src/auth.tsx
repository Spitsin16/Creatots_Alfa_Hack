import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Me, request } from './api'

type Auth = { token: string; me: Me | null; loading: boolean; login: (token: string) => void; logout: () => void }

const AuthContext = createContext<Auth | null>(null)

// Токен живёт в sessionStorage вкладки: в соседней вкладке можно войти другим пользователем.
export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const [token, setToken] = useState(() => sessionStorage.getItem('token') ?? '')
  const logout = useCallback(() => { sessionStorage.clear(); client.clear(); setToken('') }, [client])
  const login = useCallback((value: string) => { client.clear(); sessionStorage.setItem('token', value); setToken(value) }, [client])
  const me = useQuery({
    queryKey: ['me', token],
    queryFn: () => request<Me>('/api/v1/me', {}, token).catch(e => { logout(); throw e }),
    enabled: !!token,
    staleTime: Infinity,
  })
  const value = useMemo(() => ({ token, me: me.data ?? null, loading: !!token && me.isPending, login, logout }), [token, me.data, me.isPending, login, logout])
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
