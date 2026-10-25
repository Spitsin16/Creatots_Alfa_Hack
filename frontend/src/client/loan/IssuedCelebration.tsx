import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@alfalab/core-components/button/esm'
import { Modal } from '@alfalab/core-components/modal/esm'
import { Typography } from '@alfalab/core-components/typography/esm'
import { CheckmarkMIcon } from '@alfalab/icons-glyph/CheckmarkMIcon'
import { Money } from '../../ui'
import styles from './IssuedCelebration.module.css'

/**
 * Праздник показываем, только когда статус сменился на ISSUED на глазах у пользователя:
 * страница опрашивает заявку раз в 5 с, и предыдущий увиденный статус был другим.
 * Открытие уже выданной заявки (в том числе из кэша) праздника не вызывает:
 * учитываем только ответы, полученные после открытия страницы.
 */
export function useIssuedCelebration(applicationId: string, status: string | undefined, fetchedAfterMount: boolean) {
  const seen = useRef<{ id: string; status: string } | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!status || !fetchedAfterMount) return
    const prev = seen.current
    if (prev && prev.id === applicationId && prev.status !== 'ISSUED' && status === 'ISSUED') setOpen(true)
    if (prev && prev.id !== applicationId) setOpen(false)
    seen.current = { id: applicationId, status }
  }, [applicationId, status, fetchedAfterMount])
  return { open, close: () => setOpen(false) }
}

const COLORS = ['#ef3124', '#ffb400', '#0cc44d', '#3b82f6', '#212124', '#ff8a80']

type Props = { open: boolean; onClose: () => void; product: string; amountKopecks: number }

/** Модалка «Деньги на счёте!» с конфетти. При prefers-reduced-motion конфетти не показываем (CSS). */
export function IssuedCelebration({ open, onClose, product, amountKopecks }: Props) {
  const title = product === 'OVERDRAFT' ? 'Овердрафт подключён!' : product === 'REFINANCE' ? 'Кредит в другом банке погашен!' : 'Деньги на счёте!'
  const text = product === 'OVERDRAFT'
    ? 'Лимит уже работает: если на счёте не хватит денег, платёж всё равно пройдёт. Условия и подсказки — на странице ниже.'
    : product === 'REFINANCE'
      ? 'Деньги направлены на погашение кредита в другом банке. Теперь платите по новому графику — он на странице ниже.'
      : 'Кредит выдан и зачислен на расчётный счёт. График платежей и подсказки — на странице ниже.'
  return <>
    {open && <Confetti />}
    <Modal open={open} onClose={onClose} size={500}>
      <Modal.Header hasCloser />
      <Modal.Content>
        <div className={styles.body}>
          <span className={styles.check} aria-hidden><CheckmarkMIcon /></span>
          <Typography.Title tag="h2" view="medium" font="system" className={styles.title}>{title}</Typography.Title>
          <Money kopecks={amountKopecks} size="xl" />
          <p className={styles.text}>{text}</p>
        </div>
      </Modal.Content>
      <Modal.Footer layout="column">
        <Button view="accent" size={48} block onClick={onClose}>Отлично</Button>
      </Modal.Footer>
    </Modal>
  </>
}

/** Конфетти поверх всего, без кликов; убираем после анимации. */
function Confetti() {
  const [pieces] = useState(() => Array.from({ length: 80 }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.7,
    duration: 2.4 + Math.random() * 1.6,
    color: COLORS[i % COLORS.length],
    size: 6 + Math.random() * 7,
    drift: (Math.random() - 0.5) * 160,
    spin: 360 + Math.random() * 720,
    round: i % 5 === 0,
  })))
  const [done, setDone] = useState(false)
  const timer = useRef<number>(undefined)
  useEffect(() => {
    timer.current = window.setTimeout(() => setDone(true), 4500)
    return () => window.clearTimeout(timer.current)
  }, [])
  if (done) return null
  return createPortal(<div className={styles.confetti} aria-hidden>
    {pieces.map((p, i) => <i key={i} className={p.round ? styles.round : undefined} style={{
      left: `${p.left}%`, width: p.size, height: p.round ? p.size : p.size * 0.45, background: p.color,
      animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`,
      ['--drift' as string]: `${p.drift}px`, ['--spin' as string]: `${p.spin}deg`,
    }} />)}
  </div>, document.body)
}
