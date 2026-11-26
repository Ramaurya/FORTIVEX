const $ = (id) => document.getElementById(id);

function bars(obj, classPrefix) {
  const total = Object.values(obj).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(obj).map(([k, v]) => `
    <div class="bar-row">
      <span class="bar-label">${esc(k)}</span>
      <div class="bar-track"><div class="bar-fill ${classPrefix}${esc(k.toLowerCase())}" style="width:${(v / total) * 100}%"></div></div>
      <span class="bar-val">${v}</span>
    </div>`).join('');
}

function fmtDuration(sec) {
  sec = sec || 0;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

async function load() {
  const [stats, leads, appts, calls] = await Promise.all([
    api('/api/stats'), api('/api/leads'), api('/api/appointments'), api('/api/calls'),
  ]);

  // KPI tiles
  const kpis = [
    ['Total calls', stats.totalCalls],
    ['Leads captured', stats.totalLeads],
    ['Hot leads', stats.leadsByCategory.Hot],
    ['Demos booked', stats.totalAppointments],
    ['Call → demo rate', `${stats.conversionRate}%`],
    ['Avg lead score', stats.avgLeadScore],
    ['Avg sentiment', stats.avgSentiment],
    ['Avg call length', fmtDuration(stats.avgCallDurationSec)],
  ];
  $('kpis').innerHTML = kpis.map(([label, value]) =>
    `<div class="kpi"><div class="kpi-val">${esc(value)}</div><div class="kpi-label">${esc(label)}</div></div>`).join('');

  $('leadDist').innerHTML = bars(stats.leadsByCategory, 'c-');
  $('sentDist').innerHTML = bars(stats.sentimentBreakdown, 's-');
  $('objections').innerHTML = stats.topObjections.length
    ? `<ol class="obj-list">${stats.topObjections.map((o) => `<li>${esc(o.objection)} <small>×${o.count}</small></li>`).join('')}</ol>`
    : '<p class="empty">No objections recorded yet.</p>';

  // Leads table
  $('leadsTable').innerHTML = `
    <thead><tr><th>Name</th><th>Company</th><th>Contact</th><th>Need</th><th>Budget</th><th>Timeline</th><th>Score</th><th>Category</th><th>Demos</th></tr></thead>
    <tbody>${leads.length ? leads.map((l) => `
      <tr>
        <td><b>${esc(l.name || '—')}</b></td><td>${esc(l.company || '—')}</td>
        <td>${esc(l.email || '')}<br><small>${esc(l.phone || '')}</small></td>
        <td>${esc(l.need || '—')}</td><td>${esc(l.budget || '—')}</td><td>${esc(l.timeline || '—')}</td>
        <td>${l.score}</td><td>${categoryBadge(l.category)}</td><td>${l.appointment_count}</td>
      </tr>`).join('') : '<tr><td colspan="9" class="empty">No leads yet.</td></tr>'}</tbody>`;

  // Appointments table
  $('apptTable').innerHTML = `
    <thead><tr><th>Date</th><th>Time</th><th>Lead</th><th>Company</th><th>Email</th><th>Purpose</th><th>Status</th></tr></thead>
    <tbody>${appts.length ? appts.map((a) => `
      <tr><td>${esc(a.date)}</td><td>${esc(a.time)}</td><td>${esc(a.lead_name || '—')}</td><td>${esc(a.lead_company || '—')}</td>
      <td>${esc(a.lead_email || '—')}</td><td>${esc(a.purpose)}</td><td><span class="badge hot">${esc(a.status)}</span></td></tr>`).join('')
      : '<tr><td colspan="7" class="empty">No appointments yet.</td></tr>'}</tbody>`;

  // Calls
  $('calls').innerHTML = calls.length ? calls.map((c) => `
    <details class="call-item">
      <summary>
        <span><b>#${c.id}</b> ${esc(c.started_at)} · ${esc(c.lead_name || 'Unknown')} · ${esc(c.language)} · ${fmtDuration(c.duration_sec)}</span>
        <span>${sentimentBadge(c.sentiment)} ${categoryBadge(c.lead_category)}</span>
      </summary>
      <p>${esc(c.summary)}</p>
      <p><b>Intent:</b> ${esc(c.intent)} &nbsp; <b>Next steps:</b> ${esc(c.next_steps.join('; ') || '—')}</p>
      <div class="mini-transcript">${c.transcript.map((t) =>
        `<div class="msg ${t.role}"><span class="who">${t.role === 'agent' ? 'Agent' : 'Customer'}</span><p>${esc(t.text)}</p></div>`).join('')}</div>
    </details>`).join('') : '<p class="empty">No calls yet. Go to "Live Call" to make one.</p>';
}

$('refreshBtn').onclick = load;
$('resetBtn').onclick = async () => {
  if (!confirm('Delete all leads, calls and appointments?')) return;
  await api('/api/reset', { method: 'POST' });
  load();
};
$('insightsBtn').onclick = async () => {
  $('insights').innerHTML = '<li class="empty">Analysing calls…</li>';
  try {
    const { insights } = await api('/api/insights');
    $('insights').innerHTML = insights.map((i) => `<li>💡 ${esc(i)}</li>`).join('');
  } catch (err) {
    $('insights').innerHTML = `<li class="empty">Error: ${esc(err.message)}</li>`;
  }
};

load().catch((err) => alert(err.message));
