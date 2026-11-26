// Tiki Taka — 3D stadium, players and animations (Three.js).
// The scene only shows what the engine decided: it never decides an outcome.
import * as THREE from 'three';

const GOAL_Z = -50;          // goal line. Attack runs toward -z.
const BOX_Z = -44;           // passes never go deeper than this (+ a little)
const START = { x: 0, z: -4 };
const COLORS = { safe: '#4fd1ff', standard: '#7c9cff', risky: '#ffb347', shot: '#ff5d73' };
const TYPES = ['safe', 'standard', 'risky'];
const HIP = 0.9;
const BALL_R = 0.14;
const SCALE = 1.14; // players are drawn a little larger than life so they read well on phones

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ---------------- Pitch & stadium ---------------- */
function buildPitch(scene) {
  const X0 = -44, Z0 = -62, W = 88, L = 80, S = 14; // metres → pixels
  const tex = canvasTex(W * S, L * S, (g, w, h) => {
    const px = (x) => (x - X0) * S, pz = (z) => (z - Z0) * S;
    for (let i = 0; i < L / 5.5 + 1; i++) {
      g.fillStyle = i % 2 ? '#2c8a45' : '#33994d';
      g.fillRect(0, i * 5.5 * S, w, 5.5 * S + 1);
    }
    for (let i = 0; i < 9000; i++) { // grass grain
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.05)';
      g.fillRect(Math.random() * w, Math.random() * h, 2, 5);
    }
    g.strokeStyle = 'rgba(255,255,255,.92)'; g.lineWidth = 2.6; g.fillStyle = 'rgba(255,255,255,.92)';
    const line = (x1, z1, x2, z2) => { g.beginPath(); g.moveTo(px(x1), pz(z1)); g.lineTo(px(x2), pz(z2)); g.stroke(); };
    const rect = (x1, z1, x2, z2) => g.strokeRect(px(x1), pz(z1), (x2 - x1) * S, (z2 - z1) * S);
    line(-34, GOAL_Z, 34, GOAL_Z); line(-34, GOAL_Z, -34, 18); line(34, GOAL_Z, 34, 18);
    line(-34, 8, 34, 8);                                             // halfway line
    g.beginPath(); g.arc(px(0), pz(8), 9.15 * S, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(px(0), pz(8), 0.3 * S, 0, Math.PI * 2); g.fill();
    rect(-20.16, GOAL_Z, 20.16, GOAL_Z + 16.5);                      // penalty area
    rect(-9.16, GOAL_Z, 9.16, GOAL_Z + 5.5);                         // goal area
    g.beginPath(); g.arc(px(0), pz(GOAL_Z + 11), 0.25 * S, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(px(0), pz(GOAL_Z + 11), 9.15 * S, 0.205 * Math.PI, 0.795 * Math.PI); g.stroke();
    for (const sx of [-34, 34]) { g.beginPath(); g.arc(px(sx), pz(GOAL_Z), 1 * S, sx < 0 ? 0 : Math.PI / 2, sx < 0 ? Math.PI / 2 : Math.PI); g.stroke(); }
  });
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(W, L), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(X0 + W / 2, 0, Z0 + L / 2);
  pitch.receiveShadow = true;
  scene.add(pitch);

  const apron = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshStandardMaterial({ color: 0x0a1a30, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2; apron.position.set(0, -0.02, -20);
  scene.add(apron);
}

function buildStadium(scene) {
  const crowd = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#081629'; g.fillRect(0, 0, w, h);
    const cols = ['#38bdf8', '#7dd3fc', '#e8f3ff', '#1d4ed8', '#0f2b52', '#93c5fd', '#16365f', '#ffd9b8'];
    for (let r = 0; r < 14; r++) for (let c = 0; c < 84; c++) {
      if (Math.random() < 0.1) continue;
      const x = c * 12.2 + (r % 2) * 6 + Math.random() * 2, y = r * 18 + 8;
      g.fillStyle = cols[(Math.random() * cols.length) | 0];
      g.beginPath(); g.arc(x, y + 7, 5.2, 0, 7); g.fill();          // shoulders
      g.fillStyle = Math.random() < 0.5 ? '#e9c4a0' : '#8a5a3c';
      g.beginPath(); g.arc(x, y, 3.4, 0, 7); g.fill();              // head
    }
  });
  crowd.wrapS = THREE.RepeatWrapping;
  const stand = (len, rep) => {
    const t = crowd.clone(); t.needsUpdate = true; t.repeat.set(rep, 1);
    const grp = new THREE.Group();
    const seats = new THREE.Mesh(new THREE.PlaneGeometry(len, 26), new THREE.MeshBasicMaterial({ map: t, color: 0x6c7f99 }));
    seats.rotation.x = -0.55; seats.position.y = 12;
    const base = new THREE.Mesh(new THREE.BoxGeometry(len, 2.4, 1), new THREE.MeshStandardMaterial({ color: 0x0b1d36 }));
    base.position.set(0, 1.2, 6.3);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.8, 14), new THREE.MeshStandardMaterial({ color: 0x0a1a31 }));
    roof.position.set(0, 25, -5); roof.rotation.x = 0.12;
    grp.add(seats, base, roof);
    return grp;
  };
  const back = stand(130, 4); back.position.set(0, 0, -72); scene.add(back);
  const left = stand(120, 4); left.rotation.y = Math.PI / 2; left.position.set(-58, 0, -18); scene.add(left);
  const right = stand(120, 4); right.rotation.y = -Math.PI / 2; right.position.set(58, 0, -18); scene.add(right);

  // LED ad boards
  const ad = canvasTex(1024, 64, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#0b2a52'); grad.addColorStop(0.5, '#1d4ed8'); grad.addColorStop(1, '#0b2a52');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.font = '900 40px system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillStyle = '#e8f3ff'; g.fillText('TIKI TAKA', w * 0.25, h / 2 + 2);
    g.fillStyle = '#7dd3fc'; g.fillText('PASS · SHOOT · WIN', w * 0.75, h / 2 + 2);
  });
  ad.wrapS = THREE.RepeatWrapping;
  const board = (len, rep) => {
    const t = ad.clone(); t.needsUpdate = true; t.repeat.set(rep, 1);
    return new THREE.Mesh(new THREE.BoxGeometry(len, 1.1, 0.25), new THREE.MeshBasicMaterial({ map: t }));
  };
  const b1 = board(84, 6); b1.position.set(0, 0.55, GOAL_Z - 5.5); scene.add(b1);
  const b2 = board(76, 5); b2.rotation.y = Math.PI / 2; b2.position.set(-40, 0.55, -18); scene.add(b2);
  const b3 = board(76, 5); b3.rotation.y = -Math.PI / 2; b3.position.set(40, 0.55, -18); scene.add(b3);

  // floodlights
  const glow = canvasTex(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(190,225,255,.55)'); r.addColorStop(1, 'rgba(120,180,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  });
  for (const [x, z] of [[-52, -76], [52, -76], [-64, 14], [64, 14]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 38, 8), new THREE.MeshStandardMaterial({ color: 0x1a2b45 }));
    pole.position.set(x, 19, z); scene.add(pole);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 0.6), new THREE.MeshBasicMaterial({ color: 0xeaf6ff }));
    panel.position.set(x, 39, z); panel.lookAt(0, 0, -25); scene.add(panel);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.scale.set(34, 34, 1); sp.position.set(x, 39, z); scene.add(sp);
  }
}

function buildGoal(scene) {
  const grp = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
  const post = (h) => new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, h, 12), white);
  const l = post(2.44); l.position.set(-3.66, 1.22, 0);
  const r = post(2.44); r.position.set(3.66, 1.22, 0);
  const bar = post(7.46); bar.rotation.z = Math.PI / 2; bar.position.set(0, 2.44, 0);
  [l, r, bar].forEach((m) => { m.castShadow = true; grp.add(m); });
  const netTex = canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2;
    for (let i = 0; i <= 16; i++) { g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16, h); g.moveTo(0, i * 16); g.lineTo(w, i * 16); g.stroke(); }
  });
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
  const netMat = (rx, ry) => { const t = netTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false }); };
  const net = new THREE.Group();
  const backNet = new THREE.Mesh(new THREE.PlaneGeometry(7.32, 2.44, 8, 4), netMat(3, 1)); backNet.position.set(0, 1.22, -2);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(7.32, 2), netMat(3, 0.8)); top.rotation.x = Math.PI / 2; top.position.set(0, 2.44, -1);
  const sideL = new THREE.Mesh(new THREE.PlaneGeometry(2, 2.44), netMat(0.8, 1)); sideL.rotation.y = Math.PI / 2; sideL.position.set(-3.66, 1.22, -1);
  const sideR = sideL.clone(); sideR.position.x = 3.66;
  net.add(backNet, top, sideL, sideR); grp.add(net);
  grp.position.z = GOAL_Z;
  scene.add(grp);
  return { grp, backNet };
}

/* ---------------- Players ---------------- */
let G = null;
function geos() {
  if (G) return G;
  G = {
    torso: new THREE.CapsuleGeometry(0.19, 0.34, 6, 16),
    shorts: new THREE.CylinderGeometry(0.2, 0.22, 0.26, 16),
    neck: new THREE.CylinderGeometry(0.06, 0.07, 0.12, 10),
    head: new THREE.SphereGeometry(0.19, 24, 18),
    hair: new THREE.SphereGeometry(0.2, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
    eye: new THREE.SphereGeometry(0.024, 8, 8),
    upperArm: new THREE.CapsuleGeometry(0.062, 0.2, 4, 10),
    foreArm: new THREE.CapsuleGeometry(0.05, 0.2, 4, 10),
    hand: new THREE.SphereGeometry(0.062, 10, 8),
    thigh: new THREE.CapsuleGeometry(0.088, 0.26, 4, 12),
    shin: new THREE.CapsuleGeometry(0.068, 0.28, 4, 12),
    boot: new THREE.CapsuleGeometry(0.062, 0.14, 4, 10),
  };
  return G;
}
const SKINS = [0xf1c9a5, 0xd9a47a, 0xa86f48, 0x6f452c, 0xe6b48c];
const HAIRS = [0x1b1410, 0x3b2616, 0x6b4a2a, 0xd8b56a, 0x101014];

function makePlayer(kit) {
  const g = geos();
  const M = (color, extra) => new THREE.MeshStandardMaterial({ color, roughness: 0.72, ...extra });
  const skin = M(SKINS[(Math.random() * SKINS.length) | 0]);
  const mats = { shirt: M(kit.shirt), shorts: M(kit.shorts), sock: M(kit.socks), hair: M(HAIRS[(Math.random() * HAIRS.length) | 0], { roughness: 0.9 }), boot: M(kit.boots ?? 0x14161c, { roughness: 0.35 }), eye: M(0x101318) };
  const add = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const pivot = (parent, x, y, z) => { const p = new THREE.Group(); p.position.set(x, y, z); parent.add(p); return p; };

  const root = new THREE.Group();
  const rig = pivot(root, 0, 0, 0); rig.scale.setScalar(SCALE);
  const body = pivot(rig, 0, HIP, 0);
  add(g.torso, mats.shirt, body, 0, 0.36, 0).scale.set(1.22, 1, 0.82);
  add(g.shorts, mats.shorts, body, 0, 0.02, 0).scale.set(1.16, 1, 0.86);
  add(g.neck, skin, body, 0, 0.72, 0);
  const head = pivot(body, 0, 0.78, 0);
  add(g.head, skin, head, 0, 0.12, 0);
  add(g.hair, mats.hair, head, 0, 0.135, -0.012).rotation.x = -0.28;
  add(g.eye, mats.eye, head, -0.068, 0.13, 0.172);
  add(g.eye, mats.eye, head, 0.068, 0.13, 0.172);

  const arm = (side) => {
    const sh = pivot(body, side * 0.275, 0.6, 0);
    add(g.upperArm, mats.shirt, sh, 0, -0.15, 0);
    const el = pivot(sh, 0, -0.3, 0);
    add(g.foreArm, skin, el, 0, -0.13, 0);
    add(g.hand, kit.gloves ? M(kit.gloves) : skin, el, 0, -0.29, 0).scale.setScalar(kit.gloves ? 1.5 : 1);
    return [sh, el];
  };
  const leg = (side) => {
    const hip = pivot(body, side * 0.11, 0, 0);
    add(g.thigh, skin, hip, 0, -0.21, 0);
    const kn = pivot(hip, 0, -0.43, 0);
    add(g.shin, mats.sock, kn, 0, -0.2, 0);
    add(g.boot, mats.boot, kn, 0, -0.41, 0.07).rotation.x = Math.PI / 2;
    return [hip, kn];
  };
  const [shL, elL] = arm(-1), [shR, elR] = arm(1), [hipL, knL] = leg(-1), [hipR, knR] = leg(1);

  return {
    root, rig, body, head, shL, shR, elL, elR, hipL, hipR, knL, knR,
    pos: root.position, anim: 'idle', rest: 'idle', t: 0, phase: Math.random() * 6, seed: Math.random() * 10,
    target: null, speed: 8, face: null, heading: 0, onArrive: null, dive: 0, diveSide: 1,
    cur: { hipL: 0, hipR: 0, knL: 0, knR: 0, shL: 0, shR: 0, elL: 0, elR: 0, shLz: 0, shRz: 0, lean: 0, bob: 0, headX: 0, jump: 0, crouch: 0 },
  };
}

// Procedural animation: sets joint targets for the current move, then eases toward them.
function pose(p, dt) {
  p.t += dt;
  const t = p.t, s0 = p.seed;
  const T = { hipL: 0, hipR: 0, knL: 0.06, knR: 0.06, shL: 0, shR: 0, elL: -0.25, elR: -0.25, shLz: 0.13, shRz: -0.13, lean: 0, bob: 0, headX: 0, jump: 0, crouch: 0 };
  let k = 14;
  switch (p.anim) {
    case 'run': {
      p.phase += dt * (5.5 + p.speed * 0.75);
      const s = Math.sin(p.phase), c = Math.cos(p.phase);
      T.hipL = -s * 0.95; T.hipR = s * 0.95;
      T.knL = 0.3 + 1.0 * Math.max(0, c); T.knR = 0.3 + 1.0 * Math.max(0, -c);
      T.shL = s * 0.85; T.shR = -s * 0.85; T.elL = T.elR = -1.25;
      T.lean = 0.2; T.bob = Math.abs(c) * 0.06; k = 30;
      break;
    }
    case 'call': // asking for the ball
      T.shR = -2.75 + Math.sin(t * 9 + s0) * 0.16; T.shRz = -0.3; T.elR = -0.15;
      T.shL = Math.sin(t * 2 + s0) * 0.08; T.bob = Math.abs(Math.sin(t * 4 + s0)) * 0.03;
      T.hipL = Math.sin(t * 4 + s0) * 0.08; T.hipR = -T.hipL; T.knL = T.knR = 0.15;
      break;
    case 'guard': { // defender ready stance
      const w = Math.sin(t * 3.2 + s0);
      T.crouch = 0.1; T.hipL = -0.35 + w * 0.06; T.hipR = -0.35 - w * 0.06; T.knL = T.knR = 0.7; T.lean = 0.22;
      T.shLz = 0.75; T.shRz = -0.75; T.elL = T.elR = -0.7;
      break;
    }
    case 'kick': {
      const u = clamp(t / 0.5, 0, 1);
      if (u < 0.4) { const a = easeInOut(u / 0.4); T.hipR = 0.95 * a; T.knR = 1.5 * a; T.shL = -0.9 * a; T.shR = 0.5 * a; T.lean = 0.12; }
      else if (u < 0.62) { const a = (u - 0.4) / 0.22; T.hipR = lerp(0.95, -1.35, a); T.knR = lerp(1.5, 0.05, a); T.shL = lerp(-0.9, 0.7, a); T.shR = -0.4; T.lean = -0.08; }
      else { const a = (u - 0.62) / 0.38; T.hipR = lerp(-1.35, 0, a); T.knR = 0.25 * (1 - a); T.shL = 0.7 * (1 - a); T.lean = -0.08 * (1 - a); }
      T.hipL = 0.12; T.knL = 0.22; T.shLz = 0.5; T.shRz = -0.5; k = 40;
      if (u >= 1) p.anim = p.rest;
      break;
    }
    case 'celebrate':
      T.jump = Math.abs(Math.sin(t * 6.5 + s0)) * 0.42;
      T.shL = T.shR = -2.95; T.shLz = 0.45; T.shRz = -0.45; T.elL = T.elR = -0.1;
      T.knL = T.knR = 0.25 + 0.3 * Math.abs(Math.cos(t * 6.5 + s0)); T.headX = -0.2;
      break;
    case 'sad':
      T.headX = 0.6; T.lean = 0.22; T.shL = T.shR = 0.1; T.elL = T.elR = -0.05; T.knL = T.knR = 0.12; k = 5;
      break;
    case 'keeper': {
      const w = Math.sin(t * 2.6);
      T.crouch = 0.12; T.hipL = T.hipR = -0.4; T.knL = T.knR = 0.8; T.lean = 0.25;
      T.shLz = 0.95 + w * 0.05; T.shRz = -0.95 - w * 0.05; T.elL = T.elR = -0.9; T.shL = T.shR = -0.3;
      break;
    }
    case 'dive':
      T.shL = T.shR = -3.0; T.shLz = 0.25; T.shRz = -0.25; T.elL = T.elR = 0; T.hipL = 0.2; T.hipR = -0.3; T.knR = 0.6; k = 30;
      break;
    default: { // idle
      const b = Math.sin(t * 1.8 + s0);
      T.bob = b * 0.008; T.shL = b * 0.05; T.shR = -b * 0.05; T.knL = T.knR = 0.08;
    }
  }
  const a = 1 - Math.exp(-dt * k), c = p.cur;
  for (const key in T) c[key] += (T[key] - c[key]) * a;
  p.hipL.rotation.x = c.hipL; p.hipR.rotation.x = c.hipR; p.knL.rotation.x = c.knL; p.knR.rotation.x = c.knR;
  p.shL.rotation.set(c.shL, 0, -c.shLz); p.shR.rotation.set(c.shR, 0, -c.shRz);
  p.elL.rotation.x = c.elL; p.elR.rotation.x = c.elR;
  p.body.rotation.x = c.lean; p.head.rotation.x = c.headX;
  p.body.position.y = HIP + c.bob - c.crouch;
  // keeper dive: lean over and fly sideways
  const d = p.dive;
  p.rig.rotation.z = -p.diveSide * 1.3 * easeOut(d);
  p.rig.position.x = p.diveSide * p.diveReach * easeOut(d);
  p.rig.position.y = c.jump + Math.sin(Math.PI * Math.min(1, d * 1.15)) * 0.75 * (d > 0 ? 1 : 0) + d * 0.18;
}

function stepMove(p, dt) {
  if (p.target) {
    const dx = p.target.x - p.pos.x, dz = p.target.z - p.pos.z, dist = Math.hypot(dx, dz);
    if (dist < 0.12) {
      p.target = null; p.anim = p.rest;
      if (p.onArrive) { const f = p.onArrive; p.onArrive = null; f(); }
    } else {
      const v = Math.min(dist, p.speed * dt);
      p.pos.x += (dx / dist) * v; p.pos.z += (dz / dist) * v;
      if (p.anim !== 'run') p.anim = 'run';
      p.heading = Math.atan2(dx, dz);
    }
  } else if (p.face) {
    p.heading = Math.atan2(p.face.x - p.pos.x, p.face.z - p.pos.z);
  }
  p.root.rotation.y += wrapAngle(p.heading - p.root.rotation.y) * (1 - Math.exp(-dt * 10));
}

/* ---------------- Scene ---------------- */
export function createScene(container, { onPick, sfx = {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050d1c);
  scene.fog = new THREE.Fog(0x050d1c, 110, 230);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.3, 400);

  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x1c4a2c, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
  sun.shadow.bias = -0.0005;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x9ccaff, 0.55); fill.position.set(-30, 25, -60); scene.add(fill);

  buildPitch(scene);
  buildStadium(scene);
  const goal = buildGoal(scene);

  const HOME = { shirt: 0x38bdf8, shorts: 0x0b2a52, socks: 0x38bdf8 };
  const AWAY = { shirt: 0xff6b4a, shorts: 0xf4f6fb, socks: 0xff6b4a };
  const KEEP = { shirt: 0xc8f03c, shorts: 0x20242c, socks: 0xc8f03c, gloves: 0xffffff };
  const attackers = [0, 1, 2, 3].map(() => makePlayer(HOME));
  const defenders = [0, 1, 2, 3].map(() => makePlayer(AWAY));
  const keeper = makePlayer(KEEP);
  const everyone = [...attackers, ...defenders, keeper];
  everyone.forEach((p) => { p.diveReach = 2.4; scene.add(p.root); });
  defenders.forEach((d) => { d.rest = 'guard'; });
  keeper.rest = 'keeper';

  // ball
  const ballTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#fbfdff'; g.fillRect(0, 0, w, h); g.fillStyle = '#16233a';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
      const x = c * 43 + (r % 2) * 21 + 12, y = r * 44 + 20;
      g.beginPath(); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; g.lineTo(x + Math.cos(a) * 11, y + Math.sin(a) * 11); } g.fill();
    }
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.4 }));
  ball.castShadow = true; scene.add(ball);
  let ballHolder = null;

  // markers above receivers + rings on the grass
  const badge = (label, color) => canvasTex(128, 160, (g) => {
    g.fillStyle = color; g.beginPath(); g.arc(64, 60, 46, 0, 7); g.fill();
    g.beginPath(); g.moveTo(40, 98); g.lineTo(88, 98); g.lineTo(64, 150); g.fill();
    g.fillStyle = '#04121f'; g.beginPath(); g.arc(64, 60, 34, 0, 7); g.fill();
    g.fillStyle = color; g.font = '900 46px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 64, 63);
  });
  const markers = TYPES.map((type, i) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: badge(String(i + 1), COLORS[type]), depthTest: false, transparent: true }));
    sp.scale.set(1.25, 1.56, 1); sp.renderOrder = 10; scene.add(sp);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.08, 40), new THREE.MeshBasicMaterial({ color: COLORS[type], transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; scene.add(ring);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3, 10), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.userData.pick = i; scene.add(hit);
    return { sp, ring, hit };
  });
  const shotMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: badge('⚽', COLORS.shot), depthTest: false, transparent: true }));
  shotMarker.scale.set(1.9, 2.37, 1); shotMarker.position.set(0, 4.3, GOAL_Z); shotMarker.renderOrder = 10; scene.add(shotMarker);
  const shotHit = new THREE.Mesh(new THREE.BoxGeometry(8.4, 4.6, 3), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  shotHit.position.set(0, 2.3, GOAL_Z - 0.5); shotHit.userData.pick = 'shoot'; scene.add(shotHit);
  const laneGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const lanes = TYPES.map((type) => { const l = new THREE.Line(laneGeo.clone(), new THREE.LineDashedMaterial({ color: COLORS[type], dashSize: 0.5, gapSize: 0.4, transparent: true, opacity: 0.75 })); l.frustumCulled = false; scene.add(l); return l; });
  let markersOn = false, shotOn = false;

  /* state */
  let carrier = attackers[0];
  let receivers = [attackers[1], attackers[2], attackers[3]];
  let options = [];
  const focus = new THREE.Vector3(0, 0, START.z);
  let shake = 0, zoom = 0, focusLock = null;

  /* tweens */
  const tweens = [];
  const tween = (dur, fn) => new Promise((res) => tweens.push({ t: 0, dur, fn, res }));
  const wait = (d) => tween(d, () => {});

  const feet = (p, d = 0.58) => new THREE.Vector3(p.pos.x + Math.sin(p.root.rotation.y) * d, BALL_R, p.pos.z + Math.cos(p.root.rotation.y) * d);
  const place = (p, x, z, face) => { p.pos.set(x, 0, z); p.target = null; p.onArrive = null; p.face = face; p.anim = p.rest; p.dive = 0; p.t = 0; if (face) { p.heading = Math.atan2(face.x - x, face.z - z); p.root.rotation.y = p.heading; } };
  const runTo = (p, x, z, speed, rest) => new Promise((res) => { p.speed = speed; if (rest) p.rest = rest; p.target = { x, z }; p.onArrive = res; });

  function ballFly(from, to, dur, arc) {
    const axis = new THREE.Vector3(to.z - from.z, 0, -(to.x - from.x)).normalize();
    const dist = from.distanceTo(to);
    let last = 0;
    return tween(dur, (u) => {
      ball.position.lerpVectors(from, to, u);
      ball.position.y = lerp(from.y, to.y, u) + 4 * arc * u * (1 - u);
      ball.rotateOnWorldAxis(axis, -((u - last) * dist) / BALL_R); last = u;
    });
  }

  // Where the three receivers and their markers stand for the current options.
  function targets() {
    const c = carrier.pos, remaining = Math.max(0, c.z - BOX_Z);
    const perms = [[-1, 0, 1], [1, 0, -1], [0, -1, 1], [0, 1, -1], [-1, 1, 0], [1, -1, 0]];
    const slots = perms[Math.floor((options[0]?.pos ?? 0) * 6) % 6];
    const frac = { safe: 0.14, standard: 0.26, risky: 0.42 };
    return options.map((o, i) => {
      const slot = slots[i];
      const z = Math.max(GOAL_Z + 4, c.z - Math.max(remaining * frac[o.type], slot === 0 ? 5.5 : 1.5));
      const maxX = z < GOAL_Z + 16 ? 15 : 22;
      const wide = { safe: 4.5, standard: 6.5, risky: 9 }[o.type] + o.pos * 3.5;
      let x = clamp(c.x * 0.4 + slot * wide + (slot === 0 ? (o.pos - 0.5) * 4 : 0), -maxX, maxX);
      if (Math.hypot(x - c.x, z - c.z) < 4.5) x = clamp(c.x + (x >= c.x ? 5 : -5), -maxX, maxX);
      return { x, z };
    });
  }

  function arrange(instant) {
    const c = carrier.pos, goalPoint = { x: c.x * 0.4, z: GOAL_Z };
    carrier.rest = 'idle'; carrier.face = goalPoint;
    const tg = targets();
    if (!instant && c.z > BOX_Z + 3) { carrier.anim = 'run'; runTo(carrier, c.x * 0.92, c.z - 2.2, 5.5, 'idle'); } // a short dribble forward
    receivers.forEach((r, i) => {
      const t = tg[i] ?? { x: c.x + (i - 1) * 8, z: c.z - 3 };
      r.rest = options.length ? 'call' : 'idle'; r.face = c;
      if (instant) place(r, t.x, t.z, c); else { r.anim = 'run'; runTo(r, t.x, t.z, 10 + i); }
      // marker: tight on low-chance passes, far away on safe ones
      const d = defenders[i], o = options[i], ch = o ? o.chance : 0.8;
      const lx = c.x - t.x, lz = c.z - t.z, len = Math.hypot(lx, lz) || 1;
      const gap = 1.3 + ch * 5.5, off = ch * 3.4 - 0.5, side = i % 2 ? 1 : -1;
      const dx = t.x + (lx / len) * gap + (-lz / len) * off * side, dz = t.z + (lz / len) * gap + (lx / len) * off * side;
      d.rest = 'guard'; d.face = c;
      if (instant) place(d, dx, dz, c); else runTo(d, dx, dz, 7.5);
    });
    const sweeper = defenders[3], sx = clamp(c.x * 0.5, -10, 10), sz = Math.max(GOAL_Z + 7, (c.z + GOAL_Z) / 2 - 4);
    sweeper.rest = 'guard'; sweeper.face = c;
    if (instant) place(sweeper, sx, sz, c); else runTo(sweeper, sx, sz, 6.5);
    const kx = clamp(c.x * 0.09, -2, 2);
    keeper.rest = 'keeper'; keeper.face = c;
    if (instant) place(keeper, kx, GOAL_Z + 0.8, c); else if (Math.abs(keeper.pos.x - kx) > 0.4) runTo(keeper, kx, GOAL_Z + 0.8, 3);
  }

  /* public API */
  function reset(round) {
    tweens.length = 0;
    carrier = attackers[0]; receivers = [attackers[1], attackers[2], attackers[3]];
    options = round?.options ?? [];
    everyone.forEach((p) => { p.rest = 'idle'; });
    keeper.rest = 'keeper'; defenders.forEach((d) => { d.rest = 'guard'; });
    place(carrier, START.x, START.z, { x: 0, z: GOAL_Z });
    arrange(true);
    ballHolder = carrier; ball.position.copy(feet(carrier));
    focus.set(START.x, 0, START.z);
    markersOn = options.length > 0; shotOn = !!round?.shot;
    goal.backNet.position.z = -2; goal.backNet.scale.set(1, 1, 1);
    zoom = 0; focusLock = null;
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
    carrier.target = null; carrier.face = { x: r.pos.x, z: r.pos.z };
    await wait(0.16);
    carrier.anim = 'kick'; carrier.t = 0;
    await wait(0.27);
    sfx.kick?.();
    const from = ball.position.clone(); ballHolder = null;
    const dir = new THREE.Vector3(from.x - r.pos.x, 0, from.z - r.pos.z).normalize();
    const to = new THREE.Vector3(r.pos.x + dir.x * 0.5, BALL_R, r.pos.z + dir.z * 0.5);
    const dist = from.distanceTo(to), dur = clamp(dist / (type === 'risky' ? 17 : 21), 0.35, 1.25);
    const arc = type === 'risky' ? dist * 0.17 : type === 'standard' ? dist * 0.025 : 0;
    r.face = from;
    if (ok) {
      await ballFly(from, to, dur, arc);
      sfx.receive?.();
      const old = carrier;
      carrier = r; ballHolder = r;
      r.anim = 'kick'; r.t = 0.3; // first touch
      receivers = attackers.filter((a) => a !== carrier);
      old.rest = 'idle';
      await wait(0.12);
    } else {
      const cut = 0.62, ip = new THREE.Vector3().lerpVectors(from, to, cut);
      const need = Math.hypot(ip.x - d.pos.x, ip.z - d.pos.z) / (dur * cut);
      d.rest = 'idle'; runTo(d, ip.x - dir.x * 0.4, ip.z - dir.z * 0.4, Math.max(8, need * 1.05));
      await ballFly(from, ip, dur * cut, arc * 0.5);
      sfx.intercept?.();
      d.target = null; d.anim = 'kick'; d.t = 0.18; ballHolder = d; shake = 0.25;
      attackers.forEach((a) => { a.target = null; a.rest = a.anim = 'sad'; });
      await wait(0.35);
      runTo(d, clamp(ip.x * 0.7, -25, 25), ip.z + 22, 8.5, 'idle'); // breaks away with the ball
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
    carrier.anim = 'kick'; carrier.t = 0;
    await wait(0.27);
    sfx.kick?.();
    const from = ball.position.clone(); ballHolder = null;
    const dist = Math.abs(from.z - GOAL_Z), dur = clamp(dist / 30, 0.45, 1.3);
    keeper.target = null; keeper.rest = 'dive'; keeper.anim = 'dive'; keeper.face = null;
    const savedOrWide = ok ? 'goal' : Math.random() < 0.6 ? 'save' : 'wide';
    const tx = savedOrWide === 'wide' ? side * 5.4 : side * 2.9, ty = savedOrWide === 'wide' ? 1.6 : 0.5 + Math.random() * 1.5;
    keeper.diveSide = savedOrWide === 'goal' ? -side : side;
    keeper.diveReach = savedOrWide === 'save' ? Math.abs(tx - keeper.pos.x) - 0.3 : 2.3;
    zoom = 1; focusLock = { x: carrier.pos.x * 0.45, z: Math.max(GOAL_Z + 10, lerp(carrier.pos.z, GOAL_Z, 0.45)) };
    const diveStart = savedOrWide === 'save' ? 0.35 : 0.5;
    tween(dur * (1 - diveStart) + 0.25, (u) => { keeper.dive = u; }).then(() => {});
    if (savedOrWide === 'goal') {
      await ballFly(from, new THREE.Vector3(tx, ty, GOAL_Z - 0.2), dur, dist * 0.05);
      sfx.cheer?.(); shake = 0.5;
      const a = ball.position.clone(), b = new THREE.Vector3(tx * 0.95, 0.3, GOAL_Z - 1.75);
      tween(0.5, (u) => { goal.backNet.position.z = -2 - Math.sin(u * Math.PI) * 0.55; goal.backNet.scale.y = 1 + Math.sin(u * Math.PI) * 0.06; });
      await tween(0.25, (u) => { ball.position.lerpVectors(a, b, easeOut(u)); });
      attackers.forEach((p, n) => { p.target = null; p.rest = 'celebrate'; p.anim = 'celebrate'; if (p !== carrier) runTo(p, carrier.pos.x + (n - 1.5) * 1.6, carrier.pos.z + 1.2, 8.5, 'celebrate'); });
      defenders.forEach((p) => { p.target = null; p.rest = p.anim = 'sad'; });
      tween(1.2, (u) => { ball.position.y = Math.max(BALL_R, 0.3 * (1 - u)); });
      await wait(1.5);
    } else {
      if (savedOrWide === 'save') {
        const hitAt = new THREE.Vector3(tx, ty, GOAL_Z + 0.9);
        await ballFly(from, hitAt, dur, dist * 0.04);
        sfx.intercept?.(); shake = 0.3;
        await ballFly(hitAt, new THREE.Vector3(tx + side * 5, BALL_R, GOAL_Z + 6), 0.7, 1.2);
      } else {
        await ballFly(from, new THREE.Vector3(tx, ty, GOAL_Z - 3), dur * 1.05, dist * 0.05);
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

  /* picking */
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let down = null;
  const el = renderer.domElement;
  const pickAt = (ev) => {
    const b = el.getBoundingClientRect();
    ptr.set(((ev.clientX - b.left) / b.width) * 2 - 1, -((ev.clientY - b.top) / b.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const list = [];
    if (markersOn) list.push(...markers.map((m) => m.hit));
    if (shotOn) list.push(shotHit);
    const hit = ray.intersectObjects(list, false)[0];
    return hit ? hit.object.userData.pick : null;
  };
  el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) return;
    const p = pickAt(e); if (p !== null && onPick) onPick(p);
  });
  el.addEventListener('pointermove', (e) => { el.style.cursor = pickAt(e) !== null ? 'pointer' : 'default'; });

  /* resize + loop */
  let portrait = false;
  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; portrait = w / h < 0.95;
    camera.fov = portrait ? 60 : 46;
    // shift the picture up so the ball carrier is not hidden behind the option cards
    camera.setViewOffset(w, h, 0, h * (portrait ? 0.17 : 0.11), w, h);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container); resize();

  const clock = new THREE.Clock();
  const camPos = new THREE.Vector3(0, 10, 12), look = new THREE.Vector3();
  let running = true, time = 0;
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05); time += dt;
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i]; tw.t += dt;
      const u = Math.min(1, tw.t / tw.dur); tw.fn(u);
      if (u >= 1) { tweens.splice(i, 1); tw.res(); }
    }
    for (const p of everyone) { stepMove(p, dt); pose(p, dt); }
    if (ballHolder) {
      const f = feet(ballHolder, 0.58);
      if (ballHolder.anim === 'run') { ball.rotation.x -= dt * ballHolder.speed / BALL_R; f.y += Math.abs(Math.sin(time * 14)) * 0.04; }
      ball.position.lerp(f, 1 - Math.exp(-dt * 22));
    }
    // markers
    markers.forEach((m, i) => {
      const r = receivers[i], on = markersOn && !!options[i];
      m.sp.visible = m.ring.visible = lanes[i].visible = on;
      m.hit.position.set(r.pos.x, 1.5, r.pos.z);
      if (!on) return;
      m.sp.position.set(r.pos.x, 3.15 + Math.sin(time * 3 + i) * 0.1, r.pos.z);
      m.ring.position.set(r.pos.x, 0.03, r.pos.z);
      m.ring.scale.setScalar(1 + Math.sin(time * 4 + i) * 0.08);
      const pa = lanes[i].geometry.attributes.position;
      pa.setXYZ(0, ball.position.x, 0.05, ball.position.z); pa.setXYZ(1, r.pos.x, 0.05, r.pos.z); pa.needsUpdate = true;
      lanes[i].computeLineDistances();
    });
    shotMarker.visible = shotOn;
    shotMarker.position.y = 4.3 + Math.sin(time * 3) * 0.12;
    // camera follows the ball from behind
    const fz = focusLock ? focusLock.z : clamp(ball.position.z, GOAL_Z + 9, 4), fx = focusLock ? focusLock.x : ball.position.x * 0.8;
    focus.x += (fx - focus.x) * (1 - Math.exp(-dt * 2.5));
    focus.z += (fz - focus.z) * (1 - Math.exp(-dt * 2.5));
    const back = portrait ? 17 : 11.5, up = portrait ? 10.5 : 5.8;
    const want = new THREE.Vector3(focus.x * 0.9, up - zoom * 1.2, focus.z + back - zoom * 2.5);
    camPos.lerp(want, 1 - Math.exp(-dt * 3.5));
    shake = Math.max(0, shake - dt);
    camera.position.copy(camPos);
    if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.5; camera.position.y += (Math.random() - 0.5) * shake * 0.5; }
    look.set(camPos.x + (focus.x - camPos.x) * 0.5, 1.2, camPos.z - back - (portrait ? 9 : 8));
    camera.lookAt(look);
    sun.position.set(focus.x + 18, 42, focus.z + 14); sun.target.position.set(focus.x, 0, focus.z - 4);
    renderer.render(scene, camera);
  }
  reset(null);
  camPos.set(0, 5.8, START.z + 11.5);
  frame();

  return { reset, layout, playPass, playShot, playCashout, dispose() { running = false; renderer.dispose(); el.remove(); } };
}
