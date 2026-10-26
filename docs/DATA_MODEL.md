# Модель данных

Документ описывает фактическую модель демо-стенда. Источники правды — SQLAlchemy-модели в `backend/app/models/__init__.py` и миграции Alembic в `backend/alembic/versions/`.

Основная БД — PostgreSQL 16. SQLite поддерживается только для быстрой локальной разработки и части тестов.

## Основной кредитный процесс

```mermaid
erDiagram
  USERS {
    string id PK
    string login UK
    string role
  }
  BUSINESSES {
    string id PK
    string inn UK
    string ogrn UK
    string type
    string status
  }
  MEMBERSHIPS {
    string user_id PK,FK
    string business_id PK,FK
    string kind
    json permissions
  }
  CONSENTS {
    string id PK
    string business_id FK
    string user_id FK
    string kind
    datetime expires_at
  }
  DATA_SNAPSHOTS {
    string id PK
    string business_id FK
    string source
    json payload
    string status
  }
  STATEMENTS {
    string id PK
    string business_id FK
    string file_id
    date period_from
    date period_to
    json months
  }
  SEGMENTS {
    string id PK
    string business_id FK
    string code
    json flags
  }
  RULES {
    int version PK
    string author_id FK
    boolean active
    text yaml
  }
  PRE_OFFERS {
    string id PK
    string business_id FK
    int rules_version FK
    bigint limit_kopecks
    decimal rate
    datetime expires_at
  }
  APPLICATIONS {
    string id PK
    string business_id FK
    string pre_offer_id FK
    string created_by FK
    string assignee_id FK
    string status
    bigint amount_kopecks
  }
  STATUS_HISTORY {
    string id PK
    string application_id FK
    string actor_id FK
    string from_status
    string to_status
    datetime at
  }
  DECISIONS {
    string id PK
    string application_id FK
    int rules_version FK
    int score
    string cls
    bigint limit_kopecks
    decimal rate
    string outcome
  }
  APPROVALS {
    string id PK
    string decision_id FK
    string approver_id FK
    string level
    string result
  }
  CONTRACTS {
    string id PK
    string application_id UK,FK
    string signed_by FK
    datetime signed_at
    json schedule
  }

  USERS ||--o{ MEMBERSHIPS : participates
  BUSINESSES ||--o{ MEMBERSHIPS : has
  USERS ||--o{ CONSENTS : gives
  BUSINESSES ||--o{ CONSENTS : receives
  BUSINESSES ||--o{ DATA_SNAPSHOTS : has
  BUSINESSES ||--o{ STATEMENTS : uploads
  BUSINESSES ||--o{ SEGMENTS : classified_as
  USERS o|--o{ RULES : authors
  BUSINESSES ||--o{ PRE_OFFERS : receives
  RULES ||--o{ PRE_OFFERS : calculates
  BUSINESSES ||--o{ APPLICATIONS : submits
  PRE_OFFERS ||--o{ APPLICATIONS : becomes
  USERS ||--o{ APPLICATIONS : creates
  USERS o|--o{ APPLICATIONS : assigned_to
  APPLICATIONS ||--o{ STATUS_HISTORY : changes
  USERS o|--o{ STATUS_HISTORY : acts
  APPLICATIONS ||--o{ DECISIONS : gets
  RULES ||--o{ DECISIONS : fixes_version
  DECISIONS ||--o{ APPROVALS : reviewed_by
  USERS ||--o{ APPROVALS : approves
  APPLICATIONS ||--o| CONTRACTS : produces
  USERS ||--o{ CONTRACTS : signs
```

Главная цепочка данных: компания и пользователь дают согласия, система получает снимки источников и определяет сегмент, затем по версии правил создаёт предварительное предложение. Из предложения появляется заявка; все её переходы сохраняются в истории. Решение навсегда связано с использованной версией правил. Для крупных сумм к решению добавляются два уровня согласования, после одобрения создаётся один договор.

## Документы, общение и фоновые задачи

```mermaid
erDiagram
  USERS {
    string id PK
  }
  BUSINESSES {
    string id PK
  }
  APPLICATIONS {
    string id PK
  }
  FILES {
    string id PK
    string filename
    string content_type
    int size
    string sha256
    binary data
  }
  DOCUMENTS {
    string id PK
    string application_id FK
    string business_id FK
    string file_id
    string requested_by FK
    string uploaded_by FK
    string status
  }
  MESSAGES {
    string id PK
    string application_id FK
    string author_id FK
    string author_side
    datetime answer_due_at
  }
  NOTIFICATIONS {
    string id PK
    string user_id FK
    string application_id FK
    string kind
    string channel
    datetime read_at
  }
  AUDIT_LOG {
    string id PK
    string actor_id FK
    string entity
    string entity_id
    json before
    json after
  }
  OUTBOX {
    string id PK
    string event
    json payload
    string status
    int attempts
    datetime available_at
  }

  BUSINESSES o|--o{ DOCUMENTS : owns
  APPLICATIONS o|--o{ DOCUMENTS : requests
  USERS o|--o{ DOCUMENTS : handles
  FILES o|..o{ DOCUMENTS : referenced_by
  APPLICATIONS ||--o{ MESSAGES : contains
  USERS ||--o{ MESSAGES : writes
  APPLICATIONS o|--o{ NOTIFICATIONS : triggers
  USERS ||--o{ NOTIFICATIONS : receives
  USERS o|--o{ AUDIT_LOG : acts
  APPLICATIONS o|..o{ AUDIT_LOG : mentioned_in
  APPLICATIONS o|..o{ OUTBOX : mentioned_in
```

Пунктиром показаны логические связи без внешнего ключа. `documents.file_id` указывает на запись в `files`; `statements.file_id` хранит идентификатор загрузки выписки, но сам разобранный файл не связан с `files`. Поля `audit_log.entity_id` и идентификаторы внутри `outbox.payload` полиморфны. Целостность этих ссылок контролирует прикладной код.

## Назначение таблиц

| Таблица | Что хранит |
| --- | --- |
| `users` | Демо-пользователей и банковские роли. |
| `businesses` | ИП и ООО, их реквизиты и состояние регистрации. |
| `memberships` | Связь пользователя с бизнесом, вид полномочий и права МЧД. |
| `consents` | Согласия на запрос данных БКИ и ФНС со сроком действия. |
| `data_snapshots` | Неизменяемые снимки ответов Альфы, ФНС, БКИ, реестра и МЧД. |
| `statements` | Результат разбора выписки 1С по месяцам и ошибки проверки. |
| `segments` | Результаты сегментации компании и признаки, повлиявшие на сегмент. |
| `rules` | Версии YAML-правил; активная версия используется для новых расчётов. |
| `pre_offers` | Предварительный расчёт: продукт, срок, лимит, ставка, платёж и объяснение. |
| `applications` | Заявку, текущий статус, сумму, продукт, автора и назначенного сотрудника. |
| `status_history` | Полную историю переходов заявки с автором, временем и комментарием. |
| `decisions` | Внутренний результат скоринга, факторы, лимит, ставку, исход и версию правил. |
| `approvals` | Решения андеррайтера и риск-менеджера с обязательным комментарием. |
| `contracts` | Единственный подписанный договор по заявке и график платежей. |
| `files` | Бинарное содержимое файлов демо-стенда, метаданные и SHA-256. |
| `documents` | Документы бизнеса и документы, запрошенные в рамках заявки. |
| `messages` | Чат по заявке и контроль четырёх рабочих часов на ответ банка. |
| `notifications` | Внутренние уведомления и SMS-заглушки, связанные с пользователем и заявкой. |
| `audit_log` | Журнал действий с состоянием до и после изменения. |
| `outbox` | Очередь фоновых событий с числом попыток и временем следующей обработки. |

## Правила хранения

- Идентификаторы сущностей — UUID в строковом формате длиной 36 символов.
- Денежные значения хранятся целым числом копеек в `bigint`: например, `36 000 000` означает `360 000 ₽`.
- Ставки хранятся как `numeric(5,2)`, без вычислений через `float`.
- Временные отметки используют `timestamptz`; дата демо задаётся переменной `DEMO_TODAY`.
- Структурированные снимки, факторы, объяснения и графики хранятся в JSONB на PostgreSQL.
- `decisions.rules_version` фиксирует версию правил, поэтому публикация новых правил не меняет старые решения.
- Текущий статус находится в `applications.status`, а каждый переход добавляется в `status_history` в той же транзакции.
- Клиентский API не выдаёт `score`, класс риска, антифрод-признаки и внутренние пороги из `decisions`.
- `outbox` отделяет запись бизнес-события от фоновой обработки и позволяет повторять временно неудачные операции.

## Миграции и проверка

Схема создаётся последовательностью миграций Alembic:

1. `012d82640aae_initial_credit_schema.py` — основной кредитный процесс;
2. `7c1e5a2b9d40_chat_and_notifications.py` — чат и уведомления;
3. `9d2f4b7c1a3e_document_storage.py` — файлы и хранилище документов.

Применить миграции к указанной в `DATABASE_URL` базе:

```bash
cd backend
alembic upgrade head
```

Состояния и допустимые переходы описаны в [STATES.md](STATES.md), правила решения — в [DECISION_RULES.md](DECISION_RULES.md), границы компонентов — в [ARCHITECTURE.md](ARCHITECTURE.md).
