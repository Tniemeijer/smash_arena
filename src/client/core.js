// ==================== SHARED RUNTIME ====================
// The G singleton and the handful of derived numbers everything reads. No game logic of its own,
// which is what keeps the simulation separable from the renderer -- and what would let a second
// prisoner be dropped in later without unpicking anything.

import { CLASSES, UPGRADES, UPGRADE_MAX, XP_BASE, XP_GROWTH, LEVEL_HP, LEVEL_DAMAGE } from './data.js';

export const G = {
    state: null,
    scene: null,
    dungeon: null,
    onToast: () => {},
    onDamage: () => {},      // floating combat numbers, wired by the HUD
    onScore: () => {},
    sfx: () => {}
};

let idc = 1;
export const nid = () => idc++;
export const resetIds = () => { idc = 1; };

// ---------- derived ----------
export function xpForLevel(level) {
    return Math.round(XP_BASE * Math.pow(XP_GROWTH, level - 1));
}

// ---------- everything that changes your numbers ----------
// Two sources now, and they are deliberately different in kind: what you bought, which is yours
// for the rest of the run, and what you are holding, which is yours for the next ten seconds.
// There is no third source any more -- no tree, no equipment -- so what a character can do is
// visible on one short screen instead of assembled from four.
//
// Multipliers start at 1 and stack; additive keys add. Keeping the fold in one place means a new
// upgrade or a new stone is a line in data.js plus, at most, one line wherever its key is read.
export function mods(p) {
    const m = { hp: 0, damage: 1, cooldown: 1, speed: 1, taken: 1, regen: 0,
                reach: 0, arc: 1, blast: 1, knock: 1, spread: 0 };
    if (!p) return m;

    // What the trader sold you. Each line can be bought UPGRADE_MAX times and simply stacks.
    for (const [key, n] of Object.entries(p.upgrades || {})) {
        const up = UPGRADES[key];
        if (!up || !n) continue;
        const rank = Math.min(n, UPGRADE_MAX);
        const e = up.effect;
        if (e.hp) m.hp += e.hp * rank;
        if (e.damage) m.damage *= Math.pow(1 + e.damage, rank);
        if (e.cooldown) m.cooldown *= Math.pow(1 + e.cooldown, rank);
        if (e.speed) m.speed *= Math.pow(1 + e.speed, rank);
        if (e.taken) m.taken *= Math.pow(1 + e.taken, rank);
    }

    // Then whatever you are holding, while it lasts. Buffs are last so they read as "on top of
    // everything you are", and they use their own small vocabulary rather than the upgrade keys,
    // because a buff is a temporary state and not a possession.
    for (const [key, b] of Object.entries(p.buffs || {})) {
        if (!b || b.t <= 0) continue;
        if (key === 'damage') m.damage *= 1 + b.v;
        else if (key === 'guard') m.taken *= 1 - b.v;
        else if (key === 'haste') { m.cooldown *= 1 - b.v; m.speed *= 1 + b.v; }
        else if (key === 'regen') m.regen += b.v;
        else if (key === 'spread') m.spread += b.v;      // more of whatever you throw
        else if (key === 'reach') { m.reach += b.v; m.arc *= 1.15; }
        else if (key === 'blast') m.blast *= 1 + b.v;
        else if (key === 'knock') m.knock *= 1 + b.v;
    }
    return m;
}

// What the next rank of an upgrade costs. Steeper every time, so the fifth Vigour is a real
// decision rather than the obvious thing to do with a full purse.
export function upgradePrice(p, key, floor = 1) {
    const up = UPGRADES[key];
    if (!up) return Infinity;
    const owned = (p.upgrades || {})[key] || 0;
    return Math.round(up.base * Math.pow(up.step, owned) * (1 + 0.12 * (floor - 1)));
}
export const upgradeRank = (p, key) => (p.upgrades || {})[key] || 0;
export const upgradeMaxed = (p, key) => upgradeRank(p, key) >= UPGRADE_MAX;

// Hung on G as well as exported, so modules that would otherwise import each other in a circle
// can still reach it.
export function maxHp(p) {
    return CLASSES[p.cls].hp + LEVEL_HP * (p.level - 1) + mods(p).hp;
}
export function damageMul(p) {
    return (1 + LEVEL_DAMAGE * (p.level - 1)) * mods(p).damage;
}
export const classDef = (p) => CLASSES[p.cls];
G.maxHp = maxHp;

// Straight-line distance, used constantly by the AI and by every attack.
export const dist = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);

// Shortest signed angle from a to b, in radians. Used to decide whether something is inside the
// cone of a swing.
export function angleDiff(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
}
