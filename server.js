const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const yaml = require("js-yaml");
const swaggerUi = require("swagger-ui-express");
const { SwaggerTheme, SwaggerThemeNameEnum } = require("swagger-themes");
const { rateLimitFree, generateApiKey, validateFreeApiKey } = require("./middleware");

const app = express();
const PORT = 3001;

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "postgres",
  password: "postgres",
  port: 5432,
});

app.use(cors());
app.use(express.json());

// ─── Stats logger ──────────────────────────────────────────

const PERMANENT_KEY = "free-trial-permanent-33be59f62f921640941ed5e6296940f7426f68477e6e4632";

app.use((req, res, next) => {
  res.on("finish", () => {
    const p = req.path;
    if (p.startsWith("/stats") || p.startsWith("/docs") || p === "/ping" || p === "/balance-lab") return;
    const key = req.headers["x-fix-bug"] || "";
    const hash = key ? crypto.createHash("md5").update(key).digest("hex").substring(0, 8) : null;
    pool.query(
      "INSERT INTO request_logs (endpoint, method, status_code, api_key_hash) VALUES ($1, $2, $3, $4)",
      [p, req.method, res.statusCode, hash]
    ).catch(() => {});
  });
  next();
});

const UPSELL = { _upsell: "Полная версия — 48 багов, 19 уроков → https://eddytester.com/trial" };

// ─── Helpers ─────────────────────────────────────────────
function computeStatus(age) {
  if (age >= 0 && age <= 17) return "minor";
  if (age <= 65) return "candidate";
  return "retired";
}

// ===================================================================
//  LEGACY ROUTES (keep for backward compat)
// ===================================================================
app.post("/free/api/keys", async (req, res) => {
  try {
    const key = generateApiKey();
    const result = await pool.query(
      "INSERT INTO free_api_keys (key, expires_at) VALUES ($1, NOW() + INTERVAL '24 hours') RETURNING key, created_at, expires_at",
      [key]
    );
    res.status(201).json({ key: result.rows[0].key, expires_at: result.rows[0].expires_at, ...UPSELL });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error", ...UPSELL });
  }
});

app.post("/free/api/users", validateFreeApiKey(pool), rateLimitFree, async (req, res) => {
  try {
    const { name, age } = req.body;

    // BUG 1: проверка только на undefined — name: "" проходит как валидный
    if (name === undefined) return res.status(400).json({ error: "Name is required", ...UPSELL });

    // BUG 2: age не валидируется — undefined/некорректное age летит в БД,
    //        PostgreSQL падает с 500 вместо 400 Bad Request

    // BUG 5: нет unique constraint на name+api_key — дубликаты Alice создаются без ошибки

    const result = await pool.query(
      "INSERT INTO free_users (name, age, api_key) VALUES ($1, $2, $3) RETURNING id, name, age, api_key, created_at",
      [name, age, req.headers["x-fix-bug"]]
    );
    res.status(201).json({ user: result.rows[0], ...UPSELL });
  } catch (err) {
    console.error(err.message);
    // BUG 6: сообщение об ошибке PostgreSQL (схема, SQL-запрос) утекает клиенту
    res.status(500).json({ error: err.message, ...UPSELL });
  }
});

app.get("/free/api/users", validateFreeApiKey(pool), rateLimitFree, async (req, res) => {
  try {
    const { sort, limit, status } = req.query;
    let result = await pool.query("SELECT id, name, age, created_at FROM free_users WHERE api_key = $1 ORDER BY id", [req.headers["x-fix-bug"]]);
    let users = result.rows;
    users.sort((a, b) => a.name.localeCompare(b.name));
    if (status !== undefined) users = users.filter(u => computeStatus(u.age) === status);
    if (limit !== undefined) users = users.slice(0, 1);
    res.setHeader("Content-Type", "text/plain");
    res.status(200).send(JSON.stringify({ users, ...UPSELL }));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error", ...UPSELL });
  }
});

// ===================================================================
//  V1 — BUGGY VERSION (9 bugs across 5 endpoints)
// ===================================================================

// ─── Продление триала за email ───────────────────────────
const nodemailer = require("nodemailer");
const MAIL_USER = process.env.YANDEX_USER || "api.practicum@mail.ru";
const MAIL_PASS = process.env.YANDEX_PASS || "gdh2eRXXWPMOYn3YY5Bb";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const transporter = nodemailer.createTransport({
  host: "smtp.mail.ru", port: 465, secure: true,
  auth: { user: MAIL_USER, pass: MAIL_PASS },
});

app.post("/free/api/extend", async (req, res) => {
  // только лендинг имеет право дёргать продление
  const origin = req.headers.origin || "";
  if (origin && !origin.includes("eddytester.com")) {
    return res.status(403).json({ error: "Forbidden", ...UPSELL });
  }
  const email = (req.body && req.body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Нужен корректный email", ...UPSELL });
  }
  try {
    const used = await pool.query("SELECT 1 FROM free_trial_emails WHERE email = $1", [email]);
    if (used.rowCount > 0) {
      return res.status(200).json({
        error: "Этот email уже получал продление",
        _upsell: "Полная версия — 48 багов, 19 уроков → https://eddytester.com",
      });
    }
    const key = generateApiKey();
    await pool.query(
      "INSERT INTO free_trial_emails (email, key, created_at, expires_at) VALUES ($1, $2, NOW(), NOW() + INTERVAL '48 hours')",
      [email, key]
    );
    try {
      await transporter.sendMail({
        from: '"API Практикум" <api.practicum@mail.ru>',
        to: email,
        subject: "Твой ключ на +48 часов",
        text: "Ключ: " + key + "\n\nОн работает 48 часов. Документация и старт: https://eddytester.com/trial\n\nНашёл баги? Полная версия — 48 багов, 19 уроков: https://eddytester.com",
      });
    } catch (mailErr) {
      console.error("extend mail error:", mailErr.message);
    }
    res.status(201).json({ key, expires_at: null, extended: true, ...UPSELL });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error", ...UPSELL });
  }
});

// ─── Мини-урок: эталон багов и вердикт ───────────────────
const TRIAL_BUGS = {
  "age17":     { name: "Возраст 17 принимается", method: "POST /users" },
  "notrim":    { name: "Имя не обрезается от пробелов", method: "POST /users" },
  "nolimit":   { name: "Нет ограничения длины имени", method: "POST /users" },
  "limit1":    { name: "Лимит всегда отдаёт одну запись", method: "GET /users" },
  "content":   { name: "Content-Type: text/plain вместо JSON", method: "GET /users" },
  "idminus":   { name: "GET /users/2 возвращает пользователя с id=1", method: "GET /users/:id" },
  "crash500":  { name: "Некорректный id роняет сервер с 500", method: "GET /users/:id" },
};
const TRIAL_METHODS = ["POST /users", "GET /users", "GET /users/:id"];
const TRIAL_TOTAL = Object.keys(TRIAL_BUGS).length;

function originAllowed(req) {
  const origin = req.headers.origin || "";
  return !origin || origin.includes("eddytester.com");
}

app.get("/free/api/progress", validateFreeApiKey(pool), async (req, res) => {
  try {
    const key = req.headers["x-fix-bug"];
    const r = await pool.query("SELECT found_bugs FROM free_progress WHERE api_key = $1", [key]);
    const found = r.rows.length ? (r.rows[0].found_bugs || []) : [];
    res.json({ found, total: TRIAL_TOTAL, ...UPSELL });
  } catch (err) {
    res.status(500).json({ error: "Internal server error", ...UPSELL });
  }
});

app.post("/free/api/progress", validateFreeApiKey(pool), rateLimitFree, async (req, res) => {
  if (!originAllowed(req)) {
    return res.status(403).json({ error: "Forbidden", ...UPSELL });
  }
  const resetMethod = req.body && req.body.reset_method;
  const selected = Array.isArray(req.body && req.body.selected) ? req.body.selected : [];
  const key = req.headers["x-fix-bug"];
  if (resetMethod && TRIAL_METHODS.includes(resetMethod)) {
    const prev = await pool.query("SELECT found_bugs FROM free_progress WHERE api_key = $1", [key]);
    const keep = (prev.rows.length ? prev.rows[0].found_bugs || [] : [])
      .filter((bid) => TRIAL_BUGS[bid] && TRIAL_BUGS[bid].method !== resetMethod);
    await pool.query(
      "INSERT INTO free_progress (api_key, found_bugs) VALUES ($1, $2) ON CONFLICT (api_key) DO UPDATE SET found_bugs = EXCLUDED.found_bugs",
      [key, JSON.stringify(keep)]
    );
    return res.json({ found: keep, total: TRIAL_TOTAL, ...UPSELL });
  }
  const verdict = selected.map((bid) => ({
    bug_id: bid,
    is_bug: !!TRIAL_BUGS[bid],
    name: TRIAL_BUGS[bid] ? TRIAL_BUGS[bid].name : null,
  }));
  const correct = verdict.filter((v) => v.is_bug).map((v) => v.bug_id);
  const wrong = verdict.filter((v) => !v.is_bug).map((v) => v.bug_id);
  const prev = await pool.query("SELECT found_bugs FROM free_progress WHERE api_key = $1", [key]);
  const merged = Array.from(new Set([...(prev.rows.length ? prev.rows[0].found_bugs || [] : []), ...correct]));
  await pool.query(
    "INSERT INTO free_progress (api_key, found_bugs) VALUES ($1, $2) ON CONFLICT (api_key) DO UPDATE SET found_bugs = EXCLUDED.found_bugs",
    [key, JSON.stringify(merged)]
  );
  res.json({ verdict, found: merged, wrong, total: TRIAL_TOTAL, ...UPSELL });
});

app.post("/free/v1/api/keys", async (req, res) => {
  try {
    const key = generateApiKey();
    const result = await pool.query(
      "INSERT INTO free_api_keys (key, expires_at) VALUES ($1, NOW() + INTERVAL '24 hours') RETURNING key, created_at, expires_at",
      [key]
    );
    res.status(201).json({ key: result.rows[0].key, expires_at: result.rows[0].expires_at, ...UPSELL });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error", ...UPSELL });
  }
});

// ── V1 POST /users ───────────────────────────────────────
// Bugs: [1] age < 18 accepted  [2] name not trimmed  [3] no name length limit
app.post("/free/v1/api/users", validateFreeApiKey(pool), rateLimitFree, async (req, res) => {
  try {
    const { name, age } = req.body;
    if (!name || name === "") return res.status(400).json({ error: "Name is required", ...UPSELL });
    if (age === undefined || age === null) return res.status(400).json({ error: "Age is required", ...UPSELL });

    // BUG 1: no lower age limit — age 17 is accepted
    // BUG 2: name not trimmed — "  Alice  " stored with spaces
    // BUG 3: no max length on name

    const result = await pool.query(
      "INSERT INTO free_users (name, age, api_key) VALUES ($1, $2, $3) RETURNING id, name, age, created_at",
      [name, Number(age), req.headers["x-fix-bug"]]
    );

    res.status(201).json({ user: result.rows[0], ...UPSELL });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error", ...UPSELL });
  }
});

// ── V1 GET /users ────────────────────────────────────────
// Bugs: [3] limit → 1 record  [4] Content-Type text/plain
app.get("/free/v1/api/users", validateFreeApiKey(pool), rateLimitFree, async (req, res) => {
  try {
    const { limit } = req.query;
    let result = await pool.query("SELECT id, name, age, created_at FROM free_users WHERE api_key = $1 ORDER BY id", [req.headers["x-fix-bug"]]);
    let users = result.rows;

    // BUG 3: limit always caps at 1 record, regardless of value
    if (limit !== undefined) {
      users = users.slice(0, 1);
    }

    // BUG 4: Content-Type is text/plain instead of application/json
    res.setHeader("Content-Type", "text/plain");
    res.status(200).send(JSON.stringify({ users, ...UPSELL }));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error", ...UPSELL });
  }
});

// ── V1 GET /users/:id ────────────────────────────────────
// Bugs: [5] queries id-1  [6] id≤0 or NaN → crash 500 (secretka)
app.get("/free/v1/api/users/:id", validateFreeApiKey(pool), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    // BUG 5: queries id-1 instead of id. GET /users/2 returns user with id=1
    // BUG 6: if id=0 → -1. if NaN → NaN-1=NaN. Both return no rows.
    //         Accessing rows[0].name on undefined → crash 500 with leaked error
    const result = await pool.query("SELECT id, name, age, created_at FROM free_users WHERE id = $1 AND api_key = $2", [id - 1, req.headers["x-fix-bug"]]);

    // BUG 6 (continued): no guard for missing row → crash on .name of undefined
    const user = result.rows[0];
    res.json({ user: { id: user.id, name: user.name, age: user.age }, ...UPSELL });
  } catch (err) {
    console.error("GET /:id error:", err.message);
    res.status(500).json({ error: "Database error: " + err.message, ...UPSELL });
  }
});

// ── V1 PATCH /users/:id ──────────────────────────────────
// Bugs: [7] no name validation (empty name accepted)  [8] negative age → 500 with fake error
app.patch("/free/v1/api/users/:id", validateFreeApiKey(pool), rateLimitFree, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, age } = req.body;

    // BUG 7: no validation on name — empty string or whitespace-only accepted
    // BUG 8: negative age throws a dramatic fake database error
    if (age !== undefined && Number(age) < 0) {
      throw new Error("Fatal error: Database connection lost. Please try again later.");
    }

    const result = await pool.query(
      "UPDATE free_users SET name = COALESCE($1, name), age = COALESCE($2, age) WHERE id = $3 AND api_key = $4 RETURNING id, name, age",
      [name !== undefined ? name : null, age !== undefined ? Number(age) : null, id, req.headers["x-fix-bug"]]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({ message: "User not found", ...UPSELL });
    }

    res.json({ user: result.rows[0], ...UPSELL });
  } catch (err) {
    console.error("PATCH error:", err.message);
    res.status(500).json({ error: err.message, ...UPSELL });
  }
});

// ── V1 DELETE /users/:id ─────────────────────────────────
// Bug [9]: DELETE without WHERE — удаляет ВСЕХ пользователей
app.delete("/free/v1/api/users/:id", validateFreeApiKey(pool), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    // BUG 9: забыли WHERE id = $1 — удаляются все строки пользователя
    const result = await pool.query("DELETE FROM free_users WHERE api_key = $1 RETURNING id, name", [req.headers["x-fix-bug"]]);

    if (result.rows.length === 0) {
      return res.status(200).json({ message: "Deleted 0 users", ...UPSELL });
    }

    res.json({ message: "Deleted " + result.rows.length + " user(s)", user: result.rows[0].name, ...UPSELL });
  } catch (err) {
    console.error("DELETE error:", err.message);
    res.status(500).json({ error: "Internal server error", ...UPSELL });
  }
});

// ===================================================================
//  V2 — FIXED VERSION (reference implementation)
// ===================================================================

app.post("/free/v2/api/keys", async (req, res) => {
  try {
    const key = generateApiKey();
    const result = await pool.query(
      "INSERT INTO free_api_keys (key, expires_at) VALUES ($1, NOW() + INTERVAL '24 hours') RETURNING key, created_at, expires_at",
      [key]
    );
    res.status(201).json({ key: result.rows[0].key, expires_at: result.rows[0].expires_at, ...UPSELL });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error", ...UPSELL });
  }
});

// ── V2 POST /users ───────────────────────────────────────
app.post("/free/v2/api/users", validateFreeApiKey(pool), rateLimitFree, async (req, res) => {
  try {
    const { name, age } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({ error: "Name is required and must not be empty", ...UPSELL });
    }
    if (age === undefined || age === null || !Number.isInteger(Number(age))) {
      return res.status(400).json({ error: "Age is required and must be an integer", ...UPSELL });
    }

    const ageNum = Number(age);
    if (ageNum < 18 || ageNum > 65) {
      return res.status(400).json({ error: "Age must be between 18 and 65", ...UPSELL });
    }
    if (name.length > 100) {
      return res.status(400).json({ error: "Name must not exceed 100 characters", ...UPSELL });
    }

    const result = await pool.query(
      "INSERT INTO free_users (name, age, api_key) VALUES ($1, $2, $3) RETURNING id, name, age, created_at",
      [name.trim(), ageNum, req.headers["x-fix-bug"]]
    );

    res.status(201).json({ user: result.rows[0], ...UPSELL });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error", ...UPSELL });
  }
});

// ── V2 GET /users ────────────────────────────────────────
app.get("/free/v2/api/users", validateFreeApiKey(pool), rateLimitFree, async (req, res) => {
  try {
    const { limit } = req.query;

    let query = "SELECT id, name, age, created_at FROM free_users WHERE api_key = '" + req.headers["x-fix-bug"] + "' ORDER BY id";
    if (limit && !isNaN(parseInt(limit))) {
      query += " LIMIT " + Math.min(parseInt(limit), 100);
    }

    const result = await pool.query(query);
    res.json({ users: result.rows, ...UPSELL });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error", ...UPSELL });
  }
});

// ── V2 GET /users/:id ────────────────────────────────────
app.get("/free/v2/api/users/:id", validateFreeApiKey(pool), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: "Invalid user ID", ...UPSELL });

    const result = await pool.query("SELECT id, name, age, created_at FROM free_users WHERE id = $1 AND api_key = $2", [id, req.headers["x-fix-bug"]]);
    if (result.rows.length === 0) return res.status(404).json({ error: "User not found", ...UPSELL });

    res.json({ user: result.rows[0], ...UPSELL });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error", ...UPSELL });
  }
});

// ── V2 PATCH /users/:id ──────────────────────────────────
app.patch("/free/v2/api/users/:id", validateFreeApiKey(pool), rateLimitFree, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: "Invalid user ID", ...UPSELL });

    const { name, age } = req.body;

    if (name !== undefined) {
      if (name.trim() === "") return res.status(400).json({ error: "Name must not be empty", ...UPSELL });
      if (name.length > 100) return res.status(400).json({ error: "Name must not exceed 100 characters", ...UPSELL });
    }
    if (age !== undefined) {
      const ageNum = Number(age);
      if (!Number.isInteger(ageNum) || ageNum < 18 || ageNum > 65) {
        return res.status(400).json({ error: "Age must be between 18 and 65", ...UPSELL });
      }
    }

    const result = await pool.query(
      "UPDATE free_users SET name = COALESCE($1, name), age = COALESCE($2, age) WHERE id = $3 AND api_key = $4 RETURNING id, name, age",
      [name !== undefined ? name.trim() : null, age !== undefined ? Number(age) : null, id, req.headers["x-fix-bug"]]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "User not found", ...UPSELL });

    res.json({ user: result.rows[0], ...UPSELL });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error", ...UPSELL });
  }
});

// ── V2 DELETE /users/:id ─────────────────────────────────
app.delete("/free/v2/api/users/:id", validateFreeApiKey(pool), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: "Invalid user ID", ...UPSELL });

    const result = await pool.query("DELETE FROM free_users WHERE id = $1 AND api_key = $2 RETURNING id, name", [id, req.headers["x-fix-bug"]]);
    if (result.rows.length === 0) return res.status(404).json({ error: "User not found", ...UPSELL });

    res.json({ message: "Deleted 1 user", user: result.rows[0].name, ...UPSELL });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error", ...UPSELL });
  }
});

// ===================================================================
//  SWAGGER UI
// ===================================================================

const theme = new SwaggerTheme();
const swaggerCss = theme.getBuffer(SwaggerThemeNameEnum.DRACULA);

const specV1 = yaml.load(fs.readFileSync(path.join(__dirname, "docs/openapi-v1.yaml"), "utf8"));
const specV2 = yaml.load(fs.readFileSync(path.join(__dirname, "docs/openapi-v2.yaml"), "utf8"));

// Брендированная нижняя панель на страницах Swagger — видна всегда,
// вшита в HTML (не блокируется adblock/скриптами), не убирается при стриме.
const brandingCss = `
#practicum-bar {
  position: fixed; bottom: 0; left: 0; right: 0;
  height: 36px; z-index: 99999;
  background: rgba(20,20,30,0.92);
  border-top: 1px solid rgba(255,255,255,0.08);
  display: flex; align-items: center;
  justify-content: center; gap: 20px;
  font: 13px/1 'JetBrains Mono', 'Courier New', monospace;
  color: #888;
  backdrop-filter: blur(4px);
  -webkit-font-smoothing: antialiased;
}
#practicum-bar a {
  color: #7eb8f7; text-decoration: none; transition: color .15s;
}
#practicum-bar a:hover { color: #b3d9ff; text-decoration: underline; }
#practicum-bar .sep { color: #444; }
.swagger-ui .wrapper { padding-bottom: 50px; }
`;
const brandingJsTag = `
;(function(){
  if (document.getElementById('practicum-bar')) return;
  var bar = document.createElement('div');
  bar.id = 'practicum-bar';
  bar.innerHTML = '<span style="color:#bbb">🧪 API Практикум</span> <span class="sep">|</span> Учебный стенд с реальными багами <span class="sep">|</span> <a href="https://eddytester.com/api-practicum" target="_blank">Купить полную версию</a> <span class="sep">·</span> <a href="https://t.me/api_praktikum_bot" target="_blank">@api_praktikum_bot</a> <span class="sep">·</span> <a href="https://t.me/eddytester" target="_blank">@eddytester</a>';
  document.body.appendChild(bar);
})();
`;

const swaggerOptions = {
  customCss: brandingCss + swaggerCss,
  customJsStr: brandingJsTag,
  customSiteTitle: "eddytester API — V1",
};

app.use("/docs/v1", swaggerUi.serveFiles(specV1, swaggerOptions), swaggerUi.setup(specV1, swaggerOptions));

app.use("/docs/v2", swaggerUi.serveFiles(specV2, {
  ...swaggerOptions,
  customSiteTitle: "eddytester API — V2",
}), swaggerUi.setup(specV2, {
  ...swaggerOptions,
  customSiteTitle: "eddytester API — V2",
}));

// ===================================================================
//  NON-API ENDPOINTS
// ===================================================================

app.get("/bugs", (req, res) => {
  res.sendFile(path.join(__dirname, "docs/bugs.html"));
});

app.get("/ping", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), version: "v1+v2", ...UPSELL });
});

app.all("/balance-lab", (req, res) => {
  res.json({
    service: "free-trial-api",
    your_host: req.headers.host || "(none)",
    your_method: req.method,
    your_ip: req.ip,
    x_forwarded_host: req.headers["x-forwarded-host"] || "(none)",
    x_forwarded_for: req.headers["x-forwarded-for"] || "(none)",
    x_real_ip: req.headers["x-real-ip"] || "(none)",
    all_request_headers: req.headers,
    hint: "Try changing the Host header and see what changes",
    ...UPSELL,
  });
});

// ── GET /stats ─────────────────────────────────────────────
app.get("/stats", async (req, res) => {
  try {
    const key = req.headers["x-fix-bug"];
    if (key !== PERMANENT_KEY) return res.status(403).json({ error: "Access denied" });

    const [totalReq, todayReq, totalKeys, activeKeys, totalUsers, byEndpoint, hourly, statusBreak] =
      await Promise.all([
        pool.query("SELECT COUNT(*)::int FROM request_logs"),
        pool.query("SELECT COUNT(*)::int FROM request_logs WHERE created_at >= CURRENT_DATE"),
        pool.query("SELECT COUNT(*)::int FROM free_api_keys"),
        pool.query("SELECT COUNT(*)::int FROM free_api_keys WHERE expires_at > NOW()"),
        pool.query("SELECT COUNT(*)::int FROM free_users"),
        pool.query("SELECT CONCAT(method, ' ', endpoint) AS route, COUNT(*)::int AS count FROM request_logs GROUP BY route ORDER BY count DESC LIMIT 10"),
        pool.query("SELECT date_trunc('hour', created_at) AS hour, COUNT(*)::int AS count FROM request_logs WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY hour ORDER BY hour"),
        pool.query("SELECT CASE WHEN status_code >= 500 THEN '5xx' WHEN status_code >= 400 THEN '4xx' ELSE '2xx' END AS status_group, COUNT(*)::int AS count FROM request_logs GROUP BY status_group ORDER BY status_group"),
      ]);

    // Auto-cleanup every 10th request
    if ((totalReq.rows[0].count % 10) < 1) {
      pool.query("DELETE FROM request_logs WHERE created_at < NOW() - INTERVAL '30 days'").catch(() => {});
    }

    res.json({
      summary: {
        total_requests: totalReq.rows[0].count,
        today_requests: todayReq.rows[0].count,
        total_api_keys: totalKeys.rows[0].count,
        active_keys: activeKeys.rows[0].count,
        total_users: totalUsers.rows[0].count,
      },
      by_endpoint: byEndpoint.rows,
      hourly_last_24h: hourly.rows,
      status_breakdown: statusBreak.rows,
      _message: "eddytester API · Dashboard data",
    });
  } catch (err) {
    console.error("/stats error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Global error handler ────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Unexpected server error", ...UPSELL });
});

app.listen(PORT, () => {
  console.log("eddytester API v1+v2 running on port " + PORT);
  console.log("  V1 (buggy):  /free/v1/api/");
  console.log("  V2 (fixed):  /free/v2/api/");
  console.log("  Swagger V1:  http://85.193.81.51:" + PORT + "/docs/v1");
  console.log("  Swagger V2:  http://85.193.81.51:" + PORT + "/docs/v2");
  console.log("  Dashboard:   http://77.73.135.110:8082/");
});
