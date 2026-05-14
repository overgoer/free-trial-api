# Free Trial API

Учебное Express.js API с системой бесплатных пробных ключей, rate limiting и намеренно внедрёнными багами для отладки.

## Что это

Тренировочный проект — REST API на Node.js + Express + PostgreSQL.
Выдаёт trial-ключи на 24 часа, позволяет создавать и читать пользователей,
а также содержит endpoint для тестирования балансировщиков нагрузки.
Весь код намеренно содержит баги — найди и исправь.

## Быстрый старт

```bash
# 1. Установить зависимости
npm install

# 2. PostgreSQL должен быть запущен локально
#    База: postgres, пользователь: postgres, пароль: postgres, порт: 5432
#    [ISSUE] Креды захардкожены в server.js — вынести в переменные окружения

# 3. Создать таблицы (скрипта миграции нет — команды вручную)
psql -U postgres -d postgres <<SQL
CREATE TABLE IF NOT EXISTS free_api_keys (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS free_users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  age INTEGER NOT NULL,
  api_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
SQL
#    [ISSUE] Нет миграционного файла — схема БД существует только в голове разработчика

# 4. Запустить
node server.js
# → Free Trial API running on port 3001
```

## Endpoints

### `GET /ping`

Проверка живости сервера.

```bash
curl -s http://localhost:3001/ping | jq
```

```json
{
  "status": "ok",
  "timestamp": "2026-05-13T10:00:00.000Z",
  "_upsell": "Find bugs? Full version has 20 → https://t.me/api_practicum_bot"
}
```

---

### `POST /free/api/keys`

Получить бесплатный trial API-ключ (действует 24 часа). Аутентификация не требуется.

```bash
curl -s -X POST http://localhost:3001/free/api/keys | jq
```

```json
{
  "key": "free-trial-a1b2c3d4",
  "expires_at": "2026-05-14T10:00:00.000Z",
  "_upsell": "..."
}
```

[ISSUE] `generateApiKey()` использует только первые 8 hex-символов UUID (32 бита энтропии) — ключи предсказуемы и брутфорсятся.
[SUGGEST] Использовать `crypto.randomUUID()` или полный UUID v4.

---

### `POST /free/api/users`

Создать пользователя. Требует trial-ключ в заголовке `x-fix-bug`.

```bash
# Сохрани ключ
KEY=$(curl -s -X POST http://localhost:3001/free/api/keys | jq -r .key)

# Создать пользователя
curl -s -X POST http://localhost:3001/free/api/users \
  -H "x-fix-bug: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "age": 30}' | jq
```

```json
{
  "user": {
    "id": 1,
    "name": "Alice",
    "age": 30,
    "api_key": "free-trial-xxxxxxxx",
    "created_at": "2026-05-13T10:00:00.000Z"
  },
  "_upsell": "..."
}
```

[ISSUE] Заголовок аутентификации называется `x-fix-bug` вместо стандартного `Authorization` или `x-api-key`.
[ISSUE] `age` не валидируется на тип (строка "abc" пройдёт в БД как 0) и на разумные границы (отрицательные, >150).
[QUESTION] Поле `api_key` в ответе создания пользователя — это API-ключ *пользователя* или дубликат trial-ключа? По коду это новый `generateApiKey()` — зачем пользователю отдельный ключ?

---

### `GET /free/api/users`

Список пользователей. Требует trial-ключ в заголовке `x-fix-bug`.

```bash
curl -s http://localhost:3001/free/api/users \
  -H "x-fix-bug: $KEY" | jq
```

**Известные баги этого endpoint (помечены в коде как Bug 1–4):**

#### Bug 1 — `sort` игнорируется
Параметр `sort` принимается, но сортировка всегда по `name` по возрастанию.

```bash
# Ожидаешь сортировку по id? Получишь по имени.
curl -s "http://localhost:3001/free/api/users?sort=id" \
  -H "x-fix-bug: $KEY" | jq
```

[ISSUE] `users.sort((a, b) => a.name.localeCompare(b.name))` безусловно перезаписывает любую сортировку из БД.

#### Bug 2 — `limit` всегда возвращает 1 запись
Любое ненулевое значение `limit` обрезает ответ до одного элемента.

```bash
# Ожидаешь 5 записей? Получишь 1.
curl -s "http://localhost:3001/free/api/users?limit=5" \
  -H "x-fix-bug: $KEY" | jq
```

[ISSUE] `users.slice(0, 1)` — жёстко зашитый лимит, игнорирует переданное значение.

#### Bug 3+4 — `status` чувствителен к регистру и валидирует жёстко
Фильтр `status` вычисляет статус по возрасту:
- 0–17 → `"minor"`
- 18–65 → `"candidate"`
- 66+ → `"retired"`

Но сравнение регистрозависимое — `Status=Minor` не сработает.

```bash
# Работает
curl -s "http://localhost:3001/free/api/users?status=minor" \
  -H "x-fix-bug: $KEY" | jq

# Не работает — регистр
curl -s "http://localhost:3001/free/api/users?status=Minor" \
  -H "x-fix-bug: $KEY" | jq
```

[ISSUE] Фильтр `status` case-sensitive — `"Minor"`, `"MINOR"`, `"Candidate"` не матчатся.
[SUGGEST] Приводить и входной параметр, и computed status к нижнему регистру перед сравнением.

#### Bug 5 — `Content-Type: text/plain`
Ответ приходит с заголовком `Content-Type: text/plain` вместо `application/json`.

```bash
curl -sI "http://localhost:3001/free/api/users" \
  -H "x-fix-bug: $KEY"
# content-type: text/plain   ← баг
```

[ISSUE] `res.setHeader("Content-Type", "text/plain")` — клиенты, полагающиеся на Content-Type (например, `fetch().json()`), сломаются.

---

### `ALL /balance-lab`

Echo endpoint для отладки балансировщиков нагрузки и прокси. Возвращает заголовки запроса, IP и method.

```bash
curl -s http://localhost:3001/balance-lab | jq

# С кастомным Host-заголовком
curl -s -H "Host: custom.example.com" http://localhost:3001/balance-lab | jq .your_host
```

```json
{
  "service": "free-trial-api",
  "your_host": "custom.example.com",
  "your_method": "GET",
  "your_ip": "::1",
  "x_forwarded_host": "(none)",
  "x_forwarded_for": "(none)",
  "x_real_ip": "(none)",
  "all_request_headers": { ... },
  "hint": "Try changing the Host header and see what changes",
  "_upsell": "..."
}
```

---

## Rate Limiting

10 запросов в минуту на один trial-ключ. При превышении — `429 Too Many Requests`.

```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "x-fix-bug: $KEY" \
    http://localhost:3001/free/api/users
done
# 200 ... 200 (×10), затем 429
```

[ISSUE] `rateLimitMap` никогда не очищается от просроченных ключей — memory leak при долгой работе.
[SUGGEST] Добавить периодическую очистку или использовать `setTimeout` для удаления записей по TTL.

---

## Сводка проблем

| # | Серьёзность | Описание | Файл |
|---|------------|----------|------|
| 1 | 🔴 High | Хардкод кредов БД (`postgres:postgres`) | server.js |
| 2 | 🔴 High | Слабые API-ключи (8 hex → 32 бита) | middleware.js |
| 3 | 🟡 Medium | Заголовок аутентификации `x-fix-bug` вместо стандартного | middleware.js |
| 4 | 🟡 Medium | `Content-Type: text/plain` на JSON-ответе | server.js |
| 5 | 🟡 Medium | `limit` всегда возвращает 1 запись | server.js |
| 6 | 🟡 Medium | `sort` игнорируется, всегда по имени | server.js |
| 7 | 🟡 Medium | `status` фильтр case-sensitive | server.js |
| 8 | 🟡 Medium | `age` не валидируется (тип + границы) | server.js |
| 9 | 🟡 Medium | Memory leak в `rateLimitMap` | middleware.js |
| 10 | 🟢 Low | Нет миграций БД | — |
| 11 | 🟢 Low | `cors()` без ограничений (open bar) | server.js |
| 12 | 🟢 Low | Нет обработки падения PostgreSQL | server.js |
| 13 | 🟢 Low | Нет очистки просроченных ключей/пользователей | — |

## Стек

- Node.js + Express 5
- PostgreSQL (pg)
- UUID v4
- CORS
