import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Me, request } from '../api'
import { homePath, isBank, useAuth, useSession } from '../auth'
import { Spinner } from '../common/Spinner'
import { clearTabExceptDemo, readDemo } from './demoStore'
import { demoLogin, findPersona } from './personas'
import { actorOf, clientActorOf, findScenario, isKnownActor, withClient } from './scenarios'
import styles from './CabinetSwitcher.module.css'

// Слева внизу: клиент и сотрудники банка в один клик, без экрана входа (правка ментора 25.10).
// Кабинет, куда пришло новое уведомление, отмечен счётчиком — видно, кому сейчас ходить.

type Cabinet = { login: string; role: string; name: string }

const LAST_CLIENT_KEY = 'demo:lastClient'
const DEFAULT_CLIENT = { login: 'p3b', name: 'Иванов Артём' }

// Последний клиент живёт в localStorage: «Выйти» чистит вкладку, а переключатель должен его помнить.
function readLastClient(): { login: string; name: string } {
  try {
    const raw = localStorage.getItem(LAST_CLIENT_KEY)
    return raw ? { ...DEFAULT_CLIENT, ...(JSON.parse(raw) as { login: string; name: string }) } : DEFAULT_CLIENT
  } catch { return DEFAULT_CLIENT }
}

function rememberClient(login: string, name: string) {
  try { localStorage.setItem(LAST_CLIENT_KEY, JSON.stringify({ login, name })) } catch { /* без хранилища — по умолчанию кофейня */ }
}

const clientName = (login: string, fallback: string) =>
  isKnownActor(login) ? actorOf(login).name : findPersona(login)?.title ?? fallback

// Клиент в переключателе: сам клиент, если вошли им; иначе клиент идущего демо-сценария; иначе последний, кем входили.
function pickClient(me: Me, shortName: string): { login: string; name: string } {
  if (!isBank(me.role)) {
    rememberClient(me.login, shortName)
    return { login: me.login, name: shortName }
  }
  const demo = readDemo()
  const scenario = findScenario(demo.scenarioId)
  const login = scenario ? clientActorOf(withClient(scenario, demo.client?.login)) : null
  if (login) return { login, name: login === demo.client?.login ? demo.client.name : clientName(login, login) }
  const last = readLastClient()
  return { login: last.login, name: clientName(last.login, last.name) }
}

export function CabinetSwitcher({ shortName }: { shortName: string }) {
  const { me } = useSession()
  const auth = useAuth()
  const navigate = useNavigate()
  const [switching, setSwitching] = useState<string | null>(null)
  const [error, setError] = useState(false)

  const client = pickClient(me, shortName)
  const cabinets: Cabinet[] = [
    { login: client.login, role: 'Клиент', name: client.name },
    // Второй андеррайтер в списке, только если вошли им: иначе показываем основного
    me.login === 'uw2' ? { login: 'uw2', role: 'Андеррайтер', name: actorOf('uw2').name } : { login: 'uw1', role: 'Андеррайтер', name: actorOf('uw1').name },
    { login: 'risk1', role: 'Риск-менеджер', name: actorOf('risk1').name },
    { login: 'admin1', role: 'Правила', name: actorOf('admin1').name },
  ]

  const logins = cabinets.map(c => c.login).join(',')
  const unread = useQuery({
    queryKey: ['demo-unread', logins],
    queryFn: () => request<{ unread: Record<string, number> }>(`/api/v1/demo/unread?logins=${encodeURIComponent(logins)}`),
    refetchInterval: 5000,
    retry: false,
  })

  const go = async (cabinet: Cabinet) => {
    if (switching) return
    if (cabinet.login === me.login) { navigate(homePath(me.role)); return }
    setSwitching(cabinet.login); setError(false)
    try {
      const token = await demoLogin(cabinet.login)
      clearTabExceptDemo()
      auth.login(token)
      navigate(homePath(findPersona(cabinet.login)?.role ?? (cabinet.role === 'Клиент' ? 'CLIENT' : 'UNDERWRITER')))
    } catch {
      setError(true); setSwitching(null)
    }
  }

  return <nav className={styles.switcher} aria-label="Кабинеты демо">
    <span className={styles.title}>Кабинеты демо</span>
    <ul className={styles.list}>
      {cabinets.map(c => {
        const active = c.login === me.login
        const count = active ? 0 : unread.data?.unread[c.login] ?? 0
        return <li key={c.role}>
          <button type="button" className={[styles.row, active ? styles.active : ''].filter(Boolean).join(' ')}
            onClick={() => void go(c)} disabled={!!switching && switching !== c.login} aria-current={active ? 'true' : undefined}
            aria-label={`${c.role}: ${c.name}${active ? ', вы здесь' : ''}${count ? `, новых уведомлений: ${count}` : ''}`}>
            <span className={[styles.avatar, c.role === 'Клиент' ? styles.avatarClient : ''].filter(Boolean).join(' ')} aria-hidden>{c.name[0]?.toUpperCase()}</span>
            <span className={styles.text}>
              <b>{c.role}</b>
              <small>{switching === c.login ? 'Входим…' : c.name}</small>
            </span>
            {switching === c.login
              ? <Spinner />
              : count > 0 && <span className={styles.count} aria-hidden>{count}</span>}
          </button>
        </li>
      })}
    </ul>
    {error && <span className={styles.error} role="alert">Не получилось войти — попробуйте ещё раз</span>}
  </nav>
}
