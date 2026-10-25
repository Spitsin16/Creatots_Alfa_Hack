import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { isNetworkError } from '../api'
import { homePath, useAuth } from '../auth'
import { demoLogin, PersonaRole } from '../demo/personas'

/** Кого впустить: логин (пароль у всех демо-учёток один) и роль, если она известна заранее. */
export type EnterTarget = { login: string; role?: PersonaRole | null; path?: string }

/** Откуда нажали вход: ошибку показываем только там, где нажимали. */
export type EnterFrom = 'hero' | 'card' | 'saved' | 'form' | 'nonclient'

// ?next= — только адрес внутри приложения (не чужой сайт и не сам экран входа).
export const safeNext = (value: string | null) =>
  value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/login') ? value : null

export const loginErrorText = (e: unknown) =>
  isNetworkError(e) ? 'Нет связи с сервером. Проверьте, что стенд запущен, и попробуйте ещё раз.'
    : e instanceof Error && e.message ? e.message : 'Не удалось войти. Попробуйте ещё раз.'

/**
 * Вход по демо-учётке одним нажатием: токен → кабинет роли (или ?next=, если пришли по ссылке).
 * Роль неизвестна (вход по логину) — ведём на «/», а оболочка сама отправит сотрудника банка в его кабинет.
 */
export function useDemoEnter() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [busy, setBusy] = useState<{ login: string; from: EnterFrom } | null>(null)
  const [error, setError] = useState<{ login: string; from: EnterFrom; text: string } | null>(null)

  const enter = async (target: EnterTarget, from: EnterFrom) => {
    if (busy) return
    if (target.path) { navigate(target.path); return }
    setBusy({ login: target.login, from }); setError(null)
    try {
      login(await demoLogin(target.login))
      navigate(safeNext(params.get('next')) ?? homePath(target.role ?? 'CLIENT'), { replace: true })
    } catch (e) {
      setError({ login: target.login, from, text: loginErrorText(e) })
      setBusy(null)
    }
  }

  /** Идёт вход именно отсюда (эта кнопка; с логином — эта карточка). */
  const isBusy = (from: EnterFrom, loginName?: string) => !!busy && busy.from === from && (loginName === undefined || busy.login === loginName)
  /** Ошибка входа именно отсюда. */
  const errorFor = (from: EnterFrom, loginName?: string) =>
    error && error.from === from && (loginName === undefined || error.login === loginName) ? error.text : null

  return { busy: !!busy, isBusy, errorFor, enter }
}
