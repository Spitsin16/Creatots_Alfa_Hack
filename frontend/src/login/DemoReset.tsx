import { useState } from 'react'
import { Button } from '@alfalab/core-components/button/esm'
import { ArrowsCwMIcon } from '@alfalab/icons-glyph/ArrowsCwMIcon'
import { CheckmarkCircleMIcon } from '@alfalab/icons-glyph/CheckmarkCircleMIcon'
import { request } from '../api'
import styles from './LoginPage.module.css'

// После перезагрузки страницы показываем «стенд чистый» — флаг живёт одну загрузку
const DONE_KEY = 'login.resetDone'
const takeDone = () => {
  try {
    const done = sessionStorage.getItem(DONE_KEY) === '1'
    sessionStorage.removeItem(DONE_KEY)
    return done
  } catch { return false }
}

/**
 * «Сбросить демо-стенд»: удаляет заявки, решения, чаты, документы, журнал, клиентов песочницы и новые версии
 * правил — как после первого `docker compose up`. Демо-учётки остаются. Браузерная память демо (шаг сценария,
 * клиенты песочницы, последний расчёт) тоже очищается, поэтому страница перезагружается.
 */
export function DemoReset() {
  const [done] = useState(takeDone)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = async () => {
    setBusy(true); setError(null)
    try {
      await request('/api/v1/demo/reset', { method: 'POST' })
      try {
        localStorage.clear()
        sessionStorage.clear()
        sessionStorage.setItem(DONE_KEY, '1')
      } catch { /* приватный режим — просто перезагрузим */ }
      window.location.reload()
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error ? e.message : 'Не получилось сбросить стенд — попробуйте ещё раз')
    }
  }

  return <section className={styles.reset} aria-labelledby="reset-title">
    <div className={styles.resetText}>
      <b id="reset-title">{done ? <><CheckmarkCircleMIcon className={styles.resetDone} aria-hidden />Стенд чистый</> : 'Начать показ с чистого стенда'}</b>
      <span>{confirm
        ? 'Удалим все заявки, решения, чаты, документы, журнал, клиентов песочницы и новые версии правил. Отменить нельзя.'
        : done ? 'Заявок нет, демо-учётки на месте — можно начинать показ.'
          : 'Удалит все заявки и всё, что появилось за показ. Демо-учётки останутся.'}</span>
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
    <div className={styles.resetActions}>
      {confirm
        ? <>
          <Button view="secondary" size={40} onClick={() => setConfirm(false)} disabled={busy}>Отмена</Button>
          <Button view="accent" size={40} onClick={() => void reset()} loading={busy}>Да, сбросить</Button>
        </>
        : <Button view="secondary" size={40} leftAddons={<ArrowsCwMIcon aria-hidden />} onClick={() => setConfirm(true)}>Сбросить демо-стенд</Button>}
    </div>
  </section>
}
