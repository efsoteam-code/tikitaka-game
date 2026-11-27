// Tiki Taka — players: one rigged, skinned character model (Quaternius, CC0) dressed in
// team kits by a shader, driven by motion clips plus a few football moves (kick, first
// touch, calling for the ball, keeper dive) layered on top of the clips.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export const SCALE = 1.3; // drawn a little larger than life so players read well on phones

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/* ---------------- Kit shader ---------------- */
// The model is a bare athletic body. The kit is painted per pixel from the rest pose
// (a T-pose, metres): shirt, shorts, socks, boots, gloves, with trim, stripes and a number.
const KIT_COMMON = /* glsl */ `
uniform vec2 uSleeve;   // x: where the sleeve ends along the arm, y: where gloves start
float kitPart(vec3 p) { // 0 skin, 1 shirt, 2 shorts, 3 socks, 4 boots, 5 gloves
  float ax = abs(p.x);
  if (p.y > 1.25) {
    if (ax > uSleeve.y) return 5.0;
    if (ax > 0.185) return ax < uSleeve.x ? 1.0 : 0.0;
    float collar = 1.5 - (p.z > 0.0 ? 0.045 * (1.0 - smoothstep(0.0, 0.075, ax)) : 0.0);
    if (p.y > 1.565 || (p.y > collar && ax < 0.082)) return 0.0;
    return 1.0;
  }
  if (p.y > 0.93) return 1.0;
  if (p.y > 0.6) return 2.0;
  if (p.y > 0.47) return 0.0;
  if (p.y > 0.105) return 3.0;
  return 4.0;
}`;
const KIT_VERTEX = /* glsl */ `
vRest = position; vRestN = normal;
{
  float part = kitPart(position), puff = 0.0;
  if (part == 1.0) puff = abs(position.x) > 0.185 ? 0.012 : 0.009;
  else if (part == 2.0) puff = 0.02 + 0.022 * smoothstep(0.82, 0.6, position.y);
  else if (part == 3.0) puff = 0.004;
  else if (part == 4.0) puff = 0.008;
  else if (part == 5.0) puff = 0.01;
  transformed += normal * puff;
}`;
const KIT_FRAGMENT = /* glsl */ `
{
  vec3 p = vRest; float ax = abs(p.x), part = kitPart(p);
  vec3 col = diffuseColor.rgb * uSkin;
  if (part == 1.0) {
    col = uShirt;
    if (uPattern == 1) col = mix(uShirt, uShirt2, step(0.5, fract(p.x / 0.1 + 0.25)));
    else if (uPattern == 2) col = mix(uShirt, uShirt2, step(0.5, fract(p.y / 0.12)));
    else if (uPattern == 3 && ax < 0.185) col = mix(uShirt, uShirt2, step(ax, 0.055));
    if (ax > 0.185) { if (ax > uSleeve.x - 0.022) col = uTrim; }                   // cuff
    else {
      float collar = 1.5 - (p.z > 0.0 ? 0.045 * (1.0 - smoothstep(0.0, 0.075, ax)) : 0.0);
      if (p.y > collar - 0.02 && ax < 0.105) col = uTrim;                           // collar
      vec2 uv = vRestN.z < 0.0 ? vec2(0.5 - p.x / 0.3, (p.y - 1.1) / 0.3) : vec2(0.5 + p.x / 0.13, (p.y - 1.25) / 0.13);
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 && abs(vRestN.z) > 0.15) col = mix(col, uInk, texture2D(uNumber, uv).a);
    }
  } else if (part == 2.0) {
    col = uShorts;
    if (ax > 0.15 && abs(p.z + 0.03) < 0.03) col = uTrim;                           // side stripe
  } else if (part == 3.0) {
    col = p.y > 0.415 ? uTrim : uSocks;
  } else if (part == 4.0) {
    col = p.y < 0.022 ? vec3(0.9) : uBoots;                                         // pale sole
  } else if (part == 5.0) col = uGloves;
  diffuseColor.rgb = col;
  kitCloth = part > 0.5 ? 1.0 : 0.0;
}`;

function kitMaterial(base, kit, skinTone, numberTex) {
  const m = base.clone();
  const C = (h) => new THREE.Color(h);
  const u = {
    uSleeve: { value: new THREE.Vector2(kit.longSleeves ? 0.67 : 0.4, kit.gloves !== undefined ? 0.68 : 9) },
    uSkin: { value: C(skinTone) }, uShirt: { value: C(kit.shirt) }, uShirt2: { value: C(kit.shirt2 ?? kit.shirt) },
    uShorts: { value: C(kit.shorts) }, uSocks: { value: C(kit.socks) }, uBoots: { value: C(kit.boots ?? 0x16181d) },
    uGloves: { value: C(kit.gloves ?? 0xffffff) }, uTrim: { value: C(kit.trim ?? kit.shorts) }, uInk: { value: C(kit.ink ?? 0xffffff) },
    uPattern: { value: kit.pattern ?? 0 }, uNumber: { value: numberTex },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRest; varying vec3 vRestN;\n${KIT_COMMON}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${KIT_VERTEX}`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRest; varying vec3 vRestN;\nuniform vec3 uSkin, uShirt, uShirt2, uShorts, uSocks, uBoots, uGloves, uTrim, uInk; uniform int uPattern; uniform sampler2D uNumber; float kitCloth = 0.0;\n${KIT_COMMON}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${KIT_FRAGMENT}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.62, 0.88, kitCloth);');
  };
  m.customProgramCacheKey = () => 'tikitaka-kit';
  return m;
}

function numberTexture(number) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${number > 9 ? 84 : 100}px "Arial Narrow", Arial, sans-serif`;
  g.fillText(String(number), 64, 70);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
  return t;
}

/* ---------------- Loading ---------------- */
const CLIPS = { idle: 'Idle_Loop', jog: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop', crouch: 'Crouch_Idle_Loop', dance: 'Dance_Loop', slide: 'Slide_Loop', no: 'Idle_No_Loop', slump: 'Zombie_Idle_Loop' };
const BONES = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r', 'thigh_l', 'calf_l', 'thigh_r', 'calf_r', 'foot_r'];
const SKINS = [0xffffff, 0xf2dccb, 0xd9a988, 0xb07c5c, 0x8a5a40, 0x6b4330];
const HAIRS = [0x1c1612, 0x2e2119, 0x4a3220, 0x7a5a34, 0xc9a45a, 0x9a4a22];

export async function loadPlayers(base = './assets/') {
  const loader = new GLTFLoader();
  const [body, a1, a2, buzz, parted] = await Promise.all(['player', 'anims1', 'anims2', 'hair_buzzed', 'hair_simpleparted'].map((n) => loader.loadAsync(`${base}${n}.glb`)));
  const all = [...a1.animations, ...a2.animations];
  const clips = {};
  for (const [key, name] of Object.entries(CLIPS)) {
    const clip = all.find((c) => c.name === name);
    if (!clip) throw new Error(`Missing animation ${name}`);
    clip.tracks = clip.tracks.filter((t) => !/^root\./.test(t.name)); // keep every clip in place
    clips[key] = clip;
  }
  const hairGeos = [buzz, parted].map((g) => { let geo = null; g.scene.traverse((o) => { if (o.isMesh) geo = o.geometry; }); return geo; });
  let count = 0;

  function make(kit, number) {
    const n = count++;
    const model = cloneSkinned(body.scene);
    const skinTone = SKINS[(n * 5 + 1) % SKINS.length], hairCol = HAIRS[(n * 3 + (kit.gloves !== undefined ? 2 : 0)) % HAIRS.length];
    const bones = {};
    model.traverse((o) => {
      if (o.isBone && BONES.includes(o.name)) bones[o.name] = o;
      if (!o.isMesh) return;
      o.castShadow = true; o.frustumCulled = false;
      if (/Eyebrow/i.test(o.name)) o.material = new THREE.MeshStandardMaterial({ color: hairCol, roughness: 0.9 });
      else if (!/Eye/i.test(o.name)) o.material = kitMaterial(o.material, kit, skinTone, numberTexture(number));
    });
    model.updateMatrixWorld(true);
    const style = n % 5 === 3 ? -1 : n % 2; // a few shaved heads
    if (style >= 0) {
      const hair = new THREE.Mesh(hairGeos[style], new THREE.MeshStandardMaterial({ color: hairCol, roughness: 0.92, side: THREE.DoubleSide }));
      hair.castShadow = true;
      model.add(hair); bones.Head.attach(hair);
    }
    const root = new THREE.Group(), rig = new THREE.Group();
    rig.scale.setScalar(SCALE); rig.add(model); root.add(rig);

    const mixer = new THREE.AnimationMixer(model);
    const actions = {}, weights = {};
    for (const key in clips) { const a = mixer.clipAction(clips[key]); a.play(); a.setEffectiveWeight(key === 'idle' ? 1 : 0); a.time = Math.random() * clips[key].duration; actions[key] = a; weights[key] = key === 'idle' ? 1 : 0; }

    return {
      root, rig, model, bones, mixer, actions, weights, pos: root.position,
      anim: 'idle', rest: 'idle', t: 0, seed: Math.random() * 10, variant: n % 2,
      target: null, speed: 8, face: null, heading: 0, onArrive: null, slideWithin: 0,
      dive: 0, diveSide: 1, diveReach: 2.4, hop: 0,
      o: { thighR: 0, calfR: 0, thighL: 0, armL: 0, armR: 0, foreR: 0, lean: 0, twist: 0, head: 0, hop: 0 },
    };
  }
  return { make };
}

/* ---------------- Animation ---------------- */
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
// rotation of a bone's parent relative to the model
function parentQ(bone, model, out) {
  out.identity();
  for (let o = bone.parent; o && o !== model; o = o.parent) out.premultiply(o.quaternion);
  return out;
}
// turn a bone about an axis given in model space (x: the player's left, y: up, z: forward)
function turn(p, name, axis, angle) {
  if (Math.abs(angle) < 1e-3) return;
  const bone = p.bones[name];
  parentQ(bone, p.model, qa);
  qb.setFromAxisAngle(axis, angle);
  qc.copy(qa).invert().multiply(qb).multiply(qa);
  bone.quaternion.premultiply(qc);
}

function animate(p, dt) {
  p.t += dt;
  const t = p.t, s0 = p.seed;
  const W = { idle: 0, jog: 0, sprint: 0, crouch: 0, dance: 0, slide: 0, no: 0, slump: 0 };
  const O = { thighR: 0, calfR: 0, thighL: 0, armL: 0, armR: 0, foreR: 0, lean: 0, twist: 0, head: 0, hop: 0 };
  let k = 12, blend = 9;
  switch (p.anim) {
    case 'run': {
      const f = clamp((p.speed - 5.5) / 3, 0, 1);
      W.jog = 1 - f; W.sprint = f;
      p.actions.jog.timeScale = clamp(p.speed / (3.4 * SCALE), 0.8, 1.7);
      p.actions.sprint.timeScale = clamp(p.speed / (6.6 * SCALE), 0.8, 1.5);
      blend = 14;
      break;
    }
    case 'slide': W.slide = 1; blend = 16; break;
    case 'call': // asking for the ball: arm up, a small wave
      W.idle = 1; O.armR = 2.5 + Math.sin(t * 8 + s0) * 0.1; O.foreR = Math.sin(t * 8 + s0) * 0.25; O.hop = Math.abs(Math.sin(t * 3.5 + s0)) * 0.04;
      break;
    case 'guard': W.idle = 0.55; W.crouch = 0.45; O.armL = O.armR = 0.25; break; // defender jockeying
    case 'keeper': W.idle = 0.4; W.crouch = 0.6; O.armL = O.armR = 0.75 + Math.sin(t * 2.6) * 0.06; break;
    case 'dive': W.idle = 1; O.armL = O.armR = 2.7; O.thighR = 0.3; k = 26; break;
    case 'kick': {
      W.idle = 1;
      const u = clamp(t / 0.52, 0, 1);
      if (u < 0.4) { const a = easeInOut(u / 0.4); O.thighR = 0.75 * a; O.calfR = 1.35 * a; O.twist = 0.35 * a; O.lean = 0.12 * a; }
      else if (u < 0.6) { const a = (u - 0.4) / 0.2; O.thighR = lerp(0.75, -1.25, a); O.calfR = lerp(1.35, 0.05, a); O.twist = lerp(0.35, -0.4, a); O.lean = lerp(0.12, -0.1, a); }
      else { const a = easeOut((u - 0.6) / 0.4); O.thighR = -1.25 * (1 - a); O.calfR = 0.3 * (1 - a); O.twist = -0.4 * (1 - a); O.lean = -0.1 * (1 - a); O.hop = 0.05 * Math.sin(a * Math.PI); }
      O.armL = 0.9; O.armR = 0.45; O.thighL = 0.12; k = 40;
      if (u >= 1) p.anim = p.rest;
      break;
    }
    case 'trap': { // first touch: cushion the ball
      W.idle = 1;
      const u = clamp(t / 0.42, 0, 1), a = Math.sin(u * Math.PI);
      O.thighR = -0.55 * a; O.calfR = 0.8 * a; O.lean = 0.08 * a; O.armL = O.armR = 0.45 * a; k = 28;
      if (u >= 1) p.anim = p.rest;
      break;
    }
    case 'celebrate':
      if (p.variant) { W.dance = 1; O.armR = 1.6 + Math.sin(t * 7 + s0) * 0.5; O.hop = Math.abs(Math.sin(t * 5 + s0)) * 0.1; } // fist pump
      else { W.idle = 1; O.armL = O.armR = 2.45 + Math.sin(t * 6.5 + s0) * 0.15; O.hop = Math.abs(Math.sin(t * 6.5 + s0)) * 0.34; O.head = -0.25; } // jumping, both arms up
      break;
    case 'sad': W.slump = 0.6; W.no = 0.4; O.head = 0.2; blend = 5; break;
    default: W.idle = 1;
  }
  // blend the clips (weights always add up to 1 so the pose never drifts to the T-pose)
  const a = 1 - Math.exp(-dt * blend);
  let sum = 0;
  for (const key in W) { p.weights[key] += (W[key] - p.weights[key]) * a; sum += p.weights[key]; }
  for (const key in W) p.actions[key].setEffectiveWeight(p.weights[key] / (sum || 1));
  p.mixer.update(dt);
  // football moves on top
  const b = 1 - Math.exp(-dt * k), o = p.o;
  for (const key in O) o[key] += (O[key] - o[key]) * b;
  turn(p, 'spine_01', X, o.lean); turn(p, 'spine_02', Y, o.twist); turn(p, 'Head', X, o.head);
  turn(p, 'upperarm_l', Z, o.armL); turn(p, 'upperarm_r', Z, -o.armR); turn(p, 'lowerarm_r', Z, -o.foreR);
  turn(p, 'thigh_l', X, o.thighL); turn(p, 'thigh_r', X, o.thighR); turn(p, 'calf_r', X, o.calfR);
  // keeper dive: lean over and fly sideways
  const d = p.dive;
  p.rig.rotation.z = -p.diveSide * 1.3 * easeOut(d);
  p.rig.position.x = p.diveSide * p.diveReach * easeOut(d);
  p.rig.position.y = o.hop * SCALE + (d > 0 ? Math.sin(Math.PI * Math.min(1, d * 1.15)) * 0.75 + d * 0.18 : 0);
}

function stepMove(p, dt) {
  if (p.target) {
    const dx = p.target.x - p.pos.x, dz = p.target.z - p.pos.z, dist = Math.hypot(dx, dz);
    if (dist < 0.12) {
      p.target = null; p.slideWithin = 0; p.anim = p.rest; p.t = 0;
      if (p.onArrive) { const f = p.onArrive; p.onArrive = null; f(); }
    } else {
      const v = Math.min(dist, p.speed * dt);
      p.pos.x += (dx / dist) * v; p.pos.z += (dz / dist) * v;
      p.anim = dist < p.slideWithin ? 'slide' : 'run';
      p.heading = Math.atan2(dx, dz);
    }
  } else if (p.face) {
    p.heading = Math.atan2(p.face.x - p.pos.x, p.face.z - p.pos.z);
  }
  p.root.rotation.y += wrapAngle(p.heading - p.root.rotation.y) * (1 - Math.exp(-dt * 10));
}

export function updatePlayer(p, dt) { stepMove(p, dt); animate(p, dt); }
