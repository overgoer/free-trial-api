const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");
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

const UPSELL = { _upsell: "Find bugs? Full version has 20 → https://t.me/api_practicum_bot" };

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
    if (!name || name === "") return res.status(400).json({ error: "Name is required", ...UPSELL });
    if (age === undefined || age === null) return res.status(400).json({ error: "Age is required", ...UPSELL });
    const result = await pool.query(
      "INSERT INTO free_users (name, age, api_key) VALUES ($1, $2, $3) RETURNING id, name, age, api_key, created_at",
      [name, age, generateApiKey()]
    );
    res.status(201).json({ user: result.rows[0], ...UPSELL });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error", ...UPSELL });
  }
});

app.get("/free/api/users", validateFreeApiKey(pool), rateLimitFree, async (req, res) => {
  try {
    const { sort, limit, status } = req.query;
    let result = await pool.query("SELECT id, name, age, created_at FROM free_users ORDER BY id");
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
      [name, Number(age), generateApiKey()]
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
    let result = await pool.query("SELECT id, name, age, created_at FROM free_users ORDER BY id");
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
    const result = await pool.query("SELECT id, name, age, created_at FROM free_users WHERE id = $1", [id - 1]);

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
      "UPDATE free_users SET name = COALESCE($1, name), age = COALESCE($2, age) WHERE id = $3 RETURNING id, name, age",
      [name !== undefined ? name : null, age !== undefined ? Number(age) : null, id]
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

    // BUG 9: забыли WHERE id = $1 — удаляются все строки
    const result = await pool.query("DELETE FROM free_users RETURNING id, name");

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
      [name.trim(), ageNum, generateApiKey()]
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

    let query = "SELECT id, name, age, created_at FROM free_users ORDER BY id";
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

    const result = await pool.query("SELECT id, name, age, created_at FROM free_users WHERE id = $1", [id]);
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
      "UPDATE free_users SET name = COALESCE($1, name), age = COALESCE($2, age) WHERE id = $3 RETURNING id, name, age",
      [name !== undefined ? name.trim() : null, age !== undefined ? Number(age) : null, id]
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

    const result = await pool.query("DELETE FROM free_users WHERE id = $1 RETURNING id, name", [id]);
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

const swaggerOptions = {
  customCss: swaggerCss,
  customSiteTitle: "Free Trial API — V1",
};

app.use("/docs/v1", swaggerUi.serveFiles(specV1, swaggerOptions), swaggerUi.setup(specV1, swaggerOptions));

app.use("/docs/v2", swaggerUi.serveFiles(specV2, {
  ...swaggerOptions,
  customSiteTitle: "Free Trial API — V2",
}), swaggerUi.setup(specV2, {
  ...swaggerOptions,
  customSiteTitle: "Free Trial API — V2",
}));

// ===================================================================
//  NON-API ENDPOINTS
// ===================================================================

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

// ─── Global error handler ────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Unexpected server error", ...UPSELL });
});

app.listen(PORT, () => {
  console.log("Free Trial API v1+v2 running on port " + PORT);
  console.log("  V1 (buggy):  /free/v1/api/");
  console.log("  V2 (fixed):  /free/v2/api/");
  console.log("  Swagger V1:  http://85.193.81.51:" + PORT + "/docs/v1");
  console.log("  Swagger V2:  http://85.193.81.51:" + PORT + "/docs/v2");
});
