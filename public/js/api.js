// Talks to the game server. If no server answers (the page was opened as plain
// static files), it falls back to DEMO mode and runs the same engine in the browser.
import { createSession, sessionView, startRound, playAction, rotateSeed } from '../../shared/engine.js';

const randHex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

function sessionId() {
  let id = null;
  try { id = localStorage.getItem('tikitaka-session'); } catch { /* storage blocked */ }
  if (!id) {
    id = randHex().slice(0, 32);
    try { localStorage.setItem('tikitaka-session', id); } catch { /* storage blocked */ }
  }
  return id;
}

class ServerApi {
  constructor() { this.demo = false; this.id = sessionId(); }
  async call(path, body) {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-session': this.id },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  session() { return this.call('api/session'); }
  start(stake, difficulty) { return this.call('api/start', { stake, difficulty }); }
  action(type, option) { return this.call('api/action', { type, option }); }
  rotate(clientSeed) { return this.call('api/fair/rotate', { clientSeed }); }
  async leaderboard() { return (await this.call('api/leaderboard')).leaderboard; }
}

class LocalApi {
  constructor() { this.demo = true; this.s = createSession(randHex); }
  view(extra) { return { ...extra, state: sessionView(this.s) }; }
  async session() { return this.view(); }
  async start(stake, difficulty) { startRound(this.s, { stake, difficulty }); return this.view(); }
  async action(type, option) { const outcome = playAction(this.s, { type, option }); return this.view({ outcome }); }
  async rotate(clientSeed) { rotateSeed(this.s, randHex, clientSeed); return this.view(); }
  async leaderboard() {
    return this.s.bets.filter((b) => b.payout > 0).sort((a, b) => b.multiplier - a.multiplier).slice(0, 10)
      .map((b) => ({ player: this.s.name, multiplier: b.multiplier, payout: b.payout, stake: b.stake }));
  }
}

export async function createApi() {
  try {
    const api = new ServerApi();
    await api.session();
    return api;
  } catch {
    return new LocalApi();
  }
}
