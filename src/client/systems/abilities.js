// ==================== SPECIAL MOVES ====================
// The four number keys. Each move is a verb from data.js plus numbers; the verbs are implemented
// once, here, on top of the same cone/shot/blast shapes the ordinary attack uses. That is what
// keeps a new move to a line of data, and it means a move and a basic attack can never disagree
// about what "caught by a swing" means.

import { G, nid, dist, damageMul, maxHp, mods, classDef } from '../core.js';
import { ABILITIES, ABILITY_SLOTS, ABILITY_LEVELS, ABILITY_START } from '../data.js';
import { coneHit, spawnShot, blastAt } from './combat.js';
import { setSurface, tileAt, FLOOR } from '../dungeon.js';
import { SURFACE } from '../data.js';

export const poolFor = (cls) => ABILITIES[cls] || [];
export const abilityDef = (cls, id) => poolFor(cls).find(a => a.id === id) || null;
export const isKnown = (p, id) => (p.known || []).includes(id);

// How many moves this character is entitled to know: one to open with, then one at each of the
// levels in ABILITY_LEVELS. Computed rather than stored, so it self-corrects if the table is
// retuned mid-development and cannot drift out of step with the level.
export function abilityPointsTotal(level) {
    return ABILITY_START + ABILITY_LEVELS.filter(l => level >= l).length;
}
export const abilityPointsLeft = (p) => abilityPointsTotal(p.level) - (p.known || []).length;

// Learning one. The `req` on a move is a level gate: the three strongest per calling are not
// available to a character who has only just arrived, however they spend their points.
export function canLearn(p, id) {
    const def = abilityDef(p.cls, id);
    if (!def || isKnown(p, id)) return false;
    if (p.level < (def.req || 1)) return false;
    return abilityPointsLeft(p) > 0;
}
export function learn(p, id) {
    if (!canLearn(p, id)) return false;
    return teach(p, id);
}

// Learning one without spending the entitlement -- what the keeper in the market sells. The level
// gate still applies, because a move you are not ready for is not a thing coin should be able to
// fix, but the count of moves you are owed by your level is not touched: you paid for this one.
export function teach(p, id) {
    const def = abilityDef(p.cls, id);
    if (!def || isKnown(p, id) || p.level < (def.req || 1)) return false;
    p.known.push(id);
    // Straight onto the bar if there is a free key: a move you have learnt and cannot press is a
    // menu step for nothing.
    const free = p.slots.indexOf(null);
    if (free !== -1) p.slots[free] = id;
    G.sfx('level');
    return true;
}

// Which key a move sits on, and putting one there. Binding a move that is already on the bar
// swaps the two rather than duplicating it -- there is no reason to hold the same move twice.
export function bind(p, index, id) {
    if (index < 0 || index >= ABILITY_SLOTS) return false;
    if (id !== null && !isKnown(p, id)) return false;
    const existing = id === null ? -1 : p.slots.indexOf(id);
    const displaced = p.slots[index];
    p.slots[index] = id;
    if (existing !== -1 && existing !== index) p.slots[existing] = displaced;
    return true;
}

export const cooldownOf = (p, id) => (p.abilityCool || {})[id] || 0;
// The wipe on the bar is measured against the wait this particular cast actually incurred, not
// against what the same move would cost right now: gaining haste mid-cooldown otherwise makes the
// square read as more than full.
export function readyFrac(p, id) {
    const def = abilityDef(p.cls, id);
    if (!def) return 0;
    const left = cooldownOf(p, id);
    if (left <= 0) return 0;
    const full = (p.abilityFull || {})[id] || def.cool;
    return Math.min(1, left / full);
}

// ---------- using one ----------
// What the body should be seen doing. A move names its own animation when it has one worth
// naming; otherwise the verb it uses is a good enough guess.
const ANIM_FOR = { cone: 'slash', nova: 'spin', volley: 'shoot', lob: 'cast',
                   charge: 'stab', snare: 'slam', buff: 'cast', heal: 'play',
                   seed: 'cast', sleep: 'play', parry: 'guard', spring: 'cast', charm: 'play' };

export function useAbility(index, aim) {
    const s = G.state;
    if (!s || s.over) return false;
    const p = s.player;
    const id = (p.slots || [])[index];
    if (!id) return false;
    const def = abilityDef(p.cls, id);
    if (!def || cooldownOf(p, id) > 0) return false;

    const m = mods(p);
    const aimX = aim ? aim.x : p.x + Math.sin(p.facing);
    const aimZ = aim ? aim.z : p.z + Math.cos(p.facing);
    const facing = Math.atan2(aimX - p.x, aimZ - p.z);
    p.facing = facing;
    p.swing = 0.28; p.swingTime = 0.28;   // a bigger wind-up than an ordinary swing
    p.swingKind = def.anim || ANIM_FOR[def.kind] || 'slash';
    // Haste shortens the wait on special moves exactly as it shortens the wait on a swing, so a
    // buff that says "faster" means one thing everywhere.
    p.abilityCool[id] = def.cool * m.cooldown;
    p.abilityFull = p.abilityFull || {};
    p.abilityFull[id] = p.abilityCool[id];
    p.castFlash = 0.3;                    // the renderer's tell that something was spent

    VERBS[def.kind](p, def, m, facing, aimX, aimZ);
    return true;
}

const VERBS = {
    cone(p, def, m, facing) {
        const hits = coneHit(p, facing, (def.reach || 2.4) + m.range, def.arc || 120,
                             def.damage * damageMul(p), (def.knock || 0) * m.knock, def.slow || 0);
        G.sfx(hits ? 'swingHit' : 'swing');
    },
    // A cone all the way round. Same function, 360 degrees, which is why it needs no code of its
    // own beyond the number.
    nova(p, def, m) {
        blastAt(p.x, p.z, (def.radius || 3) * m.blast, 0, 0, 0);   // the ring you see
        coneHit(p, 0, (def.radius || 3) * m.blast, 360,
                def.damage * damageMul(p), (def.knock || 0) * m.knock, def.slow || 0);
    },
    volley(p, def, m, facing) {
        const n = def.shots || 1;
        for (let i = 0; i < n; i++) {
            const spread = n === 1 ? 0 : (i - (n - 1) / 2) * (def.spread || 0.24);
            spawnShot(p, facing + spread, {
                damage: def.damage * damageMul(p), speed: def.speed || 17,
                range: (def.range || 11) + m.range, blast: (def.blast || 0) * m.blast,
                pierce: (def.pierce || 0) + m.pierce, slow: def.slow || 0, kind: def.bolt || 'bolt',
                ignites: !!def.ignites
            });
        }
        G.sfx('shoot');
    },
    // Lands where you pointed rather than flying until it hits: the shot is given exactly the
    // life it needs to cover the distance to the cursor, capped at its range.
    lob(p, def, m, facing, aimX, aimZ) {
        const reach = Math.min(Math.hypot(aimX - p.x, aimZ - p.z), (def.range || 9) + m.range);
        spawnShot(p, facing, {
            damage: def.damage * damageMul(p), speed: def.speed || 11, range: reach,
            blast: (def.blast || 2.4) * m.blast, pierce: 0, slow: def.slow || 0, kind: 'burst'
        });
        G.sfx('shoot');
    },
    // A committed rush. Reuses the dash the player system already runs, so it slides along walls
    // and cuts what it passes without knowing anything about either.
    charge(p, def, m, facing) {
        const dir = def.away ? facing + Math.PI : facing;
        const time = 0.2;
        p.dvx = Math.sin(dir) * (def.distance / time);
        p.dvz = Math.cos(dir) * (def.distance / time);
        p.dashing = time;
        p.dashHit = new Set();
        p.chargeDamage = def.damage * damageMul(p);
        p.chargeKnock = (def.knock || 0) * m.knock;
        p.invuln = Math.max(p.invuln, time + 0.1);
        G.sfx('dash');
    },
    snare(p, def, m) {
        blastAt(p.x, p.z, (def.radius || 3) * m.blast, def.damage ? def.damage * damageMul(p) : 0,
                0, def.slow || 1.5);
    },
    buff(p, def) {
        for (const [key, v] of Object.entries(def.buff || {})) p.buffs[key] = { v, t: def.time || 5 };
        G.sfx('level');
    },
    heal(p, def) {
        const before = p.hp;
        p.hp = Math.min(maxHp(p), p.hp + maxHp(p) * (def.heal || 0.2));
        for (const [key, v] of Object.entries(def.buff || {})) p.buffs[key] = { v, t: def.time || 5 };
        G.onDamage(p.x, p.z, Math.round(p.hp - before), 'heal');
        G.sfx('song');
    },

    // ---- a seed that drains ----
    // Planted where you point, and then it is a place in the room rather than a thing you did.
    // What it takes out of whatever is standing near it, it gives to you -- so the druid's healing
    // is a question of where the fight is happening, which is the only question this game asks.
    seed(p, def, m, facing, aimX, aimZ) {
        const reach = 6.5;
        const dx = aimX - p.x, dz = aimZ - p.z, l = Math.hypot(dx, dz) || 1;
        const r = Math.min(reach, l);
        G.state.seeds.push({
            id: nid(), x: p.x + (dx / l) * r, z: p.z + (dz / l) * r,
            radius: (def.radius || 3) * m.blast, t: def.time || 6, life: def.time || 6,
            dps: (def.dps || 8) * damageMul(p), leech: def.leech ?? 0.5, tick: 0
        });
        G.sfx('blast');
    },

    // ---- a song that puts them down ----
    // Not a stun with a nicer name: a sleeping body is worth hitting, because the blow that wakes
    // it lands for more than twice what it would have. Sleep does not skip the fight, it lets you
    // choose which part of the room you are fighting, and pays you for choosing well.
    sleep(p, def, m) {
        const r = (def.radius || 4) * m.blast;
        for (const e of G.state.enemies) {
            if (e.boss) continue;                       // the big ones do not listen
            if (dist(p.x, p.z, e.x, e.z) > r + e.size) continue;
            e.sleep = def.time || 4;
            e.wind = 0; e.rush = 0;                     // whatever it was winding up to do, it is not
        }
        G.state.blasts.push({ id: nid(), x: p.x, z: p.z, r, t: 0, song: true });
        G.sfx('song');
    }
};

// ---- the knight's riposte ----
// Not a buff: a window. For about a second the shield is up, and the first blow that comes in
// during it is turned aside and answered (see riposte in combat.js). Miss the window and you have
// spent the move on nothing, which is the price of a move this strong.
VERBS.parry = (p, def) => {
    p.parry = def.time || 1;
    p.parryDef = def;
    // Held for the whole window, so the raised shield is the thing you read.
    p.swingKind = 'guard'; p.swing = p.swingTime = p.parry;
    G.sfx('dash');
};

// ---- the druid's wellspring ----
// Water where you point. It is the only move in the game that changes the floor on purpose, and
// everything it does comes from the floor rather than from the move: a fire under it goes out
// because fire does not burn on water, what wades in is slowed because water slows, and the
// druid mends in it because druids do. Gateways are left alone -- a flooded alcove is a wave that
// arrives already slowed, which would be the move doing something nobody could see it do.
VERBS.spring = (p, def, m, facing, aimX, aimZ) => {
    const s = G.state, d = G.dungeon;
    const dx = aimX - p.x, dz = aimZ - p.z, l = Math.hypot(dx, dz) || 1;
    const reach = Math.min(def.range || 7, l);
    const cx = p.x + dx / l * reach, cz = p.z + dz / l * reach;
    const r = (def.radius || 2.4) * m.blast;
    const room = d.arena;
    const inRoom = (x, z) => x >= room.x && x < room.x + room.w && z >= room.z && z < room.z + room.h;
    for (let z = Math.floor(cz - r); z <= cz + r; z++)
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
            if (dist(cx, cz, x + 0.5, z + 0.5) > r) continue;
            if (tileAt(d, x, z) !== FLOOR || !inRoom(x, z)) continue;
            setSurface(d, x, z, SURFACE.water);
        }
    // And whatever was burning there is not.
    s.fires = (s.fires || []).filter(f => dist(cx, cz, f.x + 0.5, f.z + 0.5) > r);
    s.blasts.push({ id: nid(), x: cx, z: cz, r, t: 0, water: true });
    G.sfx('blast');
};

// ---- the bard's discord ----
// Everything in earshot turns on whatever is standing next to it. What they do to each other is
// paid for as if you had done it -- the kills are yours -- because the move is yours and a fight
// you won by starting it between them is a fight you won.
VERBS.charm = (p, def, m) => {
    const r = (def.radius || 4.5) * m.blast;
    for (const e of G.state.enemies) {
        if (e.boss || e.crate) continue;              // the big ones hear nothing but you
        if (dist(p.x, p.z, e.x, e.z) > r + e.size) continue;
        e.charm = def.time || 5;
        e.sleep = 0; e.wind = 0; e.rush = 0;
    }
    G.state.blasts.push({ id: nid(), x: p.x, z: p.z, r, t: 0, song: true });
    G.sfx('song');
};

// Cooldowns and buffs both tick here rather than in the player system, so everything about a
// special move lives in one file.
export function updateAbilities(dt) {
    const p = G.state.player;
    for (const id of Object.keys(p.abilityCool || {})) {
        p.abilityCool[id] = Math.max(0, p.abilityCool[id] - dt);
        if (p.abilityCool[id] === 0) { delete p.abilityCool[id]; delete (p.abilityFull || {})[id]; }
    }
    for (const [key, b] of Object.entries(p.buffs || {})) {
        b.t -= dt;
        if (b.t <= 0) delete p.buffs[key];
    }
    p.castFlash = Math.max(0, (p.castFlash || 0) - dt);
    p.parry = Math.max(0, (p.parry || 0) - dt);
}

// Called on the level-up so the toast can say what you have actually earned.
export const justEarnedAMove = (level) => ABILITY_LEVELS.includes(level);
