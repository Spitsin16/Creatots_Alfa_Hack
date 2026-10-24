import { MyApplicationItem } from '../../api'
import { finalStatuses } from '../../common/status'
import { useMyApplications } from '../../queries'
import type { CurrentOverdraft } from '../ForecastCard'

// Есть ли у клиента овердрафт: выданный (лимит из заявки) или заявка на него, которая ещё в работе.
// Нужен, чтобы главная не предлагала «Подобрать овердрафт» тому, у кого он уже есть.

const byNewest = (a: MyApplicationItem, b: MyApplicationItem) => (b.created_at ?? '').localeCompare(a.created_at ?? '')

/** Выданный овердрафт — последний по дате заявки (новый лимит заменяет прежний); заявка в работе — любой нефинальный статус. */
export function currentOverdraft(items: MyApplicationItem[]): CurrentOverdraft {
  const overdrafts = items.filter(i => i.product === 'OVERDRAFT').sort(byNewest)
  const issued = overdrafts.find(i => i.status === 'ISSUED' && (i.amount_kopecks ?? 0) > 0)
  const inWork = overdrafts.find(i => !finalStatuses.includes(i.status))
  const pending = inWork ? { applicationId: inWork.id, amountKopecks: inWork.amount_kopecks, status: inWork.status } : undefined
  if (issued) return { kind: 'issued', limitKopecks: issued.amount_kopecks ?? 0, applicationId: issued.id, pending }
  if (pending) return { kind: 'pending', ...pending }
  return { kind: 'none' }
}

/** Овердрафт клиента по списку заявок. Пока список грузится — 'loading'; не загрузился — считаем, что овердрафта нет (как раньше). */
export function useCurrentOverdraft(businessId: string): CurrentOverdraft {
  const apps = useMyApplications(businessId)
  if (apps.isPending) return { kind: 'loading' }
  if (!apps.data) return { kind: 'none' }
  return currentOverdraft(apps.data.items)
}
