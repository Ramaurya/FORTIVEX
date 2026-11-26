
import * as db from './db.js';

// Business hours for demo slots
const SLOT_TIMES = ['10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'];

// ---------- 1) Tool DECLARATIONS (what the model sees) ----------
export const toolDeclarations = [
  {
    name: 'save_lead_info',
    description:
      'Save or update information about the customer in the CRM as soon as they share it ' +
      '(name, contact, company, need) and BANT qualification signals. Call it whenever new info appears. ' +
      'Only include fields you actually learned.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Customer full name' },
        email: { type: 'string' },
        phone: { type: 'string' },
        company: { type: 'string' },
        need: { type: 'string', description: 'The business problem/use-case the customer wants to solve (not the questions they asked)' },
        budget: { type: 'string', description: 'Budget as said by the customer, e.g. "around 50,000 INR per month"' },
        timeline: { type: 'string', description: 'When they plan to buy/start, e.g. "next month"' },
        budget_confirmed: { type: 'boolean', description: 'true ONLY if the customer stated a budget that can afford at least the Starter plan' },
        is_decision_maker: { type: 'boolean', description: 'true ONLY if the customer said they can approve the purchase (owner, manager, head, founder)' },
        has_clear_need: { type: 'boolean', description: 'true ONLY if the customer described a specific problem our product solves' },
        timeline_soon: { type: 'boolean', description: 'true ONLY if the customer said they plan to buy within ~3 months' },
      },
    },
  },
  {
    name: 'check_availability',
    description: 'Get free demo time slots for a specific date. Use before booking.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
      },
      required: ['date'],
    },
  },
  {
    name: 'book_appointment',
    description:
      'Book a demo/meeting with a sales specialist. Only call after the customer agreed to a ' +
      'specific date and time AND you know their name.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: '24h HH:MM, must be one of the free slots' },
        purpose: { type: 'string', description: 'e.g. "Product demo of NovaDesk Pro"' },
      },
      required: ['date', 'time'],
    },
  },
];

// ---------- Lead scoring (deterministic, in code — not by the LLM) ----------
// BANT: Budget, Authority, Need, Timeline -> 25 points each.
// Keeping the formula in code makes scoring consistent, auditable and easy to change.
export function scoreLead(lead) {
  const score =
    (lead.budget_confirmed ? 25 : 0) +
    (lead.is_decision_maker ? 25 : 0) +
    (lead.has_clear_need ? 25 : 0) +
    (lead.timeline_soon ? 25 : 0);
  const category = score >= 75 ? 'Hot' : score >= 50 ? 'Warm' : 'Cold';
  return { score, category };
}

// ---------- 2) Tool IMPLEMENTATIONS (what really runs) ----------
function saveLeadInfo(session, args) {
  let lead = db.updateLead(session.leadId, args);
  const { score, category } = scoreLead(lead);
  lead = db.updateLead(session.leadId, { score, category });

  const result = { status: 'saved', lead_score: score, category };

  // Cross-call memory: is this a returning customer (same email/phone)?
  if ((args.email || args.phone) && !session.returningChecked) {
    const previous = db.findExistingLead(args.email, args.phone, session.leadId);
    if (previous) {
      session.returningChecked = true;
      const pastCalls = db.callsForLead(previous.id).slice(0, 2);
      result.returning_customer = true;
      result.previous_interactions = pastCalls.map((c) => `${c.started_at}: ${c.summary}`);
    }
  }
  return result;
}

function checkAvailability({ date }) {
  const d = new Date(`${date}T00:00:00`);
  if (isNaN(d)) return { error: 'Invalid date. Use YYYY-MM-DD.' };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d < today) return { error: 'That date is in the past.' };
  if (d.getDay() === 0 || d.getDay() === 6) return { date, free_slots: [], note: 'We do not do demos on weekends.' };
  const booked = db.bookedTimes(date);
  return { date, free_slots: SLOT_TIMES.filter((t) => !booked.includes(t)) };
}

function bookAppointment(session, { date, time, purpose }) {
  const lead = db.getLead(session.leadId);
  if (!lead?.name) return { error: 'Ask the customer for their name before booking.' };
  const avail = checkAvailability({ date });
  if (avail.error) return avail;
  if (!avail.free_slots.includes(time)) {
    return { error: `Slot ${time} not available.`, free_slots: avail.free_slots };
  }
  const id = db.createAppointment({ leadId: session.leadId, date, time, purpose });
  // In production: also create a Google Calendar event + send confirmation email here.
  return {
    status: 'booked', appointment_id: id, date, time, with: lead.name,
    note: 'The sales specialist will email the meeting invite. No email has been sent yet.',
  };
}

/** Router: run the tool the model asked for. Never throws — errors go back to the model. */
export function runTool(session, name, args = {}) {
  try {
    switch (name) {
      case 'save_lead_info': return saveLeadInfo(session, args);
      case 'check_availability': return checkAvailability(args);
      case 'book_appointment': return bookAppointment(session, args);
      default: return { error: `Unknown tool ${name}` };
    }
  } catch (err) {
    return { error: err.message };
  }
}
