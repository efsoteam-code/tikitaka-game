// Tiki Taka — the ground: floodlit night stadium, striped turf with crisp lines, goal, ball.
import * as THREE from 'three';

export const GOAL_Z = -50;   // goal line. Attack runs toward -z.
export const HALF_Z = 2.5;   // halfway line
const TOUCH_X = 34;          // touchlines at ±34

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ---------------- Sky ---------------- */
export function buildSky(scene) {
  scene.background = canvasTex(8, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#040912'); gr.addColorStop(0.55, '#0a1830'); gr.addColorStop(1, '#16325a');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0x0c1d38, 190, 460);
}

/* ---------------- Pitch ---------------- */
export function buildPitch(scene) {
  // tiling grass: blades of slightly different greens, drawn wrapped so the tile repeats cleanly
  const grass = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#2a7a2c'; g.fillRect(0, 0, w, h);
    const tones = ['rgba(18,70,20,.35)', 'rgba(70,160,50,.3)', 'rgba(120,190,80,.22)', 'rgba(20,90,30,.3)', 'rgba(190,220,120,.12)'];
    for (let i = 0; i < 26000; i++) {
      const x = Math.random() * w, y = Math.random() * h, len = 3 + Math.random() * 7, lean = (Math.random() - 0.5) * 3;
      g.strokeStyle = tones[(Math.random() * tones.length) | 0]; g.lineWidth = 0.8 + Math.random();
      for (const ox of [0, -w, w]) for (const oy of [0, -h, h]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + lean, y + oy - len); g.stroke(); }
    }
  });
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.anisotropy = 16;
  const band = (x0, x1, z0, z1, color) => {
    const t = grass.clone(); t.needsUpdate = true; t.repeat.set((x1 - x0) / 6, (z1 - z0) / 6); t.offset.set(x0 / 6, -z0 / 6);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshStandardMaterial({ map: t, color, roughness: 1 }));
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); m.receiveShadow = true;
    scene.add(m);
  };
  // mowing bands across the pitch, then the darker run-off around it
  const BAND = 5.5;
  for (let i = 0, z = GOAL_Z; z < 58; i++, z += BAND) band(-TOUCH_X, TOUCH_X, z, Math.min(58, z + BAND), i % 2 ? 0xffffff : 0xd3e6cf);
  band(-46, 46, GOAL_Z - 9, GOAL_Z, 0xb9cdb6);
  band(-46, -TOUCH_X, GOAL_Z, 58, 0xb9cdb6); band(TOUCH_X, 46, GOAL_Z, 58, 0xb9cdb6);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: 0x1a2129, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.05, 0); scene.add(ground);

  // markings as their own geometry so they stay sharp at any distance
  const chalk = new THREE.MeshStandardMaterial({ color: 0xf4f7f2, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const T = 0.14;
  const flat = (geo, x, z) => { const m = new THREE.Mesh(geo, chalk); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.006, z); m.receiveShadow = true; scene.add(m); return m; };
  const hline = (x0, x1, z) => flat(new THREE.PlaneGeometry(x1 - x0 + T, T), (x0 + x1) / 2, z);
  const vline = (x, z0, z1) => flat(new THREE.PlaneGeometry(T, z1 - z0 + T), x, (z0 + z1) / 2);
  const box = (hw, depth) => { vline(-hw, GOAL_Z, GOAL_Z + depth); vline(hw, GOAL_Z, GOAL_Z + depth); hline(-hw, hw, GOAL_Z + depth); };
  const arc = (x, z, r, start, len) => flat(new THREE.RingGeometry(r - T / 2, r + T / 2, 72, 1, start, len), x, z);
  hline(-TOUCH_X, TOUCH_X, GOAL_Z); vline(-TOUCH_X, GOAL_Z, 58); vline(TOUCH_X, GOAL_Z, 58);
  hline(-TOUCH_X, TOUCH_X, HALF_Z);
  arc(0, HALF_Z, 9.15, 0, Math.PI * 2); flat(new THREE.CircleGeometry(0.22, 20), 0, HALF_Z);
  box(20.16, 16.5); box(9.16, 5.5);
  flat(new THREE.CircleGeometry(0.2, 20), 0, GOAL_Z + 11);
  arc(0, GOAL_Z + 11, 9.15, Math.PI + 0.645, Math.PI - 1.29); // the "D" outside the box
  arc(-TOUCH_X, GOAL_Z, 1, Math.PI * 1.5, Math.PI / 2); arc(TOUCH_X, GOAL_Z, 1, Math.PI, Math.PI / 2);
}

/* ---------------- Stadium ---------------- */
export function buildStadium(scene) {
  // crowd: rows of seated supporters, mostly in home colours, lit by the floodlights
  const crowd = canvasTex(1024, 512, (g, w, h) => {
    const shirts = ['#38bdf8', '#38bdf8', '#7dd3fc', '#0b2a52', '#1d4ed8', '#ffffff', '#e5e7eb', '#f59e0b', '#ef4444', '#94a3b8', '#0f172a', '#334155'];
    const skins = ['#f0c8a0', '#d9a577', '#a9714b', '#7a4b2e'];
    const rows = 16, rh = h / rows, cols = 64, cw = w / cols;
    for (let r = 0; r < rows; r++) {
      g.fillStyle = r % 2 ? '#141c28' : '#182233'; g.fillRect(0, r * rh, w, rh);
      for (let c = 0; c < cols; c++) {
        if (c % 16 === 15) { g.fillStyle = '#3a4658'; g.fillRect(c * cw + 3, r * rh, cw - 6, rh); continue; } // stairs
        if (Math.random() < 0.07) { g.fillStyle = '#24405f'; g.fillRect(c * cw + 2, r * rh + rh * 0.45, cw - 4, rh * 0.5); continue; } // empty seat
        const x = c * cw + cw / 2 + (Math.random() - 0.5) * 2, y = r * rh + rh * 0.6, up = Math.random() < 0.12 ? 5 : 0;
        g.fillStyle = shirts[(Math.random() * shirts.length) | 0]; g.beginPath(); g.ellipse(x, y + 5 - up, 6.4, 8.5, 0, 0, 7); g.fill();
        g.fillStyle = skins[(Math.random() * skins.length) | 0]; g.beginPath(); g.arc(x, y - 7 - up, 4.3, 0, 7); g.fill();
        g.fillStyle = Math.random() < 0.6 ? '#20140c' : '#6b4a2a'; g.beginPath(); g.arc(x, y - 8.6 - up, 4.2, Math.PI, 0); g.fill();
      }
    }
  });
  crowd.wrapS = THREE.RepeatWrapping;
  const dark = new THREE.MeshStandardMaterial({ color: 0x0e1622, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x1b2738, roughness: 0.7 });
  // a stand: front wall, two raked tiers of seats with a balcony between them, and a roof
  const stand = (len) => {
    const grp = new THREE.Group();
    const tier = (y0, z0, depth, rise, rep) => {
      const t = crowd.clone(); t.needsUpdate = true; t.repeat.set(len / 26, rep);
      const slope = Math.hypot(depth, rise);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, slope), new THREE.MeshBasicMaterial({ map: t, color: 0xb9c4d6 }));
      m.rotation.x = -Math.atan2(depth, rise); m.position.set(0, y0 + rise / 2, z0 - depth / 2);
      grp.add(m);
    };
    tier(1.6, 0, 13, 8, 1);
    tier(12.2, -13.5, 13, 10, 1);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 1.6, 0.5), dark); wall.position.set(0, 0.8, 0.25);
    const balcony = new THREE.Mesh(new THREE.BoxGeometry(len, 2.6, 0.6), steel); balcony.position.set(0, 10.9, -13.2);
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, 30, 1), dark); back.position.set(0, 15, -27.2);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.8, 22), steel); roof.position.set(0, 28.5, -17); roof.rotation.x = 0.07;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.35, 0.3), new THREE.MeshBasicMaterial({ color: 0xdfeaff })); strip.position.set(0, 28.9, -6.1);
    grp.add(wall, balcony, back, roof, strip);
    return grp;
  };
  const far = stand(150); far.position.set(0, 0, GOAL_Z - 13); scene.add(far);
  const left = stand(170); left.rotation.y = Math.PI / 2; left.position.set(-50, 0, 0); scene.add(left);
  const right = stand(170); right.rotation.y = -Math.PI / 2; right.position.set(50, 0, 0); scene.add(right);

  // LED boards around the pitch (the text scrolls)
  const led = canvasTex(1024, 64, (g, w, h) => {
    g.fillStyle = '#06101f'; g.fillRect(0, 0, w, h);
    g.font = '900 40px system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
    const words = [['TIKI TAKA', '#4fd1ff'], ['PASS', '#ffffff'], ['SHOOT', '#ff5d73'], ['WIN', '#ffb347']];
    words.forEach(([text, c], i) => { g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 12; g.fillText(text, (i + 0.5) * (w / 4), h / 2 + 2); });
  });
  led.wrapS = THREE.RepeatWrapping;
  const boards = [];
  const board = (len, x, z, ry) => {
    const t = led.clone(); t.needsUpdate = true; t.repeat.set(len / 30, 1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 1, 0.3), new THREE.MeshBasicMaterial({ map: t, fog: false }));
    m.position.set(x, 0.5, z); m.rotation.y = ry; scene.add(m); boards.push(t);
  };
  board(88, 0, GOAL_Z - 6, 0); board(104, -42, 0, Math.PI / 2); board(104, 42, 0, -Math.PI / 2);

  // floodlight towers in the far corners
  const glow = canvasTex(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(225,238,255,.75)'); gr.addColorStop(0.5, 'rgba(160,200,255,.16)'); gr.addColorStop(1, 'rgba(160,200,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
  for (const [x, z] of [[-60, GOAL_Z - 24], [60, GOAL_Z - 24], [-66, 34], [66, 34]]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 44, 8), steel); mast.position.set(x, 22, z); scene.add(mast);
    const head = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 0.8), steel); head.position.set(x, 45, z); head.lookAt(0, 0, -20); scene.add(head);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      s.scale.setScalar(7.5); s.position.set(x + (c - 1.5) * 2.1 * (z < 0 ? 1 : 0.6), 44 + r * 2.2, z + (x < 0 ? 1 : -1) * (c - 1.5) * 0.9); scene.add(s);
    }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.5 }));
    halo.scale.setScalar(46); halo.position.set(x, 45, z); scene.add(halo);
  }
  return { tick(dt) { for (const t of boards) t.offset.x += dt * 0.02; } };
}

/* ---------------- Goal ---------------- */
export function buildGoal(scene) {
  const grp = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const post = (h, r = 0.075) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), white);
  const l = post(2.44); l.position.set(-3.66, 1.22, 0);
  const r = post(2.44); r.position.set(3.66, 1.22, 0);
  const bar = post(7.47); bar.rotation.z = Math.PI / 2; bar.position.set(0, 2.44, 0);
  [l, r, bar].forEach((m) => { m.castShadow = true; grp.add(m); });
  for (const x of [-3.66, 3.66]) { // back stanchions holding the net
    const s = post(1.9, 0.035); s.position.set(x, 0.95, -2.1); grp.add(s);
    const t = post(2.17, 0.035); t.rotation.x = Math.PI / 2 - 0.25; t.position.set(x, 2.17, -1.05); grp.add(t);
  }
  const netTex = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2.5;
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16, h); g.moveTo(0, i * 16); g.lineTo(w, i * 16); g.stroke(); }
  });
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
  const netMat = (rx, ry) => { const t = netTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.85 }); };
  const backNet = new THREE.Mesh(new THREE.PlaneGeometry(7.32, 1.9), netMat(6, 1.6)); backNet.position.set(0, 0.95, -2.1);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(7.32, 2.17), netMat(6, 1.8)); top.rotation.x = Math.PI / 2 - 0.25; top.position.set(0, 2.17, -1.05);
  const side = (x) => {
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(2.1, 0), new THREE.Vector2(2.1, 1.9), new THREE.Vector2(0, 2.44)]);
    const geo = new THREE.ShapeGeometry(shape);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.82, uv.getY(i) * 0.82);
    const m = new THREE.Mesh(geo, netMat(1, 1)); m.rotation.y = Math.PI / 2; m.position.set(x, 0, 0); return m;
  };
  grp.add(backNet, top, side(-3.66), side(3.66));
  grp.position.z = GOAL_Z;
  scene.add(grp);
  return { grp, backNet, restZ: -2.1 };
}

/* ---------------- Ball ---------------- */
// Classic panel ball: black pentagons at the twelve corners of an icosahedron, white hexagons
// between them and dark seams where panels meet.
export function buildBall(radius) {
  const P = (1 + Math.sqrt(5)) / 2, pent = [], hexa = [];
  for (const a of [-1, 1]) for (const b of [-P, P]) pent.push([0, a, b], [a, b, 0], [b, 0, a]);
  const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
  const pv = pent.map(norm);
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) {
    const d = (a, b) => pv[a][0] * pv[b][0] + pv[a][1] * pv[b][1] + pv[a][2] * pv[b][2];
    if (d(i, j) > 0.4 && d(j, k) > 0.4 && d(i, k) > 0.4) hexa.push(norm([0, 1, 2].map((c) => pv[i][c] + pv[j][c] + pv[k][c])));
  }
  const centres = [...pv.map((v) => ({ v, black: true })), ...hexa.map((v) => ({ v, black: false }))];
  const tex = canvasTex(512, 256, (g, w, h) => {
    const img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) {
      const th = ((y + 0.5) / h) * Math.PI, sy = Math.cos(th), sr = Math.sin(th);
      for (let x = 0; x < w; x++) {
        const ph = ((x + 0.5) / w) * Math.PI * 2, vx = -sr * Math.cos(ph), vz = sr * Math.sin(ph);
        let best = -2, second = -2, black = false;
        for (const c of centres) {
          const dot = (vx * c.v[0] + sy * c.v[1] + vz * c.v[2]) * (c.black ? 1.035 : 1); // pentagons are the smaller panels
          if (dot > best) { second = best; best = dot; black = c.black; } else if (dot > second) second = dot;
        }
        const seam = best - second < 0.012, i = (y * w + x) * 4;
        const v = seam ? 40 : black ? 22 : 246;
        d[i] = v; d[i + 1] = v + (black || seam ? 2 : 1); d[i + 2] = v + (black || seam ? 8 : 4); d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 }));
  ball.castShadow = true;
  return ball;
}
