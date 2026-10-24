import { useLayoutEffect, useRef, useState } from 'react'
import { Steps } from '@alfalab/core-components/steps/esm'
import { CrossCircleMIcon } from '@alfalab/icons-glyph/CrossCircleMIcon'
import { formatDateTime, StepMode, Track, trackLabels } from '../../common/status'
import styles from './Application.module.css'

type Layout = 'wide' | 'tight' | 'compact' | 'vertical'

/** Раскладка шагов по ширине самого блока: в строку без переносов (обычно или плотнее), с переносами или столбиком. */
function useLayout(signature: string) {
  const ref = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<Layout>('wide')
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(entries => setWidth(Math.round(entries[0].contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Сначала пробуем в строку без переносов; не влезло — плотнее (короче линии, меньше поля, шрифт мельче);
  // не влезло и так — разрешаем переносы; совсем узко — столбиком.
  useLayoutEffect(() => {
    if (!width) return
    setLayout(width < 600 ? 'vertical' : 'wide')
  }, [width, signature])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || el.scrollWidth <= el.clientWidth + 1) return
    if (layout === 'wide') setLayout('tight')
    else if (layout === 'tight') setLayout('compact')
  }, [layout, width, signature])
  return { ref, layout }
}

const currentText: Partial<Record<StepMode, string>> = {
  current: 'Сейчас', waiting: 'Идёт сейчас', action: 'Ждём вас', failed: 'Отказ', stopped: 'Остановлено',
}
const statusText: Record<string, string> = {
  DRAFT: 'Черновик', AWAITING_SIGNATURE: 'Ждёт директора', CANCELLED: 'Отменена', EXPIRED: 'Срок истёк',
}

/** Путь заявки «как трек посылки»: пять этапов кита Steps с датами пройденных. */
export function TrackSteps({ track, status, waitingFor }: { track: Track; status: string; /** Подпись текущего шага по правам пользователя: «Ждём вас» / «Ждёт директора» */ waitingFor?: string }) {
  const { ref, layout } = useLayout(`${status}:${track.doneAt.join(',')}`)
  const vertical = layout === 'vertical'
  const at = (n: number) => track.modes[n - 1]
  return <div ref={ref} className={[styles.steps, styles[`steps-${layout}`]].join(' ')}>
    <Steps
      activeStep={track.active}
      interactive={false}
      isVerticalAlign={vertical}
      minSpaceBetweenSteps={vertical ? 16 : 24}
      checkIsStepWaiting={n => at(n) === 'waiting'}
      checkIsStepWarning={n => at(n) === 'action'}
      checkIsStepPositive={n => at(n) === 'success'}
      checkIsStepCriticalError={n => at(n) === 'failed'}
      checkIsStepCustom={n => (at(n) === 'stopped' ? { content: <CrossCircleMIcon />, iconColor: 'tertiary', className: styles.stoppedIndicator } : null)}
      checkIsStepDisabled={n => at(n) === 'skipped'}
    >
      {trackLabels(track).map((label, i) => {
        const mode = track.modes[i]
        const doneAt = track.doneAt[i]
        const current = i + 1 === track.active
        const sub = doneAt ? formatDateTime(doneAt) : (current && (waitingFor ?? statusText[status])) || currentText[mode] || ''
        return <div key={label} className={[styles.step, styles[`step-${mode}`]].join(' ')} aria-current={i + 1 === track.active ? 'step' : undefined}>
          <span className={styles.stepLabel}>{label}</span>
          {sub && <span className={styles.stepSub}>{sub}</span>}
        </div>
      })}
    </Steps>
  </div>
}
