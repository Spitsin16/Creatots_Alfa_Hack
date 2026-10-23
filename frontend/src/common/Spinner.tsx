// Индикатор ожидания: кнопки и блоки, где система что-то считает или обрабатывает.
export function Spinner({ label, light }: { label?: string; light?: boolean }) {
  return <span className={`spinner-wrap ${light ? 'light' : ''}`} role="status" aria-live="polite"><span className="spinner" />{label && <span>{label}</span>}</span>
}

const steps = ['SUBMITTED', 'VALIDATION', 'ENRICHMENT', 'SCORING']
const stepText: Record<string, string> = {
  SUBMITTED: 'Заявка принята', VALIDATION: 'Проверяем данные', ENRICHMENT: 'Запрашиваем БКИ и ФНС', SCORING: 'Рассчитываем решение',
  CONTRACT_SIGNED: 'Зачисляем деньги на счёт',
}

// Полоса прогресса автоматической обработки заявки.
export function Processing({ status }: { status: string }) {
  const index = steps.indexOf(status)
  const share = status === 'CONTRACT_SIGNED' ? 90 : Math.max(10, ((index + 1) / (steps.length + 1)) * 100)
  return <div className="processing"><Spinner label={stepText[status] ?? 'Обрабатываем'} />
    <div className="progress"><i style={{ width: `${share}%` }} /></div><small>Обычно это занимает несколько секунд — статус обновится сам</small></div>
}
