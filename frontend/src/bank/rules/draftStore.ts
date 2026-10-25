// Черновик правил в sessionStorage этой вкладки: переживает уход на другую страницу и обновление.
// Хранилище может быть недоступно (приватный режим, запрет сайта) — тогда черновик живёт только в памяти.
import type { Rules } from './meta'
import type { SimRow } from './SimulationTable'

export type SimResult = { base_version: number; personas: SimRow[]; changed: number }
export type SimState = { key: string; result: SimResult }

export type StoredDraft = {
  /** Версия правил, от которой считается черновик */
  version: number | null
  draft: Rules | null
  sim: SimState | null
  comment: string
}

const KEY = 'rules-admin-draft'

const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Похоже ли на полный набор правил — иначе форма упадёт на отсутствующем разделе */
const looksLikeRules = (v: unknown): v is Rules =>
  isObject(v) && isObject(v.scoring) && isObject(v.scoring.factors) && Array.isArray(v.classes) && isObject(v.products)
  && isObject(v.market) && isObject(v.rate) && isObject(v.collateral)

export function loadDraft(): StoredDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!isObject(value)) return null
    const draft = looksLikeRules(value.draft) ? value.draft : null
    const sim = draft && isObject(value.sim) && typeof value.sim.key === 'string' && isObject(value.sim.result) && Array.isArray(value.sim.result.personas)
      ? value.sim as SimState : null
    return {
      version: typeof value.version === 'number' ? value.version : null,
      draft,
      sim,
      comment: typeof value.comment === 'string' ? value.comment : '',
    }
  } catch {
    return null
  }
}

export function storeDraft(value: StoredDraft | null) {
  try {
    if (value) sessionStorage.setItem(KEY, JSON.stringify(value))
    else sessionStorage.removeItem(KEY)
  } catch {
    // хранилище недоступно — ничего страшного, черновик останется в памяти страницы
  }
}
