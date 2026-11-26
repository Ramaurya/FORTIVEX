
import * as db from './db.js';
import { generate } from './gemini.js';
import { INSIGHTS_PROMPT, insightsSchema } from './prompts.js';

export function computeStats() {
  const leads = db.listLeads();
  const calls = db.listCalls();
  const appointments = db.listAppointments();

  const countBy = (arr, key) =>
    arr.reduce((acc, x) => ((acc[x[key]] = (acc[x[key]] || 0) + 1), acc), {});

  // Most common objections across all calls (lower-cased to merge duplicates)
  const objectionCounts = {};
  for (const c of calls) for (const o of c.objections) {
    const k = o.toLowerCase();
    objectionCounts[k] = (objectionCounts[k] || 0) + 1;
  }
  const topObjections = Object.entries(objectionCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([objection, count]) => ({ objection, count }));

  const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);

  return {
    totalCalls: calls.length,
    totalLeads: leads.length,
    totalAppointments: appointments.length,
    conversionRate: calls.length ? Math.round((appointments.length / calls.length) * 100) : 0,
    avgLeadScore: Math.round(avg(leads.map((l) => l.score))),
    avgCallDurationSec: Math.round(avg(calls.map((c) => c.duration_sec || 0))),
    avgSentiment: Number(avg(calls.map((c) => c.sentiment_score || 0)).toFixed(2)),
    leadsByCategory: { Hot: 0, Warm: 0, Cold: 0, ...countBy(leads, 'category') },
    sentimentBreakdown: { positive: 0, neutral: 0, negative: 0, ...countBy(calls, 'sentiment') },
    callsByLanguage: countBy(calls, 'language'),
    topObjections,
  };
}

export async function aiInsights() {
  const calls = db.listCalls().slice(0, 30);
  if (calls.length === 0) return { insights: ['No calls yet. Make a few calls to generate insights.'] };

  const stats = computeStats();
  const digest = calls.map((c) =>
    `- [${c.sentiment}, lead ${c.lead_category || 'n/a'} ${c.lead_score ?? ''}] ${c.summary} | intent: ${c.intent} | objections: ${c.objections.join('; ') || 'none'}`
  ).join('\n');

  const content = await generate(
    [{ role: 'user', parts: [{ text: `STATS: ${JSON.stringify(stats)}\n\nCALLS:\n${digest}` }] }],
    { system: INSIGHTS_PROMPT, jsonSchema: insightsSchema, temperature: 0.4 }
  );
  return JSON.parse(content.parts.map((p) => p.text || '').join(''));
}
