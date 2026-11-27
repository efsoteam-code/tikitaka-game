# Tiki Taka

Original 3D football passing game. Build a passing move, grow the multiplier with every completed pass, then cash out or shoot.

## How a round works

1. The player sets a bet and a difficulty (Easy / Medium / Hard) and presses **Bet**.
2. Three teammates are offered on every step: **Short pass**, **Through ball**, **Long ball**. Each shows its chance and the multiplier the player will have if it is completed. Chances change on every step (teammates are "open" or "marked").
3. A completed pass moves the ball up the pitch and grows the multiplier. An intercepted pass loses the bet.
4. After the first completed pass the player can **Cash out** at any time.
5. **Shoot** is always available. The chance starts at 5% and grows by 4.5% per completed pass (up to 50%). A goal pays the shot multiplier and ends the round; a miss loses the bet.
6. After 12 passes only Shoot and Cash out remain. The win is capped at 5000×.

Controls: click a teammate (or the goal) on the pitch, or use the cards. Keyboard: `1` `2` `3` pass, `S` shoot, `Space` bet / cash out.
Auto play: choose the pass type, cash out after N passes, number of bets, stop on profit / loss.

## Maths

`multiplier = RTP × 1 / (chance₁ × chance₂ × …)`, rounded down to 2 decimals.

The house edge (3%) is taken once per round, so the RTP is 97% whatever the player picks. All numbers live in [`shared/config.js`](shared/config.js): RTP, max win, max passes, bet limits, chance ranges per difficulty, shot odds.

## Provably fair

Every number comes from `HMAC-SHA256(serverSeed, "clientSeed:nonce:step:index")` (first 52 bits → float in [0,1)).

| index | used for |
|---|---|
| 0 | outcome of the step (success if `float < chance`) |
| 1–3 | chance of the three pass options (inside the difficulty range) |
| 4–6 | where teammates stand (visual only) |

The player sees the SHA-256 hash of the server seed before betting, can set the client seed, and the nonce grows by 1 per round. "Change seeds" reveals the old server seed; `replayRound()` in `shared/engine.js` rebuilds any past round from seeds + the player's actions.

## Run

```
npm start        # http://localhost:3000 (no dependencies to install)
npm test         # engine tests
```

Node 18+. Nothing is loaded from a CDN: the 3D engine (Three.js 0.160) is in `public/vendor/three` and the models are in `public/assets`.

If the page is opened without the server (static hosting), it runs in **DEMO** mode: the same engine runs in the browser with a play-money wallet.

## Structure

```
shared/config.js   game settings
shared/engine.js   all game logic + provably fair (used by server and browser)
server/index.js    demo server: static files + API, in-memory wallet
public/            the game: index.html, styles.css, js/main.js (UI), js/api.js, js/audio.js
public/js/scene.js    3D match view: camera, markers, how each pass / shot plays out
public/js/players.js  rigged player model, team kits (shader), animations
public/js/stadium.js  pitch, stands, floodlights, goal, ball
public/assets/     player model, hair and animation clips (CC0, see CREDITS.md)
public/vendor/     Three.js
tools/             build-assets.mjs — how the files in public/assets were made from the originals
tests/             engine tests (node --test)
```

## Match view

- **Players** are one rigged character model (Quaternius, CC0) with motion clips for standing, jogging, sprinting, crouching, sliding and celebrating. Kicks, first touches, calling for the ball and the keeper's dive are layered on top in `players.js`.
- **Kits** are painted by a shader, so a team is a few colours: change `HOME`, `AWAY` and `KEEP` at the top of `createScene` in `scene.js` (shirt, second colour, pattern `0` plain / `1` stripes / `2` hoops / `3` centre band, shorts, socks, trim, number colour).
- **Camera** looks down from high above (about 44°) toward the goal. It is framed from the kick-off spot to the goal, so the keeper and every pass option are always in view and it never zooms in during a move.

## Integration notes

- The server decides every outcome. The browser only sends `start`, `pass n`, `shoot`, `cashout`.
- API: `GET /api/session`, `POST /api/start {stake, difficulty}`, `POST /api/action {type, option}`, `POST /api/fair/rotate {clientSeed}`, `GET /api/leaderboard`. The session is the `x-session` header — replace it with the platform's auth.
- Replace the in-memory wallet in `shared/engine.js` (`startRound` debits, `playAction` credits) with the platform wallet, and persist sessions/rounds in a database.
