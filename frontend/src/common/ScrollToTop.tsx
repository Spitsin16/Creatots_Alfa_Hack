import { useLayoutEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router'

/**
 * Новая страница открывается с начала: без этого после «Рассчитать предложение» внизу главной
 * предложение открывалось тоже внизу (баг на телефоне 26.10). «Назад» в браузере не трогаем —
 * там браузер сам возвращает прежнее место; переходы по якорю (#calc) прокручивают сами страницы.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation()
  const type = useNavigationType()
  useLayoutEffect(() => {
    if (type === 'POP' || hash) return
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps -- только смена страницы
  return null
}
