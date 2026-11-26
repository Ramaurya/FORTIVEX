
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { embedMany, embedQuery } from './gemini.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KNOWLEDGE_DIR = path.join(ROOT, 'knowledge');
const INDEX_FILE = path.join(ROOT, 'data', 'vector-index.json');

let index = []; // [{ id, source, text, vector }]

// ---------- Step 1a: CHUNKING ----------
// Split each markdown file by "## " headings, so each chunk is one topic
// (e.g. "Pricing", "Refund policy"). Small focused chunks = better search.
function chunkDocuments() {
  const chunks = [];
  for (const file of fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'))) {
    const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf8');
    const docTitle = (content.match(/^# (.+)$/m) || [, file])[1];
    const sections = content.split(/\n(?=## )/); // split before each "## "
    sections.forEach((section, i) => {
      const text = section.trim();
      if (text.length < 30) return; // skip empty bits
      chunks.push({ id: `${file}#${i}`, source: file, text: `[${docTitle}]\n${text}` });
    });
  }
  return chunks;
}

// ---------- Step 1b: INDEXING (embeddings) ----------
export async function buildIndex({ force = false } = {}) {
  const chunks = chunkDocuments();
  // Hash of all text: if documents did not change, reuse saved vectors
  // (saves API calls and makes server start instantly).
  const hash = crypto.createHash('md5').update(chunks.map((c) => c.text).join('|')).digest('hex');

  if (!force && fs.existsSync(INDEX_FILE)) {
    const saved = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    if (saved.hash === hash) {
      index = saved.chunks;
      console.log(`[rag] Loaded ${index.length} chunks from cache`);
      return;
    }
  }

  try {
    const vectors = await embedMany(chunks.map((c) => c.text));
    index = chunks.map((c, i) => ({ ...c, vector: vectors[i] }));
    fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
    fs.writeFileSync(INDEX_FILE, JSON.stringify({ hash, chunks: index }));
    console.log(`[rag] Indexed ${index.length} chunks with embeddings`);
  } catch (err) {
    // Fallback: keep chunks without vectors -> keyword search still works
    console.warn(`[rag] Embedding failed (${err.message.slice(0, 80)}). Using keyword search fallback.`);
    index = chunks;
  }
}

// ---------- Step 2: SIMILARITY SEARCH ----------
// Cosine similarity = how much two vectors "point the same direction".
// 1.0 = same meaning, 0 = unrelated.
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Backup method if embeddings are unavailable: count shared words.
function keywordScore(query, text) {
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const lower = text.toLowerCase();
  return words.filter((w) => lower.includes(w)).length / (words.length || 1);
}

/** Return the top-k most relevant knowledge chunks for a question. */
export async function search(query, k = 3) {
  if (index.length === 0) return [];
  let scored;
  if (index[0].vector) {
    try {
      const qVec = await embedQuery(query);
      scored = index.map((c) => ({ ...c, score: cosineSimilarity(qVec, c.vector) }));
    } catch {
      scored = null; // embedding call failed -> fall back below
    }
  }
  if (!scored) scored = index.map((c) => ({ ...c, score: keywordScore(query, c.text) }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ source, text, score }) => ({ source, text, score: Number(score.toFixed(3)) }));
}

// Allow "npm run reindex" to rebuild the index from the command line
if (process.argv.includes('--reindex')) {
  await buildIndex({ force: true });
}
