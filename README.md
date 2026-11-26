# Autonomous AI Sales Voice Agent (MVP)

An AI sales representative ("Aria") that **talks to leads by voice**, answers questions from the
company's own documents (**RAG**), **qualifies the lead (BANT score)**, **books a demo** into a
**CRM**, and after the call produces a **summary, sentiment and business insights**.

Demo company: *NovaTech Solutions* (fictional) selling *NovaDesk*, an AI helpdesk SaaS.

---

## 1. Quick start

**Requirements:** Node.js 22.13+ (uses built-in SQLite), Google Chrome (for voice), a free Gemini API key.

```bash
npm install
# open .env and paste your key:  GEMINI_API_KEY=...
npm start
```

| Page | URL |
|---|---|
| Live voice call | http://localhost:3000 |
| CRM dashboard | http://localhost:3000/dashboard.html |
| Architecture diagram | http://localhost:3000/architecture.html |

Get a free key: https://aistudio.google.com/apikey

> Voice works on `localhost` in Chrome. Allow microphone access when asked.
> No mic? Untick **Voice mode** and type — same workflow.

---

## 2. Features → how they are implemented

| Requirement | Implementation | File |
|---|---|---|
| Real-time voice (STT + TTS) | Browser Web Speech API (`SpeechRecognition` + `speechSynthesis`), half-duplex turn-taking | `public/app.js` |
| Contextual memory | Full conversation history sent to the LLM every turn; per-call session | `src/agent.js` |
| Cross-call memory | Returning customer detected by email/phone → previous call summaries given to the AI | `src/tools.js` |
| Multilingual | STT/TTS language selector (EN, HI, ES, FR) + prompt rule "reply in the customer's language" | `src/prompts.js` |
| Lead qualification | LLM extracts BANT signals via function calling → **score computed in code** (25 pts each) → Hot/Warm/Cold | `src/tools.js` |
| Sentiment analysis | Post-call LLM analysis with forced JSON schema (label + score −1..1) | `src/agent.js`, `src/prompts.js` |
| RAG knowledge | Markdown docs → chunk by heading → Gemini embeddings → cosine similarity top-3 → injected into prompt | `src/rag.js`, `knowledge/` |
| Appointment booking | `check_availability` + `book_appointment` tools, double-booking prevented | `src/tools.js` |
| CRM integration | SQLite tables `leads`, `appointments`, `calls` behind one module (swap for HubSpot API) | `src/db.js` |
| Call summary & insights | Summary/objections/next steps per call + KPI dashboard + AI-generated insights | `src/analytics.js`, `public/dashboard.*` |

---

## 3. Project structure

```
FORTIVEX/
├── server.js            Express app: REST routes, static files, boot
├── src/
│   ├── config.js        Reads .env (API key, model names)
│   ├── gemini.js        ONLY file that calls the AI (fetch + retry). Swap provider here.
│   ├── agent.js         Orchestrator: memory, RAG, LLM ↔ tool loop, end-call summary
│   ├── prompts.js       System prompt, greetings per language, JSON schemas
│   ├── tools.js         Function-calling tools + BANT lead scoring
│   ├── rag.js           Chunking, embeddings, vector cache, cosine search (+ keyword fallback)
│   ├── db.js            SQLite CRM (leads, appointments, calls)
│   └── analytics.js     KPIs + AI business insights
├── knowledge/           Company documents used by RAG (pricing, features, FAQ, objections)
├── public/              Frontend (plain HTML/CSS/JS)
│   ├── index.html + app.js           Live voice call page
│   ├── dashboard.html + dashboard.js CRM & insights dashboard
│   ├── architecture.html             System architecture diagram
│   ├── common.js, style.css
├── data/                Created at runtime: crm.db, vector-index.json (git-ignored)
└── docs/                Presentation guide + interview Q&A
```

---

## 4. REST API

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/calls/start` `{language}` | Start call → `{sessionId, greeting, leadId}` |
| POST | `/api/calls/:id/message` `{text}` | Customer utterance → `{reply, actions, sources, lead}` |
| POST | `/api/calls/:id/end` | End call → summary, sentiment, objections, next steps |
| GET | `/api/leads` · `/api/appointments` · `/api/calls` | CRM data |
| GET | `/api/stats` | Dashboard KPIs |
| GET | `/api/insights` | AI-generated business insights |
| GET | `/api/knowledge/search?q=...` | Test RAG retrieval directly |
| GET | `/api/health` | Health check |
| POST | `/api/reset` | Clear demo data |

---

## 5. Useful commands

```bash
npm start          # run
npm run dev        # run with auto-restart on file changes (good for live coding)
npm run reindex    # rebuild RAG vectors after editing knowledge/*.md (also auto-detected on start)
```

## 6. Tech stack

Node.js 22 · Express 4 · Google Gemini (`gemini-3.5-flash-lite`, `gemini-embedding-001`) · SQLite (`node:sqlite`) ·
Web Speech API · plain HTML/CSS/JS (no build step). Only 2 npm dependencies: `express`, `dotenv`.
