// Tiki Taka — game settings. Shared by the server and the browser.
// Change numbers here; the engine and UI read everything from this file.
export const CONFIG = {
  rtp: 0.97,            // return to player. House edge (3%) is applied once per round.
  maxMultiplier: 5000,  // win cap. A round that reaches it is paid out automatically.
  maxPasses: 12,        // after this many completed passes only Shoot / Cash out remain.
  minStake: 0.1,
  maxStake: 1000,
  defaultStake: 1,
  startBalance: 1000,   // demo wallet only — the real wallet comes from the platform.

  // Chance range of each pass type per difficulty. The exact chance of every
  // option is drawn from the provably fair stream, inside these ranges.
  difficulties: {
    easy:   { safe: [0.88, 0.94], standard: [0.78, 0.86], risky: [0.55, 0.70] },
    medium: { safe: [0.80, 0.88], standard: [0.66, 0.78], risky: [0.35, 0.55] },
    hard:   { safe: [0.68, 0.78], standard: [0.50, 0.64], risky: [0.20, 0.38] },
  },

  // Shot at goal: chance grows with every completed pass (closer to goal).
  shot: { base: 0.05, perPass: 0.045, max: 0.5 },
};

export const PASS_TYPES = ['safe', 'standard', 'risky'];
