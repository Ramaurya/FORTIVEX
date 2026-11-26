# Presentation Guide — what to say, in what order

Total time ≈ 12–15 minutes. Open 3 browser tabs before you start:
1. `http://localhost:3000/architecture.html`
2. `http://localhost:3000` (Live Call)
3. `http://localhost:3000/dashboard.html`

And VS Code with `src/agent.js` open.

---

## 0. 30-second opening (learn this by heart)

> "I built an **Autonomous AI Sales Voice Agent**. It talks to a lead by voice, answers their
> questions using the company's own documents through **RAG**, qualifies the lead with the
> **BANT** framework, books a demo directly into the **CRM**, and after the call it generates a
> **summary, sentiment and business insights** for the sales team.
> It's built with **Node.js and Express**, **Google Gemini** as the LLM with **function calling**,
> the browser's **Web Speech API** for speech-to-text and text-to-speech, and **SQLite** as the CRM.
> I'll show the business problem, a live end-to-end demo, the architecture, and then cost,
> security and deployment."

---

## 1. Business problem (1–2 min)

- Companies generate many inbound leads (ads, website forms). **Speed matters**: a lead contacted
  within minutes converts far better than one called the next day.
- Human sales reps (SDRs) are **expensive**, work **8 hours**, handle **one call at a time**, and
  spend a lot of time on **unqualified leads** and **manual CRM data entry**.
- Managers have **no visibility** into what customers said — notes are incomplete.

**Our solution:** an AI agent that answers every lead **instantly, 24/7, in their language**,
qualifies them, books meetings for the human team, and logs everything automatically.
**Humans focus only on Hot leads and closing deals.**

---

## 2. Live demo — the end-to-end workflow (4–5 min)

Click **Start Call** (English India). Speak these lines (or type them):

| # | You say | What to point out |
|---|---|---|
| 1 | "Hi, I'm Rahul from ShopKart, an e-commerce company." | **AI actions** panel: `save_lead_info` called → lead card fills with name + company |
| 2 | "We get around 3000 customer queries a month on WhatsApp and email, and our team can't reply fast enough." | Need captured → **N** of BANT turns green |
| 3 | "What does your Growth plan cost?" | **Knowledge used (RAG)** panel shows `pricing.md` → answer is 2,499 INR, from our docs, not invented |
| 4 | "Is our data safe? Where is it stored?" | RAG pulls `faq.md` → ISO 27001, AWS Mumbai |
| 5 | "I'm the founder, so I decide. Budget is about 50,000 a month for 10 agents, and we want to start next month." | B, A, T go green → score **100 → Hot** |
| 6 | "Can we do a demo next Monday?" | `check_availability` → AI offers free slots |
| 7 | "3 PM works. My email is rahul@shopkart.in" | `book_appointment` → booked ✓ |
| 8 | Click **End Call** | Summary popup: summary, **sentiment**, intent, objections, next steps |

Then open **Dashboard**: KPIs, lead in CRM table, appointment, call summary with transcript.
Click **Generate insights**.

**Bonus demos (if time):**
- **Multilingual:** choose हिन्दी, say *"मुझे आपके प्रोडक्ट की कीमत जाननी है"*, and the AI answers in Hindi.
- **Returning customer memory:** start a new call, give the same email, and the AI remembers the previous call.
- **Objection handling:** say "This is too expensive", and RAG pulls `objections.md` (ROI, discounts, trial).
- **No hallucination:** ask "Do you have a free lifetime plan?", and the AI says a specialist will confirm.

---

## 3. Technical implementation (3–4 min) — show the architecture page

Explain the 4 boxes left → right:

1. **Browser**: STT turns voice into text. Text goes to the backend by REST. The reply comes back and TTS speaks it.
   Turn-taking: the mic is off while the AI speaks, so it doesn't hear itself (no echo).
2. **Backend (Express)**: the heart is `agent.js`, the **orchestrator**. For every sentence:
   - **RAG** finds the 3 most relevant knowledge chunks
   - Builds the **system prompt** (rules + today's date + language + knowledge)
   - Sends the **full history** (= contextual memory) to Gemini
   - **Tool loop:** if Gemini returns a `functionCall`, we execute it (save lead / check slots /
     book) and send the result back, up to 5 rounds, then return the final text.
3. **Gemini API**: chat model (function calling + JSON output) and embedding model (for RAG).
   All AI calls go through **one file** (`gemini.js`), so changing provider means changing one file.
4. **Data layer**: SQLite CRM with 3 tables (`leads`, `appointments`, `calls`), the vector index, and the knowledge docs.

**Key design decisions (say these, they show maturity):**
- **The LLM decides *what*, code decides *how*.** The LLM extracts BANT signals, but the **score is
  calculated in code** (25 points each), so it's consistent and auditable. Booking is **validated in
  code** (weekday, business hours, no double booking). The AI can't corrupt the data.
- **Structured output:** the post-call summary uses a **JSON schema**, so it always saves cleanly to the DB.
- **RAG instead of fine-tuning:** cheaper, updated instantly by editing a document, and grounded answers.
- **Resilience:** retry with exponential backoff on rate limits; keyword-search fallback if embeddings fail;
  tool errors go back to the LLM instead of crashing.
- **Low latency:** short voice replies, thinking disabled on Gemini 3.5 Flash-Lite, embeddings cached on disk.

---

## 4. Commercial feasibility (1–2 min)

*All numbers are rough estimates. Say "approximately".*

**Cost of one 5-minute AI call (production setup):**

| Component | Approx cost |
|---|---|
| LLM (Gemini Flash, ~30k tokens) | ≈ ₹1 |
| STT (e.g. Deepgram, 5 min) | ≈ ₹2–3 |
| TTS (e.g. Google Cloud TTS) | ≈ ₹2–4 |
| Telephony (Exotel/Twilio India, 5 min) | ≈ ₹3–7 |
| **Total** | **≈ ₹8–15 per call (≈ ₹2–3 / minute)** |

**Human SDR:** ~₹30–40k/month (salary + overheads) for ~1,500 calls/month → **≈ ₹20–30 per call**,
only in office hours, one call at a time.

**Value:** 24/7, instant response, unlimited parallel calls, every call logged and scored, humans
spend time only on Hot leads. **The MVP itself costs ₹0** (Gemini free tier, browser voice, SQLite).

**Business model (if selling this as a product):** SaaS, with a monthly platform fee plus per-minute
usage, or a price per qualified lead or booked meeting.

---

## 5. Data security (1 min)

**Already in the MVP:**
- API key only in `.env` (git-ignored), sent in a header, never to the browser
- **Parameterised SQL** (no SQL injection) + column allow-list in `updateLead`
- **HTML escaping** of all displayed text (no XSS)
- Input validation (text required, max 1000 chars, 50 KB body limit)
- The AI can only act through 3 **validated tools**. It cannot run arbitrary queries. This limits
  **prompt injection** damage.
- Company data is not used to train Google models on the paid API tier.

**For production:**
- HTTPS everywhere; authentication + roles for the dashboard (missing in the MVP, so say it honestly)
- Encrypt PII at rest; data retention policy (auto-delete transcripts after X days)
- **Consent:** the agent discloses "you are speaking with an AI assistant; this call may be recorded"
- Compliance: **India DPDP Act 2023**, GDPR for EU; TRAI/DND rules for outbound calls
- Rate limiting, audit logs, secrets in AWS Secrets Manager

---

## 6. Infrastructure & deployment (1 min)

- **Now:** a single Node process; `npm start`.
- **Deploy:** Dockerfile → **Render / Railway** (quick) or **AWS ECS / EC2** behind a load balancer with HTTPS.
- **Scale:** move sessions from the in-memory Map to **Redis**, so any server can handle any call → horizontal
  scaling. SQLite → **PostgreSQL**; JSON vectors → **pgvector** or **Pinecone**.
- **Real phone calls:** **Twilio / Exotel** streams call audio over WebSocket → streaming STT (Deepgram) →
  same `agent.js` → streaming TTS (ElevenLabs) → back to the phone. *The brain stays the same; only the voice I/O layer changes.*
- **Monitoring:** log every tool call (already printed), track latency, error rate, cost per call, and conversion.
- **Infra cost:** ~$10–30/month for a small server + managed DB at MVP scale. AI usage cost is per call (above).

---

## 7. Limitations & roadmap (say it before they ask)

| Not built yet | How it would be done |
|---|---|
| Phone calls | Twilio Media Streams + WebSocket server |
| Barge-in (customer interrupts AI) | Full-duplex streaming STT + stop TTS on speech detected |
| Real CRM | Replace `db.js` functions with HubSpot/Zoho API calls (same function names) |
| Calendar invites | Google Calendar API inside `book_appointment` + confirmation email |
| Outbound campaigns | Queue of leads (BullMQ/Redis) + scheduler that dials them |
| Live sentiment per sentence | Lightweight classifier per utterance, or ask the LLM for a sentiment field each turn |
| Auth & multi-tenant | JWT login, `company_id` on every table |
| Voice quality on all browsers | Server-side STT/TTS (Web Speech works best in Chrome) |

---

## 8. Closing line

> "So in short, the core workflow works end-to-end today: voice in, grounded answers, qualification,
> booking into the CRM, and summary plus insights out. The architecture is modular, so moving to
> real phone calls, a real CRM and production scale means replacing adapters, not rewriting the brain."
