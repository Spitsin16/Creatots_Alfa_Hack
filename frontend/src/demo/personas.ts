import { request } from '../api'

// Демо-учётки — единый список для экрана входа и демо-панели.
// Источник фактов — data/personas/*.json и data/personas/bank_users.json (поля title, demo_note, scenario).
// Пароль у всех один, код подписи договора — 0000. Данные синтетические.

export const DEMO_PASSWORD = 'demo'
export const DEMO_SIGN_CODE = '0000'

export type PersonaGroup = 'client' | 'guest' | 'bank'
export type PersonaRole = 'CLIENT' | 'UNDERWRITER' | 'RISK_MANAGER' | 'RULES_ADMIN'

export type Persona = {
  login: string
  group: PersonaGroup
  /** Имя или фирма: «Иванов Артём», «ООО «СтройБаза»» */
  title: string
  /** Кто это: «Кофейня, ИП Иванов» */
  subtitle: string
  /** Что на нём показать — одна строка простым языком */
  scenario: string
  /** Короткая метка на карточке: ожидаемый исход для клиента, роль для сотрудника */
  badge: string
  /** Роль в системе; у гостя её нет — он не входит, а смотрит путь к кредиту */
  role: PersonaRole | null
  /** Главный сценарий демо — подсветить и выбрать по умолчанию */
  primary?: boolean
  /** Куда вести вместо входа (только гость) */
  path?: string
}

export const personas: Persona[] = [
  // ——— Клиенты Альфа-Банка ———
  {
    login: 'p3b', group: 'client', role: 'CLIENT', primary: true,
    title: 'Иванов Артём', subtitle: 'Кофейня, ИП Иванов · работает 8 месяцев',
    scenario: 'Прогноз: 12 ноября не хватит денег → овердрафт 270 тыс. ₽; с выпиской 1С из другого банка лимит вырастет до 360 тыс. ₽',
    badge: 'Главный сценарий',
  },
  {
    login: 'p1a', group: 'client', role: 'CLIENT',
    title: 'Морозова Анна', subtitle: 'Пекарня, ИП Морозова · кредит только в Альфе',
    scenario: 'Оборотный кредит 2 млн ₽ на закупку одобряется сразу; прогноз показывает просадку остатка 12 ноября (мука + зарплата)',
    badge: 'Одобрение',
  },
  {
    login: 'p1b', group: 'client', role: 'CLIENT',
    title: 'ООО «Оптторг-Регион»', subtitle: 'Оптовая торговля · кредиты в Альфе и в другом банке',
    scenario: 'Просит 4 млн ₽, но платежи по кредитам уже около трети выручки → контрпредложение: перенести кредит другого банка в Альфу с меньшим платежом',
    badge: 'Контрпредложение',
  },
  {
    login: 'p2a', group: 'client', role: 'CLIENT',
    title: 'Гаврилов Максим', subtitle: 'Автосервис, ИП Гаврилов · бывший заёмщик Альфы',
    scenario: '«С возвращением»: рефинансирование 1,4 млн ₽ из другого банка одобрено, платёж ниже; хорошая история погашений в Альфе идёт в плюс',
    badge: 'Рефинансирование',
  },
  {
    login: 'p2b', group: 'client', role: 'CLIENT',
    title: 'Лебедева Ольга', subtitle: 'Салон красоты, ИП Лебедева · были просрочки',
    scenario: 'Просрочки в прошлом (в Альфе и по карте другого банка) → ручная проверка: специалист запрашивает документы, клиент отвечает в чате',
    badge: 'Ручная проверка',
  },
  {
    login: 'p3a', group: 'client', role: 'CLIENT',
    title: 'ООО «СтройБаза»', subtitle: 'Стройматериалы · директор Орлов Сергей',
    scenario: 'Рефинансирование 5,5 млн ₽ с сезонным графиком; больше 5 млн — решают андеррайтер и риск-менеджер; директор отправляет заявку, которую подготовил бухгалтер',
    badge: 'Больше 5 млн',
  },
  {
    login: 'p3a_acc', group: 'client', role: 'CLIENT',
    title: 'Зайцева Марина', subtitle: 'Бухгалтер ООО «СтройБаза» по доверенности (МЧД)',
    scenario: 'Готовит заявку за компанию, но отправить и подписать не может — заявка ждёт подписи директора (вход p3a)',
    badge: 'По МЧД',
  },
  {
    login: 'p_stop', group: 'client', role: 'CLIENT',
    title: 'Ковалёв Денис', subtitle: 'Грузоперевозки, ИП Ковалёв · просрочка в другом банке',
    scenario: 'Текущая просрочка больше 30 дней → отказ сразу на расчёте, с объяснением и планом: погасите просрочку и возвращайтесь',
    badge: 'Отказ',
  },

  // ——— Ещё не клиент ———
  {
    login: 'guest', group: 'guest', role: null, path: '/login/guest',
    title: 'Новый предприниматель', subtitle: 'Нет счёта в Альфе',
    scenario: 'Как получить кредит без счёта: открыть счёт, проводить обороты, через 3 месяца — персональное предложение',
    badge: 'Не клиент',
  },

  // ——— Сотрудники банка ———
  {
    login: 'uw1', group: 'bank', role: 'UNDERWRITER',
    title: 'Смирнова Е.', subtitle: 'Андеррайтер',
    scenario: 'Очередь ручной проверки: взять заявку в работу, запросить документы, принять решение с кодом причины',
    badge: 'Андеррайтер',
  },
  {
    login: 'uw2', group: 'bank', role: 'UNDERWRITER',
    title: 'Петров К.', subtitle: 'Второй андеррайтер',
    scenario: 'Та же очередь глазами коллеги: видно, кто уже ведёт заявку',
    badge: 'Андеррайтер',
  },
  {
    login: 'risk1', group: 'bank', role: 'RISK_MANAGER',
    title: 'Волков А.', subtitle: 'Риск-менеджер',
    scenario: 'Второе одобрение: суммы больше 5 млн ₽ и решения вопреки скорингу',
    badge: 'Риск',
  },
  {
    login: 'admin1', group: 'bank', role: 'RULES_ADMIN',
    title: 'Ким Д.', subtitle: 'Администратор правил',
    scenario: 'Правила решения как форма: прогон «было / стало» на тестовых клиентах до включения, версии правил',
    badge: 'Правила',
  },
]

export const personaGroups: { key: PersonaGroup; title: string; note: string }[] = [
  { key: 'client', title: 'Клиенты Альфа-Банка', note: 'Есть расчётный счёт — данные о бизнесе уже в банке' },
  { key: 'guest', title: 'Ещё не клиент', note: 'Нет счёта в Альфе' },
  { key: 'bank', title: 'Сотрудники банка', note: 'Кабинет банка' },
]

export const personasOf = (group: PersonaGroup) => personas.filter(p => p.group === group)
export const findPersona = (login: string) => personas.find(p => p.login === login)

/** Название роли по-русски (для профиля в оболочке и карточек входа). */
export const roleTitle: Record<string, string> = {
  CLIENT: 'Клиент', UNDERWRITER: 'Андеррайтер', RISK_MANAGER: 'Риск-менеджер', RULES_ADMIN: 'Администратор правил',
}

// Вход по демо-логину: пароль у всех тестовых пользователей один. Возвращает токен для useAuth().login(token).
export async function demoLogin(login: string) {
  const data = await request<{ access_token: string }>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ login, password: DEMO_PASSWORD }) })
  return data.access_token
}
