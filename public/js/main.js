// Tiki Taka — UI: controls, cards, bets list, auto play. Outcomes come from the API.
import { createApi } from './api.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (c) => `${+(c * 100).toFixed(1)}%`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LABEL = { safe: 'Short pass', standard: 'Through ball', risky: 'Long ball' };
const RESULT = { cashout: 'Cashed out', goal: 'Goal', intercepted: 'Intercepted', miss: 'Missed shot', max: 'Max win' };

let api, state, scene;
let busy = false;        // an animation or request is in flight
let mode = 'manual';
let difficulty = 'medium';
let auto = null;         // { left, start } while auto play runs
let list = 'bets';

/* ---------- match view (falls back to cards-only if the canvas cannot start) ---------- */
const nullScene = { reset() {}, layout() {}, playPass: () => sleep(350), playShot: () => sleep(450), playCashout: () => sleep(200) };
async function loadScene() {
  try {
    const { createScene } = await import('./scene.js');
    scene = await createScene($('canvasWrap'), { onPick: (p) => (p === 'shoot' ? shoot() : pass(p)), sfx });
    $('loading').hidden = true;
  } catch (e) {
    console.error('Match view unavailable', e);
    scene = nullScene;
    $('loading').textContent = 'The match view could not load on this device. You can still play with the cards below.';
    $('loading').style.alignItems = 'start'; $('loading').style.padding = '90px 20px'; $('loading').style.textAlign = 'center';
  }
}

/* ---------- rendering ---------- */
const round = () => state?.round;
const active = () => round()?.status === 'active';

function renderHud(pop) {
  const r = round();
  $('balance').textContent = fmt(state.balance);
  $('mult').textContent = `${fmt(active() || r?.status === 'won' ? r.multiplier : 1)}×`;
  $('passes').textContent = r && r.status !== undefined ? r.passes : 0;
  $('multSub').textContent = active() ? (r.canCashout ? `Win ${fmt(r.payout)}` : 'Make your first pass') : 'Place your bet';
  if (pop) { const m = $('mult').parentElement; m.classList.remove('up'); void m.offsetWidth; m.classList.add('up'); }
}

function renderControls() {
  const on = active();
  $('betBtn').disabled = mode === 'auto' ? false : on || busy;
  $('betBtn').textContent = mode === 'auto' ? (auto ? 'Stop auto' : 'Start auto') : 'Bet';
  $('cashBtn').disabled = !on || busy || !round().canCashout || !!auto;
  $('cashBtn').textContent = on && round().canCashout ? `Cash out ${fmt(round().payout)}` : 'Cash out';
  for (const el of document.querySelectorAll('#stake, #half, #double, #difficulty button, #autoFields input, #autoPass button, .panel .tab')) el.disabled = on || !!auto;
}

function renderCards() {
  const box = $('cards'), r = round();
  if (!active()) { box.hidden = true; return; }
  box.hidden = false; box.innerHTML = '';
  const card = (cls, num, name, tag, mult, chance, onClick) => {
    const b = document.createElement('button');
    b.className = 'card'; b.style.setProperty('--c', `var(--${cls})`); b.disabled = busy || !!auto;
    b.innerHTML = `<div class="name"><span class="num">${num}</span>${name}${tag ? `<span class="tag">${tag}</span>` : ''}</div><div class="x">${fmt(mult)}×</div><div class="pct">${pct(chance)}<span class="bar"><i style="width:${chance * 100}%"></i></span></div>`;
    b.addEventListener('click', onClick);
    box.appendChild(b);
  };
  r.options.forEach((o) => card(o.type, o.index + 1, LABEL[o.type], o.tag, o.multiplier, o.chance, () => pass(o.index)));
  if (r.shot) card('shot', 'S', 'Shoot', '', r.shot.multiplier, r.shot.chance, () => shoot());
}

function banner(text, sub, cls) {
  const b = $('banner');
  b.className = `banner ${cls}`; b.innerHTML = `${text}<small>${sub}</small>`; b.hidden = false;
}

async function renderList() {
  const head = $('listTable').tHead, body = $('listTable').tBodies[0];
  let rows = [];
  if (list === 'bets') {
    head.innerHTML = '<tr><th>Result</th><th>Passes</th><th>Bet</th><th>Multiplier</th><th>Payout</th></tr>';
    rows = state.bets.map((b) => `<tr><td>${RESULT[b.result] ?? b.result}</td><td>${b.passes}</td><td>${fmt(b.stake)}</td><td>${fmt(b.multiplier)}×</td><td class="${b.payout > 0 ? 'win' : 'lose'}">${fmt(b.payout)}</td></tr>`);
    $('listEmpty').textContent = 'No bets yet.';
  } else {
    head.innerHTML = '<tr><th>Player</th><th>Bet</th><th>Multiplier</th><th>Payout</th></tr>';
    const top = await api.leaderboard().catch(() => []);
    rows = top.map((b) => `<tr><td>${String(b.player).replace(/[<>&]/g, '')}</td><td>${fmt(b.stake)}</td><td>${fmt(b.multiplier)}×</td><td class="win">${fmt(b.payout)}</td></tr>`);
    $('listEmpty').textContent = 'No wins yet. Be the first.';
  }
  body.innerHTML = rows.join('');
  $('listEmpty').hidden = rows.length > 0;
}

function render(pop) { renderHud(pop); renderControls(); renderCards(); }
function hint(text, err) { $('hint').textContent = text; $('hint').classList.toggle('err', !!err); }

/* ---------- actions ---------- */
async function guard(fn) {
  if (busy) return false;
  busy = true; renderControls(); renderCards();
  try { await fn(); return true; }
  catch (e) { hint(e.message || 'Something went wrong', true); return false; }
  finally { busy = false; render(); }
}

function bet(fromAuto) {
  if (auto && !fromAuto) return Promise.resolve(false);
  return guard(async () => {
    const res = await api.start(Number($('stake').value), difficulty);
    state = res.state;
    $('banner').hidden = true;
    sfx.whistle(); sfx.crowd(true);
    scene.reset(round());
    hint('Pick a pass on the pitch or a card. Every completed pass grows your win.');
  });
}

function finish(outcome) {
  const r = round();
  if (r.status === 'won') {
    banner(outcome === 'goal' ? 'GOAL!' : outcome === 'max' ? 'MAX WIN!' : 'CASHED OUT', `${fmt(r.multiplier)}× · won ${fmt(r.payout)}`, 'win');
    if (outcome !== 'goal') sfx.cash();
  } else {
    banner(outcome === 'miss' ? 'NO GOAL' : 'INTERCEPTED', `Lost ${fmt(r.stake)}`, 'lose');
  }
  hint(r.status === 'won' ? `You won ${fmt(r.payout)}.` : 'Unlucky. Try again.');
  renderList();
}

function pass(i, fromAuto) {
  if (!active() || !round().options[i] || (auto && !fromAuto)) return Promise.resolve(false);
  return guard(async () => {
    const res = await api.action('pass', i);
    const ok = res.outcome === 'complete' || res.outcome === 'max';
    $('cards').hidden = true;
    await scene.playPass(i, ok).catch(console.error);
    state = res.state;
    if (res.outcome === 'complete') { sfx.tick(); renderHud(true); scene.layout(round()); }
    else { if (res.outcome === 'max') await scene.playCashout().catch(console.error); finish(res.outcome); }
  });
}

function shoot(fromAuto) {
  if (!active() || (auto && !fromAuto)) return Promise.resolve(false);
  return guard(async () => {
    const res = await api.action('shoot');
    $('cards').hidden = true;
    await scene.playShot(res.outcome === 'goal').catch(console.error);
    state = res.state;
    finish(res.outcome);
  });
}

function cashout(fromAuto) {
  if (!active() || !round().canCashout || (auto && !fromAuto)) return Promise.resolve(false);
  return guard(async () => {
    const res = await api.action('cashout');
    $('cards').hidden = true;
    await scene.playCashout().catch(console.error);
    state = res.state;
    finish(res.outcome);
  });
}

/* ---------- auto play ---------- */
async function runAuto() {
  const count = Math.max(0, Math.floor(Number($('autoCount').value) || 0));
  const passesGoal = Math.min(12, Math.max(1, Math.floor(Number($('autoPasses').value) || 1)));
  const stopProfit = Number($('autoProfit').value) || 0, stopLoss = Number($('autoLoss').value) || 0;
  const pick = Number(document.querySelector('#autoPass .active').dataset.p);
  auto = { left: count || Infinity, start: state.balance };
  render();
  while (auto && auto.left > 0) {
    if (!(await bet(true))) break;
    while (auto && active()) {
      const r = round();
      const done = r.passes >= passesGoal || !r.options.length;
      if (!(await (done ? cashout(true) : pass(pick, true)))) { auto = null; break; }
    }
    if (!auto) break;
    auto.left -= 1;
    const profit = state.balance - auto.start;
    if ((stopProfit > 0 && profit >= stopProfit) || (stopLoss > 0 && -profit >= stopLoss)) break;
    await sleep(900);
  }
  auto = null; render();
}

/* ---------- wiring ---------- */
function setStake(v) {
  const c = state.config;
  $('stake').value = Math.min(c.maxStake, Math.max(c.minStake, Math.round(v * 100) / 100));
}

function wire() {
  $('betBtn').addEventListener('click', () => {
    if (mode === 'auto') { if (auto) { auto = null; render(); } else runAuto(); } else bet();
  });
  $('cashBtn').addEventListener('click', () => cashout());
  $('half').addEventListener('click', () => setStake(Number($('stake').value) / 2));
  $('double').addEventListener('click', () => setStake(Number($('stake').value) * 2));
  $('stake').addEventListener('change', () => setStake(Number($('stake').value) || state.config.defaultStake));
  for (const b of document.querySelectorAll('#difficulty button')) b.addEventListener('click', () => {
    difficulty = b.dataset.d;
    document.querySelectorAll('#difficulty button').forEach((x) => x.classList.toggle('active', x === b));
  });
  for (const b of document.querySelectorAll('#autoPass button')) b.addEventListener('click', () => {
    document.querySelectorAll('#autoPass button').forEach((x) => x.classList.toggle('active', x === b));
  });
  for (const t of document.querySelectorAll('.panel .tab')) t.addEventListener('click', () => {
    mode = t.dataset.mode;
    document.querySelectorAll('.panel .tab').forEach((x) => x.classList.toggle('active', x === t));
    $('autoFields').hidden = mode !== 'auto';
    render();
  });
  for (const t of document.querySelectorAll('.below .tab')) t.addEventListener('click', () => {
    list = t.dataset.list;
    document.querySelectorAll('.below .tab').forEach((x) => x.classList.toggle('active', x === t));
    renderList();
  });
  $('soundBtn').addEventListener('click', () => {
    sfx.setMuted(!sfx.muted);
    $('soundBtn').textContent = sfx.muted ? '🔇' : '🔊'; $('soundBtn').classList.toggle('off', sfx.muted);
  });
  const fillFair = () => {
    $('fHash').value = state.serverSeedHash; $('fClient').value = state.clientSeed; $('fNonce').value = state.nonce;
    $('fPrev').hidden = !state.previous;
    if (state.previous) { $('fPrevSeed').value = state.previous.serverSeed; $('fPrevHash').value = state.previous.serverSeedHash; }
  };
  $('fairBtn').addEventListener('click', () => { $('fErr').textContent = ''; fillFair(); $('fairDlg').showModal(); });
  $('fRotate').addEventListener('click', async () => {
    try { state = (await api.rotate($('fClient').value)).state; $('fErr').textContent = ''; fillFair(); }
    catch (e) { $('fErr').textContent = e.message; }
  });
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, dialog') || e.repeat) return;
    if (e.key >= '1' && e.key <= '3') pass(Number(e.key) - 1);
    else if (e.key.toLowerCase() === 's') shoot();
    else if (e.code === 'Space') { e.preventDefault(); if (active()) cashout(); else if (mode === 'manual') bet(); }
  });
}

async function init() {
  api = await createApi();
  state = (await api.session()).state;
  $('modeTag').hidden = !api.demo;
  $('stake').value = state.config.defaultStake;
  $('stake').min = state.config.minStake; $('stake').max = state.config.maxStake;
  wire();
  await loadScene();
  if (active()) scene.reset(round()); // round restored after a page reload
  render(); renderList();
}
init();
