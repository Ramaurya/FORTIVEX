
import crypto from 'node:crypto';
import { config } from './config.js';
import { generate } from './gemini.js';
import { search } from './rag.js';
import { toolDeclarations, runTool } from './tools.js';
import { buildSystemPrompt, LANGUAGES, SUMMARY_PROMPT, summarySchema } from './prompts.js';
import * as db from './db.js';

const sessions = new Map(); // sessionId -> session (in-memory; Redis in production)
const MAX_TOOL_ROUNDS = 5;  // safety limit so the model can't loop forever

// ---------- Start a call ----------
export function startCall(language = 'en-IN') {
  if (!LANGUAGES[language]) language = 'en-IN';
  const id = crypto.randomUUID();
  const greeting = LANGUAGES[language].greeting(config.agentName, config.companyName);

  const session = {
    id,
    language,
    leadId: db.createLead(language), // every call creates a lead record in CRM
    startedAt: new Date(),
    lastActive: Date.now(),
    // "history" = contextual memory in Gemini's format (sent to the LLM every turn)
    // (Gemini expects the conversation to start with a 'user' turn, so we add a marker.)
    history: [
      { role: 'user', parts: [{ text: '[Call connected]' }] },
      { role: 'model', parts: [{ text: greeting }] },
    ],
    // "transcript" = human-readable log (saved to DB, shown in UI)
    transcript: [{ role: 'agent', text: greeting }],
  };
  sessions.set(id, session);
  return { sessionId: id, greeting, leadId: session.leadId };
}

// ---------- Handle one customer utterance ----------
export async function handleMessage(sessionId, userText) {
  const session = sessions.get(sessionId);
  if (!session) throw Object.assign(new Error('Call not found or already ended'), { status: 404 });
  session.lastActive = Date.now();

  session.transcript.push({ role: 'customer', text: userText });
  session.history.push({ role: 'user', parts: [{ text: userText }] });

  // 1) RAG — retrieve relevant knowledge for this utterance
  const hits = await search(userText, 3);
  const knowledge = hits.map((h) => h.text).join('\n---\n');
  const system = buildSystemPrompt({ language: session.language, knowledge });

  // 2-4) LLM + tool-calling loop
  const actions = [];
  let replyText = '';
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const content = await generate(session.history, { system, tools: toolDeclarations });
    session.history.push(content); // keep the model's turn exactly as returned

    const calls = content.parts.filter((p) => p.functionCall);
    if (calls.length === 0) {
      replyText = content.parts.map((p) => p.text || '').join('').trim();
      break;
    }

    // Model asked for one or more tools -> run them and send results back
    const responses = calls.map(({ functionCall }) => {
      const result = runTool(session, functionCall.name, functionCall.args);
      actions.push({ tool: functionCall.name, args: functionCall.args, result });
      console.log(`[tool] ${functionCall.name}`, JSON.stringify(functionCall.args), '->', JSON.stringify(result));
      return { functionResponse: { name: functionCall.name, response: result } };
    });
    session.history.push({ role: 'user', parts: responses });
  }

  if (!replyText) replyText = 'Sorry, could you say that again?';
  session.transcript.push({ role: 'agent', text: replyText });

  return {
    reply: replyText,
    actions,                                    // shown live in UI ("AI is doing...")
    sources: hits.map(({ source, score }) => ({ source, score })), // which docs RAG used
    lead: db.getLead(session.leadId),
  };
}

// ---------- End call: summarise + sentiment + save ----------
export async function endCall(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw Object.assign(new Error('Call not found or already ended'), { status: 404 });
  sessions.delete(sessionId);

  const endedAt = new Date();
  const transcriptText = session.transcript
    .map((t) => `${t.role === 'agent' ? 'AGENT' : 'CUSTOMER'}: ${t.text}`)
    .join('\n');

  let analysis = {
    summary: 'Call ended before the customer spoke.', sentiment: 'neutral', sentiment_score: 0,
    customer_intent: 'Unknown', objections: [], next_steps: [], key_topics: [],
  };

  const customerSpoke = session.transcript.some((t) => t.role === 'customer');
  if (customerSpoke) {
    try {
      const content = await generate(
        [{ role: 'user', parts: [{ text: `TRANSCRIPT:\n${transcriptText}` }] }],
        { system: SUMMARY_PROMPT, jsonSchema: summarySchema, temperature: 0.2 }
      );
      analysis = JSON.parse(content.parts.map((p) => p.text || '').join(''));
    } catch (err) {
      console.error('[summary] failed:', err.message);
      analysis.summary = 'Summary unavailable (AI error).';
    }
  }

  const callId = db.saveCall({
    leadId: session.leadId,
    language: session.language,
    startedAt: session.startedAt.toLocaleString('sv-SE').slice(0, 16), // "YYYY-MM-DD HH:MM"
    endedAt: endedAt.toLocaleString('sv-SE').slice(0, 16),
    durationSec: Math.round((endedAt - session.startedAt) / 1000),
    transcript: session.transcript,
    summary: analysis.summary,
    sentiment: analysis.sentiment,
    sentimentScore: analysis.sentiment_score,
    intent: analysis.customer_intent,
    objections: analysis.objections,
    nextSteps: analysis.next_steps,
    topics: analysis.key_topics,
  });

  return { callId, ...analysis, lead: db.getLead(session.leadId) };
}

// Clean up calls abandoned for 30+ minutes (e.g. browser closed)
setInterval(() => {
  for (const [id, s] of sessions) {
    if (Date.now() - s.lastActive > 30 * 60 * 1000) sessions.delete(id);
  }
}, 5 * 60 * 1000).unref();
