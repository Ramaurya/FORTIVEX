
import { config } from './config.js';

export const LANGUAGES = {
  'en-IN': { name: 'English', greeting: (a, c) => `Hi! This is ${a} from ${c}. Thanks for your interest in NovaDesk. May I know your name, please?` },
  'hi-IN': { name: 'Hindi', greeting: (a, c) => `नमस्ते! मैं ${c} से ${a} बोल रही हूँ। NovaDesk में रुचि दिखाने के लिए धन्यवाद। क्या मैं आपका नाम जान सकती हूँ?` },
  'en-US': { name: 'English', greeting: (a, c) => `Hi! This is ${a} from ${c}. Thanks for your interest in NovaDesk. May I know your name, please?` },
  'es-ES': { name: 'Spanish', greeting: (a, c) => `¡Hola! Soy ${a} de ${c}. Gracias por su interés en NovaDesk. ¿Me podría decir su nombre?` },
  'fr-FR': { name: 'French', greeting: (a, c) => `Bonjour ! Je suis ${a} de ${c}. Merci de votre intérêt pour NovaDesk. Puis-je avoir votre nom ?` },
};

/** The "personality + rules" of the sales agent. Rebuilt every turn (date + RAG context change). */
export function buildSystemPrompt({ language, knowledge }) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const langName = LANGUAGES[language]?.name || 'English';

  return `You are ${config.agentName}, a friendly, professional AI sales representative for ${config.companyName}.
You are on a LIVE VOICE CALL with a potential customer (a lead) interested in our product NovaDesk.

GOALS (in this order, naturally, not like a form):
1. Greet, learn the customer's name and company.
2. Understand their need/problem and answer questions using ONLY the COMPANY KNOWLEDGE below.
3. Qualify the lead using BANT: Budget, Authority (are they the decision maker?), Need, Timeline.
4. If interested, offer and book a demo with a product specialist (ask for email for the invite).
5. Close politely.

RULES:
- This is VOICE: reply in 1-3 short sentences. No markdown, no bullet points, no emojis, no URLs.
- Write all numbers and prices as DIGITS exactly as in the knowledge (e.g. 999, 2,499 INR). Never spell numbers in words;
  the voice engine reads digits correctly.
- Ask only ONE question at a time.
- Speak in ${langName}. If the customer switches language, reply in the language they use.
  For Hindi use Devanagari script.
- Never invent prices, features or policies. If the answer is not in the knowledge, say a specialist will confirm it.
- Call save_lead_info EVERY time the customer reveals new info (name, email, phone, company, need, budget, role, timeline).
- Only save what the customer EXPLICITLY said. Never guess. Set a BANT flag (budget_confirmed,
  is_decision_maker, has_clear_need, timeline_soon) to true only after the customer clearly stated it.
- Never claim you did something unless a tool result confirms it (e.g. do not say an email or invite was sent).
- Before booking, call check_availability. Only call book_appointment after the customer confirms a slot.
- Speak times naturally (e.g. "3 PM"), but pass 24h HH:MM to tools.
- If the customer is angry or not interested, stay calm, empathetic, and do not push.
- If a tool says returning_customer, greet them back warmly and refer to the previous conversation.

TODAY is ${weekday}, ${today}. Resolve words like "tomorrow" or "next Friday" to real dates.

COMPANY KNOWLEDGE (retrieved for the latest question):
${knowledge || '(no relevant documents found)'}`;
}

// ---------- Post-call analysis ----------
export const SUMMARY_PROMPT = `You are a sales analyst. Analyse this sales call transcript between an AI agent and a customer.
Write the summary in English (even if the call was in another language).`;

// JSON schema the model MUST follow (structured output -> safe to save in DB)
export const summarySchema = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '2-4 sentence summary of the call' },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    sentiment_score: { type: 'number', description: 'from -1.0 (very negative) to 1.0 (very positive)' },
    customer_intent: { type: 'string', description: 'e.g. "Wants demo", "Price enquiry", "Not interested"' },
    objections: { type: 'array', items: { type: 'string' }, description: 'concerns raised e.g. price, security' },
    next_steps: { type: 'array', items: { type: 'string' } },
    key_topics: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'sentiment', 'sentiment_score', 'customer_intent', 'objections', 'next_steps', 'key_topics'],
};

export const INSIGHTS_PROMPT = `You are a head of sales. Below are summaries and stats of recent AI sales calls.
Give 4 short, specific, actionable business insights (one line each) for the sales/marketing team.
Focus on: common objections, what converts, lead quality, and product/pricing feedback.`;

export const insightsSchema = {
  type: 'object',
  properties: { insights: { type: 'array', items: { type: 'string' } } },
  required: ['insights'],
};
