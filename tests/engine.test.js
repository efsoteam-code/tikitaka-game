import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { CONFIG } from '../shared/config.js';
import { sha256Hex, hmacSha256Hex, fairFloat, createRound, optionsOf, shotOf, applyAction, multiplierOf, replayRound, createSession, startRound, playAction, rotateSeed, sessionView } from '../shared/engine.js';

let n = 0;
const rand = () => createHash('sha256').update('seed' + n++).digest('hex');

test('sha256 and hmac match Node crypto', () => {
  for (const s of ['', 'abc', 'x'.repeat(200), 'ტიკი-ტაკა ⚽']) {
    assert.equal(sha256Hex(s), createHash('sha256').update(s).digest('hex'));
    assert.equal(hmacSha256Hex('key' + s, s), createHmac('sha256', 'key' + s).update(s).digest('hex'));
  }
});

test('fair floats are deterministic and in [0,1)', () => {
  const a = fairFloat('s', 'c', 1, 0, 0);
  assert.equal(a, fairFloat('s', 'c', 1, 0, 0));
  assert.notEqual(a, fairFloat('s', 'c', 2, 0, 0));
  assert.ok(a >= 0 && a < 1);
});

test('options stay inside the configured ranges', () => {
  for (const difficulty of Object.keys(CONFIG.difficulties)) {
    for (let i = 0; i < 200; i++) {
      const r = createRound({ serverSeed: 'srv' + i, clientSeed: 'c', nonce: i, stake: 1, difficulty });
      const opts = optionsOf(r);
      assert.equal(opts.length, 3);
      opts.forEach((o) => {
        const [lo, hi] = CONFIG.difficulties[difficulty][o.type];
        assert.ok(o.chance >= lo - 1e-9 && o.chance <= hi + 1e-9);
      });
      assert.ok(opts[0].chance > opts[1].chance && opts[1].chance > opts[2].chance);
    }
  }
});

test('multiplier = rtp / product of chances; cash out needs one pass', () => {
  let i = 0, r;
  for (;;) { // find a seed where the first safe pass completes
    r = createRound({ serverSeed: 'm' + i++, clientSeed: 'c', nonce: 1, stake: 10, difficulty: 'easy' });
    assert.throws(() => applyAction(r, { type: 'cashout' }));
    const chance = optionsOf(r)[0].chance;
    if (applyAction(r, { type: 'pass', option: 0 }) === 'complete') {
      assert.equal(multiplierOf(r), Math.floor((CONFIG.rtp / chance) * 100 + 1e-9) / 100);
      break;
    }
    assert.equal(r.status, 'lost');
  }
  assert.equal(applyAction(r, { type: 'cashout' }), 'cashout');
  assert.equal(r.payout, Math.floor(10 * r.finalMultiplier * 100 + 1e-6) / 100);
  assert.throws(() => applyAction(r, { type: 'pass', option: 0 }));
});

test('shot chance grows with passes and is capped', () => {
  const r = createRound({ serverSeed: 's', clientSeed: 'c', nonce: 1, stake: 1, difficulty: 'medium' });
  assert.equal(shotOf(r).chance, CONFIG.shot.base);
  r.passes = 40;
  assert.equal(shotOf(r).chance, CONFIG.shot.max);
});

test('win is capped at maxMultiplier', () => {
  const r = createRound({ serverSeed: 's', clientSeed: 'c', nonce: 1, stake: 1, difficulty: 'hard' });
  r.passes = 5; r.prod = 1e6;
  assert.equal(multiplierOf(r), CONFIG.maxMultiplier);
  assert.ok(optionsOf(r).every((o) => o.multiplier === CONFIG.maxMultiplier));
});

test('replay reproduces a finished round', () => {
  const s = createSession(rand);
  startRound(s, { stake: 2, difficulty: 'medium' });
  while (s.round.status === 'active') playAction(s, s.round.passes >= 3 ? { type: 'cashout' } : { type: 'pass', option: 0 });
  const bet = s.bets[0];
  const re = replayRound({ serverSeed: s.serverSeed, clientSeed: s.clientSeed, nonce: bet.nonce, stake: bet.stake, difficulty: bet.difficulty, actions: bet.actions });
  assert.equal(re.result, bet.result);
  assert.equal(re.payout, bet.payout);
});

test('session wallet, validation and seed rotation', () => {
  const s = createSession(rand);
  assert.throws(() => startRound(s, { stake: 0, difficulty: 'easy' }));
  assert.throws(() => startRound(s, { stake: 1e9, difficulty: 'easy' }));
  assert.throws(() => startRound(s, { stake: 1, difficulty: 'nope' }));
  startRound(s, { stake: 5, difficulty: 'easy' });
  assert.equal(s.balance, CONFIG.startBalance - 5);
  assert.throws(() => startRound(s, { stake: 5, difficulty: 'easy' }));
  assert.throws(() => rotateSeed(s, rand));
  const hash = sessionView(s).serverSeedHash, seed = s.serverSeed;
  assert.equal(sessionView(s).serverSeed, undefined); // never leaked while in use
  while (s.round.status === 'active') playAction(s, { type: 'shoot' });
  rotateSeed(s, rand, 'my-seed');
  assert.equal(s.previous.serverSeed, seed);
  assert.equal(sha256Hex(s.previous.serverSeed), hash);
  assert.equal(s.clientSeed, 'my-seed');
  assert.equal(s.nonce, 0);
});

test('every option is priced at the configured RTP (exact expectation)', () => {
  for (const difficulty of Object.keys(CONFIG.difficulties)) {
    for (let i = 0; i < 300; i++) {
      const r = createRound({ serverSeed: 'ev' + i, clientSeed: 'c', nonce: i, stake: 1, difficulty });
      r.passes = i % 6; r.prod = 1 + (i % 7) * 0.8;
      const fair = CONFIG.rtp * r.prod;
      for (const o of [...optionsOf(r), shotOf(r)]) {
        const ev = o.chance * o.multiplier; // expected multiplier of taking this option
        assert.ok(ev <= fair + 1e-9, 'never pays above RTP');
        assert.ok(ev >= fair - 0.01, 'only rounding below RTP');
      }
    }
  }
});

test('simulated RTP is close to the configured value', () => {
  let paid = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const r = createRound({ serverSeed: 'rtp', clientSeed: 'sim', nonce: i, stake: 1, difficulty: 'easy' });
    while (r.status === 'active') applyAction(r, r.passes >= 3 ? { type: 'cashout' } : { type: 'pass', option: 0 });
    paid += r.payout;
  }
  assert.ok(Math.abs(paid / N - CONFIG.rtp) < 0.04, `RTP ${(paid / N).toFixed(4)}`);
});
