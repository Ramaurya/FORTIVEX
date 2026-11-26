
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Small wrapper around fetch for our REST API
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function categoryBadge(category) {
  const c = category || 'Cold';
  return `<span class="badge ${c.toLowerCase()}">${esc(c)}</span>`;
}

function sentimentBadge(s) {
  const icon = { positive: '🙂', neutral: '😐', negative: '🙁' }[s] || '😐';
  return `<span class="badge s-${esc(s || 'neutral')}">${icon} ${esc(s || 'neutral')}</span>`;
}

// BANT checklist (Budget, Authority, Need, Timeline)
function bantHtml(lead) {
  const items = [
    ['B', 'Budget', lead.budget_confirmed, lead.budget],
    ['A', 'Authority', lead.is_decision_maker, lead.is_decision_maker ? 'Decision maker' : ''],
    ['N', 'Need', lead.has_clear_need, lead.need],
    ['T', 'Timeline', lead.timeline_soon, lead.timeline],
  ];
  return `<div class="bant">${items.map(([k, label, ok, detail]) => `
    <div class="bant-item ${ok ? 'ok' : ''}" title="${esc(detail || 'unknown')}">
      <b>${k}</b><span>${label}</span><small>${esc(detail || '—')}</small>
    </div>`).join('')}</div>`;
}
