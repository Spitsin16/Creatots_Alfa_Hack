import { expect, test } from '@playwright/test'
import { checkFirmly, collectPageErrors, enterAs, fetchApplication, giveConsent, rub, sessionToken, waitForStatus } from './helpers'

// Главный сценарий кейса (ТЗ, раздел 13): кофейня p3b от входа до выдачи овердрафта.
// Тест не зависит от чистоты базы: у p3b могут быть прошлые заявки — проверяем только ту, что создали здесь.
const UUID = /\/applications\/([0-9a-f-]{36})/

test('кофейня p3b: прогноз разрыва → овердрафт 270 000 → выписка 1С → 360 000 → подпись → выдача', async ({ page }) => {
  const errors = collectPageErrors(page)
  let applicationId = ''

  await test.step('Экран входа: карточка «Иванов Артём» → кабинет клиента', async () => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: /Начать с главного сценария/ })).toBeVisible()
    await enterAs(page, 'Иванов Артём')
    await expect(page.getByRole('heading', { name: /Артём/ }).first()).toBeVisible()
  })

  await test.step('Главная: «Деньги на счёте» предупреждает о разрыве 12 ноября', async () => {
    await expect(page.getByRole('heading', { name: 'Деньги на счёте', exact: true })).toBeVisible()
    // На чистой базе — «может не хватить», если у p3b уже есть овердрафт — «уйдёт в минус … овердрафт покроет»
    await expect(page.getByText(/12 ноября .*(не хватить|в минус)/).first()).toBeVisible()
    await expect(page.getByText(rub(211060)).first()).toBeVisible()
  })

  await test.step('Анкета: цель «Закрыть кассовый разрыв», 340 000 ₽ на 12 месяцев', async () => {
    // «Подобрать овердрафт» под прогнозом есть, пока овердрафта ещё нет (чистая база); иначе цель выбираем сами
    const pick = page.getByRole('button', { name: 'Подобрать овердрафт' })
    if (await pick.isVisible()) await pick.click()
    else await page.getByRole('radio', { name: /Закрыть кассовый разрыв/ }).click()
    await expect(page.getByRole('radio', { name: /Закрыть кассовый разрыв/ })).toHaveAttribute('aria-checked', 'true')
    // Сумма как в демо-сценарии жюри
    const amount = page.getByRole('textbox', { name: 'Сумма' })
    await amount.fill('340000')
    await expect(amount).toHaveValue(rub(340000))
    await page.getByRole('textbox', { name: 'Срок' }).fill('12')
  })

  await test.step('Согласие на запрос в БКИ и ФНС → «Рассчитать предложение»', async () => {
    await giveConsent(page)
    await page.getByRole('button', { name: 'Рассчитать предложение' }).click()
    await expect(page).toHaveURL(/\/offer\//, { timeout: 30_000 })
  })

  await test.step('Предложение: овердрафт 270 000 ₽ и совет загрузить выписку', async () => {
    await expect(page.getByRole('heading', { name: /Овердрафт/ }).first()).toBeVisible()
    await expect(page.getByText(rub(270000)).first()).toBeVisible()
    await expect(page.getByText('Загрузите выписку из другого банка')).toBeVisible()
  })

  await test.step('Загрузка выписки 1С из другого банка → лимит 360 000 ₽', async () => {
    // Демо-выписка лежит в репозитории: data/statements (testDir — это frontend/e2e)
    await page.getByLabel('Файл выписки 1С').setInputFiles(`${test.info().project.testDir}/../../data/statements/p3b_other_bank_1c.txt`)
    // «+90 000 ₽ по выписке» рядом с новой суммой — значит, лимит пересчитан (360 000 до этого был только в совете)
    await expect(page.getByText(new RegExp(`\\+${rub(90000).source}\\s?₽\\s+по выписке`)).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(rub(360000)).first()).toBeVisible()
  })

  await test.step('Выбор суммы: весь лимит 360 000 ₽ вместо запрошенных 340 000 → «Оформить заявку»', async () => {
    // Запросили 340 000, лимит после выписки 360 000: выбор «В заявку пойдёт» в этом сценарии есть всегда
    const fullLimit = page.getByRole('radio', { name: rub(360000) })
    await expect(page.getByRole('radio', { name: rub(340000) })).toBeVisible()
    await checkFirmly(fullLimit)
    // Подсказка под кнопкой меняется только когда выбор принят приложением, а не одной отметкой в поле
    await expect(page.getByText('Сначала пересчитаем предложение на весь лимит')).toBeVisible()
    await expect(fullLimit, 'перед оформлением выбран весь лимит').toBeChecked()
    await page.getByRole('button', { name: 'Оформить заявку' }).click()
    await expect(page).toHaveURL(UUID, { timeout: 30_000 })
    applicationId = UUID.exec(page.url())![1]
    test.info().annotations.push({ type: 'Заявка', description: applicationId })
  })

  const token = await sessionToken(page)

  await test.step('Черновик на 360 000 ₽ → «Отправить заявку»', async () => {
    const draft = await fetchApplication(page, token, applicationId)
    expect(draft.status).toBe('DRAFT')
    expect(draft.product).toBe('OVERDRAFT')
    expect(draft.amount_kopecks).toBe(360_000_00)
    await page.getByRole('button', { name: 'Отправить заявку' }).click()
  })

  await test.step('Банк решает автоматически: заявка одобрена', async () => {
    await waitForStatus(page, token, applicationId, 'APPROVED')
    // Страница заявки сама опрашивает статус — форма подписи появляется без перезагрузки
    await expect(page.getByText('Код подтверждения')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Одобрено').first()).toBeVisible()
  })

  await test.step('Подпись договора кодом 0000', async () => {
    await page.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]').first().click()
    await page.keyboard.type('0000')
    await page.getByRole('button', { name: 'Подписать договор' }).click()
  })

  await test.step('Выдача: статус «Деньги на счёте» и блок «Мой кредит»', async () => {
    await waitForStatus(page, token, applicationId, 'ISSUED')
    const issued = await fetchApplication(page, token, applicationId)
    expect(issued.amount_kopecks).toBe(360_000_00)
    // Страница сама узнаёт о выдаче: статус в трекере и блок «Мой кредит» из договора
    await expect(page.getByText(/Мой кредит/).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Деньги на счёте').first()).toBeVisible()
    // Поздравление «Овердрафт подключён!» поверх страницы — закрываем, если показалось
    const ok = page.getByRole('dialog').getByRole('button', { name: 'Отлично' })
    if (await ok.isVisible()) {
      await expect(page.getByRole('dialog')).toContainText(rub(360000))
      await ok.click()
      await expect(page.getByRole('dialog')).toBeHidden()
    }
    await expect(page.getByText('Овердрафт подключён').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: rub(360000) }).first()).toBeVisible()
  })

  await test.step('Страница без горизонтальной прокрутки и без ошибок JavaScript', async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
    expect(errors, 'ошибки JavaScript на странице').toEqual([])
  })
})
