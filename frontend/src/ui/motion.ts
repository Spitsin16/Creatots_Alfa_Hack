import { useEffect, useRef, useState } from 'react'

// Движение в интерфейсе — только чтобы показать, что изменилось (правка ментора 25.10): сумма выросла
// после выписки, заявка перешла на следующий этап, пришло решение. Без библиотек, на rAF и CSS;
// при «уменьшить движение» в системе всё сразу встаёт в конечное состояние.

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const easeOut = (t: number) => 1 - (1 - t) ** 3

/** Число плавно доходит от from до to (за duration мс). Если from не задан или равен to — сразу to. */
export function useCountUp(to: number, from?: number | null, duration = 900): number {
  const animate = from != null && from !== to && !prefersReducedMotion()
  const [value, setValue] = useState(animate ? (from as number) : to)
  useEffect(() => {
    if (!animate) { setValue(to); return }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      setValue((from as number) + (to - (from as number)) * easeOut(t))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [to, from, duration, animate])
  return value
}

/**
 * true, если значение изменилось с тех пор, как его впервые показали (undefined — ещё грузится, не в счёт):
 * анимируем перемены, а не первую отрисовку экрана.
 */
export function useChangedSinceMount<T>(value: T | undefined): boolean {
  const first = useRef(value)
  if (first.current === undefined) first.current = value
  return value !== undefined && value !== first.current
}
