// Демо-сессия в браузере: последний клиент и созданные в песочнице клиенты (живут, пока открыта вкладка).
export type SandboxClient = { login: string; name: string; score: number; outcome: string; cls: string }

const read = <T,>(key: string, fallback: T): T => {
  try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) as T : fallback } catch { return fallback }
}
const write = (key: string, value: unknown) => { try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* приватный режим */ } }

export const sandboxClients = (): SandboxClient[] => read<SandboxClient[]>('sandboxClients', [])
export const rememberSandboxClient = (c: SandboxClient) => write('sandboxClients', [c, ...sandboxClients().filter(x => x.login !== c.login)].slice(0, 20))
export const lastClient = (): { login: string; name: string } => read('lastClient', { login: 'p3b', name: 'Иванов Артём' })
export const rememberLastClient = (login: string, name: string) => write('lastClient', { login, name })
