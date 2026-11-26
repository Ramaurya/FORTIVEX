

const $ = (id) => document.getElementById(id);
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let sessionId = null;
let state = 'idle';           // idle | listening | thinking | speaking
let recognition = null;
let voices = [];

// Load TTS voices (Chrome loads them asynchronously)
function loadVoices() { voices = speechSynthesis.getVoices(); }
speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

// ---------------- UI helpers ----------------
function setState(newState, text) {
  state = newState;
  $('orb').className = `orb ${newState}`;
  $('statusText').textContent = text || {
    idle: 'Ready.', listening: '🎤 Listening… speak now', thinking: '🧠 Thinking…', speaking: '🔊 Agent speaking…',
  }[newState];
}

function addMessage(role, text) {
  const box = $('transcript');
  box.querySelector('.empty')?.remove();
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = `<span class="who">${role === 'agent' ? 'Agent' : 'You'}</span><p>${esc(text)}</p>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function renderLead(lead) {
  if (!lead) return;
  $('leadCard').innerHTML = `
    <div class="lead-head">
      <div><b>${esc(lead.name || 'Unknown caller')}</b><br><small>${esc(lead.company || '')}</small></div>
      ${categoryBadge(lead.category)}
    </div>
    <div class="score"><div class="score-bar" style="width:${lead.score}%"></div></div>
    <small>Lead score: <b>${lead.score}</b>/100</small>
    ${bantHtml(lead)}
    <div class="contact">${esc(lead.email || '')} ${esc(lead.phone || '')}</div>`;
}

function renderActions(actions) {
  if (!actions.length) return;
  const ul = $('actions');
  ul.querySelector('.empty')?.remove();
  for (const a of actions) {
    const li = document.createElement('li');
    const ok = !a.result.error;
    li.className = ok ? 'ok' : 'err';
    li.innerHTML = `<code>${esc(a.tool)}</code> ${ok ? '✓' : '✗'}
      <details><summary>details</summary><pre>${esc(JSON.stringify({ args: a.args, result: a.result }, null, 2))}</pre></details>`;
    ul.prepend(li);
  }
}

function renderSources(sources) {
  $('sources').innerHTML = sources.length
    ? sources.map((s) => `<li><code>${esc(s.source)}</code> <small>similarity ${s.score}</small></li>`).join('')
    : '<li class="empty">—</li>';
}

// ---------------- TTS: speak text ----------------
function speak(text) {
  return new Promise((resolve) => {
    if (!$('voiceMode').checked) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const lang = $('language').value;
    u.lang = lang;
    // Pick a voice for this language (prefer Google voices — they sound better)
    const match = voices.filter((v) => v.lang.replace('_', '-').startsWith(lang.split('-')[0]));
    u.voice = match.find((v) => v.lang === lang && /Google/.test(v.name)) || match.find((v) => v.lang === lang) || match[0] || null;
    u.rate = 1.05;
    u.onend = resolve;
    u.onerror = resolve;
    setState('speaking');
    speechSynthesis.speak(u);
  });
}

// ---------------- STT: listen to the mic ----------------
function startListening() {
  if (state === 'thinking') return; // waiting for the AI -> don't listen yet
  stopListening();                  // never run two recognizers at once
  if (!sessionId || !$('voiceMode').checked) { setState('idle', 'Type your message below.'); return; }
  if (!SpeechRecognition) { setState('idle', 'Speech recognition not supported — use Chrome, or type below.'); return; }

  recognition = new SpeechRecognition();
  recognition.lang = $('language').value;
  recognition.interimResults = true;   // show words while user is still speaking
  recognition.continuous = false;      // stop automatically after the user pauses
  let finalText = '';

  recognition.onresult = (e) => {
    let interim = '';
    for (const r of e.results) (r.isFinal ? (finalText = r[0].transcript) : (interim += r[0].transcript));
    $('interim').textContent = interim;
  };
  recognition.onerror = (e) => {
    if (e.error === 'not-allowed') setState('idle', 'Microphone permission denied. Allow mic or type below.');
  };
  recognition.onend = () => {
    $('interim').textContent = '';
    if (finalText.trim()) sendMessage(finalText.trim());
    else if (state === 'listening' && sessionId) startListening(); // silence -> keep listening
  };

  setState('listening');
  recognition.start();
}

function stopListening() {
  if (recognition) { recognition.onend = null; recognition.abort(); recognition = null; }
}

// ---------------- Call flow ----------------
async function startCall() {
  $('transcript').innerHTML = '';
  $('actions').innerHTML = '<li class="empty">None yet.</li>';
  $('leadCard').innerHTML = '<div class="empty">No lead yet.</div>';
  try {
    const data = await api('/api/calls/start', { method: 'POST', body: { language: $('language').value } });
    sessionId = data.sessionId;
    toggleControls(true);
    addMessage('agent', data.greeting);
    await speak(data.greeting);
    startListening();
  } catch (err) {
    setState('idle', `Error: ${err.message}`);
  }
}

async function sendMessage(text) {
  if (!sessionId || state === 'thinking') return;
  stopListening();
  addMessage('customer', text);
  setState('thinking');
  try {
    const data = await api(`/api/calls/${sessionId}/message`, { method: 'POST', body: { text } });
    addMessage('agent', data.reply);
    renderLead(data.lead);
    renderActions(data.actions);
    renderSources(data.sources);
    await speak(data.reply);
  } catch (err) {
    addMessage('agent', `[Error: ${err.message}]`);
  }
  if (state === 'thinking') setState('idle'); // text mode / error: unlock input
  if (sessionId) startListening();
}

async function endCall() {
  const id = sessionId;
  sessionId = null;
  stopListening();
  speechSynthesis.cancel();
  toggleControls(false);
  setState('thinking', '📝 Generating call summary…');
  try {
    const s = await api(`/api/calls/${id}/end`, { method: 'POST' });
    renderLead(s.lead);
    showSummary(s);
    setState('idle', 'Call ended.');
  } catch (err) {
    setState('idle', `Error: ${err.message}`);
  }
}

function showSummary(s) {
  const list = (arr) => (arr?.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p>—</p>');
  $('summaryBody').innerHTML = `
    <p>${esc(s.summary)}</p>
    <div class="summary-grid">
      <div><h4>Sentiment</h4>${sentimentBadge(s.sentiment)} <small>(${s.sentiment_score})</small></div>
      <div><h4>Lead</h4>${categoryBadge(s.lead?.category)} <small>score ${s.lead?.score ?? 0}/100</small></div>
      <div><h4>Intent</h4><p>${esc(s.customer_intent)}</p></div>
    </div>
    <h4>Objections</h4>${list(s.objections)}
    <h4>Next steps</h4>${list(s.next_steps)}
    <h4>Topics</h4><p>${(s.key_topics || []).map((t) => `<span class="chip">${esc(t)}</span>`).join(' ')}</p>`;
  $('summaryModal').classList.remove('hidden');
}

function toggleControls(inCall) {
  $('startBtn').disabled = inCall;
  $('endBtn').disabled = !inCall;
  $('language').disabled = inCall;
  $('textInput').disabled = !inCall;
  $('sendBtn').disabled = !inCall;
  $('micBtn').disabled = !inCall;
}

// ---------------- Events ----------------
$('startBtn').onclick = startCall;
$('endBtn').onclick = endCall;
$('closeModal').onclick = () => $('summaryModal').classList.add('hidden');
$('micBtn').onclick = () => { speechSynthesis.cancel(); stopListening(); startListening(); };
$('voiceMode').onchange = () => {
  if (!$('voiceMode').checked) { stopListening(); speechSynthesis.cancel(); setState('idle', 'Text mode. Type below.'); }
  else if (sessionId && state !== 'thinking') startListening();
};
$('textForm').onsubmit = (e) => {
  e.preventDefault();
  const text = $('textInput').value.trim();
  if (!text) return;
  $('textInput').value = '';
  sendMessage(text);
};
