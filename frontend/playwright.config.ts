import { defineConfig, devices } from '@playwright/test'

// Автотест сквозного пути (ТЗ, раздел 13). Стенд должен быть запущен: `docker compose up` → http://localhost:8080.
// Другой адрес (например, dev-сервер Vite) — через переменную E2E_BASE_URL.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8080'
const ci = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/.out/**',
  outputDir: './e2e/.out/results',
  // Тесты меняют общие данные стенда (заявки p3b) — по одному, по порядку.
  workers: 1,
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  // Сквозной путь ждёт решения и выдачи от воркера — до нескольких минут на медленной машине CI.
  timeout: 4 * 60_000,
  expect: { timeout: 20_000 },
  // В консоль — шаги, рядом — HTML-отчёт с трейсом упавшего теста (в CI его выгружает workflow).
  reporter: [['list'], ['html', { outputFolder: './e2e/.out/report', open: 'never' }]],
  use: {
    baseURL,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
})
