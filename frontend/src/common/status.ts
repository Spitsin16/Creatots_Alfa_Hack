export const statusName: Record<string, string> = {
  DRAFT: 'Черновик', AWAITING_SIGNATURE: 'Ждёт подписи', SUBMITTED: 'Отправлена', VALIDATION: 'Проверяем',
  ENRICHMENT: 'Собираем данные', SCORING: 'Рассчитываем', MANUAL_REVIEW: 'Проверяет специалист',
  APPROVED: 'Одобрено', REJECTED: 'Отказ', COUNTER_OFFER: 'Предложение банка', INFO_REQUESTED: 'Нужны документы', CANCELLED: 'Отменена', EXPIRED: 'Срок предложения истёк', CONTRACT_SIGNED: 'Договор подписан', ISSUED: 'Деньги выданы',
}

// Статусы, в которых заявка сама не меняется — ждём клиента или процесс завершён.
export const settledStatuses = ['DRAFT', 'ISSUED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'INFO_REQUESTED', 'COUNTER_OFFER']

// Заявка завершена: по ней больше ничего не произойдёт.
export const finalStatuses = ['ISSUED', 'REJECTED', 'CANCELLED', 'EXPIRED']
