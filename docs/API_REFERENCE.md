# eddytester API — Testing Reference

**Base URL:** `http://85.193.81.51:3001`
**API prefix:** `/free/v1/api/`

> This document describes the API specification. All endpoints listed below define the expected behavior. Use this as your reference when writing and running tests.

---

## Authentication

All endpoints except key creation require an API key.

**Header:** `X-Fix-Bug: <your-api-key>`

**Expected behavior:**
- Without a valid key → `401 Unauthorized`
- With an expired key → `403 Forbidden`
- With a valid key → request proceeds

---

## 1. Create API Key

Creates a new API key valid for 24 hours.

```
POST /free/v1/api/keys
```

**Request:** no body required

**Expected response (201):**

```json
{
  "key": "free-trial-1a2b3c4d",
  "expires_at": "2026-05-25T12:00:00.000Z",
  "_upsell": "Find bugs? Full version has 20 → https://t.me/api_practicum_bot"
}
```

**Status codes:** `201` — created

---

## 2. Create User

Creates a new user record.

```
POST /free/v1/api/users
```

**Headers:** `X-Fix-Bug`, `Content-Type: application/json`

**Request body:**

```json
{
  "name": "Alice",
  "age": 25
}
```

**Validation rules:**
| Field  | Required | Constraints                        |
|--------|----------|------------------------------------|
| `name` | yes      | Must be non-empty, trimmed         |
| `age`  | yes      | Must be an integer between **18 and 65** inclusive |

**Expected response (201):**

```json
{
  "user": {
    "id": 42,
    "name": "Alice",
    "age": 25,
    "created_at": "2026-05-24T12:00:00.000Z"
  },
  "_upsell": "Find bugs? Full version has 20 → https://t.me/api_practicum_bot"
}
```

**Status codes:**
- `201` — user created
- `400` — validation error (invalid age, empty name)
- `401` — missing/invalid API key
- `429` — rate limit exceeded

---

## 3. List Users

Returns a list of all users.

```
GET /free/v1/api/users
```

**Query parameters:**

| Parameter | Type   | Required | Description                                          |
|-----------|--------|----------|------------------------------------------------------|
| `limit`   | number | no       | Maximum number of users to return. Must be positive. |

**Headers:** `X-Fix-Bug`

**Expected response (200):** `Content-Type: application/json`

```json
{
  "users": [
    {
      "id": 42,
      "name": "Alice",
      "age": 25,
      "created_at": "2026-05-24T12:00:00.000Z"
    }
  ],
  "_upsell": "Find bugs? Full version has 20 → https://t.me/api_practicum_bot"
}
```

**Notes on `limit`:**
- If `limit=3`, exactly 3 users should be returned (or fewer if not enough exist)
- If `limit` is omitted, all users are returned
- `limit` should not cap to any fixed number

**Status codes:**
- `200` — success (always JSON array in `users` field)
- `401` — missing/invalid API key
- `429` — rate limit exceeded

---

## 4. Get User by ID

Returns a single user by their ID.

```
GET /free/v1/api/users/:id
```

**Headers:** `X-Fix-Bug`

**Expected behavior:**
- Requesting `GET /users/5` must return the user whose `id = 5`
- If no user exists with that ID, return `404 Not Found`

**Expected response (200):**

```json
{
  "user": {
    "id": 5,
    "name": "Alice",
    "age": 25
  },
  "_upsell": "Find bugs? Full version has 20 → https://t.me/api_practicum_bot"
}
```

**Status codes:**
- `200` — user found
- `400` — invalid ID (zero, negative, non-numeric)
- `401` — missing/invalid API key
- `404` — user not found

---

## 5. Update User

Updates an existing user's name and/or age.

```
PATCH /free/v1/api/users/:id
```

**Headers:** `X-Fix-Bug`, `Content-Type: application/json`

**Request body:**

```json
{
  "name": "Alice Updated",
  "age": 30
}
```

Both fields are optional — only provided fields are updated.

**Validation rules:**
| Field  | Constraints                                              |
|--------|----------------------------------------------------------|
| `name` | If provided, must be a non-empty string, trimmed         |
| `age`  | If provided, must be an integer between **18 and 65** inclusive |

**Expected responses:**

- **200** — updated successfully:

```json
{
  "user": {
    "id": 5,
    "name": "Alice Updated",
    "age": 30
  },
  "_upsell": "Find bugs? Full version has 20 → https://t.me/api_practicum_bot"
}
```

- **400** — validation error (empty name, invalid age)
- **401** — missing/invalid API key
- **404** — user not found
- **429** — rate limit exceeded

---

## 6. Delete User

Deletes a user by their ID.

```
DELETE /free/v1/api/users/:id
```

**Headers:** `X-Fix-Bug`

**Expected behavior:**
- Deletes **only** the user with the specified ID
- Other users must remain untouched

**Expected responses:**

- **200** — deleted successfully:

```json
{
  "message": "Deleted 1 user",
  "user": "Alice",
  "_upsell": "Find bugs? Full version has 20 → https://t.me/api_practicum_bot"
}
```

- **400** — invalid ID (zero, negative, non-numeric)
- **401** — missing/invalid API key
- **404** — user not found

---

## Non-API Endpoints

### Health Check

```
GET /ping
```

**Expected response (200):**

```json
{
  "status": "ok",
  "timestamp": "2026-05-24T12:00:00.000Z",
  "version": "v1+v2",
  "_upsell": "Find bugs? Full version has 20 → https://t.me/api_practicum_bot"
}
```

### Balance Lab

```
GET /balance-lab
```

Returns diagnostic information about your request. Does not require authentication.

---

## Rate Limiting

- **Limit:** 10 requests per minute per API key
- **Exceeded:** `429 Too Many Requests`
- The counter resets every minute automatically

---

## Summary of Status Codes

| Code | Meaning              |
|------|----------------------|
| 200  | Success              |
| 201  | Created              |
| 400  | Validation error     |
| 401  | Missing/invalid key  |
| 403  | Key expired          |
| 404  | Not found            |
| 429  | Rate limit exceeded  |
| 500  | Internal server error |

---

*This document describes the expected API behavior. Any deviation from these specifications during testing should be reported.*
