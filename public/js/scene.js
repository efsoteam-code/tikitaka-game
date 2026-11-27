// Tiki Taka — 2D match view (canvas). Flat cartoon pitch seen from above, upright players.
// The scene only shows what the engine decided: it never decides an outcome.

const GOAL_Z = -50;          // goal line. Attack runs up the screen (toward -z).
const BOX_Z = -44;
const HALF_W = 34;
const START = { x: 0, z: -4 };
const COLORS = { safe: '#4fd1ff', standard: '#7c9cff', risky: '#ffb347', shot: '#ff5d73' };
const TYPES = ['safe', 'standard', 'risky'];
const PLAYER = 0.8;          // player size: sprite units per metre (a little larger than life)
const INK = '#0b1b33';       // outline colour of everything on the pitch
const KITS = {
  home: { shirt: '#38bdf8', shorts: '#0b2a52', socks: '#ffffff', boots: '#0b1b33', ink: '#0b2a52' },
  away: { shirt: '#ff5a47', shorts: '#ffffff', socks: '#ff5a47', boots: '#0b1b33', ink: '#ffffff' },
  keeper: { shirt: '#ffd23f', shorts: '#1f2937', socks: '#ffd23f', boots: '#0b1b33', ink: '#1f2937', gloves: '#ffffff' },
};
const SKINS = ['#f2c9a0', '#dba577', '#a9714b', '#7a4b2e', '#e8b98f'];
const HAIRS = ['#22160f', '#4a2f1a', '#8a5a2b', '#e0b85c', '#111318'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }; // stable pseudo-random

function makePlayer(kit, number, i) {
  return {
    x: 0, z: 0, kit, number, skin: SKINS[Math.floor(rnd(i + 1) * SKINS.length)], hair: HAIRS[Math.floor(rnd(i + 31) * HAIRS.length)],
    anim: 'idle', rest: 'idle', t: 0, phase: rnd(i + 7) * 6, seed: rnd(i + 3) * 10,
    target: null, speed: 8, face: null, heading: 0, rot: 0, onArrive: null, dive: 0, diveSide: 1, diveReach: 2.4, kickDir: 0,
  };
}

function stepMove(p, dt) {
  if (p.target) {
    const dx = p.target.x - p.x, dz = p.target.z - p.z, dist = Math.hypot(dx, dz);
    if (dist < 0.12) {
      p.target = null; p.anim = p.rest;
      if (p.onArrive) { const f = p.onArrive; p.onArrive = null; f(); }
    } else {
      const v = Math.min(dist, p.speed * dt);
      p.x += (dx / dist) * v; p.z += (dz / dist) * v;
      if (p.anim !== 'run') p.anim = 'run';
      p.heading = Math.atan2(dx, dz);
    }
  } else if (p.face) {
    p.heading = Math.atan2(p.face.x - p.x, p.face.z - p.z);
  }
  p.rot += wrapAngle(p.heading - p.rot) * (1 - Math.exp(-dt * 10));
  p.t += dt;
  if (p.anim === 'run') p.phase += dt * (6 + p.speed * 0.9);
  if ((p.anim === 'kick' && p.t > 0.5) || (p.anim === 'trap' && p.t > 0.4)) p.anim = p.rest;
}

export function createScene(container, { onPick, sfx = {} } = {}) {
  const cv = document.createElement('canvas');
  container.appendChild(cv);
  const g = cv.getContext('2d');
  let W = 1, H = 1, S = 16, dpr = 1, anchor = 0.58; // S = pixels per metre, anchor = where the ball sits vertically

  const attackers = [10, 7, 11, 8].map((n, i) => makePlayer(KITS.home, n, i));
  const defenders = [4, 5, 3, 6].map((n, i) => makePlayer(KITS.away, n, i + 10));
  const keeper = makePlayer(KITS.keeper, 1, 20);
  const everyone = [...attackers, ...defenders, keeper];

  const ball = { x: 0, z: 0, h: 0, spin: 0 };
  let ballHolder = null, trail = [];
  let carrier = attackers[0], receivers = attackers.slice(1), options = [];
  let markersOn = false, shotOn = false;
  const cam = { x: 0, z: START.z };
  let focusLock = null, shake = 0, netPush = 0, flash = 0, confetti = [], time = 0;

  /* tweens */
  const tweens = [];
  const tween = (dur, fn) => new Promise((res) => tweens.push({ t: 0, dur, fn, res }));
  const wait = (d) => tween(d, () => {});

  const sx = (x) => W / 2 + (x - cam.x) * S;
  const sy = (z) => H * anchor + (z - cam.z) * S;
  // the ball sits just ahead of the player's right foot, so it is never hidden behind the body
  const feet = (p) => ({ x: p.x + Math.sin(p.rot) * 0.45 + Math.cos(p.rot) * 0.6, z: p.z + Math.cos(p.rot) * 0.45 - Math.sin(p.rot) * 0.6 + 0.15 });
  const place = (p, x, z, face) => { p.x = x; p.z = z; p.target = null; p.onArrive = null; p.face = face; p.anim = p.rest; p.dive = 0; p.t = 0; if (face) { p.heading = Math.atan2(face.x - x, face.z - z); p.rot = p.heading; } };
  const runTo = (p, x, z, speed, rest) => new Promise((res) => { p.speed = speed; if (rest) p.rest = rest; p.target = { x, z }; p.onArrive = res; });

  function ballFly(from, to, dur, arc) {
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    let last = 0;
    return tween(dur, (u) => {
      ball.x = lerp(from.x, to.x, u); ball.z = lerp(from.z, to.z, u);
      ball.h = 4 * arc * u * (1 - u);
      ball.spin += (u - last) * dist * 2.2; last = u;
      trail.push({ x: ball.x, z: ball.z, h: ball.h, a: 1 });
    });
  }

  /* ---------- where everybody stands ---------- */
  function targets() {
    const c = carrier, remaining = Math.max(0, c.z - BOX_Z);
    const perms = [[-1, 0, 1], [1, 0, -1], [0, -1, 1], [0, 1, -1], [-1, 1, 0], [1, -1, 0]];
    const slots = perms[Math.floor((options[0]?.pos ?? 0) * 6) % 6];
    const frac = { safe: 0.1, standard: 0.19, risky: 0.3 };
    return options.map((o, i) => {
      const slot = slots[i];
      const z = Math.max(GOAL_Z + 4, c.z - Math.max(remaining * frac[o.type], slot === 0 ? 5.5 : 2));
      const maxX = z < GOAL_Z + 16 ? 14 : 17;
      const wide = { safe: 5, standard: 7, risky: 9.5 }[o.type] + o.pos * 3;
      let x = clamp(c.x * 0.45 + slot * wide + (slot === 0 ? (o.pos - 0.5) * 4 : 0), -maxX, maxX);
      if (Math.hypot(x - c.x, z - c.z) < 5) x = clamp(c.x + (x >= c.x ? 5.5 : -5.5), -maxX, maxX);
      return { x, z };
    });
  }

  function arrange(instant) {
    const c = carrier, goalPoint = { x: c.x * 0.4, z: GOAL_Z };
    carrier.rest = 'idle'; carrier.face = goalPoint;
    const tg = targets();
    if (!instant && c.z > BOX_Z + 3) { carrier.anim = 'run'; runTo(carrier, c.x * 0.92, c.z - 2, 5.5, 'idle'); } // a short dribble forward
    receivers.forEach((r, i) => {
      const t = tg[i] ?? { x: c.x + (i - 1) * 7, z: c.z - 3 };
      r.rest = options.length ? 'call' : 'idle'; r.face = c;
      if (instant) place(r, t.x, t.z, c); else runTo(r, t.x, t.z, 10 + i);
      // marker: tight on low-chance passes, far away on safe ones
      const d = defenders[i], o = options[i], ch = o ? o.chance : 0.8;
      const lx = c.x - t.x, lz = c.z - t.z, len = Math.hypot(lx, lz) || 1;
      const gap = 1.6 + ch * 4.5, off = ch * 3.2 - 0.4, side = i % 2 ? 1 : -1;
      const dx = t.x + (lx / len) * gap + (-lz / len) * off * side, dz = t.z + (lz / len) * gap + (lx / len) * off * side;
      d.rest = 'guard'; d.face = c;
      if (instant) place(d, dx, dz, c); else runTo(d, dx, dz, 7.5);
    });
    const sweeper = defenders[3], swx = clamp(c.x * 0.5, -10, 10), swz = Math.max(GOAL_Z + 7, (c.z + GOAL_Z) / 2 - 4);
    sweeper.rest = 'guard'; sweeper.face = c;
    if (instant) place(sweeper, swx, swz, c); else runTo(sweeper, swx, swz, 6.5);
    const kx = clamp(c.x * 0.09, -2, 2);
    keeper.rest = 'keeper'; keeper.face = c;
    if (instant) place(keeper, kx, GOAL_Z + 0.9, c); else if (Math.abs(keeper.x - kx) > 0.4) runTo(keeper, kx, GOAL_Z + 0.9, 3);
  }

  /* ---------- public API ---------- */
  function reset(round) {
    tweens.length = 0; trail = []; confetti = [];
    carrier = attackers[0]; receivers = attackers.slice(1);
    options = round?.options ?? [];
    everyone.forEach((p) => { p.rest = 'idle'; });
    keeper.rest = 'keeper'; defenders.forEach((d) => { d.rest = 'guard'; });
    place(carrier, START.x, START.z, { x: 0, z: GOAL_Z });
    arrange(true);
    ballHolder = carrier; Object.assign(ball, feet(carrier), { h: 0 });
    cam.x = 0; cam.z = START.z;
    markersOn = options.length > 0; shotOn = !!round?.shot;
    focusLock = null; netPush = 0; flash = 0;
  }

  function layout(round) {
    options = round.options ?? [];
    arrange(false);
    markersOn = options.length > 0; shotOn = !!round.shot;
  }

  async function playPass(i, ok) {
    const r = receivers[i], d = defenders[i], type = TYPES[i];
    markersOn = false; shotOn = false;
    r.target = null; r.onArrive = null; r.anim = r.rest = 'idle';
    carrier.target = null; carrier.face = { x: r.x, z: r.z };
    await wait(0.16);
    carrier.anim = 'kick'; carrier.t = 0; carrier.kickDir = Math.atan2(r.x - carrier.x, r.z - carrier.z);
    await wait(0.22);
    sfx.kick?.();
    const from = { x: ball.x, z: ball.z }; ballHolder = null;
    const dl = Math.hypot(from.x - r.x, from.z - r.z) || 1;
    const to = { x: r.x + ((from.x - r.x) / dl) * 0.7, z: r.z + ((from.z - r.z) / dl) * 0.7 };
    const dist = Math.hypot(to.x - from.x, to.z - from.z), dur = clamp(dist / (type === 'risky' ? 16 : 20), 0.32, 1.2);
    const arc = type === 'risky' ? dist * 0.16 : 0;
    r.face = from;
    if (ok) {
      await ballFly(from, to, dur, arc);
      sfx.receive?.();
      const old = carrier;
      carrier = r; ballHolder = r; ball.h = 0;
      r.anim = 'trap'; r.t = 0; // first touch
      receivers = attackers.filter((a) => a !== carrier);
      old.rest = 'idle';
      await wait(0.14);
    } else {
      const cut = 0.62, ip = { x: lerp(from.x, to.x, cut), z: lerp(from.z, to.z, cut) };
      const need = Math.hypot(ip.x - d.x, ip.z - d.z) / (dur * cut);
      d.rest = 'idle'; runTo(d, ip.x, ip.z + 0.3, Math.max(8, need * 1.05));
      await ballFly(from, ip, dur * cut, arc * 0.5);
      sfx.intercept?.();
      d.target = null; d.anim = 'kick'; d.t = 0.15; d.kickDir = 0; ballHolder = d; ball.h = 0; shake = 0.3;
      attackers.forEach((a) => { a.target = null; a.rest = a.anim = 'sad'; });
      await wait(0.35);
      runTo(d, clamp(ip.x * 0.7, -25, 25), ip.z + 20, 8.5, 'idle'); // breaks away with the ball
      defenders.filter((x) => x !== d).forEach((x) => { x.rest = x.anim = 'celebrate'; x.target = null; });
      await wait(0.9);
    }
  }

  async function playShot(ok) {
    markersOn = false; shotOn = false;
    const side = Math.random() < 0.5 ? -1 : 1;
    carrier.target = null; carrier.face = { x: side * 2, z: GOAL_Z };
    receivers.forEach((r) => { r.target = null; r.rest = r.anim = 'idle'; r.face = { x: 0, z: GOAL_Z }; });
    await wait(0.22);
    carrier.anim = 'kick'; carrier.t = 0; carrier.kickDir = Math.atan2(side * 2 - carrier.x, GOAL_Z - carrier.z);
    await wait(0.22);
    sfx.kick?.();
    const from = { x: ball.x, z: ball.z }; ballHolder = null;
    const dist = Math.abs(from.z - GOAL_Z), dur = clamp(dist / 30, 0.45, 1.3);
    const kind = ok ? 'goal' : Math.random() < 0.6 ? 'save' : 'wide';
    const tx = kind === 'wide' ? side * 5.2 : side * 2.7;
    keeper.target = null; keeper.rest = keeper.anim = 'dive'; keeper.face = null; keeper.heading = keeper.rot = 0;
    keeper.diveSide = kind === 'goal' ? -side : side;
    keeper.diveReach = kind === 'save' ? Math.abs(tx - keeper.x) - 0.2 : 2.3;
    focusLock = { x: 0, z: GOAL_Z + 11 };
    tween(dur * (kind === 'save' ? 0.65 : 0.5) + 0.25, (u) => { keeper.dive = u; });
    if (kind === 'goal') {
      await ballFly(from, { x: tx, z: GOAL_Z - 0.3 }, dur, dist * 0.04);
      sfx.cheer?.(); shake = 0.5; flash = 1;
      for (let i = 0; i < 90; i++) confetti.push({ x: Math.random() * W, y: -Math.random() * H * 0.5, vx: (Math.random() - 0.5) * 80, vy: 140 + Math.random() * 220, r: Math.random() * 6, c: ['#38bdf8', '#ffffff', '#ffd23f', '#7c9cff'][i % 4], s: 4 + Math.random() * 5 });
      const a = { x: ball.x, z: ball.z }, b = { x: tx * 0.95, z: GOAL_Z - 1.7 };
      tween(0.5, (u) => { netPush = Math.sin(u * Math.PI); });
      await tween(0.22, (u) => { ball.x = lerp(a.x, b.x, easeOut(u)); ball.z = lerp(a.z, b.z, easeOut(u)); ball.h = 0; });
      attackers.forEach((p, n) => { p.target = null; p.rest = 'celebrate'; p.anim = 'celebrate'; if (p !== carrier) runTo(p, carrier.x + (n - 1.5) * 2, carrier.z + 1.4, 9, 'celebrate'); });
      defenders.forEach((p) => { p.target = null; p.rest = p.anim = 'sad'; });
      await wait(0.7);
      focusLock = { x: carrier.x * 0.7, z: carrier.z - 2 }; // pan back to the celebration
      await wait(1.5);
    } else {
      if (kind === 'save') {
        const hit = { x: tx, z: GOAL_Z + 1 };
        await ballFly(from, hit, dur, dist * 0.03);
        sfx.intercept?.(); shake = 0.3;
        await ballFly(hit, { x: tx + side * 5, z: GOAL_Z + 6.5 }, 0.7, 1.2);
      } else {
        await ballFly(from, { x: tx, z: GOAL_Z - 3.2 }, dur * 1.05, dist * 0.04);
        sfx.intercept?.();
      }
      attackers.forEach((p) => { p.target = null; p.rest = p.anim = 'sad'; });
      defenders.forEach((p) => { p.target = null; p.rest = p.anim = 'celebrate'; });
      await wait(0.9);
    }
  }

  async function playCashout() {
    markersOn = false; shotOn = false;
    attackers.forEach((p) => { p.target = null; p.rest = p.anim = 'celebrate'; });
    defenders.forEach((p) => { p.target = null; p.rest = p.anim = 'sad'; });
    await wait(0.9);
  }

  /* ---------- drawing ---------- */
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const fillStroke = (fill, lw) => { g.fillStyle = fill; g.fill(); g.lineWidth = lw; g.strokeStyle = INK; g.stroke(); };
  // a limb: dark outline first, then the two colours on top
  function limb(x1, y1, x2, y2, w, lw, c1, c2, split = 0.5) {
    g.lineCap = 'round';
    g.strokeStyle = INK; g.lineWidth = w + lw * 2; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    const mx = lerp(x1, x2, split), my = lerp(y1, y2, split);
    g.strokeStyle = c2; g.lineWidth = w; g.beginPath(); g.moveTo(mx, my); g.lineTo(x2, y2); g.stroke();
    g.strokeStyle = c1; g.beginPath(); g.moveTo(x1, y1); g.lineTo(mx, my); g.stroke();
  }

  let crowdTile = null;
  function makeCrowd() {
    const c = document.createElement('canvas'); c.width = 240; c.height = 120;
    const k = c.getContext('2d');
    k.fillStyle = '#0a1a31'; k.fillRect(0, 0, 240, 120);
    const cols = ['#38bdf8', '#7dd3fc', '#e8f3ff', '#1d4ed8', '#16365f', '#93c5fd', '#ffd9b8', '#ff5a47'];
    for (let r = 0; r < 8; r++) for (let i = 0; i < 16; i++) {
      const n = r * 16 + i; if (rnd(n) < 0.08) continue;
      const x = i * 15 + (r % 2) * 7.5 + 4, y = r * 15 + 8;
      k.fillStyle = cols[Math.floor(rnd(n + 99) * cols.length)]; k.beginPath(); k.arc(x, y + 4, 5, 0, 7); k.fill();
      k.fillStyle = rnd(n + 5) < 0.5 ? '#e9c4a0' : '#8a5a3c'; k.beginPath(); k.arc(x, y - 1, 3.2, 0, 7); k.fill();
    }
    crowdTile = g.createPattern(c, 'repeat');
  }

  function drawPitch() {
    const zTop = cam.z - (H * anchor) / S, zBot = cam.z + (H * (1 - anchor)) / S;
    // stands + crowd behind everything
    g.save(); g.translate(((sx(0) % 240) + 240) % 240, ((sy(0) % 120) + 120) % 120 + Math.sin(time * 5) * 1.5); g.fillStyle = crowdTile; g.fillRect(-480, -240, W + 960, H + 480); g.restore();
    // grass apron and striped pitch
    g.fillStyle = '#2f9d48'; g.fillRect(sx(-HALF_W - 4), sy(GOAL_Z - 3.2), (HALF_W * 2 + 8) * S, 80 * S);
    const band = 5.5;
    for (let z = GOAL_Z; z < Math.min(zBot + band, 26); z += band) {
      if (z + band < zTop) continue;
      g.fillStyle = Math.round((z - GOAL_Z) / band) % 2 ? '#3fb354' : '#48c05f';
      g.fillRect(sx(-HALF_W), sy(z), HALF_W * 2 * S, band * S + 1);
    }
    // ad boards along the goal line and touchlines
    const board = (x, z, w, h) => { g.fillStyle = '#0b2a52'; g.fillRect(sx(x), sy(z), w * S, h * S); g.strokeStyle = INK; g.lineWidth = Math.max(1.5, S * 0.1); g.strokeRect(sx(x), sy(z), w * S, h * S); };
    board(-HALF_W - 4, GOAL_Z - 4.4, HALF_W * 2 + 8, 1.2);
    board(-HALF_W - 5.2, GOAL_Z - 4.4, 1.2, 82); board(HALF_W + 4, GOAL_Z - 4.4, 1.2, 82);
    g.fillStyle = '#7dd3fc'; g.font = `900 ${S * 0.8}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let x = -30; x <= 30; x += 12) g.fillText(x % 24 ? 'PASS · SHOOT · WIN' : 'TIKI TAKA', sx(x), sy(GOAL_Z - 3.8));
    // lines
    g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = Math.max(2, S * 0.16); g.lineJoin = 'round';
    const rect = (x1, z1, x2, z2) => g.strokeRect(sx(x1), sy(z1), (x2 - x1) * S, (z2 - z1) * S);
    g.beginPath(); g.moveTo(sx(-HALF_W), sy(26)); g.lineTo(sx(-HALF_W), sy(GOAL_Z)); g.lineTo(sx(HALF_W), sy(GOAL_Z)); g.lineTo(sx(HALF_W), sy(26)); g.stroke();
    g.beginPath(); g.moveTo(sx(-HALF_W), sy(8)); g.lineTo(sx(HALF_W), sy(8)); g.stroke();
    g.beginPath(); g.arc(sx(0), sy(8), 9.15 * S, 0, Math.PI * 2); g.stroke();
    rect(-20.16, GOAL_Z, 20.16, GOAL_Z + 16.5); rect(-9.16, GOAL_Z, 9.16, GOAL_Z + 5.5);
    g.beginPath(); g.arc(sx(0), sy(GOAL_Z + 11), 9.15 * S, 0.205 * Math.PI, 0.795 * Math.PI); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(sx(0), sy(GOAL_Z + 11), S * 0.22, 0, 7); g.fill();
    g.beginPath(); g.arc(sx(0), sy(8), S * 0.25, 0, 7); g.fill();
  }

  function drawGoal() {
    const x1 = sx(-3.66), x2 = sx(3.66), y0 = sy(GOAL_Z), depth = (2.2 + netPush * 0.5) * S;
    g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(x1, y0 - depth, x2 - x1, depth);
    g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= 12; i++) { const x = lerp(x1, x2, i / 12); g.moveTo(x, y0); g.lineTo(x, y0 - depth); }
    for (let j = 1; j <= 4; j++) { const y = y0 - (depth * j) / 4; g.moveTo(x1, y); g.lineTo(x2, y); }
    g.stroke();
    g.lineCap = 'round'; g.lineJoin = 'round';
    const frame = () => { g.beginPath(); g.moveTo(x1, y0); g.lineTo(x1, y0 - depth); g.lineTo(x2, y0 - depth); g.lineTo(x2, y0); g.stroke(); };
    g.strokeStyle = INK; g.lineWidth = S * 0.42; frame();
    g.strokeStyle = '#fff'; g.lineWidth = S * 0.24; frame();
  }

  function drawPlayer(p) {
    const U = S * PLAYER, lw = Math.max(1.5, U * 0.13), k = p.kit;
    const dx = Math.sin(p.rot), dy = Math.cos(p.rot), back = dy < -0.15;
    const t = p.t, s0 = p.seed;
    let bob = 0, jump = 0, slouch = 0, shuffle = 0;
    let fl = [0, 0], fr = [0, 0];                 // feet offsets (in U)
    let hl = [-0.78, -1.3], hrt = [0.78, -1.3];    // hands, in U from the feet
    switch (p.anim) {
      case 'run': { const s = Math.sin(p.phase), c = Math.cos(p.phase); fl = [dx * s * 0.6, dy * s * 0.6 - Math.max(0, c) * 0.22]; fr = [-dx * s * 0.6, -dy * s * 0.6 - Math.max(0, -c) * 0.22]; hl = [-0.78 - dx * s * 0.35, -1.5 - dy * s * 0.35]; hrt = [0.78 + dx * s * 0.35, -1.5 + dy * s * 0.35]; bob = Math.abs(c) * 0.12; break; }
      case 'call': hrt = [0.9 + Math.sin(t * 9 + s0) * 0.14, -3.3]; bob = Math.abs(Math.sin(t * 4 + s0)) * 0.08; break;
      case 'guard': shuffle = Math.sin(t * 3.4 + s0) * 0.16; hl = [-1.2, -1.8]; hrt = [1.2, -1.8]; fl = [-0.12, 0]; fr = [0.12, 0]; slouch = 0.1; bob = Math.abs(Math.sin(t * 3.4 + s0)) * 0.05; break;
      case 'kick': { const u = clamp(t / 0.5, 0, 1), kx = Math.sin(p.kickDir), ky = Math.cos(p.kickDir); const a = u < 0.4 ? -0.6 * easeInOut(u / 0.4) : u < 0.6 ? lerp(-0.6, 1.25, (u - 0.4) / 0.2) : lerp(1.25, 0, easeOut((u - 0.6) / 0.4)); fr = [kx * a, ky * a - Math.abs(a) * 0.15]; hl = [-1.1, -1.8]; hrt = [1.0, -1.6]; bob = -0.04; break; }
      case 'trap': { const a = Math.sin(clamp(t / 0.4, 0, 1) * Math.PI); fr = [dx * 0.45 * a, dy * 0.45 * a - 0.12 * a]; hl = [-1.0, -1.55]; hrt = [1.0, -1.55]; break; }
      case 'celebrate': jump = Math.abs(Math.sin(t * 7 + s0)) * 0.7; hl = [-0.9, -3.35]; hrt = [0.9, -3.35]; break;
      case 'sad': slouch = 0.2; hl = [-0.66, -1.05]; hrt = [0.66, -1.05]; break;
      case 'keeper': { const w = Math.sin(t * 2.6); hl = [-1.3, -2.0 + w * 0.05]; hrt = [1.3, -2.0 - w * 0.05]; fl = [-0.2, 0]; fr = [0.2, 0]; slouch = 0.1; shuffle = w * 0.08; break; }
      case 'dive': hl = [-0.5, -3.45]; hrt = [0.5, -3.45]; break;
      default: bob = Math.sin(t * 1.8 + s0) * 0.02;
    }
    const dv = easeOut(p.dive), X = sx(p.x) + shuffle * U + p.diveSide * p.diveReach * S * dv, Y = sy(p.z);
    g.fillStyle = 'rgba(8,30,20,.3)'; g.beginPath(); g.ellipse(X, Y + U * 0.05, U * (0.78 + p.dive * 0.5), U * 0.27, 0, 0, 7); g.fill();
    g.save();
    g.translate(X, Y - jump * U - (p.dive > 0 ? Math.sin(Math.PI * Math.min(1, p.dive * 1.15)) * U * 0.9 + dv * U * 0.3 : 0));
    g.rotate(p.diveSide * 1.3 * dv);
    const by = (-bob + slouch) * U; // body offset
    // legs
    for (const [side, f] of [[-1, fl], [1, fr]]) {
      const fx = side * 0.3 * U + f[0] * U, fy = -0.12 * U + f[1] * U;
      limb(side * 0.3 * U, -1.05 * U + by, fx, fy, U * 0.3, lw, p.skin, k.socks, 0.48);
      g.beginPath(); g.ellipse(fx + dx * U * 0.1, fy + U * 0.05, U * 0.25, U * 0.17, 0, 0, 7); fillStroke(k.boots, lw);
    }
    // arms
    for (const [side, h] of [[-1, hl], [1, hrt]]) {
      limb(side * 0.58 * U, -2.15 * U + by, h[0] * U, h[1] * U + by, U * 0.26, lw, k.shirt, p.skin, 0.45);
      g.beginPath(); g.arc(h[0] * U, h[1] * U + by, U * (k.gloves ? 0.24 : 0.17), 0, 7); fillStroke(k.gloves ?? p.skin, lw);
    }
    // shorts + shirt
    rr(-0.56 * U, -1.42 * U + by, 1.12 * U, 0.62 * U, U * 0.16); fillStroke(k.shorts, lw);
    rr(-0.68 * U, -2.4 * U + by, 1.36 * U, 1.14 * U, U * 0.3); fillStroke(k.shirt, lw);
    g.fillStyle = k.ink;
    if (back) { g.font = `900 ${U * 0.64}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p.number, 0, -1.8 * U + by); }
    else g.fillRect(-0.3 * U, -2.36 * U + by, 0.6 * U, 0.15 * U); // collar
    // head
    const hy = -2.95 * U + by + (p.anim === 'sad' ? 0.18 * U : 0), hr = 0.62 * U;
    g.beginPath(); g.arc(0, hy, hr, 0, 7); fillStroke(p.skin, lw);
    g.fillStyle = p.hair; g.beginPath();
    if (back) g.arc(0, hy, hr - lw * 0.5, Math.PI * 0.8, Math.PI * 2.2); // back of the head
    else g.arc(0, hy, hr - lw * 0.5, Math.PI * 1.04, Math.PI * 1.96); // fringe
    g.closePath(); g.fill();
    if (!back) { g.fillStyle = INK; for (const e of [-1, 1]) { g.beginPath(); g.arc(e * hr * 0.36 + dx * hr * 0.28, hy + hr * 0.2, Math.max(1.2, hr * 0.11), 0, 7); g.fill(); } }
    g.restore();
  }

  function drawBall() {
    for (const tp of trail) { g.fillStyle = `rgba(255,255,255,${tp.a * 0.35})`; g.beginPath(); g.arc(sx(tp.x), sy(tp.z) - tp.h * S * 0.55 - S * 0.2, S * 0.2 * tp.a, 0, 7); g.fill(); }
    const X = sx(ball.x), Y = sy(ball.z), r = S * (0.36 + ball.h * 0.035), lift = ball.h * S * 0.55;
    g.fillStyle = 'rgba(8,30,20,.3)'; g.beginPath(); g.ellipse(X + lift * 0.25, Y + S * 0.12, r * 0.95, r * 0.42, 0, 0, 7); g.fill();
    g.save(); g.translate(X, Y - lift - r * 0.55);
    g.beginPath(); g.arc(0, 0, r, 0, 7); fillStroke('#ffffff', Math.max(1.5, S * 0.09));
    g.clip(); g.rotate(ball.spin); g.fillStyle = INK;
    g.beginPath(); g.arc(0, 0, r * 0.3, 0, 7); g.fill();
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; g.beginPath(); g.arc(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, r * 0.3, 0, 7); g.fill(); }
    g.restore();
  }

  function pin(X, Y, label, color, size) {
    g.fillStyle = color; g.strokeStyle = INK; g.lineWidth = Math.max(1.5, size * 0.1); g.lineJoin = 'round';
    g.beginPath(); g.moveTo(X, Y); g.arc(X, Y - size * 1.35, size * 0.72, Math.PI * 0.72, Math.PI * 0.28); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = INK; g.font = `900 ${size * 0.85}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, X, Y - size * 1.3);
  }

  function shotPin() { // sits over the goal, or at the top edge when the goal is off screen
    const size = Math.max(13, S * 0.85), gy = sy(GOAL_Z) - S * 2.6, minY = size * 2.2 + 70;
    return { x: clamp(sx(0), 40, W - 40), y: Math.max(minY, gy), size, off: gy < minY };
  }

  function drawMarkers() {
    if (!markersOn) return;
    receivers.forEach((r, i) => {
      if (!options[i]) return;
      const X = sx(r.x), Y = sy(r.z), c = COLORS[TYPES[i]], pulse = 1 + Math.sin(time * 4 + i) * 0.08;
      g.setLineDash([S * 0.5, S * 0.4]); g.lineDashOffset = -time * S * 1.5; g.strokeStyle = c; g.lineWidth = Math.max(2, S * 0.14); g.globalAlpha = 0.85;
      g.beginPath(); g.moveTo(sx(ball.x), sy(ball.z)); g.lineTo(X, Y); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      g.lineWidth = Math.max(2.5, S * 0.2); g.beginPath(); g.ellipse(X, Y, S * 1.15 * pulse, S * 0.55 * pulse, 0, 0, 7); g.stroke();
    });
  }
  function drawPins() {
    if (markersOn) receivers.forEach((r, i) => { if (options[i]) pin(sx(r.x), sy(r.z) - S * PLAYER * 3.75 + Math.sin(time * 3 + i) * 3, String(i + 1), COLORS[TYPES[i]], Math.max(12, S * 0.8)); });
    if (shotOn) { const s = shotPin(); pin(s.x, s.y + Math.sin(time * 3) * 3, s.off ? '▲' : 'S', COLORS.shot, s.size); }
  }

  /* ---------- picking ---------- */
  function pickAt(ev) {
    const b = cv.getBoundingClientRect(), px = ev.clientX - b.left, py = ev.clientY - b.top;
    if (markersOn) {
      let best = null, bd = Infinity;
      receivers.forEach((r, i) => { if (!options[i]) return; const d = Math.hypot(px - sx(r.x), (py - (sy(r.z) - S * 1.4)) * 0.6); if (d < bd) { bd = d; best = i; } });
      if (best !== null && bd < Math.max(34, S * 2.4)) return best;
    }
    if (shotOn) {
      const s = shotPin();
      if (Math.hypot(px - s.x, py - (s.y - s.size * 1.3)) < s.size * 1.6 + 12) return 'shoot';
      if (Math.abs(px - sx(0)) < S * 4.5 && py < sy(GOAL_Z) + S * 1.5 && py > sy(GOAL_Z) - S * 3.5) return 'shoot';
    }
    return null;
  }
  let down = null;
  cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) return;
    const p = pickAt(e); if (p !== null && onPick) onPick(p);
  });
  cv.addEventListener('pointermove', (e) => { cv.style.cursor = pickAt(e) !== null ? 'pointer' : 'default'; });

  /* ---------- resize + loop ---------- */
  function resize() {
    W = container.clientWidth || 1; H = container.clientHeight || 1;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const portrait = W / H < 0.95;
    S = clamp(Math.min(W / (portrait ? 26 : 34), H / (portrait ? 30 : 25)), 10, 34);
    anchor = portrait ? 0.56 : 0.6;
    makeCrowd();
  }
  new ResizeObserver(resize).observe(container); resize();

  let running = true, lastT = performance.now();
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(Math.max(0, (now - lastT) / 1000), 0.05); lastT = now; time += dt;
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i]; tw.t += dt;
      const u = Math.min(1, tw.t / tw.dur); tw.fn(u);
      if (u >= 1) { tweens.splice(i, 1); tw.res(); }
    }
    for (const p of everyone) stepMove(p, dt);
    if (ballHolder) {
      const f = feet(ballHolder), a = 1 - Math.exp(-dt * 22);
      if (ballHolder.anim === 'run') ball.spin += dt * ballHolder.speed * 2;
      ball.x += (f.x - ball.x) * a; ball.z += (f.z - ball.z) * a; ball.h = 0;
    }
    trail = trail.filter((tp) => (tp.a -= dt * 4) > 0);
    // camera follows the ball, looking up the pitch
    const fz = focusLock ? focusLock.z : ball.z, fx = focusLock ? focusLock.x : ball.x * 0.7, ca = 1 - Math.exp(-dt * 3.2);
    const maxX = Math.max(0, HALF_W + 5.2 - W / 2 / S);
    cam.x += (clamp(fx, -maxX, maxX) - cam.x) * ca;
    cam.z += (clamp(fz, GOAL_Z - 9.5 + (H * anchor) / S, 6) - cam.z) * ca;
    shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt * 2.2);

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0a1a31'; g.fillRect(0, 0, W, H);
    g.save();
    if (shake > 0) g.translate((Math.random() - 0.5) * shake * 16, (Math.random() - 0.5) * shake * 16);
    drawPitch(); drawGoal(); drawMarkers();
    const list = [...everyone].sort((a, b) => a.z - b.z);
    let ballDrawn = false;
    for (const p of list) {
      if (!ballDrawn && !ballHolder && ball.z < p.z) { drawBall(); ballDrawn = true; }
      drawPlayer(p);
      if (p === ballHolder) { drawBall(); ballDrawn = true; }
    }
    if (!ballDrawn) drawBall();
    drawPins();
    g.restore();
    if (flash > 0) { g.fillStyle = `rgba(255,255,255,${flash * 0.35})`; g.fillRect(0, 0, W, H); }
    for (const c of confetti) { c.x += c.vx * dt; c.y += c.vy * dt; c.r += dt * 6; g.save(); g.translate(c.x, c.y); g.rotate(c.r); g.fillStyle = c.c; g.fillRect(-c.s / 2, -c.s / 4, c.s, c.s / 2); g.restore(); }
    confetti = confetti.filter((c) => c.y < H + 20);
  }
  reset(null);
  requestAnimationFrame(frame);

  return { reset, layout, playPass, playShot, playCashout, dispose() { running = false; cv.remove(); } };
}
