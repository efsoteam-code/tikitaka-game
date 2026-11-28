// Tiki Taka — demo server. No dependencies: `node server/index.js`
// Serves the game and runs every round on the server (the browser never decides an outcome).
// The in-memory wallet is for demo only: replace it with the platform wallet when integrating.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, sessionView, startRound, playAction, rotateSeed } from '../shared/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;
const rand = () => randomBytes(32).toString('hex');
const sessions = new Map();
const leaderboard = [];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };

function sessionOf(req) {
  const id = String(req.headers['x-session'] || '').slice(0, 64);
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) throw new Error('Missing session');
  if (!sessions.has(id)) sessions.set(id, createSession(rand));
  return sessions.get(id);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e4) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Bad JSON')); } });
  });
}

const send = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };

async function api(req, res, url) {
  try {
    if (url.pathname === '/api/leaderboard') return send(res, 200, { leaderboard });
    const s = sessionOf(req);
    if (url.pathname === '/api/session' && req.method === 'GET') return send(res, 200, { state: sessionView(s) });
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const body = await readJson(req);
    if (url.pathname === '/api/start') {
      startRound(s, { stake: body.stake, difficulty: String(body.difficulty) });
      return send(res, 200, { state: sessionView(s) });
    }
    if (url.pathname === '/api/action') {
      const outcome = playAction(s, { type: String(body.type), option: Number(body.option) });
      const r = s.round;
      if (r.status === 'won') {
        leaderboard.push({ player: s.name, multiplier: r.finalMultiplier, payout: r.payout, stake: r.stake });
        leaderboard.sort((a, b) => b.multiplier - a.multiplier);
        leaderboard.length = Math.min(leaderboard.length, 10);
      }
      return send(res, 200, { outcome, state: sessionView(s) });
    }
    if (url.pathname === '/api/fair/rotate') {
      rotateSeed(s, rand, body.clientSeed);
      return send(res, 200, { state: sessionView(s) });
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
}

async function serveStatic(res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const base = rel.startsWith('/shared/') ? ROOT : path.join(ROOT, 'public');
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  serveStatic(res, url);
}).listen(PORT, () => console.log(`Tiki Taka running on http://localhost:${PORT}`));
