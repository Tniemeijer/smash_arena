// ==================== THE SCORE ====================
// An arcade counter bolted onto a roguelike, and the two want different things: the dungeon
// rewards patience, a score rewards nerve. That tension is deliberate and the multiplier is where
// it lives -- points come from killing quickly and in a row, so the safe way through a floor is
// never the high-scoring way through it.
//
// Nothing else in the game reads the score. It cannot buy anything and it does not make you
// stronger; it exists so that a dead character is still a claim somebody can beat.

import { G } from '../core.js';
import { SCORE, HIGH_SCORES, CLASSES, ELITE } from '../data.js';

// ---------- during a run ----------
export function addScore(amount, kind = '') {
    const s = G.state;
    if (!s || !amount) return 0;
    const gained = Math.round(amount * multiplier(s));
    s.score += gained;
    if (kind) G.onScore?.(gained, kind);
    return gained;
}

export const multiplier = (s) => 1 + Math.min(SCORE.comboMax - 1, Math.floor(s.chain / SCORE.comboStep));

// A kill is worth what the thing was worth to fight, times how deep it was, times the chain. The
// chain is extended BEFORE the points are counted, so the kill that earns you a multiplier is
// itself paid at the new rate -- the opposite feels like being cheated out of the one that
// mattered.
export function scoreKill(e, floor) {
    const s = G.state;
    s.chain++;
    s.chainT = SCORE.comboTime;
    s.stats.best = Math.max(s.stats.best || 0, s.chain);
    return addScore((e.xp || 1) * SCORE.perXp * (1 + SCORE.depth * (floor - 1)) *
                    (e.elite ? ELITE.score : 1), 'kill');
}

// The chain is the only thing here with a clock. Everything else is paid once and forgotten.
export function tickScore(dt) {
    const s = G.state;
    if (!s || s.over) return;
    if (s.chainT > 0) {
        s.chainT -= dt;
        if (s.chainT <= 0) s.chain = 0;
    }
}

// ---------- between runs ----------
// A local table, which is all "between players" means on one machine: whoever sat down last has
// to get past whoever sat down before them.
const KEY = 'deepdelve.scores';

export function highScores() {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
        if (!Array.isArray(raw)) return [];
        return raw.filter(r => r && typeof r.score === 'number')
                  .sort((a, b) => b.score - a.score)
                  .slice(0, HIGH_SCORES);
    } catch { return []; }
}

// Returns which place the run took, or 0 if it did not make the table -- the death screen needs
// to know whether to make a fuss.
export function recordScore(over) {
    const row = {
        name: over.name, cls: over.cls, score: over.score || 0, floor: over.floor,
        level: over.level, kills: over.stats.kills, chain: over.stats.best || 0, at: Date.now()
    };
    const table = [...highScores(), row].sort((a, b) => b.score - a.score).slice(0, HIGH_SCORES);
    try { localStorage.setItem(KEY, JSON.stringify(table)); } catch { /* not worth a crash */ }
    const place = table.indexOf(row);
    return place === -1 ? 0 : place + 1;
}

export const scoreLine = (r) =>
    `${r.name} the ${(CLASSES[r.cls] || { name: '?' }).name.toLowerCase()}`;
