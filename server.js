const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Health endpoint
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Stub endpoints
app.post('/free/api/users', (req, res) => {
  res.status(501).json({ error: 'Not Implemented' });
});

app.get('/free/api/users', (req, res) => {
  res.status(501).json({ error: 'Not Implemented' });
});

app.listen(PORT, () => {
  console.log('Free Trial API running on port ' + PORT);
});
