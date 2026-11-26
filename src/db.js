
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(ROOT, 'data', 'crm.db'));

// ---------- Schema (3 tables) ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT,
    email             TEXT,
    phone             TEXT,
    company           TEXT,
    need              TEXT,     -- what problem they want solved
    budget            TEXT,     -- B of BANT (free text, e.g. "50k per month")
    timeline          TEXT,     -- T of BANT
    budget_confirmed  INTEGER DEFAULT 0,  -- 1 = budget fits our plans
    is_decision_maker INTEGER DEFAULT 0,  -- A of BANT (Authority)
    has_clear_need    INTEGER DEFAULT 0,  -- N of BANT
    timeline_soon     INTEGER DEFAULT 0,  -- buying within ~3 months
    score             INTEGER DEFAULT 0,  -- 0-100
    category          TEXT DEFAULT 'Cold',-- Hot / Warm / Cold
    language          TEXT,
    created_at        TEXT DEFAULT (datetime('now','localtime')),
    updated_at        TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id    INTEGER REFERENCES leads(id),
    date       TEXT NOT NULL,   -- YYYY-MM-DD
    time       TEXT NOT NULL,   -- HH:MM (24h)
    purpose    TEXT,
    status     TEXT DEFAULT 'scheduled',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS calls (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id         INTEGER REFERENCES leads(id),
    language        TEXT,
    started_at      TEXT,
    ended_at        TEXT,
    duration_sec    INTEGER,
    transcript      TEXT,  -- JSON array of {role, text}
    summary         TEXT,
    sentiment       TEXT,  -- positive / neutral / negative
    sentiment_score REAL,  -- -1.0 .. +1.0
    intent          TEXT,
    objections      TEXT,  -- JSON array
    next_steps      TEXT,  -- JSON array
    topics          TEXT   -- JSON array
  );
`);

const plain = (row) => (row ? { ...row } : null); // strip null-prototype

// ---------- Leads ----------
export function createLead(language) {
  const r = db.prepare('INSERT INTO leads (language) VALUES (?)').run(language);
  return Number(r.lastInsertRowid);
}

export function getLead(id) {
  return plain(db.prepare('SELECT * FROM leads WHERE id = ?').get(id));
}

const LEAD_COLUMNS = [
  'name', 'email', 'phone', 'company', 'need', 'budget', 'timeline',
  'budget_confirmed', 'is_decision_maker', 'has_clear_need', 'timeline_soon',
  'score', 'category',
];

export function updateLead(id, fields) {
  // Only allow known columns (prevents SQL injection via column names)
  const entries = Object.entries(fields).filter(
    ([k, v]) => LEAD_COLUMNS.includes(k) && v !== undefined && v !== null && v !== ''
  );
  if (entries.length === 0) return getLead(id);
  const setSql = entries.map(([k]) => `${k} = ?`).join(', ');
  const values = entries.map(([, v]) => (typeof v === 'boolean' ? Number(v) : v));
  db.prepare(`UPDATE leads SET ${setSql}, updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(...values, id);
  return getLead(id);
}

/** Find an EARLIER lead with the same email/phone (returning customer). */
export function findExistingLead(email, phone, excludeId) {
  if (!email && !phone) return null;
  return plain(
    db.prepare(
      `SELECT * FROM leads WHERE id != ? AND ((email IS NOT NULL AND lower(email) = lower(?))
        OR (phone IS NOT NULL AND phone = ?)) ORDER BY id DESC LIMIT 1`
    ).get(excludeId, email || '', phone || '')
  );
}

export function listLeads() {
  return db.prepare(`
    SELECT l.*, (SELECT COUNT(*) FROM appointments a WHERE a.lead_id = l.id) AS appointment_count
    FROM leads l WHERE l.name IS NOT NULL OR l.email IS NOT NULL OR l.phone IS NOT NULL
    ORDER BY l.updated_at DESC`).all().map(plain);
}

// ---------- Appointments ----------
export function bookedTimes(date) {
  return db.prepare(
    "SELECT time FROM appointments WHERE date = ? AND status = 'scheduled'"
  ).all(date).map((r) => r.time);
}

export function createAppointment({ leadId, date, time, purpose }) {
  const r = db.prepare(
    'INSERT INTO appointments (lead_id, date, time, purpose) VALUES (?, ?, ?, ?)'
  ).run(leadId, date, time, purpose || 'Product demo');
  return Number(r.lastInsertRowid);
}

export function listAppointments() {
  return db.prepare(`
    SELECT a.*, l.name AS lead_name, l.email AS lead_email, l.company AS lead_company
    FROM appointments a LEFT JOIN leads l ON l.id = a.lead_id
    ORDER BY a.date, a.time`).all().map(plain);
}

// ---------- Calls ----------
export function saveCall(c) {
  const r = db.prepare(`
    INSERT INTO calls (lead_id, language, started_at, ended_at, duration_sec, transcript,
      summary, sentiment, sentiment_score, intent, objections, next_steps, topics)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    c.leadId, c.language, c.startedAt, c.endedAt, c.durationSec,
    JSON.stringify(c.transcript), c.summary, c.sentiment, c.sentimentScore, c.intent,
    JSON.stringify(c.objections || []), JSON.stringify(c.nextSteps || []), JSON.stringify(c.topics || [])
  );
  return Number(r.lastInsertRowid);
}

function parseCall(row) {
  const c = plain(row);
  for (const k of ['transcript', 'objections', 'next_steps', 'topics']) {
    try { c[k] = JSON.parse(c[k] || '[]'); } catch { c[k] = []; }
  }
  return c;
}

export function listCalls() {
  return db.prepare(`
    SELECT c.*, l.name AS lead_name, l.category AS lead_category, l.score AS lead_score
    FROM calls c LEFT JOIN leads l ON l.id = c.lead_id ORDER BY c.id DESC`).all().map(parseCall);
}

export function callsForLead(leadId) {
  return db.prepare('SELECT * FROM calls WHERE lead_id = ? ORDER BY id DESC').all(leadId).map(parseCall);
}

export function resetAll() {
  db.exec('DELETE FROM calls; DELETE FROM appointments; DELETE FROM leads;');
}
