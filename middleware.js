const { v4: uuidv4 } = require("uuid");

const rateLimitMap = new Map();

function rateLimitFree(req, res, next) {
  const apiKey = req.headers["x-fix-bug"];
  if (!apiKey) {
    return res.status(401).json({
      error: "Missing API key",
      _upsell: "Find bugs? Full version has 20 \xe2\x86\x92 https://t.me/api_practicum_bot"
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
      _upsell: "Find bugs? Full version has 20 \xe2\x86\x92 https://t.me/api_practicum_bot"
    });
  }

  next();
}

function generateApiKey() {
  const short = uuidv4().split("-")[0].substring(0, 8);
  return "free-trial-" + short;
}

function validateFreeApiKey(req, res, next) {
  const key = req.headers["x-fix-bug"];
  if (!key || key.trim() === "") {
    return res.status(401).json({
      error: "Missing or empty API key",
      _upsell: "Find bugs? Full version has 20 \xe2\x86\x92 https://t.me/api_practicum_bot"
    });
  }
  next();
}

module.exports = { rateLimitFree, generateApiKey, validateFreeApiKey };
