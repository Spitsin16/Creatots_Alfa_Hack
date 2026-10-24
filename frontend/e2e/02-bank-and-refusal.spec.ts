import { expect, test } from '@playwright/test'
import { collectPageErrors, enterAs, giveConsent, sessionToken } from './helpers'

// Короткие проверки двух других сторон кейса: кабинет андеррайтера и отказ клиенту без внутренней кухни скоринга.
// На чистой базе (CI) очередь банка пуста, пока 01-coffee-shop не создаст заявку, поэтому сверяемся с API:
// есть заявки — должна быть таблица со строками, нет — понятное пустое состояние вместо белого экрана.

test('андеррайтер uw1: после входа открывается очередь заявок с таблицей', async ({ page }) => {
  const errors = collectPageErrors(page)

  await test.step('Экран входа: карточка «Смирнова Е.» (андеррайтер)', async () => {
    await enterAs(page, 'Смирнова Е.')
    await expect(page).toHaveURL(/\/bank/)
  })

  await test.step('Очередь: заголовок и таблица заявок (или «Заявок пока нет» на пустой базе)', async () => {
    await expect(page.getByRole('heading', { name: /Очередь/ }).first()).toBeVisible()
    const token = await sessionToken(page)
    const response = await page.request.get('/api/v1/bank/applications?limit=1', { headers: { Authorization: `Bearer ${token}` } })
    expect(response.ok(), `GET /bank/applications → ${response.status()}`).toBeTruthy()
    const { items } = (await response.json()) as { items: unknown[] }
    if (items.length > 0) {
      const table = page.getByRole('table').first()
      await expect(table).toBeVisible()
      await expect(table.getByRole('row').nth(1), 'заявка из API видна строкой в таблице').toBeVisible()
    } else {
      test.info().annotations.push({ type: 'Очередь', description: 'пустая база: заявок нет, проверено пустое состояние' })
      await expect(page.getByText('Заявок пока нет')).toBeVisible()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
    expect(errors, 'ошибки JavaScript на странице').toEqual([])
  })
})

test('p_stop: расчёт заканчивается отказом — объяснение словами, без баллов и класса', async ({ page }) => {
  const errors = collectPageErrors(page)

  await test.step('Экран входа: карточка «Ковалёв Денис» (грузоперевозки)', async () => {
    await enterAs(page, 'Ковалёв Денис')
    await expect(page.getByRole('heading', { name: 'Рассчитать предложение' })).toBeVisible()
  })

  await test.step('Анкета: «Другое», 800 000 ₽ на 12 месяцев, согласие → «Рассчитать предложение»', async () => {
    await page.getByRole('radio', { name: /Другое/ }).click()
    await page.getByRole('textbox', { name: 'Сумма' }).fill('800000')
    await page.getByRole('textbox', { name: 'Срок' }).fill('12')
    await giveConsent(page)
    await page.getByRole('button', { name: 'Рассчитать предложение' }).click()
    await expect(page).toHaveURL(/\/offer\//, { timeout: 30_000 })
  })

  await test.step('Отказ: объяснение есть, оформить заявку нельзя', async () => {
    await expect(page.getByRole('heading', { name: /не можем|не одобр|отказ/i }).first()).toBeVisible()
    await expect(page.getByText(/просрочк/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Оформить заявку' })).toHaveCount(0)
  })

  await test.step('На экране клиента нет баллов скоринга и класса', async () => {
    await page.waitForLoadState('networkidle')
    const text = await page.locator('body').innerText()
    expect(text).not.toMatch(/балл/i)
    expect(text).not.toMatch(/класс/i)
    expect(errors, 'ошибки JavaScript на странице').toEqual([])
  })
})
