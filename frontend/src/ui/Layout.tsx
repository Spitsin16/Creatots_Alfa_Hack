import { CSSProperties, ReactNode } from 'react'
import styles from './Layout.module.css'

type Gap = 8 | 12 | 16 | 20 | 24 | 32

export type StackProps = {
  children?: ReactNode
  /** Расстояние между блоками, px (по умолчанию 20 — между карточками экрана) */
  gap?: Gap
  /** Выравнивание по горизонтали (для вертикального стека) */
  align?: 'stretch' | 'start' | 'center' | 'end'
  className?: string
}

/** Вертикальный стек блоков с равными отступами — каркас экрана: шапка, карточка, карточка… */
export function Stack({ children, gap = 20, align = 'stretch', className }: StackProps) {
  return <div className={[styles.stack, className].filter(Boolean).join(' ')} style={{ '--stack-gap': `${gap}px`, alignItems: align === 'stretch' ? 'stretch' : align === 'start' ? 'flex-start' : align === 'end' ? 'flex-end' : 'center' } as CSSProperties}>
    {children}
  </div>
}

export type GridProps = {
  children?: ReactNode
  /**
   * Колонки: число (2, 3, 4 — равные) или шаблон grid-template-columns ('2fr 1fr', '1fr 360px').
   * Ниже 900px любая сетка складывается в одну колонку (у 3–4 колонок на 600–900px — две).
   */
  columns?: 2 | 3 | 4 | string
  gap?: Gap
  /** Выравнивание ячеек по вертикали */
  align?: 'stretch' | 'start' | 'center' | 'end'
  className?: string
}

/** Сетка карточек: «главное + боковая колонка» или ряд одинаковых плиток. Сама складывается на мобильном. */
export function Grid({ children, columns = 2, gap = 20, align = 'stretch', className }: GridProps) {
  const template = typeof columns === 'number' ? `repeat(${columns}, minmax(0, 1fr))` : columns
  const cls = [styles.grid, typeof columns === 'number' && columns > 2 ? styles.many : '', className].filter(Boolean).join(' ')
  return <div className={cls} style={{ '--grid-template': template, '--grid-gap': `${gap}px`, alignItems: align } as CSSProperties}>
    {children}
  </div>
}
