import { useEffect, useState } from 'react'
import { rubles } from '../api'

const colors = ['#ef3124', '#ffb400', '#2f8f46', '#3b82f6', '#ffffff', '#ff6a5f']

// Праздничный экран в момент выдачи кредита: конфетти и «Деньги на счёте».
export function Celebration({ amountKopecks, onClose }: { amountKopecks: number; onClose: () => void }) {
  const [pieces] = useState(() => Array.from({ length: 90 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.8, dur: 2.4 + Math.random() * 1.6,
    color: colors[i % colors.length], rot: Math.random() * 360, size: 6 + Math.random() * 8,
  })))
  useEffect(() => { const t = setTimeout(onClose, 6500); return () => clearTimeout(t) }, [])
  return <div className="celebration" onClick={onClose} role="dialog" aria-label="Кредит выдан">
    {pieces.map((p, i) => <i key={i} style={{ left: `${p.left}%`, background: p.color, width: p.size, height: p.size * 0.45,
      animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, transform: `rotate(${p.rot}deg)` }} />)}
    <div className="celebration-card"><span className="big-check">✓</span><h2>Деньги на счёте!</h2>
      <strong>{rubles(amountKopecks)}</strong><p>Кредит выдан и зачислен на ваш расчётный счёт. График платежей и подсказки — в кабинете ниже.</p>
      <button className="primary" onClick={onClose}>Отлично</button></div>
  </div>
}
