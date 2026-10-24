import { ComponentType, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@alfalab/core-components/button/esm'
import { Dropzone } from '@alfalab/core-components/dropzone/esm'
import { ArrowsCwMIcon } from '@alfalab/icons-glyph/ArrowsCwMIcon'
import { ArrowsRightLeftMIcon } from '@alfalab/icons-glyph/ArrowsRightLeftMIcon'
import { ArrowUpMIcon } from '@alfalab/icons-glyph/ArrowUpMIcon'
import { BanknoteOutMIcon } from '@alfalab/icons-glyph/BanknoteOutMIcon'
import { BulbMIcon } from '@alfalab/icons-glyph/BulbMIcon'
import { CalendarMIcon } from '@alfalab/icons-glyph/CalendarMIcon'
import { CashRegisterTerminalMIcon } from '@alfalab/icons-glyph/CashRegisterTerminalMIcon'
import { ClockMIcon } from '@alfalab/icons-glyph/ClockMIcon'
import { Document1CMIcon } from '@alfalab/icons-glyph/Document1CMIcon'
import { DocumentStampMIcon } from '@alfalab/icons-glyph/DocumentStampMIcon'
import { ExclamationCircleMIcon } from '@alfalab/icons-glyph/ExclamationCircleMIcon'
import { PercentMIcon } from '@alfalab/icons-glyph/PercentMIcon'
import { ScalesMIcon } from '@alfalab/icons-glyph/ScalesMIcon'
import { request } from '../../api'
import { Card, ErrorState } from '../../ui'
import { AdviceItem, OfferData, StatementResult, formatRate, isOverdraft, nb, rub } from './offerMath'
import styles from './offer.module.css'

const icons: Record<string, ComponentType<{ className?: string }>> = {
  UPLOAD_STATEMENT: Document1CMIcon,
  MOVE_TURNOVER: ArrowsRightLeftMIcon,
  ACQUIRING: CashRegisterTerminalMIcon,
  REPAY_EXTERNAL: BanknoteOutMIcon,
  REFINANCE_EXTERNAL: ArrowsCwMIcon,
  WAIT_ANNIVERSARY: CalendarMIcon,
  PAY_TAX_DEBT: ScalesMIcon,
  ADD_COLLATERAL: DocumentStampMIcon,
  PAY_ON_TIME: ClockMIcon,
}

/** «Как получить больше»: советы банка карточками; у совета «загрузите выписку» — загрузка файла 1С и пересчёт. */
export function AdviceSection({ offer, items, loading, canUpload, token, onStatement, onEditAnswers, rejected }: {
  offer: OfferData; items: AdviceItem[]; loading: boolean; canUpload: boolean; token: string
  onStatement: (r: StatementResult, file: Blob) => void; onEditAnswers: () => void; rejected?: boolean
}) {
  const title = rejected ? 'Что поможет в следующий раз' : offer.limit_kopecks > 0 ? 'Как получить больше' : 'Что поможет получить кредит'
  if (items.length === 0) {
    if (loading) return null
    // лимит больше запрошенного — «улучшить нечем» было бы неправдой: больше взять можно уже сейчас
    const room = !rejected && offer.limit_kopecks > offer.requested_amount_kopecks && offer.requested_amount_kopecks > 0
    const subtitle = rejected
      ? 'Как только причина уйдёт, пересчитайте предложение — данные уже есть в банке.'
      : room
        ? isOverdraft(offer)
          ? <>Это лучшие условия на ваших данных. Больше уже можно: весь лимит {rub({ kopecks: offer.limit_kopecks })} выбирается при оформлении заявки.</>
          : <>Это лучшие условия на ваших данных. Сумму можно увеличить до {rub({ kopecks: offer.limit_kopecks })} — измените её в <button type="button" className={styles.textLink} onClick={onEditAnswers}>анкете</button>.</>
        : 'Советов нет: на ваших данных это лучшее предложение — сумму и ставку сейчас улучшить нечем.'
    return <Card title={title} subtitle={subtitle} />
  }
  const regular = items.filter(a => a.code !== 'UPLOAD_STATEMENT')
  const regularCount = regular.length
  const lastRegular = regular[regular.length - 1]?.code
  return <Card title={title} subtitle="Советы посчитаны на ваших данных: видно, что изменится">
    <div className={styles.adviceGrid}>
      {items.map(a => {
        const Icon = icons[a.code] ?? BulbMIcon
        const upload = a.code === 'UPLOAD_STATEMENT'
        const growth = a.newLimitKopecks != null && a.newLimitKopecks > offer.limit_kopecks ? a.newLimitKopecks : null
        const lowerRate = a.newRate != null && offer.rate != null && a.newRate < offer.rate ? a.newRate : null
        // загрузка выписки — на всю ширину; из остальных одинокая последняя карточка — тоже
        const wide = upload || (a.code === lastRegular && regularCount % 2 === 1)
        return <article key={a.code} className={[styles.adviceCard, wide ? styles.adviceWide : ''].filter(Boolean).join(' ')}>
          <div className={styles.adviceHead}>
            <div className={styles.adviceIcon} aria-hidden><Icon /></div>
            <div>
              <div className={styles.adviceTitle}>{nb(a.title)}</div>
              {!growth && !lowerRate && a.effect && <div className={styles.adviceEffect}>{nb(a.effect)}</div>}
            </div>
          </div>
          {(growth || lowerRate) && <div className={styles.chips}>
            {growth && <span className={styles.chip}><ArrowUpMIcon aria-hidden />Сумма до {rub({ kopecks: growth })}{offer.limit_kopecks > 0 ? ` (+${rub({ kopecks: growth - offer.limit_kopecks })})` : ''}</span>}
            {lowerRate && <span className={styles.chip}><PercentMIcon aria-hidden />Ставка {formatRate(lowerRate)} вместо {formatRate(offer.rate)}</span>}
          </div>}
          {a.costs && <div className={styles.costs}><ExclamationCircleMIcon aria-hidden /><span><b>Цена вопроса:</b> {nb(a.costs)}</span></div>}
          {upload && canUpload && <StatementUpload offerId={offer.id} token={token} onDone={onStatement} />}
        </article>
      })}
    </div>
  </Card>
}

/** Загрузка выписки 1С из другого банка (перетащить или выбрать файл) → новое предложение. */
function StatementUpload({ offerId, token, onDone }: { offerId: string; token: string; onDone: (r: StatementResult, file: Blob) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const upload = useMutation({
    mutationFn: (file: File) => request<StatementResult>(`/api/v1/pre-offers/${offerId}/statement`,
      { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } }, token),
    onSuccess: (r, file) => onDone(r, file),
  })
  const pick = (file: File | undefined) => {
    if (!file || upload.isPending) return
    setFileName(file.name)
    upload.mutate(file)
  }
  return <div>
    <Dropzone block className={styles.drop} text="Отпустите файл — сразу пересчитаем" disabled={upload.isPending} error={upload.isError} onDrop={files => pick(files[0])}>
      <div className={styles.dropInner}>
        <Document1CMIcon className={styles.dropIcon} aria-hidden />
        <div className={styles.dropText}>
          <div className={styles.dropTitle}>{upload.isPending ? `Загружаем «${fileName}» и пересчитываем…` : 'Загрузите выписку из другого банка'}</div>
          <div className={styles.dropHint}>Перетащите файл сюда или выберите его. Формат 1С (.txt) до 5 МБ — в клиент-банке выберите «Экспорт в 1С». Сумму пересчитаем сразу.</div>
        </div>
        <Button view="secondary" size={40} loading={upload.isPending} onClick={() => input.current?.click()}>Выбрать файл</Button>
      </div>
    </Dropzone>
    <input ref={input} className={styles.hiddenInput} type="file" accept=".txt,text/plain" aria-label="Файл выписки 1С"
      onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
    {upload.isError && <div className={styles.uploadError}><ErrorState error={upload.error} title="Не получилось учесть выписку" onRetry={() => input.current?.click()} retryLabel="Выбрать другой файл" /></div>}
  </div>
}
