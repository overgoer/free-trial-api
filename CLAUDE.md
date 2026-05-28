# Free Trial API — контекст

> Бесплатная входная точка в воронку API-тренажёра.
> Человек пробует → находит баги → покупает Practicum.

---

## Роль в воронке

```
Telegram @eddytester → Free Trial API (бесплатно, 24ч) → Practicum API (платно)
```

Каждый ответ Free Trial содержит поле `_upsell` со ссылкой на полную версию.

## Стек

Node.js + Express 5 + PostgreSQL (raw pg, без ORM).

## Сервер

`85.193.81.51:3001` — Timeweb, работает. Swagger документация.

## Эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| GET | /ping | Health check |
| POST | /free/api/keys | Получить trial-ключ на 24ч |
| POST | /free/api/users | Создать пользователя (x-fix-bug header) |
| GET | /free/api/users | Список пользователей (x-fix-bug header) |
| ALL | /balance-lab | Echo для отладки балансировщиков |

## Баги (намеренные, не чинить)

Free Trial содержит intentional bugs: слабые ключи (8 hex), `Content-Type: text/plain`, `limit` всегда 1, `sort` игнорируется, `status` case-sensitive, `age` без валидации, memory leak в rateLimitMap, хардкод кредов БД.

Подробно — в README.md этого репозитория.

## Запуск

```bash
npm install
# PostgreSQL нужен локально
node server.js    # порт 3001
```

## Аутентификация

Заголовок `x-fix-bug: <trial_key>` (нестандартный, так задумано).
Rate limit: 10 запр/мин на ключ.

## Бэклог — новые баги

Добавить в POST /free/api/users:

- ✅ Пустое имя проходит — name: "" создаёт пользователя вместо 400 Bad Request
- ✅ Нет required полей — если не передать name или age, падает 500 с стеком ошибки вместо 400
- ✅ Дубликаты пользователей — нет проверки, можно создать двух одинаковых Alice
- ✅ Error message наружу — при ошибке БД текст запроса сыпется в ответ (утечка схемы)
