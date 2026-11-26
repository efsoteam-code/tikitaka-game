// Small synthesized sound set (no audio files): kick, whistle, crowd, win, lose.
let ctx = null;
let muted = false;
let crowdGain = null;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noise(seconds) {
  const c = ac();
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

function tone(freq, dur, type = 'sine', vol = 0.15, slideTo) {
  const c = ac(); if (!c || muted) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start(); o.stop(c.currentTime + dur);
}

function burst(dur, freq, q, vol) {
  const c = ac(); if (!c || muted) return;
  const n = noise(dur), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(0.001, c.currentTime);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + dur * 0.15);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  n.connect(f).connect(g).connect(c.destination);
  n.start();
}

export const sfx = {
  kick() { tone(150, 0.12, 'sine', 0.35, 50); burst(0.06, 1800, 0.8, 0.12); },
  receive() { tone(110, 0.07, 'sine', 0.18, 70); },
  whistle() { tone(2300, 0.28, 'square', 0.05); setTimeout(() => tone(2300, 0.4, 'square', 0.05), 60); },
  tick() { tone(660, 0.05, 'triangle', 0.08); },
  intercept() { tone(220, 0.35, 'sawtooth', 0.12, 80); burst(0.9, 500, 0.6, 0.1); },
  cheer() { burst(2.2, 1100, 0.5, 0.3); [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.12), i * 90)); },
  cash() { [784, 988, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.13), i * 70)); },
  crowd(on) {
    const c = ac(); if (!c) return;
    if (!crowdGain) {
      const n = noise(4), f = c.createBiquadFilter();
      n.loop = true; f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.4;
      crowdGain = c.createGain(); crowdGain.gain.value = 0;
      n.connect(f).connect(crowdGain).connect(c.destination); n.start();
    }
    crowdGain.gain.linearRampToValueAtTime(on && !muted ? 0.035 : 0, c.currentTime + 0.6);
  },
  setMuted(m) { muted = m; if (crowdGain && ctx) crowdGain.gain.value = m ? 0 : 0.035; },
  get muted() { return muted; },
};
