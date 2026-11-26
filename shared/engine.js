// Tiki Taka — game engine. Pure logic, no DOM, no Node APIs.
// The server runs it as the source of truth; the browser runs the same file in
// demo mode (no server) and to verify finished rounds.
import { CONFIG, PASS_TYPES } from './config.js';

/* ---------- SHA-256 / HMAC (small sync implementation, same in Node and browser) ---------- */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const enc = new TextEncoder();
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

export function sha256Bytes(msg) {
  const len = msg.length;
  const total = (((len + 9) >> 6) + 1) << 6;
  const data = new Uint8Array(total);
  data.set(msg);
  data[len] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(total - 8, Math.floor((len * 8) / 0x100000000));
  view.setUint32(total - 4, (len * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export const sha256Hex = (str) => toHex(sha256Bytes(enc.encode(str)));

export function hmacSha256Hex(key, message) {
  let k = enc.encode(key);
  if (k.length > 64) k = sha256Bytes(k);
  const ipad = new Uint8Array(64).fill(0x36);
  const opad = new Uint8Array(64).fill(0x5c);
  for (let i = 0; i < k.length; i++) { ipad[i] ^= k[i]; opad[i] ^= k[i]; }
  const m = enc.encode(message);
  const inner = new Uint8Array(64 + m.length);
  inner.set(ipad); inner.set(m, 64);
  const ih = sha256Bytes(inner);
  const outer = new Uint8Array(96);
  outer.set(opad); outer.set(ih, 64);
  return toHex(sha256Bytes(outer));
}

/* ---------- Provably fair number stream ---------- */
// float in [0,1) from HMAC-SHA256(serverSeed, "clientSeed:nonce:step:index")
// index 0 = outcome of the step, 1..3 = chance of each pass option, 4..6 = pitch position (visual only)
export function fairFloat(serverSeed, clientSeed, nonce, step, index) {
  const hex = hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}:${step}:${index}`);
  return parseInt(hex.slice(0, 13), 16) / 2 ** 52;
}

const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;
const cents = (n) => Math.floor(n * 100 + 1e-6) / 100;

/* ---------- Round ---------- */
export function createRound({ serverSeed, clientSeed, nonce, stake, difficulty }) {
  if (!CONFIG.difficulties[difficulty]) throw new Error('Unknown difficulty');
  return { serverSeed, clientSeed, nonce, stake, difficulty, passes: 0, prod: 1, step: 0, status: 'active', result: null, payout: 0, actions: [] };
}

export function multiplierOf(round) {
  if (round.passes === 0) return 1;
  return Math.min(CONFIG.maxMultiplier, floor2(CONFIG.rtp * round.prod));
}

const potential = (round, chance) => Math.min(CONFIG.maxMultiplier, floor2((CONFIG.rtp * round.prod) / chance));

export function shotOf(round) {
  const s = CONFIG.shot;
  const chance = Math.min(s.max, Math.round((s.base + s.perPass * round.passes) * 1000) / 1000);
  return { chance, multiplier: potential(round, chance) };
}

export function optionsOf(round) {
  if (round.status !== 'active' || round.passes >= CONFIG.maxPasses) return [];
  const ranges = CONFIG.difficulties[round.difficulty];
  return PASS_TYPES.map((type, i) => {
    const [lo, hi] = ranges[type];
    const f = fairFloat(round.serverSeed, round.clientSeed, round.nonce, round.step, i + 1);
    const chance = Math.round((lo + (hi - lo) * f) * 200) / 200; // steps of 0.5%
    return {
      index: i,
      type,
      chance,
      multiplier: potential(round, chance),
      tag: f < 0.3 ? 'marked' : f > 0.7 ? 'open' : '',
      pos: fairFloat(round.serverSeed, round.clientSeed, round.nonce, round.step, i + 4),
    };
  });
}

function finish(round, result, multiplier) {
  round.status = multiplier > 0 ? 'won' : 'lost';
  round.result = result;
  round.finalMultiplier = multiplier;
  round.payout = cents(round.stake * multiplier);
}

// action: { type: 'pass', option: 0|1|2 } | { type: 'shoot' } | { type: 'cashout' }
// returns outcome: 'complete' | 'intercepted' | 'goal' | 'miss' | 'cashout' | 'max'
export function applyAction(round, action) {
  if (round.status !== 'active') throw new Error('Round is not active');
  if (action.type === 'cashout') {
    if (round.passes < 1) throw new Error('Cash out is available after the first pass');
    round.actions.push({ type: 'cashout' });
    finish(round, 'cashout', multiplierOf(round));
    return 'cashout';
  }
  const roll = fairFloat(round.serverSeed, round.clientSeed, round.nonce, round.step, 0);
  if (action.type === 'pass') {
    const opt = optionsOf(round)[action.option];
    if (!opt) throw new Error('Pass is not available');
    round.actions.push({ type: 'pass', option: opt.index });
    round.step += 1;
    if (roll >= opt.chance) { finish(round, 'intercepted', 0); return 'intercepted'; }
    round.prod /= opt.chance;
    round.passes += 1;
    if (CONFIG.rtp * round.prod >= CONFIG.maxMultiplier) { finish(round, 'max', CONFIG.maxMultiplier); return 'max'; }
    return 'complete';
  }
  if (action.type === 'shoot') {
    const shot = shotOf(round);
    round.actions.push({ type: 'shoot' });
    round.step += 1;
    if (roll >= shot.chance) { finish(round, 'miss', 0); return 'miss'; }
    finish(round, 'goal', shot.multiplier);
    return 'goal';
  }
  throw new Error('Unknown action');
}

// Replays a finished round from its seeds — used to verify fairness.
export function replayRound({ serverSeed, clientSeed, nonce, stake, difficulty, actions }) {
  const round = createRound({ serverSeed, clientSeed, nonce, stake, difficulty });
  const steps = [];
  for (const a of actions) {
    const options = optionsOf(round);
    const shot = shotOf(round);
    const outcome = applyAction(round, a);
    steps.push({ action: a, options, shot, outcome });
  }
  return { steps, result: round.result, multiplier: round.finalMultiplier ?? multiplierOf(round), payout: round.payout };
}

/* ---------- Session (wallet + seeds + current round) ---------- */
// rand(): returns a random hex string. Server: crypto.randomBytes; browser: crypto.getRandomValues.
export function createSession(rand, name) {
  const serverSeed = rand();
  return {
    name: name || 'Player-' + rand().slice(0, 4).toUpperCase(),
    balance: CONFIG.startBalance,
    serverSeed,
    clientSeed: rand().slice(0, 16),
    nonce: 0,
    previous: null, // revealed after rotation: { serverSeed, serverSeedHash, clientSeed, lastNonce }
    round: null,
    bets: [],
  };
}

export function roundView(round) {
  if (!round) return null;
  const active = round.status === 'active';
  return {
    nonce: round.nonce,
    stake: round.stake,
    difficulty: round.difficulty,
    passes: round.passes,
    status: round.status,
    result: round.result,
    multiplier: active ? multiplierOf(round) : round.finalMultiplier,
    payout: active ? cents(round.stake * multiplierOf(round)) : round.payout,
    canCashout: active && round.passes >= 1,
    options: optionsOf(round),
    shot: active ? shotOf(round) : null,
  };
}

export function sessionView(s) {
  return {
    name: s.name,
    balance: cents(s.balance),
    serverSeedHash: sha256Hex(s.serverSeed),
    clientSeed: s.clientSeed,
    nonce: s.nonce,
    previous: s.previous,
    round: roundView(s.round),
    bets: s.bets.slice(0, 30),
    config: { minStake: CONFIG.minStake, maxStake: CONFIG.maxStake, defaultStake: CONFIG.defaultStake, rtp: CONFIG.rtp, maxMultiplier: CONFIG.maxMultiplier, difficulties: Object.keys(CONFIG.difficulties) },
  };
}

export function startRound(s, { stake, difficulty }) {
  if (s.round && s.round.status === 'active') throw new Error('Finish the current round first');
  if (!Object.hasOwn(CONFIG.difficulties, difficulty)) throw new Error('Unknown difficulty');
  stake = cents(Number(stake));
  if (!(stake >= CONFIG.minStake && stake <= CONFIG.maxStake)) throw new Error(`Stake must be between ${CONFIG.minStake} and ${CONFIG.maxStake}`);
  if (stake > s.balance + 1e-9) throw new Error('Not enough balance');
  s.balance -= stake;
  s.nonce += 1;
  s.round = createRound({ serverSeed: s.serverSeed, clientSeed: s.clientSeed, nonce: s.nonce, stake, difficulty });
}

export function playAction(s, action) {
  if (!s.round || s.round.status !== 'active') throw new Error('No active round');
  const outcome = applyAction(s.round, action);
  const r = s.round;
  if (r.status !== 'active') {
    s.balance += r.payout;
    s.bets.unshift({ nonce: r.nonce, stake: r.stake, difficulty: r.difficulty, passes: r.passes, result: r.result, multiplier: r.finalMultiplier, payout: r.payout, actions: r.actions });
    if (s.bets.length > 100) s.bets.length = 100;
  }
  return outcome;
}

export function rotateSeed(s, rand, clientSeed) {
  if (s.round && s.round.status === 'active') throw new Error('Finish the current round first');
  s.previous = { serverSeed: s.serverSeed, serverSeedHash: sha256Hex(s.serverSeed), clientSeed: s.clientSeed, lastNonce: s.nonce };
  s.serverSeed = rand();
  if (clientSeed && String(clientSeed).trim()) s.clientSeed = String(clientSeed).trim().slice(0, 64);
  s.nonce = 0;
}
