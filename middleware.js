const { v4: uuidv4 } = require("uuid");

const rateLimitMap = new Map();

function rateLimitFree(req, res, next) {
  const apiKey = req.headers["x-fix-bug"];
  if (!apiKey) {
    return res.status(401).json({
      error: "Missing API key",
      _upsell: "Полная версия — 48 багов, 19 уроков → https://eddytester.com/trial"
    });
  }

  const now = Date.now();
  const windowStart = Math.floor(now / 60000) * 60000;

  if (!rateLimitMap.has(apiKey)) {
    rateLimitMap.set(apiKey, { windowStart, count: 0 });
  }

  const entry = rateLimitMap.get(apiKey);

  if (entry.windowStart !== windowStart) {
    entry.windowStart = windowStart;
    entry.count = 0;
  }

  entry.count++;

  if (entry.count > 10) {
    return res.status(429).json({
      error: "Rate limit exceeded",
      retry_after: 60,
      _upsell: "Полная версия — 48 багов, 19 уроков → https://eddytester.com/trial"
    });
  }

  next();
}

function generateApiKey() {
  const short = uuidv4().split("-")[0].substring(0, 8);
  return "free-trial-" + short;
}

const PERMANENT_TEST_KEY = "free-trial-permanent-33be59f62f921640941ed5e6296940f7426f68477e6e4632";

function validateFreeApiKey(pool) {
  return async function (req, res, next) {
    const key = req.headers["x-fix-bug"];
    if (!key || key.trim() === "") {
      return res.status(401).json({
        error: "Missing or empty API key",
        _upsell: "Полная версия — 48 багов, 19 уроков → https://eddytester.com/trial"
      });
    }

    const logKey = key === PERMANENT_TEST_KEY ? key : key.substring(0, 20) + "...";
    const _logTime = new Date();
    console.log(`${_logTime.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false })} ${logKey} ${req.method} ${req.originalUrl || req.url} — ${_logTime.toISOString()}`);

    try {
      const result = await pool.query(
        "SELECT key, created_at, expires_at FROM free_api_keys WHERE key = $1",
        [key]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          error: "Invalid API key",
          _upsell: "Полная версия — 48 багов, 19 уроков → https://eddytester.com/trial"
        });
      }

      const row = result.rows[0];
      if (new Date(row.expires_at) < new Date()) {
        return res.status(403).json({
          error: "Free trial expired",
          _upsell: "Полная версия — 48 багов, 19 уроков → https://eddytester.com/trial"
        });
      }

      next();
    } catch (err) {
      console.error("validateFreeApiKey error:", err.message);
      return res.status(500).json({
        error: "Internal server error",
        _upsell: "Полная версия — 48 багов, 19 уроков → https://eddytester.com/trial"
      });
    }
  };
}

module.exports = { rateLimitFree, generateApiKey, validateFreeApiKey };
