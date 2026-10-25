// Сценарии показа для жюри: кто (учётка), где (экран), что сделать и как понять, что шаг выполнен.
// Логика шагов построена по фактам стенда (прогон через API 24.10):
// - бухгалтер по МЧД может создать черновик, но не отправить и не подписать (403 «Нет полномочия SIGN»);
// - андеррайтер одобрил сумму > 5 млн или клиента класса D → статус остаётся MANUAL_REVIEW, исполнитель тот же,
//   а последнее решение по заявке уже APPROVED: так и клиент, и банк видят «ждём риск-менеджера»;
// - риск-менеджер «Вернуть андеррайтеру» → исполнитель снимается, решение остаётся тем же APPROVED; андеррайтер
//   снова берёт заявку — у клиента всё как при ожидании риск-менеджера, отличить можно только по тому,
//   что решение не новое. Банк видит это точно — по журналу аудита (RISK_RETURN / UNDERWRITER_* с risk_required);
// - риск-менеджер подтвердил → APPROVED; подпись кодом → CONTRACT_SIGNED → через секунду ISSUED;
// - запрос документов → INFO_REQUESTED; клиент приложил файл → снова MANUAL_REVIEW у того же андеррайтера.

/** Что панель знает о заявке сценария (последнее, что видела любая из ролей). */
export type Snapshot = {
  status: string
  /** Заявку ведёт сотрудник банка */
  assigned: boolean
  /** Исход последнего решения: MANUAL_REVIEW (автомат), INFO_REQUESTED, APPROVED (андеррайтер)… */
  lastOutcome: string | null
  /** Банк хоть раз запрашивал документы */
  everInfoRequested: boolean
  amountKopecks: number | null
  /** Последний «живой» статус до отказа / отмены / истечения — чтобы показать, на каком шаге сценарий сорвался */
  lastLive: string | null
  /** Последнее решение (исход, сумма, ставка, комментарий) — одинаково видно клиенту и банку: так узнаём, новое ли оно */
  decisionKey?: string | null
  /** Андеррайтер одобрил, ждём второе одобрение риск-менеджера */
  riskPending?: boolean
  /** Риск-менеджер вернул решение андеррайтеру, нового решения ещё нет */
  returned?: boolean
}

export type Facts = {
  appId: string | null
  offerId: string | null
  /** Название бизнеса клиента сценария (из профиля клиента или карточки банка) */
  business: string | null
  snapshot: Snapshot | null
  /** Шаги, отмеченные по посещённой странице или вручную */
  marks: string[]
}

export type Step = {
  id: string
  /** Логин участника, который делает шаг */
  actor: string
  /** Коротко: «Готовит заявку» */
  title: string
  /** Подпись экрана: «Кредиты → анкета» */
  where: string
  /** Куда вести участника на этот шаг (может зависеть от того, докуда он дошёл) */
  path: (f: Facts) => string
  /** Шаг идёт через несколько экранов: на любом из них участник «на месте», панель не зовёт его обратно */
  at?: RegExp
  /** Что сделать на экране — одна-две строки (может зависеть от заявки). Видят все участники, в том числе клиент */
  todo: string | ((f: Facts) => string)
  /** Пояснение только для сотрудника банка (класс риска, скоринг — клиенту их не показываем) */
  bankNote?: string
  /** Как понять, что шаг выполнен. Названия статусов — словами того, кто смотрит (у клиента и банка они разные) */
  doneHint: string | ((names: StatusNames) => string)
  done: (f: Facts) => boolean
  /** Шаг пока нельзя сделать: банк обрабатывает заявку автоматически или ждём предыдущего участника */
  waiting?: (f: Facts) => string | null
  /** Страница, посещение которой участником шага само по себе означает «шаг выполнен» */
  visit?: RegExp
  /** Шаг можно отметить вручную (по данным API его не определить) */
  manual?: boolean
  /** Дополнительная подсказка-действие в панели */
  extra?: 'statement'
}

export type Scenario = {
  id: string
  title: string
  /** Одна строка в списке сценариев */
  short: string
  primary?: boolean
  /** Нужна заявка: панель отслеживает её статус */
  tracksApplication: boolean
  steps: Step[]
  /** Что увидит жюри в конце */
  finale: string
  /** Сценарий завершён (например, деньги выданы) */
  finished: (f: Facts) => boolean
}

/** Русские названия статусов заявки: у клиента — common/status.ts, у банка — bank/workplace/text.ts. */
export type StatusNames = Record<string, string>

/** Участник: как подписать его в панели. У клиента — ИНН бизнеса (data/personas), чтобы банк сразу узнал его заявку. */
export type Actor = { name: string; role: string; inn?: string }

export const actors: Record<string, Actor> = {
  p3b: { name: 'Иванов Артём', role: 'кофейня, ИП', inn: '822503806490' },
  p3a_acc: { name: 'Зайцева Марина', role: 'бухгалтер по МЧД', inn: '7636593302' },
  p3a: { name: 'Орлов Сергей', role: 'директор СтройБазы', inn: '7636593302' },
  p2b: { name: 'Лебедева Ольга', role: 'салон красоты, ИП', inn: '678291765825' },
  p1b: { name: 'Белов Игорь', role: 'директор Оптторг-Региона', inn: '0511600777' },
  p_stop: { name: 'Ковалёв Денис', role: 'грузоперевозки, ИП', inn: '792350760625' },
  uw1: { name: 'Смирнова Е.', role: 'андеррайтер' },
  uw2: { name: 'Петров К.', role: 'андеррайтер' },
  risk1: { name: 'Волков А.', role: 'риск-менеджер' },
  admin1: { name: 'Ким Д.', role: 'админ правил' },
}

const bankLogins = ['uw1', 'uw2', 'risk1', 'admin1']
const extraActors: Record<string, Actor> = {}

/** Свой клиент из песочницы, за которого проходят сценарий: имя берём из его профиля. */
export function registerActor(login: string, actor: Actor) { extraActors[login] = actor }

export const actorOf = (login: string): Actor => actors[login] ?? extraActors[login] ?? { name: login, role: '' }
export const isKnownActor = (login: string) => login in actors || login in extraActors
export const isBankActor = (login: string) => bankLogins.includes(login)

// ——— Статусы заявки ———

const rank: Record<string, number> = {
  DRAFT: 0, AWAITING_SIGNATURE: 1, SUBMITTED: 2, VALIDATION: 2, ENRICHMENT: 2, SCORING: 2,
  MANUAL_REVIEW: 3, INFO_REQUESTED: 3, COUNTER_OFFER: 4, APPROVED: 5, CONTRACT_SIGNED: 6, ISSUED: 7,
}
/** Заявка дошла до конца пути: новые прогоны сценария её не подхватывают. */
export const finalStatuses = ['ISSUED', 'REJECTED', 'CANCELLED', 'EXPIRED']
/** Автоматическая обработка: участнику остаётся подождать пару секунд. */
export const processingStatuses = ['SUBMITTED', 'VALIDATION', 'ENRICHMENT', 'SCORING', 'CONTRACT_SIGNED']
/** Заявка сошла с пути сценария — дальше по нему не пройти. */
export const deadStatuses = ['REJECTED', 'CANCELLED', 'EXPIRED']

const status = (f: Facts) => f.snapshot?.status ?? null
/** Докуда заявка дошла: после отказа или отмены — последний статус до них */
const reached = (f: Facts) => {
  const current = status(f)
  return current !== null && deadStatuses.includes(current) ? f.snapshot?.lastLive ?? null : current
}
const atLeast = (f: Facts, s: string) => {
  const current = reached(f)
  return current !== null && (rank[current] ?? -1) >= rank[s]
}
const created = (f: Facts) => !!f.appId && status(f) !== null
const is = (f: Facts, ...list: string[]) => list.includes(status(f) ?? '')

/** Андеррайтер одобрил, ждём второе одобрение риск-менеджера (как это узнаём — см. useScenarioTracking). */
export const riskPending = (f: Facts) => f.snapshot?.status === 'MANUAL_REVIEW' && !!f.snapshot.riskPending
/** Риск-менеджер вернул решение — андеррайтеру решать заново. */
export const riskReturned = (f: Facts) => f.snapshot?.status === 'MANUAL_REVIEW' && !!f.snapshot.returned
/** Заявку уже ведёт специалист — кнопки «Взять в работу» на карточке нет. */
const assigned = (f: Facts) => is(f, 'MANUAL_REVIEW') && !!f.snapshot?.assigned
/** Клиент ответил на запрос документов — заявка снова у специалиста. */
const docsReturned = (f: Facts) => !!f.snapshot?.everInfoRequested && atLeast(f, 'MANUAL_REVIEW') && !is(f, 'INFO_REQUESTED')

const processingWait = (f: Facts) =>
  is(f, ...processingStatuses.filter(s => s !== 'CONTRACT_SIGNED')) ? 'Банк обрабатывает заявку автоматически — пара секунд' : null

// ——— Экраны ———

const home = () => '/'
const offer = (f: Facts) => (f.offerId ? `/offer/${f.offerId}` : '/')
const clientApp = (f: Facts) => (f.appId ? `/applications/${f.appId}` : '/applications')
const bankApp = (f: Facts) => (f.appId ? `/bank/applications/${f.appId}` : '/bank')
const riskQueue = () => '/bank/risk'
/** Шаг клиента «анкета → предложение → заявка»: ведём туда, докуда он уже дошёл */
const clientFlow = (f: Facts) => (f.appId ? clientApp(f) : f.offerId ? offer(f) : home())
const offerFlow = (f: Facts) => (f.appId ? clientApp(f) : offer(f))
/** Экраны этого пути: анкета, предложение, заявка */
const onClientFlow = /^\/($|offer\/[^/]+$|applications\/[^/]+$)/
const onOfferFlow = /^\/(offer|applications)\/[^/]+$/

/** Короткое название экрана — для главной кнопки панели. */
export function screenOf(path: string) {
  if (path === '/') return 'Кредиты'
  if (/^\/offer\//.test(path)) return 'Предложение'
  if (/^\/applications\/./.test(path)) return 'Заявка'
  if (path === '/applications') return 'Мои заявки'
  if (/^\/bank\/applications\/./.test(path)) return 'Карточка заявки'
  return ({ '/bank': 'Очередь заявок', '/bank/risk': 'Согласования', '/bank/rules': 'Правила', '/bank/audit': 'Журнал аудита' } as Record<string, string>)[path] ?? 'Нужный экран'
}

/** Участник уже на экране шага. */
export const onSpot = (step: Step, f: Facts, pathname: string) => pathname === step.path(f) || !!step.at?.test(pathname)

// ——— Общие шаги банка ———

/** «Взять в работу» → …, а если заявку уже ведёт специалист (вернулась после запроса документов) — сразу к решению. */
const takeThen = (f: Facts, then: string) => (assigned(f) ? then[0].toUpperCase() + then.slice(1) : `«Взять в работу» → ${then}`)

const underwriterApprove = (id: string, why: string, bankNote?: string): Step => ({
  id, actor: 'uw1', title: 'Берёт в работу и одобряет', where: 'Кабинет банка → карточка заявки', path: bankApp, bankNote,
  todo: f => `${riskReturned(f) ? 'Риск-менеджер вернул решение на доработку. ' : ''}${takeThen(f, 'решение «Одобрить», комментарий → «Отправить на согласование».')} ${why}`,
  doneHint: n => `решение сохранено: заявка ждёт риск-менеджера (статус пока «${n.MANUAL_REVIEW}»)`,
  done: f => riskPending(f) || atLeast(f, 'COUNTER_OFFER'),
  waiting: f => processingWait(f) ?? (created(f) && atLeast(f, 'MANUAL_REVIEW') ? null : 'Заявка ещё не дошла до банка'),
})

const amountText = (kopecks: number) => `${new Intl.NumberFormat('ru-RU').format(Math.round(kopecks / 100))} ₽`

const riskApprove = (id: string, fallback: string): Step => ({
  // Ведём сразу в карточку заявки: там у риск-менеджера блок второго одобрения,
  // а в общем списке «Согласования» может быть много чужих заявок.
  id, actor: 'risk1', title: 'Даёт второе одобрение', where: 'Кабинет банка → карточка заявки',
  path: f => (f.appId ? `/bank/applications/${f.appId}` : riskQueue()),
  todo: f => {
    const amount = f.snapshot?.amountKopecks ? `, ${amountText(f.snapshot.amountKopecks)}` : ''
    return `${f.business ?? fallback}${amount}: в блоке «Решение по заявке» — комментарий → «Подтвердить решение». Все такие заявки — в разделе «Согласования».`
  },
  doneHint: n => `статус заявки — «${n.APPROVED}»`,
  done: f => atLeast(f, 'APPROVED'),
  waiting: f => (riskPending(f) ? null : 'Сначала андеррайтер должен одобрить заявку'),
})

const sign = (id: string, actor: string, note = ''): Step => ({
  id, actor, title: 'Подписывает договор', where: 'Заявка', path: clientApp,
  todo: `Код подтверждения 0000 → «Подписать договор». Деньги придут на счёт сами.${note}`,
  doneHint: n => `статус «${n.CONTRACT_SIGNED}», через секунду — «${n.ISSUED}»`,
  done: f => atLeast(f, 'CONTRACT_SIGNED'),
  waiting: f => (atLeast(f, 'APPROVED') ? null : 'Подписать можно после одобрения'),
})

const issued = (f: Facts) => is(f, 'ISSUED')

// ——— Сценарии ———

export const scenarios: Scenario[] = [
  {
    id: 'coffee', primary: true, tracksApplication: true,
    title: 'Кофейня: прогноз, овердрафт и выписка 1С',
    short: 'Главный сценарий: разрыв 12 ноября, автоодобрение, выписка из другого банка поднимает лимит с 270 до 360 тыс. ₽',
    finale: 'Деньги на счёте. Клиент сам увидел разрыв в прогнозе, получил решение за секунды и поднял лимит выпиской.',
    finished: issued,
    steps: [
      {
        id: 'calc', actor: 'p3b', title: 'Видит разрыв и считает овердрафт', where: 'Кредиты → прогноз и анкета', path: home,
        todo: 'Прогноз: 12 ноября не хватит денег. Анкета: «Закрыть кассовый разрыв», 340 000 ₽ на 12 мес. → «Рассчитать предложение».',
        doneHint: 'открылось предложение: овердрафт до 270 000 ₽',
        visit: /^\/offer\//, done: f => created(f),
      },
      {
        id: 'statement', actor: 'p3b', title: 'Загружает выписку и оформляет', where: 'Предложение', path: offerFlow, at: onOfferFlow, extra: 'statement',
        todo: 'В «Как получить больше» загрузите выписку 1С из другого банка (файл ниже) — лимит вырастет с 270 до 360 тыс. ₽. Затем «Оформить заявку».',
        doneHint: 'создана заявка и открылась её страница',
        done: f => created(f),
      },
      {
        id: 'submit', actor: 'p3b', title: 'Отправляет заявку', where: 'Заявка', path: clientApp,
        todo: '«Отправить заявку» — банк решает автоматически за несколько секунд, без специалиста.',
        doneHint: n => `статус заявки — «${n.APPROVED}»`,
        done: f => atLeast(f, 'APPROVED'),
        waiting: processingWait,
      },
      sign('sign', 'p3b'),
    ],
  },
  {
    id: 'chain', tracksApplication: true,
    title: 'Бухгалтер, директор и две подписи в банке',
    short: 'Бухгалтер по МЧД готовит заявку на 5,5 млн ₽, директор отправляет, банк одобряет в две подписи, директор подписывает',
    finale: 'Кредит выдан: заявку подготовил бухгалтер, отправил и подписал директор, решение — в две подписи банка.',
    finished: issued,
    steps: [
      {
        id: 'prepare', actor: 'p3a_acc', title: 'Готовит заявку за компанию', where: 'Анкета → предложение → заявка', path: clientFlow, at: onClientFlow,
        todo: 'Анкета: «Снизить платёж по кредиту», 5 500 000 ₽ на 48 мес., в «Расскажите больше» — «Больше в сезон» → «Рассчитать предложение» → «Подготовить заявку» → «Передать директору». Отправить в банк бухгалтер не может.',
        doneHint: n => `статус заявки «${n.AWAITING_SIGNATURE}» — директор видит её у себя`,
        done: f => atLeast(f, 'AWAITING_SIGNATURE'),
      },
      {
        id: 'submit', actor: 'p3a', title: 'Проверяет и отправляет', where: 'Заявка бухгалтера', path: clientApp,
        todo: 'Заявка, которую подготовил бухгалтер, → «Отправить заявку». Сумма больше 5 млн — решать будут андеррайтер и риск-менеджер.',
        doneHint: n => `статус «${n.MANUAL_REVIEW}»`,
        done: f => atLeast(f, 'SUBMITTED'),
      },
      underwriterApprove('underwriter', 'Сумма больше 5 млн — нужна вторая подпись.'),
      riskApprove('risk', 'ООО «СтройБаза»'),
      sign('sign', 'p3a', ' Бухгалтер подписать не может — только директор.'),
    ],
  },
  {
    id: 'documents', tracksApplication: true,
    title: 'Ручная проверка с документами',
    short: 'Специалист запрашивает документ, клиент прикладывает его в заявке, банк одобряет в две подписи',
    finale: 'Кредит выдан после ручной проверки: специалист запросил документ, клиент ответил прямо в кабинете.',
    finished: issued,
    steps: [
      {
        id: 'apply', actor: 'p2b', title: 'Подаёт заявку', where: 'Анкета → предложение → заявка', path: clientFlow, at: onClientFlow,
        todo: 'Анкета: «Оборудование или ремонт», 1 500 000 ₽ на 24 мес. → «Рассчитать предложение» (предварительно — решит специалист) → «Оформить заявку» → «Отправить заявку».',
        doneHint: n => `статус «${n.MANUAL_REVIEW}»`,
        done: f => atLeast(f, 'SUBMITTED'),
      },
      {
        id: 'request', actor: 'uw1', title: 'Запрашивает документы', where: 'Кабинет банка → карточка заявки', path: bankApp,
        todo: f => takeThen(f, 'решение «Запросить документы», в комментарии — что нужно (например, справку о погашении) → «Запросить документы».'),
        doneHint: n => `статус «${n.INFO_REQUESTED}»`,
        done: f => !!f.snapshot?.everInfoRequested || atLeast(f, 'COUNTER_OFFER'),
        waiting: f => processingWait(f) ?? (atLeast(f, 'MANUAL_REVIEW') ? null : 'Заявка ещё не дошла до банка'),
      },
      {
        id: 'upload', actor: 'p2b', title: 'Прикладывает документ', where: 'Заявка → «Банк просит документы»', path: clientApp,
        todo: '«Загрузить файл» — любой файл, например справку. Заявка сама вернётся специалисту, ответить можно и в чате.',
        doneHint: n => `статус снова «${n.MANUAL_REVIEW}»`,
        done: f => docsReturned(f) || atLeast(f, 'COUNTER_OFFER'),
        waiting: f => (is(f, 'INFO_REQUESTED') ? null : 'Банк ещё не запросил документы'),
      },
      underwriterApprove('underwriter', 'Были просрочки — одобрение специалиста подтверждает риск-менеджер.',
        'Класс риска D: одобрение вопреки скорингу — нужна вторая подпись риск-менеджера.'),
      riskApprove('risk', 'ИП Лебедева Ольга Викторовна'),
      sign('sign', 'p2b'),
    ],
  },
  {
    id: 'refinance', tracksApplication: true,
    title: 'Контрпредложение: рефинансирование',
    short: 'Просит 4 млн ₽ на закупку, но платежи уже около трети выручки → банк предлагает перенести кредит другого банка',
    finale: 'Вместо отказа — рефинансирование с меньшим платежом: клиент экономит каждый месяц.',
    finished: issued,
    steps: [
      {
        id: 'calc', actor: 'p1b', title: 'Просит новый кредит', where: 'Кредиты → анкета', path: home,
        todo: 'Анкета: «Закупка товара или сырья», 4 000 000 ₽ на 24 мес. → «Рассчитать предложение». Новых денег сейчас нет — банк объяснит почему и что предлагает взамен.',
        doneHint: 'открылось встречное предложение: рефинансирование кредита другого банка с меньшим платежом',
        visit: /^\/offer\//, done: f => created(f),
      },
      {
        id: 'apply', actor: 'p1b', title: 'Принимает рефинансирование', where: 'Предложение → заявка', path: offerFlow, at: onOfferFlow,
        todo: '«Рассчитать рефинансирование» → платёж ниже → «Оформить заявку» → «Отправить заявку».',
        doneHint: n => `статус «${n.MANUAL_REVIEW}» (сумма больше 5 млн)`,
        done: f => atLeast(f, 'SUBMITTED'),
      },
      underwriterApprove('underwriter', 'Сумма больше 5 млн — нужна вторая подпись.'),
      riskApprove('risk', 'ООО «Оптторг-Регион»'),
      sign('sign', 'p1b'),
    ],
  },
  {
    id: 'stop', tracksApplication: false,
    title: 'Отказ со стоп-фактором',
    short: 'Текущая просрочка в другом банке → отказ сразу на расчёте, с причиной и планом',
    finale: 'Отказ показан честно: причина словами и план «погасите просрочку — возвращайтесь». Баллы клиенту не показываем.',
    finished: f => f.marks.includes('calc'),
    steps: [
      {
        id: 'calc', actor: 'p_stop', title: 'Получает отказ с объяснением', where: 'Кредиты → анкета', path: home,
        todo: 'Анкета: «Другое», 800 000 ₽ на 12 мес. → «Рассчитать предложение». Отказ — сразу, заявку по такому расчёту оформить нельзя.',
        doneHint: 'открылся экран с причиной отказа и планом',
        visit: /^\/offer\//, done: () => false, manual: true,
      },
    ],
  },
  {
    id: 'rules', tracksApplication: false,
    title: 'Правила решения: прогон «было / стало»',
    short: 'Админ меняет веса и пороги как форму и видит эффект на тестовых клиентах до включения',
    finale: 'Правила — это данные, а не код: изменение проверяется на тестовых клиентах, каждое решение хранит версию правил.',
    finished: f => f.marks.includes('audit'),
    steps: [
      {
        id: 'simulate', actor: 'admin1', title: 'Прогоняет новые правила', where: 'Правила', path: () => '/bank/rules',
        todo: 'Поменяйте вес или порог в форме → «Проверить на клиентах» — таблица «было / стало» по всем тестовым клиентам. «Сохранить и включить версию…» меняет скоринг для всех — для показа не нужно.',
        doneHint: 'появилась таблица «было / стало»',
        done: () => false, manual: true,
      },
      {
        id: 'audit', actor: 'admin1', title: 'Смотрит журнал аудита', where: 'Журнал аудита', path: () => '/bank/audit',
        todo: 'Кто, что и когда менял: решения андеррайтеров, согласования риск-менеджера, версии правил.',
        doneHint: 'открыт журнал аудита',
        visit: /^\/bank\/audit/, done: () => false, manual: true,
      },
    ],
  },
]

export const findScenario = (id: string | null | undefined) => scenarios.find(s => s.id === id) ?? null

export const todoOf = (step: Step, f: Facts) => (typeof step.todo === 'function' ? step.todo(f) : step.todo)
export const doneHintOf = (step: Step, names: StatusNames) => (typeof step.doneHint === 'function' ? step.doneHint(names) : step.doneHint)

/** Все участники сценария в порядке появления. */
export const participantsOf = (s: Scenario) => [...new Set(s.steps.map(step => step.actor))]

/** ИНН бизнеса клиента сценария (у демо-персоны; у клиента из песочницы его узнаём из профиля при входе). */
export const innOf = (s: Scenario) => participantsOf(s).map(login => actors[login]?.inn).find(Boolean) ?? null

/** Клиент сценария, если он один, — его можно заменить своим клиентом из песочницы. */
export const clientActorOf = (s: Scenario) => {
  const clients = participantsOf(s).filter(login => !isBankActor(login))
  return clients.length === 1 ? clients[0] : null
}

/** Сценарий, в котором клиента играет другой пользователь (клиент песочницы). */
export function withClient(s: Scenario, login: string | null | undefined): Scenario {
  const original = clientActorOf(s)
  if (!login || !original || login === original) return s
  return { ...s, steps: s.steps.map(step => (step.actor === original ? { ...step, actor: login } : step)) }
}

/**
 * Выполнен ли каждый шаг. Шаг выполнен, если выполнено его условие, он отмечен,
 * или выполнен любой следующий шаг (заявка не ходит назад).
 */
export function progress(s: Scenario, f: Facts): boolean[] {
  const raw = s.steps.map(step => f.marks.includes(step.id) || step.done(f))
  const result = [...raw]
  for (let i = result.length - 2; i >= 0; i--) result[i] = result[i] || result[i + 1]
  if (s.finished(f)) return result.map(() => true)
  return result
}

/** Заявка сценария сошла с пути: отказ, отмена, истёк срок. */
export function derailed(s: Scenario, f: Facts): string | null {
  const current = f.snapshot?.status
  if (!s.tracksApplication || !current || !deadStatuses.includes(current)) return null
  return {
    REJECTED: 'Банк отказал по этой заявке — сценарий дальше не пройти.',
    CANCELLED: 'Заявка отменена — сценарий дальше не пройти.',
    EXPIRED: 'Срок предложения истёк — сценарий дальше не пройти.',
  }[current] ?? null
}
