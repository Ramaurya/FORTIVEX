
import express from 'express';
import { config, hasValidKey } from './src/config.js';
import { buildIndex, search } from './src/rag.js';
import { startCall, handleMessage, endCall } from './src/agent.js';
import { computeStats, aiInsights } from './src/analytics.js';
import * as db from './src/db.js';

const app = express();
app.use(express.json({ limit: '50kb' })); 
app.use(express.static('public'));        

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);


app.post('/api/calls/start', (req, res) => {
  res.json(startCall(req.body?.language));
});

// 2. Customer said something (text from browser STT) -> AI reply
app.post('/api/calls/:id/message', wrap(async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > 1000) return res.status(400).json({ error: 'text too long' });
  res.json(await handleMessage(req.params.id, text));
}));

// 3. End call -> summary, sentiment, lead score (saved to CRM)
app.post('/api/calls/:id/end', wrap(async (req, res) => {
  res.json(await endCall(req.params.id));
}));

// ---------------- CRM + insights (dashboard) ----------------
app.get('/api/leads', (req, res) => res.json(db.listLeads()));
app.get('/api/appointments', (req, res) => res.json(db.listAppointments()));
app.get('/api/calls', (req, res) => res.json(db.listCalls()));
app.get('/api/stats', (req, res) => res.json(computeStats()));
app.get('/api/insights', wrap(async (req, res) => res.json(await aiInsights())));

// ---------------- Debug / demo helpers ----------------
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', model: config.chatModel, apiKeyConfigured: !!hasValidKey() }));

// Test RAG directly: /api/knowledge/search?q=pricing
app.get('/api/knowledge/search', wrap(async (req, res) =>
  res.json(await search(String(req.query.q || ''), 3))));

app.post('/api/reset', (req, res) => { db.resetAll(); res.json({ status: 'cleared' }); });

// ---------------- Error handler ----------------
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message });
});

// ---------------- Boot ----------------
if (!hasValidKey()) {
  console.error('\n  GEMINI_API_KEY missing! Open the .env file and paste your key from https://aistudio.google.com/apikey\n');
  process.exit(1);
}
await buildIndex(); // build/load RAG vectors before accepting calls
app.listen(config.port, () => {
  console.log(`\n  AI Sales Voice Agent running`);
  console.log(`  Call UI   : http://localhost:${config.port}`);
  console.log(`  Dashboard : http://localhost:${config.port}/dashboard.html\n`);
});
