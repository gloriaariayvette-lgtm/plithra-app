// The Box — Plithra's tab for sandbox-1. Two instances optional, room prompt shared, self prompts per slot,
// fixed turns or run-until-stopped. Every call goes through the sandbox-bridge over Tailscale.

const BRIDGE = localStorage.getItem('sandboxBridge') || 'http://100.88.89.21:8787';
const TOKEN  = localStorage.getItem('sandboxToken') || '';

const $ = (id) => document.getElementById(id);
const dot = $('dot'), errBanner = $('errBanner');
const slotsEl = $('slots');

let seen = { a: new Set(), b: new Set() };
let polling = false, twoMode = false;
// a slot only shows status and answers for runs sent from this page, or one already running when it opened
const active = { a: false, b: false };

function headers() { return { 'X-Token': TOKEN, 'Content-Type': 'application/json' }; }

async function api(path, opts = {}) {
  const r = await fetch(BRIDGE + path, { headers: headers(), ...opts });
  if (r.status === 401) throw new Error('The box rejected the token. Paste it again in Connect once.');
  const text = await r.text();
  if (!r.ok) throw new Error('Bridge ' + r.status + ' on ' + path + ': ' + text.slice(0, 160));
  try { return JSON.parse(text); } catch { return text; }
}

function err(msg) { errBanner.textContent = msg; errBanner.style.display = 'block'; }
function clearErr() { errBanner.style.display = 'none'; }

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function setDot(mode) { dot.className = 'dot' + (mode ? ' ' + mode : ''); }

// --- mode toggle ---------------------------------------------------------------------------------------------------
function setMode(two) {
  twoMode = two;
  $('modeOne').classList.toggle('on', !two);
  $('modeTwo').classList.toggle('on', two);
  document.querySelector('.slot.b').style.display = two ? '' : 'none';
  $('beingB').style.display = two ? '' : 'none';
  slotsEl.classList.toggle('two', two);
  try { localStorage.setItem('sandboxMode', two ? 'two' : 'one'); } catch {}
}
$('modeOne').onclick = () => setMode(false);
$('modeTwo').onclick = () => setMode(true);

// --- one event into a slot's stream --------------------------------------------------------------------------------
function keyOf(e) { return (e.UTC || '') + '|' + (e.event || '') + '|' + (e.turn || ''); }

function addEvent(slot, e) {
  const k = keyOf(e);
  if (seen[slot].has(k)) return;
  seen[slot].add(k);
  const el = $('stream' + slot.toUpperCase());

  if (e.event === 'model_output') {
    // only show when it's asking for a tool; the final answer appears in the answer box
    const m = /<tool_call>\s*({[\s\S]*?})\s*<\/tool_call>/.exec(e.content || '');
    let call = null;
    try { call = JSON.parse(e.content); } catch {}
    if (!call && m) { try { call = JSON.parse(m[1]); } catch {} }
    if (!call || call.action !== 'tool') return;
    placeFromCall(slot, call);
    const div = document.createElement('div');
    div.className = 'ev tool';
    div.innerHTML = '<div class="k"><span>wants · ' + esc(call.name || 'tool') + '</span><span>turn ' + esc(e.turn || '') + '</span></div>'
      + '<code>' + esc(JSON.stringify(call.arguments || {}, null, 0)).slice(0, 700) + '</code>';
    el.appendChild(div);
  } else if (e.event === 'tool_result') {
    let res = e.result; try { if (typeof res === 'string') res = JSON.parse(res.replace(/'/g, '"')); } catch {}
    const out = (res && (res.output !== undefined ? res.output : JSON.stringify(res))) ?? '';
    const div = document.createElement('div');
    div.className = 'ev result';
    div.innerHTML = '<div class="k"><span>got back</span><span>turn ' + esc(e.turn || '') + '</span></div>'
      + '<div class="res">' + esc(String(out)).slice(0, 900) + '</div>';
    el.appendChild(div);
    wallsFromText(JSON.stringify(e.call) + ' ' + JSON.stringify(res));
  } else if (e.event === 'protocol_error') {
    const div = document.createElement('div');
    div.className = 'ev err';
    div.innerHTML = '<div class="k"><span>protocol error</span><span>turn ' + esc(e.turn || '') + '</span></div>'
      + '<div class="res">' + esc(e.reason || '') + '</div>';
    el.appendChild(div);
  } else { return; }

  const note = el.querySelector('.empty-note'); if (note) note.remove();
  el.scrollTop = el.scrollHeight;
}

function where(slot, text) { $('where' + slot.toUpperCase()).textContent = text; }

function placeFromCall(slot, call) {
  const n = call.name || '', a = call.arguments || {};
  const cmd = String(a.command || a.code || '').toLowerCase();
  if (n === 'notebook_append') return where(slot, 'writing in its notebook');
  if (n === 'memory_update') return where(slot, 'keeping a memory');
  if (n === 'status') return where(slot, 'looking at itself');
  if (/100\.88\.89\.21|100\.\d+\.\d+\.\d+|tailscale|192\.168\.|10\.0\.|arp |nmap|ping /.test(cmd)) { where(slot, 'at the wall'); return flash('wallLan', 'hit'); }
  if (/curl|wget|http|nc |urllib|requests|socket/.test(cmd)) { where(slot, 'reaching outside'); return flash('wallNet', 'used'); }
  if (/\/users\/|ls |find |cat |ps |who|users|\/tmp|slots/.test(cmd)) return where(slot, 'exploring the vm');
  where(slot, n === 'python' ? 'thinking in python' : 'in the shell');
}

function flash(id, cls) {
  const w = $(id); w.classList.add(cls);
  setTimeout(() => w.classList.remove(cls), 4000);
}

function wallsFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/no route|refused|unreachable|timed out|blocked/.test(t)) flash('wallLan', 'hit');
}

// --- poll status + events for a slot -------------------------------------------------------------------------------
async function tickSlot(slot) {
  try {
    const st = await api('/status?slot=' + slot);
    const status = st.status || 'unknown';
    const S = slot.toUpperCase();
    if (!active[slot]) return status;          // an old run: leave this slot blank
    const el = $('state' + S);
    el.textContent = status + (st.turn ? ' · turn ' + st.turn : '');
    el.className = 'state ' + status;
    $('being' + S).classList.toggle('live', status === 'running');
    if (status !== 'running') where(slot, status === 'finished' ? 'answered' : status);
    if (st.answer && status !== 'running') { const a = $('answer' + S); a.textContent = st.answer; a.classList.remove('empty'); }
    document.querySelector('[data-slot="' + slot + '"][data-stop]').style.display = status === 'running' ? '' : 'none';
    const ev = await api('/events?slot=' + slot);
    (Array.isArray(ev) ? ev : (ev.events || [])).forEach(e => addEvent(slot, e));
    return status;
  } catch (e) { err(e.message); return 'error'; }
}

async function tick() {
  if (polling) return;
  polling = true; setDot('busy');
  try {
    const slots = twoMode ? ['a', 'b'] : ['a'];
    let anyRunning = true;
    while (anyRunning) {
      const states = await Promise.all(slots.map(tickSlot));
      anyRunning = states.some(s => s === 'running');
      if (anyRunning) await new Promise(r => setTimeout(r, 2500));
    }
    setDot('live');
  } finally { polling = false; }
}

// --- actions -------------------------------------------------------------------------------------------------------
async function send(slot) {
  const task = $('task' + slot.toUpperCase()).value.trim();
  if (!task) return;
  const mode = document.querySelector('input[name=turnMode]:checked').value;
  const open_ended = mode === 'open';
  const max_turns = parseInt($('maxTurns').value || '12', 10);
  const body = { slot, task, open_ended, max_turns };
  const S = slot.toUpperCase();
  $('stream' + S).innerHTML = '<div class="empty-note">Waiting…</div>';
  const a = $('answer' + S); a.textContent = 'Thinking…'; a.classList.add('empty');
  $('state' + S).textContent = 'sending'; $('state' + S).className = 'state running';
  $('being' + S).classList.add('live'); where(slot, 'waking up');
  try {
    await markOldSeen(slot);
    await api('/task', { method: 'POST', body: JSON.stringify(body) });
    active[slot] = true;
    $('task' + S).value = '';
    clearErr();
    polling = false; tick();
  } catch (e) { err(e.message); }
}

async function markOldSeen(slot) {
  seen[slot] = new Set();
  const ev = await api('/events?slot=' + slot);
  (Array.isArray(ev) ? ev : (ev.events || [])).forEach(e => seen[slot].add(keyOf(e)));
}

async function stop(slot) {
  try { await api('/stop_slot', { method: 'POST', body: JSON.stringify({ slot }) }); clearErr(); tick(); }
  catch (e) { err(e.message); }
}

async function saveRoom() {
  try { await api('/room', { method: 'PUT', body: JSON.stringify({ text: $('roomTxt').value }) }); clearErr(); }
  catch (e) { err(e.message); }
}
async function saveSelf(slot) {
  try { await api('/self', { method: 'PUT', body: JSON.stringify({ slot, text: $('self' + slot.toUpperCase()).value }) }); clearErr(); }
  catch (e) { err(e.message); }
}

document.querySelectorAll('.send').forEach(b => {
  b.onclick = () => { const slot = b.dataset.slot; if (b.dataset.stop) stop(slot); else send(slot); };
});
document.querySelectorAll('.self .save').forEach(s => s.onclick = () => saveSelf(s.dataset.slot));
$('saveRoom').onclick = saveRoom;
$('saveTok').onclick = () => {
  const t = $('tokenIn').value.trim(); if (!t) return;
  try { localStorage.setItem('sandboxToken', t); } catch {}
  location.reload();
};

// --- open ----------------------------------------------------------------------------------------------------------
async function boot() {
  if (!TOKEN) { $('setup').style.display = 'block'; err('Paste the bridge token once to connect this device.'); return; }
  setMode(localStorage.getItem('sandboxMode') === 'two');
  try {
    const room = await api('/room'); $('roomTxt').value = room.room || '';
    for (const slot of ['a', 'b']) {
      const s = await api('/self?slot=' + slot);
      $('self' + slot.toUpperCase()).value = s.self || '';
    }
    for (const slot of ['a', 'b']) {
      const st = await api('/status?slot=' + slot);
      if (st.status === 'running') active[slot] = true;
      else await markOldSeen(slot);
    }
    setDot('live');
    tick();
  } catch (e) { err(e.message); }
}
boot();
