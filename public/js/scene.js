// Tiki Taka — 3D match view (Three.js): floodlit stadium, rigged players in team kits,
// a high, steep camera that keeps every pass option in frame.
// The scene only shows what the engine decided: it never decides an outcome.
import * as THREE from 'three';
import { loadPlayers, updatePlayer, SCALE } from './players.js';
import { GOAL_Z, canvasTex, buildSky, buildPitch, buildStadium, buildGoal, buildBall } from './stadium.js';

const BOX_Z = -44;           // passes never go deeper than this (+ a little)
const START = { x: 0, z: -22 }; // the move starts 28 m from goal, just outside the box
const COLORS = { safe: '#b6f24a', standard: '#ffd84a', risky: '#ff9838', shot: '#ff4d5e' }; // same as the option cards
const TYPES = ['safe', 'standard', 'risky'];
const BALL_R = 0.21;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 3;
const pct = (c) => `${+(c * 100).toFixed(1)}%`;

export async function createScene(container, { onPick, sfx = {} } = {}) {
  const squad = await loadPlayers(new URL('../assets/', import.meta.url).href);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 900);
  buildSky(scene);

  // floodlights: a cool wash, one shadow-casting key light and a rim light from the far side
  scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x2a4a2a, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 2.9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 160 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
  key.shadow.camera.updateProjectionMatrix();
  const rim = new THREE.DirectionalLight(0xbfd6ff, 1.1);
  scene.add(key, key.target, rim, rim.target);

  buildPitch(scene);
  const stadium = buildStadium(scene);
  const goal = buildGoal(scene);

  const HOME = { shirt: 0x38bdf8, shirt2: 0x0b2a52, pattern: 1, shorts: 0x0b2a52, socks: 0x38bdf8, trim: 0xffffff, ink: 0xffffff, boots: 0x16181d };
  const AWAY = { shirt: 0xd62f45, shorts: 0xf4f4f5, socks: 0xd62f45, trim: 0x7a1020, ink: 0xffffff, boots: 0x16181d };
  const KEEP = { shirt: 0xffc928, shorts: 0x1f2937, socks: 0xffc928, trim: 0x1f2937, ink: 0x1f2937, boots: 0x16181d, gloves: 0xf8fafc, longSleeves: true };
  const attackers = [10, 7, 11, 8].map((n) => squad.make(HOME, n));
  const defenders = [4, 5, 3, 6].map((n) => squad.make(AWAY, n));
  const keeper = squad.make(KEEP, 1);
  const everyone = [...attackers, ...defenders, keeper];
  everyone.forEach((p) => scene.add(p.root));
  defenders.forEach((d) => { d.rest = 'guard'; });
  keeper.rest = 'keeper';

  const ball = buildBall(BALL_R);
  scene.add(ball);
  let ballHolder = null;

  /* ---------- markers: a badge above each receiver, a ring at their feet, a lane on the grass ---------- */
  const ringTex = canvasTex(256, 256, (g, w) => {
    const c = w / 2;
    const gr = g.createRadialGradient(c, c, c * 0.5, c, c, c);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.22)'); gr.addColorStop(0.74, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
    g.strokeStyle = '#fff'; g.lineWidth = 12; g.beginPath(); g.arc(c, c, c * 0.74, 0, Math.PI * 2); g.stroke();
  });
  const chevronTex = canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(6, 50); g.lineTo(32, 20); g.lineTo(58, 50); g.lineTo(58, 34); g.lineTo(32, 4); g.lineTo(6, 34); g.closePath(); g.fill();
  });
  chevronTex.wrapT = THREE.RepeatWrapping;
  const drawBadge = (g, label, text, color) => {
    g.clearRect(0, 0, 256, 160);
    g.beginPath(); g.roundRect(8, 8, 240, 104, 52); g.moveTo(108, 110); g.lineTo(128, 150); g.lineTo(148, 110); g.closePath();
    g.fillStyle = 'rgba(10,15,11,.94)'; g.fill();
    g.lineWidth = 7; g.strokeStyle = color; g.lineJoin = 'round'; g.beginPath(); g.roundRect(8, 8, 240, 104, 52); g.stroke();
    g.fillStyle = color; g.beginPath(); g.arc(60, 60, 38, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#06140a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 50px system-ui, sans-serif'; g.fillText(label, 60, 63);
    g.fillStyle = '#fff'; g.font = `800 ${text.length > 4 ? 36 : 44}px system-ui, sans-serif`; g.fillText(text, 172, 63);
  };
  const makeBadge = (color) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 160;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
    sp.center.set(0.5, 0); sp.renderOrder = 10; scene.add(sp);
    return { sp, set(label, text) { drawBadge(c.getContext('2d'), label, text, color); tex.needsUpdate = true; } };
  };
  const flatGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const markers = TYPES.map((type, i) => {
    const badge = makeBadge(COLORS[type]);
    const ring = new THREE.Mesh(flatGeo, new THREE.MeshBasicMaterial({ map: ringTex, color: COLORS[type], transparent: true, depthWrite: false, fog: false }));
    ring.scale.set(4, 1, 4); ring.renderOrder = 2; scene.add(ring);
    const tex = chevronTex.clone(); tex.needsUpdate = true;
    const lane = new THREE.Mesh(flatGeo, new THREE.MeshBasicMaterial({ map: tex, color: COLORS[type], transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
    lane.renderOrder = 1; scene.add(lane);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 6, 10), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.userData.pick = i; scene.add(hit);
    return { badge, ring, lane, tex, hit };
  });
  const shotBadge = makeBadge(COLORS.shot);
  const shotGlow = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 2.36), new THREE.MeshBasicMaterial({ color: COLORS.shot, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  shotGlow.position.set(0, 1.2, GOAL_Z - 0.05); scene.add(shotGlow);
  const shotHit = new THREE.Mesh(new THREE.BoxGeometry(9.5, 6, 5), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  shotHit.position.set(0, 2.8, GOAL_Z - 0.5); shotHit.userData.pick = 'shoot'; scene.add(shotHit);
  // ring under the player on the ball
  const halo = new THREE.Mesh(flatGeo, new THREE.MeshBasicMaterial({ map: ringTex, color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
  halo.scale.set(3.2, 1, 3.2); halo.renderOrder = 2; scene.add(halo);
  let markersOn = false, shotOn = false;

  /* ---------- state ---------- */
  let carrier = attackers[0];
  let receivers = [attackers[1], attackers[2], attackers[3]];
  let options = [];
  let shake = 0, camMode = 'play', camFast = false;

  /* tweens */
  const tweens = [];
  const tween = (dur, fn) => new Promise((res) => tweens.push({ t: 0, dur, fn, res }));
  const wait = (d) => tween(d, () => {});

  const feet = (p, d = 0.9) => new THREE.Vector3(p.pos.x + Math.sin(p.root.rotation.y) * d, BALL_R, p.pos.z + Math.cos(p.root.rotation.y) * d);
  const place = (p, x, z, face) => { p.pos.set(x, 0, z); p.target = null; p.onArrive = null; p.slideWithin = 0; p.face = face; p.anim = p.rest; p.dive = 0; p.t = 0; if (face) { p.heading = Math.atan2(face.x - x, face.z - z); p.root.rotation.y = p.heading; } };
  const runTo = (p, x, z, speed, rest) => new Promise((res) => { p.speed = speed; if (rest) p.rest = rest; p.target = { x, z }; p.onArrive = res; });
  const setAnim = (p, anim, rest = anim) => { p.target = null; p.onArrive = null; p.anim = anim; p.rest = rest; p.t = 0; };

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
    const frac = { safe: 0.12, standard: 0.22, risky: 0.36 };
    return options.map((o, i) => {
      const slot = slots[i];
      const z = Math.max(GOAL_Z + 4, c.z - Math.max(remaining * frac[o.type], slot === 0 ? 5.5 : 1.5));
      const maxX = z < GOAL_Z + 16 ? 15 : 22;
      const wide = { safe: 5, standard: 7.5, risky: 10 }[o.type] + o.pos * 4;
      let x = clamp(c.x * 0.4 + slot * wide + (slot === 0 ? (o.pos - 0.5) * 4 : 0), -maxX, maxX);
      if (Math.hypot(x - c.x, z - c.z) < 4.5) x = clamp(c.x + (x >= c.x ? 5 : -5), -maxX, maxX);
      return { x, z };
    });
  }

  function arrange(instant) {
    const c = carrier.pos, goalPoint = { x: c.x * 0.4, z: GOAL_Z };
    carrier.rest = 'idle'; carrier.face = goalPoint;
    const tg = targets();
    if (!instant && c.z > BOX_Z + 3) runTo(carrier, c.x * 0.92, c.z - 2.2, 5.2, 'idle'); // a short dribble forward
    receivers.forEach((r, i) => {
      const t = tg[i] ?? { x: c.x + (i - 1) * 8, z: c.z - 3 };
      r.rest = options.length ? 'call' : 'idle'; r.face = c;
      if (instant) place(r, t.x, t.z, c); else runTo(r, t.x, t.z, 9.5 + i);
      // marker: tight on low-chance passes, far away on safe ones
      const d = defenders[i], o = options[i], ch = o ? o.chance : 0.8;
      const lx = c.x - t.x, lz = c.z - t.z, len = Math.hypot(lx, lz) || 1;
      const gap = 2 + ch * 4.5, off = ch * 3.4 - 0.5, side = i % 2 ? 1 : -1;
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

  function labels(round) {
    options.forEach((o, i) => markers[i].badge.set(String(i + 1), pct(o.chance)));
    if (round?.shot) shotBadge.set('S', pct(round.shot.chance));
  }

  /* ---------- public API ---------- */
  function reset(round) {
    tweens.length = 0;
    carrier = attackers[0]; receivers = [attackers[1], attackers[2], attackers[3]];
    options = round?.options ?? [];
    everyone.forEach((p) => { p.rest = 'idle'; });
    keeper.rest = 'keeper'; defenders.forEach((d) => { d.rest = 'guard'; });
    place(carrier, START.x, START.z, { x: 0, z: GOAL_Z });
    arrange(true);
    ballHolder = carrier; ball.position.copy(feet(carrier));
    markersOn = options.length > 0; shotOn = !!round?.shot;
    labels(round);
    goal.backNet.position.z = goal.restZ; goal.backNet.scale.set(1, 1, 1);
    camMode = 'play'; camFast = false; camReady = false;
  }

  function layout(round) {
    options = round.options ?? [];
    arrange(false);
    markersOn = options.length > 0; shotOn = !!round.shot;
    labels(round);
  }

  async function playPass(i, ok) {
    const r = receivers[i], d = defenders[i], type = TYPES[i];
    markersOn = false; shotOn = false;
    setAnim(r, 'idle');
    carrier.target = null; carrier.onArrive = null; carrier.anim = 'idle'; carrier.face = { x: r.pos.x, z: r.pos.z };
    await wait(0.16);
    carrier.anim = 'kick'; carrier.t = 0;
    await wait(0.27);
    sfx.kick?.();
    const from = ball.position.clone(); ballHolder = null;
    const dir = new THREE.Vector3(from.x - r.pos.x, 0, from.z - r.pos.z).normalize();
    const to = new THREE.Vector3(r.pos.x + dir.x * 0.6, BALL_R, r.pos.z + dir.z * 0.6);
    const dist = from.distanceTo(to), dur = clamp(dist / (type === 'risky' ? 17 : 21), 0.35, 1.25);
    const arc = type === 'risky' ? dist * 0.17 : type === 'standard' ? dist * 0.025 : 0;
    r.face = from;
    if (ok) {
      await ballFly(from, to, dur, arc);
      sfx.receive?.();
      const old = carrier;
      carrier = r; ballHolder = r;
      r.anim = 'trap'; r.t = 0; // first touch
      receivers = attackers.filter((a) => a !== carrier);
      old.rest = 'idle';
      await wait(0.12);
    } else {
      // the marker slides in and cuts the pass out
      const cut = 0.62, ip = new THREE.Vector3().lerpVectors(from, to, cut);
      const need = Math.hypot(ip.x - d.pos.x, ip.z - d.pos.z) / (dur * cut);
      d.rest = 'idle'; d.slideWithin = 3.4; runTo(d, ip.x - dir.x * 0.4, ip.z - dir.z * 0.4, Math.max(8, need * 1.05));
      await ballFly(from, ip, dur * cut, arc * 0.5);
      sfx.intercept?.();
      setAnim(d, 'idle'); d.slideWithin = 0; ballHolder = d; shake = 0.25; camMode = 'hold';
      attackers.forEach((a) => setAnim(a, 'sad'));
      await wait(0.4);
      runTo(d, clamp(ip.x * 0.7, -25, 25), ip.z + 22, 8.5, 'idle'); // breaks away with the ball
      defenders.filter((x) => x !== d).forEach((x) => setAnim(x, 'celebrate'));
      await wait(0.9);
    }
  }

  async function playShot(ok) {
    markersOn = false; shotOn = false;
    const side = Math.random() < 0.5 ? -1 : 1;
    carrier.target = null; carrier.onArrive = null; carrier.anim = 'idle'; carrier.face = { x: side * 2, z: GOAL_Z };
    receivers.forEach((r) => { setAnim(r, 'idle'); r.face = { x: 0, z: GOAL_Z }; });
    await wait(0.22);
    carrier.anim = 'kick'; carrier.t = 0;
    await wait(0.27);
    sfx.kick?.();
    const from = ball.position.clone(); ballHolder = null;
    const dist = Math.abs(from.z - GOAL_Z), dur = clamp(dist / 30, 0.45, 1.3);
    setAnim(keeper, 'dive'); keeper.face = null;
    const savedOrWide = ok ? 'goal' : Math.random() < 0.6 ? 'save' : 'wide';
    const tx = savedOrWide === 'wide' ? side * 5.4 : side * 2.9, ty = savedOrWide === 'wide' ? 1.6 : 0.5 + Math.random() * 1.5;
    keeper.diveSide = savedOrWide === 'goal' ? -side : side;
    keeper.diveReach = savedOrWide === 'save' ? Math.abs(tx - keeper.pos.x) - 0.3 : 2.3;
    camMode = 'shot'; camFast = true; // the camera chases the ball to the goal
    const diveStart = savedOrWide === 'save' ? 0.35 : 0.5;
    tween(dur * (1 - diveStart) + 0.25, (u) => { keeper.dive = u; }).then(() => {});
    if (savedOrWide === 'goal') {
      await ballFly(from, new THREE.Vector3(tx, ty, GOAL_Z - 0.2), dur, dist * 0.05);
      sfx.cheer?.(); shake = 0.5;
      const a = ball.position.clone(), b = new THREE.Vector3(tx * 0.95, 0.3, GOAL_Z - 1.75);
      tween(0.5, (u) => { goal.backNet.position.z = goal.restZ - Math.sin(u * Math.PI) * 0.55; goal.backNet.scale.y = 1 + Math.sin(u * Math.PI) * 0.06; });
      await tween(0.25, (u) => { ball.position.lerpVectors(a, b, easeOut(u)); });
      attackers.forEach((p, n) => { setAnim(p, 'celebrate'); if (p !== carrier) runTo(p, carrier.pos.x + (n - 1.5) * 1.8, carrier.pos.z + 1.4, 8.5, 'celebrate'); });
      defenders.forEach((p) => setAnim(p, 'sad'));
      tween(1.2, (u) => { ball.position.y = Math.max(BALL_R, 0.3 * (1 - u)); });
      await wait(0.9);
      camFast = false; camMode = 'party'; // pan back to the celebration
      await wait(1.7);
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
      attackers.forEach((p) => setAnim(p, 'sad'));
      defenders.forEach((p) => setAnim(p, 'celebrate'));
      await wait(0.9);
    }
  }

  async function playCashout() {
    markersOn = false; shotOn = false;
    attackers.forEach((p) => setAnim(p, 'celebrate'));
    defenders.forEach((p) => setAnim(p, 'sad'));
    camMode = 'party';
    await wait(1.1);
  }

  /* ---------- picking ---------- */
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

  /* ---------- camera ---------- */
  // High above the move, looking down and up the pitch toward the goal. Each frame it works out how far back it must
  // be so that everything that matters (carrier, receivers and their badges, the ball) fits
  // between the HUD at the top and the option cards at the bottom, on any screen shape.
  let portrait = false, tanV = 0.34, tanH = 0.5;
  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; portrait = w / h < 0.95;
    camera.fov = portrait ? 34 : 30; // narrow lens keeps the pitch flat and the players upright
    camera.updateProjectionMatrix();
    tanV = Math.tan((camera.fov * Math.PI) / 360); tanH = tanV * camera.aspect;
  }
  new ResizeObserver(resize).observe(container); resize();

  const cam = { x: 0, z: 0, D: 30, tilt: 0.5 };
  let camReady = false;
  const pts = [];
  const add = (x, y, z) => pts.push(x, y, z);
  function frameCamera(dt) {
    pts.length = 0;
    let fx, fz, tilt = 0.76, minD = 30; // about 44° above the ground
    const bottom = portrait ? 0.37 : 0.23, top = portrait ? 0.1 : 0.07; // share of the screen covered by cards / HUD
    if (camMode === 'shot') {
      // from behind the shooter, with the whole goal in view
      add(ball.position.x, ball.position.y, ball.position.z); add(-4.6, 0, GOAL_Z); add(4.6, 3.4, GOAL_Z); add(carrier.pos.x, 0, carrier.pos.z + 1); add(carrier.pos.x, 2.6, carrier.pos.z);
      fx = carrier.pos.x * 0.5; fz = (carrier.pos.z + GOAL_Z) / 2; tilt -= 0.1; minD = 40;
    } else if (camMode === 'party') {
      let sx = 0, sz = 0;
      attackers.forEach((p) => { add(p.pos.x, 0, p.pos.z); add(p.pos.x, 3.2, p.pos.z); sx += p.pos.x; sz += p.pos.z; });
      fx = sx / 4; fz = sz / 4; tilt -= 0.06; minD = 44;
    } else {
      // the carrier, every option, and the goal with its keeper are always in view
      const c = carrier.pos;
      add(c.x, 0, c.z + 1.2); add(c.x, 3.1, c.z);
      const half = portrait ? 2.8 : 2.2; // room for the badge above each receiver
      receivers.forEach((r) => { add(r.pos.x - half, 0, r.pos.z); add(r.pos.x + half, 5.4, r.pos.z); });
      add(-5.5, 0, GOAL_Z - 1); add(5.5, 4.2, GOAL_Z - 1); add(keeper.pos.x, 3.1, keeper.pos.z);
      add(START.x - 6, 0, START.z + 2.5); add(START.x + 6, 0, START.z + 2.5); // framed from the kick-off spot, so the view stays far for the whole move
      fx = c.x * 0.25; fz = null; // the aim point up the pitch is chosen below, where the view is tightest
    }
    // how far back the camera must be, aimed at (x, z), for every point to fit
    const fit = (x, z, t) => {
      const s = Math.sin(t), co = Math.cos(t);
      let D = 0;
      for (let i = 0; i < pts.length; i += 3) {
        const rx = pts[i] - x, ry = pts[i + 1], rz = pts[i + 2] - z;
        const depth = -ry * s - rz * co, up = ry * co - rz * s; // along the view direction / up the screen
        D = Math.max(D, Math.abs(rx) / (tanH * 0.9) - depth, up > 0 ? up / (tanV * (1 - 2 * top)) - depth : -up / (tanV * (1 - 2 * bottom)) - depth);
      }
      return D;
    };
    if (fz === null) { // slide the aim point along the pitch to the spot that needs the least distance
      let best = Infinity;
      for (let z = GOAL_Z + 4; z <= START.z + 6; z += 1.5) { const d = fit(fx, z, tilt); if (d < best) { best = d; fz = z; } }
    }
    const follow = camMode === 'hold' ? 0 : 1 - Math.exp(-dt * (camFast ? 7 : 2.6)); // 'hold': stay where we are
    if (!camReady) { cam.x = fx; cam.z = fz; cam.tilt = tilt; } else { cam.x += (fx - cam.x) * follow; cam.z += (fz - cam.z) * follow; cam.tilt += (tilt - cam.tilt) * follow; }
    const s = Math.sin(cam.tilt), co = Math.cos(cam.tilt);
    let D = Math.max(minD, fit(cam.x, cam.z, cam.tilt));
    D = Math.min(D * 1.03, 320);
    cam.D = camReady ? cam.D + (D - cam.D) * follow : D;
    camReady = true;
    shake = Math.max(0, shake - dt);
    camera.position.set(cam.x, cam.D * s, cam.z + cam.D * co);
    if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.5; camera.position.y += (Math.random() - 0.5) * shake * 0.5; }
    camera.rotation.set(-cam.tilt, 0, 0);
    camera.position.y = Math.max(camera.position.y, 1.5);
  }

  /* ---------- loop ---------- */
  const clock = new THREE.Clock();
  let running = true, time = 0;
  const camDist = (v) => camera.position.distanceTo(v), ndc = new THREE.Vector3();
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05); time += dt;
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i]; tw.t += dt;
      const u = Math.min(1, tw.t / tw.dur); tw.fn(u);
      if (u >= 1) { tweens.splice(i, 1); tw.res(); }
    }
    for (const p of everyone) updatePlayer(p, dt);
    if (ballHolder) {
      const f = feet(ballHolder);
      if (ballHolder.anim === 'run') { ball.rotation.x -= dt * ballHolder.speed / BALL_R; f.y += Math.abs(Math.sin(time * 14)) * 0.04; }
      ball.position.lerp(f, 1 - Math.exp(-dt * 22));
    }
    frameCamera(dt);
    stadium.tick(dt);
    // markers
    markers.forEach((m, i) => {
      const r = receivers[i], on = markersOn && !!options[i];
      m.badge.sp.visible = m.ring.visible = m.lane.visible = on;
      m.hit.position.set(r.pos.x, 3, r.pos.z);
      if (!on) return;
      const k = camDist(r.pos) * (portrait ? 0.052 : 0.042);
      m.badge.sp.scale.set(k * 1.6, k, 1);
      m.badge.sp.position.set(r.pos.x, 3.3 + Math.sin(time * 3 + i) * 0.1, r.pos.z);
      m.ring.position.set(r.pos.x, 0.03, r.pos.z);
      m.ring.scale.setScalar(4 * (1 + Math.sin(time * 4 + i) * 0.07));
      const dx = r.pos.x - ball.position.x, dz = r.pos.z - ball.position.z, len = Math.hypot(dx, dz), gap = 1.7, l = Math.max(0.01, len - gap * 2);
      m.lane.position.set(ball.position.x + dx / 2, 0.025, ball.position.z + dz / 2);
      m.lane.rotation.y = Math.atan2(-dx, -dz);
      m.lane.scale.set(0.8, 1, l);
      m.tex.repeat.set(1, l / 1.1); m.tex.offset.y -= dt * 1.6;
    });
    shotBadge.sp.visible = shotGlow.visible = shotOn;
    if (shotOn) {
      
      // above the crossbar, but never off the top of the screen
      ndc.set(0, 2.9 + Math.sin(time * 3) * 0.1, GOAL_Z).project(camera);
      ndc.y = Math.min(ndc.y, portrait ? 0.58 : 0.74); ndc.x = clamp(ndc.x, -0.6, 0.6);
      shotBadge.sp.position.copy(ndc.unproject(camera));
      const k = camDist(shotBadge.sp.position) * (portrait ? 0.052 : 0.042);
      shotBadge.sp.scale.set(k * 1.6, k, 1);
      shotGlow.material.opacity = 0.14 + Math.sin(time * 4) * 0.07;
    }
    halo.visible = !!ballHolder && attackers.includes(ballHolder);
    if (ballHolder) halo.position.set(ballHolder.pos.x, 0.03, ballHolder.pos.z);
    key.position.set(cam.x - 22, 40, cam.z + 16); key.target.position.set(cam.x, 0, cam.z - 4);
    rim.position.set(cam.x + 30, 30, cam.z - 40); rim.target.position.set(cam.x, 0, cam.z);
    renderer.render(scene, camera);
  }
  reset(null);
  frame();

  return { reset, layout, playPass, playShot, playCashout, dispose() { running = false; renderer.dispose(); el.remove(); } };
}
