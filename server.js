const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
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

const upsell = { _upsell: "Find bugs? Full version has 20 \xe2\x86\x92 https://t.me/api_practicum_bot" };

app.get("/ping", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), ...upsell });
});

app.post("/free/api/users", validateFreeApiKey, rateLimitFree, async (req, res) => {
  try {
    const { name, age } = req.body;

    if (!name || name === "") {
      return res.status(400).json({ error: "Name is required", ...upsell });
    }

    if (age === undefined || age === null) {
      return res.status(400).json({ error: "Age is required", ...upsell });
    }

    const apiKey = generateApiKey();

    const result = await pool.query(
      "INSERT INTO free_users (name, age, api_key) VALUES ($1, $2, $3) RETURNING id, name, age, api_key, created_at",
      [name, age, apiKey]
    );

    const user = result.rows[0];

    res.status(201).json({ user, ...upsell });
  } catch (err) {
    console.error("POST /free/api/users error:", err.message);
    res.status(500).json({ error: "Internal server error", ...upsell });
  }
});

app.get("/free/api/users", validateFreeApiKey, rateLimitFree, async (req, res) => {
  try {
    const { sort, limit, status } = req.query;

    let result = await pool.query("SELECT id, name, age, created_at FROM free_users ORDER BY id");

    let users = result.rows;

    // Bug 1: sort — always sort by name ascending, ignore any sort param
    users.sort((a, b) => a.name.localeCompare(b.name));

    // Bug 3+4: status filter — case-sensitive, only "minor"/"candidate"/"retired" work
    if (status !== undefined) {
      users = users.filter((u) => {
        const computedStatus = u.age >= 0 && u.age <= 17 ? "minor" : u.age <= 65 ? "candidate" : "retired";
        return computedStatus === status;
      });
    }

    // Bug 2: limit — always return 1 record
    if (limit !== undefined) {
      users = users.slice(0, 1);
    }

    // Build response payload: wrap in {users, _upsell}
    const payload = { users, ...upsell };

    // Bug: Content-Type: text/plain instead of application/json
    res.setHeader("Content-Type", "text/plain");
    res.status(200).send(JSON.stringify(payload));
  } catch (err) {
    console.error("GET /free/api/users error:", err.message);
    res.status(500).json({ error: "Internal server error", ...upsell });
  }
});

app.listen(PORT, () => {
  console.log("Free Trial API running on port " + PORT);
});
