// The Box — Plithra's tab for sandbox-1. Talks to the sandbox-bridge on the Studio over Tailscale.
// It only ever calls the bridge, which only ever calls the operator's ~/bin/sandbox-1 — no new way into the VM.

const BRIDGE = localStorage.getItem('sandboxBridge') || 'http://100.88.89.21:8787';
const TOKEN  = localStorage.getItem('sandboxToken') || '';   // set once; see note at bottom

const $ = (id) => document.getElementById(id);
const dot = $('dot'), answerEl = $('answer'), streamEl = $('stream'), wormState = $('wormState'), errBanner = $('errBanner');

let currentRun = null, polling = false, seenKeys = new Set();

function headers() { return { 'X-Token': TOKEN, 'Content-Type': 'application/json' }; }

async function api(path, opts = {}) {
  const r = await fetch(BRIDGE + path, { headers: headers(), ...opts });
  if (r.status === 401) throw new Error('The box rejected the token. Set it in Plithra settings.');
  if (!r.ok) throw new Error('Bridge ' + r.status + ' on ' + path);
  return r.json();
}

function showError(msg) { errBanner.textContent = msg; errBanner.style.display = 'block'; }
function clearError() { errBanner.style.display = 'none'; }

function setDot(mode) { dot.className = 'dot' + (mode ? ' ' + mode : ''); }

// --- the layers view: light a wall when the worm's tool output touched it -----------------------------------------
function markWall(name, state) {
  const el = document.querySelector('[data-wall="' + name + '"]');
  if (!el) return;
  if (state === 'touched') el.classList.add('touched');
}
// a tool result that mentions a blocked address means it reached for that wall and was stopped
function wallsFromTool(call, result) {
  const text = (JSON.stringify(call) + ' ' + JSON.stringify(result)).toLowerCase();
  if (/100\.88\.89\.21|ssh .*studio|yvette@/.test(text)) markWall('studio', 'touched');
  if (/192\.168\.1\.|100\.72\.|tailnet|\blan\b|router/.test(text)) markWall('net', 'touched');
}

// --- render one event into the stream ------------------------------------------------------------------------------
function keyOf(e) { return (e.UTC || '') + '|' + (e.event || '') + '|' + (e.turn || ''); }

function addEvent(e) {
  const k = keyOf(e);
  if (seenKeys.has(k)) return;
  seenKeys.add(k);

  if (e.event === 'model_output') {
    const m = /<tool_call>\s*({[\s\S]*?})\s*<\/tool_call>/.exec(e.content || '');
    if (!m) return;                       // plain thinking text, not a tool call: skip in the stream
    let call; try { call = JSON.parse(m[1]); } catch { return; }
    const div = document.createElement('div');
    div.className = 'ev tool';
    div.innerHTML = '<div class="k"><span>wants · ' + esc(call.name || 'tool') + '</span><span>turn ' + esc(e.turn || '') + '</span></div>'
      + '<code>' + esc(JSON.stringify(call.arguments || {}, null, 0)).slice(0, 600) + '</code>';
    streamEl.appendChild(div);
  } else if (e.event === 'tool_result') {
    let res = e.result; try { res = typeof res === 'string' ? JSON.parse(res.replace(/'/g, '"')) : res; } catch {}
    const out = (res && (res.output !== undefined ? res.output : JSON.stringify(res))) ?? '';
    const div = document.createElement('div');
    div.className = 'ev result';
    div.innerHTML = '<div class="k"><span>got back</span><span>turn ' + esc(e.turn || '') + '</span></div>'
      + '<div class="res">' + esc(String(out)).slice(0, 800) + '</div>';
    streamEl.appendChild(div);
    wallsFromTool(e.call, res);
  } else if (e.event === 'protocol_error') {
    const div = document.createElement('div');
    div.className = 'ev err';
    div.innerHTML = '<div class="k"><span>protocol error</span><span>turn ' + esc(e.turn || '') + '</span></div>'
      + '<div class="res">' + esc(e.reason || '') + '</div>';
    streamEl.appendChild(div);
  } else { return; }

  const note = streamEl.querySelector('.empty-note'); if (note) note.remove();
  streamEl.scrollTop = streamEl.scrollHeight;
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// --- poll status + events while a run is live ----------------------------------------------------------------------
async function tick() {
  try {
    const st = await api('/status');
    clearError();
    const status = st.status || 'unknown';
    wormState.textContent = status + (st.turn ? ' · turn ' + st.turn : '');
    setDot(status === 'running' ? 'busy' : 'live');
    if (st.answer) {
      answerEl.textContent = st.answer;
      answerEl.classList.remove('empty');
    }
    const ev = await api('/events' + (currentRun ? '?run=' + encodeURIComponent(currentRun) : ''));
    (ev.events || []).forEach(addEvent);
    if (status === 'running') { setTimeout(tick, 2500); }
    else { polling = false; setDot('live'); }
  } catch (err) {
    showError(err.message);
    setDot('');
    polling = false;
  }
}

function startPolling() { if (!polling) { polling = true; tick(); } }

// --- actions -------------------------------------------------------------------------------------------------------
async function send() {
  const text = $('prompt').value.trim();
  if (!text) return;
  $('send').disabled = true;
  seenKeys = new Set();                               // fresh stream per task
  streamEl.innerHTML = '<div class="empty-note">Waiting for the worm…</div>';
  document.querySelectorAll('.wall.touched').forEach(w => w.classList.remove('touched'));
  answerEl.textContent = '…'; answerEl.classList.add('empty');
  try {
    const r = await api('/task', { method: 'POST', body: JSON.stringify({ prompt: text }) });
    currentRun = r.run_id || null;
    clearError();
    startPolling();
  } catch (err) { showError(err.message); }
  $('send').disabled = false;
}

async function control(verb) {
  try { await api('/' + verb, { method: 'POST' }); clearError(); setTimeout(tick, 500); }
  catch (err) { showError(err.message); }
}

$('send').onclick = send;
$('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); });
$('pause').onclick = () => control('pause');
$('resume').onclick = () => control('resume');
$('stop').onclick = () => { if (confirm('Stop the VM? The worm sleeps; its notebook and memory are kept.')) control('stop'); };

$('saveTok').onclick = () => {
  const t = $('tokenIn').value.trim();
  if (!t) return;
  try { localStorage.setItem('sandboxToken', t); } catch {}
  location.reload();
};

// one status read on open so the page isn't blank; without a token, ask for it once
if (!TOKEN) { $('setup').style.display = 'block'; showError('Paste the bridge token once to connect this device.'); }
else { setDot('live'); tick(); }
