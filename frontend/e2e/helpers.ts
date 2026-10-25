import { expect, type Locator, type Page } from '@playwright/test'

/** Сумма в рублях так, как её пишет интерфейс: «270 000» с обычным, неразрывным или узким пробелом. */
export const rub = (value: number) =>
  new RegExp(String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '[\\s\\u00a0\\u202f]?'))

/** Ошибки JavaScript на странице за время теста: в конце теста их быть не должно. */
export function collectPageErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  return errors
}

/** Вход с экрана выбора учётки: карточка персоны по имени («Войти: Иванов Артём, …»). */
export async function enterAs(page: Page, title: string) {
  if (!new URL(page.url()).pathname.startsWith('/login')) await page.goto('/login')
  await page.getByRole('button', { name: new RegExp(`^Войти: ${title}`) }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/**
 * Поставить галочку или радио так, чтобы отметка закрепилась. Страница ещё догружает карточки и может
 * сдвинуться под кликом или перерисовать поле, и тогда клик «не засчитывается». Поэтому повторяем, пока
 * отметка не продержится.
 */
export async function checkFirmly(control: Locator, timeout = 20_000) {
  await expect(control).toBeVisible()
  await expect(async () => {
    if (!(await control.isChecked())) await control.check({ force: true, timeout: 2_000 })
    await expect(control).toBeChecked({ timeout: 1_000 })
  }).toPass({ timeout })
}

/** Галочка согласия на запрос в БКИ и ФНС в анкете. В новой вкладке она есть всегда; если согласие уже запомнено, блока нет. */
export async function giveConsent(page: Page) {
  const consent = page.getByRole('checkbox', { name: /Согласен на запрос данных в БКИ и ФНС/ })
  if (!(await consent.isVisible())) return
  await checkFirmly(consent)
}

/** Токен текущей сессии: приложение держит его в sessionStorage. Нужен, чтобы сверить статус заявки с API. */
export async function sessionToken(page: Page) {
  const token = await page.evaluate(() => sessionStorage.getItem('token'))
  expect(token, 'после входа в sessionStorage должен быть токен').toBeTruthy()
  return token as string
}

export type ApplicationState = { id: string; status: string; product: string; amount_kopecks: number }

/** Заявка глазами API, тем же токеном, что и у клиента в браузере. Ответ не 2xx — падаем с кодом ответа. */
export async function fetchApplication(page: Page, token: string, id: string): Promise<ApplicationState> {
  const response = await page.request.get(`/api/v1/applications/${id}`, { headers: { Authorization: `Bearer ${token}` } })
  expect(response.ok(), `GET /applications/${id} → ${response.status()}`).toBeTruthy()
  return response.json()
}

/**
 * Ждём, пока воркер переведёт заявку в нужный статус: спрашиваем API раз в 2–5 секунд.
 * Разовый сбой API (5xx, обрыв сети) не роняет опрос: такой ответ считается «пока не тот статус».
 * Если заявка ушла в другой конечный статус (отказ, ручная проверка), падаем сразу, с понятным текстом.
 */
export async function waitForStatus(page: Page, token: string, id: string, wanted: string, timeout = 90_000) {
  const dead = ['REJECTED', 'CANCELLED', 'EXPIRED', 'COUNTER_OFFER', 'INFO_REQUESTED', 'MANUAL_REVIEW']
  await expect.poll(async () => {
    const response = await page.request
      .get(`/api/v1/applications/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .catch((e: Error) => e)
    if (response instanceof Error) return `сеть: ${response.message.split('\n')[0]}`
    if (!response.ok()) return `HTTP ${response.status()}`
    const { status } = (await response.json()) as ApplicationState
    if (status !== wanted && dead.includes(status)) throw new Error(`Заявка ${id} ушла в статус ${status}, ждали ${wanted}`)
    return status
  }, { message: `заявка ${id} должна дойти до статуса ${wanted}`, timeout, intervals: [2_000, 5_000] }).toBe(wanted)
}
