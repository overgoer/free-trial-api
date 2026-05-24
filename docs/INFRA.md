# Infrastructure

## Servers

### Timeweb (85.193.81.51)

Сервер, на котором работает API.

| Параметр | Значение |
|----------|----------|
| IP | `85.193.81.51` |
| SSH | `ssh root@85.193.81.51 -p 2222` (через Amsterdam как прокси) |
| SSH proxy | `ssh -J root@77.73.135.110 root@85.193.81.51 -p 2222` |
| OS | Ubuntu 22.04 |
| Процессы | PM2: `free-trial-api` (id:1), `v0-test-api` (id:2) |

### Amsterdam (77.73.135.110)

Основной сервер для инфраструктуры и ботов.

| Параметр | Значение |
|----------|----------|
| IP | `77.73.135.110` |
| SSH | `ssh root@77.73.135.110` |
| OS | Ubuntu 22.04 |
| Nginx | Порт 8081 (VPN Monitor), 8082 (Dashboard), 8888 (Telegram proxy — Python) |
| PM2 | alvin-bot, api-practicum-bot, bsa-tg, fitmister, portmonet, amsterdeep-bot |

---

## eddytester API

| Ссылка | Описание |
|--------|----------|
| http://85.193.81.51:3001/ping | Health check |
| http://85.193.81.51:3001/stats | Статистика API (требует ключ) |
| http://85.193.81.51:3001/docs/v1 | Swagger UI — V1 (бажная версия) |
| http://85.193.81.51:3001/docs/v2 | Swagger UI — V2 (эталон) |
| http://77.73.135.110:8082/ | Dashboard (Chart.js, Dracula) |

### Endpoints API

#### V1 (бажная, 9 багов) — префикс `/free/v1/api/`

| Метод | Путь | Аутентификация |
|-------|------|---------------|
| POST | `/free/v1/api/keys` | Нет |
| POST | `/free/v1/api/users` | `X-Fix-Bug` |
| GET | `/free/v1/api/users` | `X-Fix-Bug` |
| GET | `/free/v1/api/users/:id` | `X-Fix-Bug` |
| PATCH | `/free/v1/api/users/:id` | `X-Fix-Bug` |
| DELETE | `/free/v1/api/users/:id` | `X-Fix-Bug` |

#### V2 (эталон) — префикс `/free/v2/api/`

Те же эндпоинты, но поведение корректное (валидация, правильные SQL-запросы, Content-Type).

#### Legacy — префикс `/free/api/`

Старые эндпоинты для обратной совместимости.

### API ключи

| Тип | Ключ | Срок |
|-----|------|------|
| Перманентный (тестовый) | `free-trial-permanent-33be59f62f921640941ed5e6296940f7426f68477e6e4632` | 2099-12-31 |
| Обычный | `free-trial-XXXXXXXX` | 24 часа |

---

## Postman

Коллекция на рабочем столе: `~/Desktop/Free Trial API.postman_collection.json`

Переменные:
- `base_url`: `http://85.193.81.51:3001`
- `api_key`: перманентный тестовый ключ

---

## GitHub

```
https://github.com/overgoer/free-trial-api
```

---

## Репозиторий: структура документации

| Файл | Описание |
|------|----------|
| `README.md` | Быстрый старт, список багов, сводка проблем |
| `docs/API_REFERENCE.md` | Спецификация API для тестировщиков (bug-blind) |
| `docs/openapi-v1.yaml` | OpenAPI 3.0 — V1 (корректное поведение) |
| `docs/openapi-v2.yaml` | OpenAPI 3.0 — V2 (корректное поведение) |
| `docs/dashboard.html` | Исходник дашборда (Chart.js, Dracula) |
| `docs/INFRA.md` | Инфраструктура, адреса, доступы (этот файл) |

---

## Мониторинг

- Dashboard: http://77.73.135.110:8082/ (обновляется каждые 30с)
- `/stats`: сырые данные в JSON
- Логи PM2: `pm2 logs free-trial-api`
- Логи ключей: `[API KEY USED]` в PM2 out-логах
