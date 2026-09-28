// ==================== WHAT LIVES DOWN THERE ====================
// Enemies are deliberately simple: sit still until they can see you, then walk at you and swing
// when they're close enough. The interesting part is not the individual brain but the crowd --
// separation between them, so a pack arrives as a line rather than as one enemy wearing five
// coats, which is what makes an arc swing worth aiming.

import { G, nid, dist } from '../core.js';
import { ENEMIES, DEPTH_HP, DEPTH_DAMAGE, ELITE, BOSSES, BOSS_ORDER,
         BOSS_DEPTH_HP, BOSS_DEPTH_DAMAGE, SURFACE, TERRAIN } from '../data.js';
import { moveWithSlide, lineOfSight, canStand, unstick, surfaceAt } from '../dungeon.js';
import { surfaceSpeed } from './terrain.js';
import { hurtPlayer, hurtEnemy, hostileShot, hostileBlast } from './combat.js';

const SIGHT = 9;               // how far one can notice you, given a clear line
const SEPARATION = 0.55;       // how hard they refuse to stand inside each other

// Which of them can be down here at all, and how likely each is. Pulled out of populate() because
// an arena wave rolls from the identical table -- what walks through a gauntlet door is the same
// bestiary that sleeps in a delve, which is what keeps the two halves of the game one game.
// Nothing sleeps in a room any more -- everything walks in through a gate -- so there is no
// populate() to scatter a floor with. What is left is the roll itself.
//
// A kind is drawn from a WAVE SHAPE rather than from one global weighting, which is what stops
// every wave being the same soup. Kinds too deep for this room are filtered out first, and a
// shape with nothing left in it falls back to whatever the room can field.
export function pickKind(floor, shape, biome) {
    let table = (shape && shape.kinds) || { rat: 8, skeleton: 6, shade: 3 };
    // What lives here multiplies into what the wave asked for, so a rush is still a rush -- it is
    // a rush of the things that live here. Anything the place does not list is dropped: an
    // icehouse does not start fielding rats because the shape of the wave wanted some.
    //
    // And anything the place lists that the shape never mentioned still gets a share, at a weight
    // taken from the shape's own. That second half is the one that matters: no wave shape names a
    // frost wolf, so a plain intersection meant the creature a place is known for could never walk
    // out of its gates.
    const here = biome && biome.kinds;
    if (here) {
        const ws = Object.values(table);
        const base = ws.length ? (ws.reduce((a, b) => a + b, 0) / ws.length) * 0.6 : 1;
        const merged = {};
        for (const [k, w] of Object.entries(here)) merged[k] = w * (table[k] ?? base);
        table = merged;
    }
    const usable = Object.entries(table).filter(([k]) => ENEMIES[k] && floor >= ENEMIES[k].from);
    const pool = usable.length ? usable
        : Object.entries(ENEMIES).filter(([, e]) => floor >= e.from).map(([k]) => [k, 1]);
    const total = pool.reduce((n, [, w]) => n + w, 0);
    let roll = Math.random() * total;
    for (const [k, w] of pool) { roll -= w; if (roll <= 0) return k; }
    return pool[0][0];
}

export function spawnAt(kind, at, floor, elite = false) {
    const def = ENEMIES[kind];
    const depth = floor - 1;
    const mul = elite ? ELITE : { hp: 1, damage: 1, size: 1, speed: 1, xp: 1 };
    const hp = Math.round(def.hp * (1 + DEPTH_HP * depth) * mul.hp);
    return {
        id: nid(), kind, ai: def.ai || 'chase', elite,
        x: at.x, z: at.z, hp, maxHp: hp,
        damage: def.damage * (1 + DEPTH_DAMAGE * depth) * mul.damage,
        speed: def.speed * mul.speed, size: def.size * mul.size,
        reach: def.reach, xp: Math.round(def.xp * mul.xp),
        cool: Math.random() * def.cooldown, cooldown: def.cooldown,
        // A wave walks in already looking for you. Sleeping until noticed is a delve behaviour:
        // in a sealed room there is nothing to notice you from.
        awake: !!at.awake, facing: 0, flash: 0, slow: 0, kx: 0, kz: 0, swing: 0,
        // What it is in the middle of. `wind` is a telegraph burning down; `rush` is a committed
        // charge. Both are readable on the body, which is the point of having them at all.
        wind: 0, rush: 0, rvx: 0, rvz: 0, fuse: 0
    };
}

// ---------- the big ones ----------
// Which one is waiting this deep, and how many times the list has come round. A repeat is the
// same fight with more health and a harder hand, which is the honest way to keep a list of three
// bosses working on floor sixteen.
export function bossFor(floor) {
    const nth = Math.max(0, Math.floor(floor / 4) - 1);
    const key = BOSS_ORDER[nth % BOSS_ORDER.length];
    const repeats = Math.floor(nth / BOSS_ORDER.length);
    return { key, def: BOSSES[key], repeats };
}

export function populateBoss(d, floor) {
    const { key, def, repeats } = bossFor(floor);
    const hp = Math.round(def.hp * (1 + BOSS_DEPTH_HP * repeats) * (1 + DEPTH_HP * (floor - 1) * 0.4));
    return [{
        id: nid(), kind: key, boss: key, ai: 'boss', name: def.name, title: def.title,
        x: d.bossAt.x, z: d.bossAt.z, hp, maxHp: hp,
        damage: def.damage * (1 + BOSS_DEPTH_DAMAGE * repeats),
        speed: def.speed, size: def.size, reach: def.reach, xp: def.xp,
        cool: 0, cooldown: def.cooldown,
        awake: false, facing: Math.PI, flash: 0, slow: 0, kx: 0, kz: 0, swing: 0,
        // One clock per move, started staggered so the first thing it does is not everything it
        // does. `act` is whatever it is in the middle of.
        moves: def.moves, moveT: def.moves.map((m, i) => 1.5 + i * 1.2), act: null, glow: 0
    }];
}

export function updateEnemies(d, dt) {
    const s = G.state, p = s.player;
    for (const e of s.enemies) {
        e.flash = Math.max(0, e.flash - dt);
        // Anything that has ended up inside the rock walks out of it, whatever put it there. A
        // body wedged in a wall is a body that can never be killed and a wave that can never end.
        if (unstick(d, e, dt)) continue;
        e.swing = Math.max(0, e.swing - dt);
        e.slow = Math.max(0, e.slow - dt);
        e.cool = Math.max(0, e.cool - dt);

        // Knockback is applied as a decaying velocity rather than a teleport, so being shoved
        // reads as being shoved and can push something back into a wall.
        if (Math.abs(e.kx) + Math.abs(e.kz) > 0.01) {
            moveWithSlide(d, e, e.kx * dt, e.kz * dt, e.size * 0.6);
            e.kx *= 0.82; e.kz *= 0.82;
        }

        const toPlayer = dist(e.x, e.z, p.x, p.z);
        if (!e.awake) {
            if (toPlayer < SIGHT && lineOfSight(d, e.x, e.z, p.x, p.z)) {
                e.awake = true;
                if (e.boss) wake(e);
            } else continue;
        }
        if (s.over) continue;

        // Asleep. It does not chase, swing, wind up or finish what it was doing -- and the blow
        // that wakes it is worth a great deal more than the one before it.
        if (e.sleep > 0) {
            e.sleep -= dt;
            e.swing = 0;
            continue;
        }

        // Turned by a bard's Discord: it fights whatever is nearest that is not itself, and
        // leaves you alone while it does.
        if (e.charm > 0) {
            e.charm -= dt;
            brawl(d, e, dt);
            continue;
        }

        // A boss spends most of its time doing something specific, and the ordinary behaviours
        // below are only what it falls back to between them.
        if (e.boss && updateBoss(d, e, dt, toPlayer)) continue;

        // Anything in the middle of a committed move finishes it before it decides anything else.
        if (e.rush > 0) { rushing(d, e, dt); continue; }
        if (e.wind > 0) { winding(d, e, dt, toPlayer); continue; }

        e.facing = Math.atan2(p.x - e.x, p.z - e.z);
        if (e.ai === 'shooter') shooter(d, e, dt, toPlayer);
        else if (e.ai === 'charger') charger(d, e, dt, toPlayer);
        else if (e.ai === 'bloat') bloat(d, e, dt, toPlayer);
        else chase(d, e, dt, toPlayer);
    }
}

// ---------- moving ----------
// Shared by every behaviour, because "walk that way without standing inside your neighbours" is
// the same problem whoever is doing it. Without the separation a pack stacks into one square and
// only the front one is ever hittable, which is what makes an arc swing worth aiming.
function walk(d, e, dt, dirX, dirZ, scale = 1) {
    const s = G.state;
    let vx = dirX, vz = dirZ;
    for (const o of s.enemies) {
        if (o === e) continue;
        const dd = dist(e.x, e.z, o.x, o.z);
        if (dd > SEPARATION + (e.size + o.size) * 0.5 || dd < 1e-4) continue;
        vx += (e.x - o.x) / dd * 0.9; vz += (e.z - o.z) / dd * 0.9;
    }
    const len = Math.hypot(vx, vz) || 1;
    const sp = e.speed * scale * (e.slow > 0 ? 0.45 : 1) * footing(d, e);
    moveWithSlide(d, e, vx / len * sp * dt, vz / len * sp * dt, e.size * 0.6);
}

// What the floor does to this particular body. The same as it does to you, except for the few
// that belong to a place: a drowned thing is quicker in water, not slower, and a frost wolf does
// not notice ice at all. Those exceptions are the whole of what makes those two dangerous at
// home -- the pool you backed into to slow the wave down is the one place the drowned are fast.
function footing(d, e) {
    const def = ENEMIES[e.kind] || {};
    const surf = surfaceAt(d, e.x, e.z);
    if (def.wades && surf === SURFACE.water) return def.waterSpeed || 1.3;
    if (def.sure && (surf === SURFACE.ice || surf === SURFACE.snow)) return 1;
    return surfaceSpeed(d, e.x, e.z);
}

// A frost wolf's bite leaves you slow. Only a bite that landed: a blow the mercy window swallowed
// did nothing, and the chill should not pretend otherwise.
function bitten(e, landed) {
    const def = ENEMIES[e.kind] || {};
    if (landed && def.chill) G.state.player.chill = Math.max(G.state.player.chill || 0, def.chill);
}
const toward = (e, p) => { const l = dist(e.x, e.z, p.x, p.z) || 1; return [(p.x - e.x) / l, (p.z - e.z) / l]; };

// ---------- turned ----------
// Whatever its usual way of fighting, a charmed body walks up to the nearest other body and hits
// it. Shooters do not shoot and chargers do not charge: the telegraphs are about YOU, and a wind-up
// aimed at somebody else would be a telegraph telling you nothing. The damage goes through the
// ordinary path, so a kill it makes is a kill that pays -- the move that caused it was yours.
function brawl(d, e, dt) {
    let target = null, best = Infinity;
    for (const o of G.state.enemies) {
        if (o === e) continue;
        const dd = dist(e.x, e.z, o.x, o.z);
        if (dd < best) { best = dd; target = o; }
    }
    if (!target) return;                                   // nobody left to argue with
    e.facing = Math.atan2(target.x - e.x, target.z - e.z);
    if (best > e.reach + target.size * 0.5 + 0.2) {
        const [vx, vz] = toward(e, target);
        walk(d, e, dt, vx, vz);
    } else if (e.cool <= 0) {
        e.cool = e.cooldown;
        e.swing = 0.2;
        hurtEnemy(target, Math.max(e.damage, 5), e.x, e.z, 2);
    }
}

// ---------- chase ----------
function chase(d, e, dt, toPlayer) {
    const p = G.state.player;
    if (toPlayer > e.reach + 0.3) {
        const [vx, vz] = toward(e, p);
        walk(d, e, dt, vx, vz);
    } else if (e.cool <= 0) {
        e.cool = e.cooldown;
        e.swing = 0.2;
        bitten(e, hurtPlayer(e.damage, { from: e }));
    }
}

// ---------- shooter ----------
// Holds a distance and throws. Backs off when you close, which means the answer to it is to
// commit -- and committing is exactly what the melee in the same wave is punishing.
function shooter(d, e, dt, toPlayer) {
    const p = G.state.player, def = ENEMIES[e.kind];
    const [vx, vz] = toward(e, p);
    if (toPlayer < def.keep * 0.72) walk(d, e, dt, -vx, -vz, 1.05);
    else if (toPlayer > def.range * 0.85) walk(d, e, dt, vx, vz);
    else walk(d, e, dt, -vz * 0.6, vx * 0.6, 0.7);       // sidesteps rather than standing still
    if (e.cool <= 0 && toPlayer < def.range && lineOfSight(d, e.x, e.z, p.x, p.z)) {
        e.wind = def.wind;
        e.windKind = 'shot';
    }
}

// ---------- charger ----------
// Stops dead, winds up where you can see it, then commits to a straight line. The answer is to
// step out of the line, which is a different reflex from backing away and is the reason this
// exists next to things that chase.
function charger(d, e, dt, toPlayer) {
    const p = G.state.player, def = ENEMIES[e.kind];
    if (e.cool <= 0 && toPlayer < def.lock && lineOfSight(d, e.x, e.z, p.x, p.z)) {
        e.wind = def.wind;
        e.windKind = 'rush';
        return;
    }
    chase(d, e, dt, toPlayer);
}

// ---------- bloat ----------
// Walks at you and bursts. Killing it at range is free; killing it in a huddle is not, and it
// does not much mind which of those you choose.
function bloat(d, e, dt, toPlayer) {
    const p = G.state.player, def = ENEMIES[e.kind];
    if (toPlayer < def.reach + 0.4) { e.wind = def.wind; e.windKind = 'burst'; return; }
    const [vx, vz] = toward(e, p);
    walk(d, e, dt, vx, vz);
}

// ---------- the committed bits ----------
// A telegraph is a promise: whatever it was going to do, it does when this runs out, and it does
// not steer in the meantime. That is the whole contract that makes any of these fair.
function winding(d, e, dt, toPlayer) {
    const p = G.state.player;
    e.wind -= dt;
    // Still turns to face you while winding up a rush, so the line it will take is readable --
    // but only while winding. Once it goes, it goes where it was pointing.
    if (e.windKind === 'rush') e.facing = Math.atan2(p.x - e.x, p.z - e.z);
    if (e.wind > 0) return;
    const def = ENEMIES[e.kind];
    if (e.windKind === 'shot') {
        // What it throws says what it is: an imp's is alight, a stonethrower's is a rock.
        hostileShot(e, Math.atan2(p.x - e.x, p.z - e.z), def.shotDamage, def.shot,
                    { ignites: !!def.ignites, heavy: !!def.heavy,
                      kind: def.ignites ? 'ember' : def.heavy ? 'rock' : 'hex' });
        e.cool = e.cooldown;
        G.sfx('shoot');
    } else if (e.windKind === 'rush') {
        e.rush = def.rushTime;
        e.rvx = Math.sin(e.facing) * def.rush;
        e.rvz = Math.cos(e.facing) * def.rush;
        e.rushHit = false;
        G.sfx('dash');
    } else if (e.windKind === 'burst') {
        burst(e);
    }
    e.windKind = null;
}

function rushing(d, e, dt) {
    const p = G.state.player;
    const before = { x: e.x, z: e.z };
    // On ice a charge runs out of legs far more slowly than it runs out of intent: it skids.
    // Step aside and it goes sailing past into whatever is behind you -- which, in an icehouse,
    // is the whole trick to fighting the things that charge. The wolves do not skid; that is the
    // whole trick to them.
    const def = ENEMIES[e.kind] || {};
    const skid = !def.sure && surfaceAt(d, e.x, e.z) === SURFACE.ice;
    e.rush -= dt * (skid ? TERRAIN.iceSkid : 1);
    moveWithSlide(d, e, e.rvx * dt, e.rvz * dt, e.size * 0.6);
    const moved = Math.hypot(e.x - before.x, e.z - before.z);
    if (!e.rushHit && dist(e.x, e.z, p.x, p.z) < e.size * 0.7 + 0.45) {
        e.rushHit = true;
        bitten(e, hurtPlayer((ENEMIES[e.kind].rushHit || e.damage) * (e.elite ? 1.35 : 1), { from: e }));
    }
    // Stopped by a wall, or run out of legs. Either way it has to wind up again.
    if (e.rush <= 0 || moved < Math.hypot(e.rvx, e.rvz) * dt * 0.5) {
        e.rush = 0;
        e.cool = e.cooldown;
    }
}

// A bloat that reaches you kills itself to do it. Routed through the ordinary damage path rather
// than removed by hand, so it still pays experience and still drops what it was carrying -- and
// so the blast itself lives in exactly one place, which is the kill.
export function burst(e) {
    hurtEnemy(e, 1e9, e.x, e.z, 0);
}

// ---------- boss behaviour ----------
// Every move is the same three beats: a wind-up you can see, the thing itself, and a cooldown.
// The wind-up is the whole design -- a boss that acts on the frame it decides to is a boss you
// cannot read, and an unreadable boss is just a damage race.
function wake(e) {
    G.state.bossId = e.id;
    G.onToast(`${e.name}, ${e.title}`, 'bad');
    G.sfx('boss');
}

// Returns true when it has taken the frame -- the ordinary walk-and-swing is skipped then.
function updateBoss(d, e, dt, toPlayer) {
    const s = G.state, p = s.player;
    e.glow = Math.max(0, e.glow - dt * 2);

    if (e.act) {
        e.act.t -= dt;
        if (e.act.phase === 'wind') {
            // Stands still and turns to face you while it winds up, so where the blow is going to
            // land is something you were told rather than something you learn afterwards.
            e.facing = Math.atan2(p.x - e.x, p.z - e.z);
            e.glow = 1;
            if (e.act.t <= 0) fire(d, e, e.act.move);
            return true;
        }
        if (e.act.phase === 'charge') {
            moveWithSlide(d, e, e.act.vx * dt, e.act.vz * dt, e.size * 0.6);
            if (dist(e.x, e.z, p.x, p.z) < e.size * 0.7 + 0.4) {
                hurtPlayer(e.act.move.damage);
                e.act = null;
                return true;
            }
            if (e.act.t <= 0) e.act = null;
            return true;
        }
        e.act = null;
    }

    // Pick among whatever is off cooldown. Random rather than in order, so the pattern is a
    // vocabulary rather than a dance you can memorise once and never look at again.
    const ready = [];
    for (let i = 0; i < e.moves.length; i++) {
        e.moveT[i] -= dt;
        if (e.moveT[i] <= 0) ready.push(i);
    }
    if (ready.length && toPlayer < 14) {
        const i = ready[Math.floor(Math.random() * ready.length)];
        const m = e.moves[i];
        e.moveT[i] = m.cool;
        e.act = { move: m, phase: 'wind', t: m.wind || 0.6 };
        G.sfx('wind');
        return true;
    }
    return false;
}

// Somewhere clear on a ring around the boss. Walks round from where it was asked and gives up
// on top of the boss itself, which is by definition somewhere a body can stand.
function ringSpot(d, e, angle) {
    const r = e.size + 1.2;
    for (let k = 0; k < 8; k++) {
        const a = angle + k * (Math.PI / 4);
        const x = e.x + Math.sin(a) * r, z = e.z + Math.cos(a) * r;
        if (canStand(d, x, z, 0.5)) return { x, z, awake: true };
    }
    return { x: e.x, z: e.z, awake: true };
}

function fire(d, e, m) {
    const s = G.state, p = s.player;
    e.act = null;
    if (m.kind === 'slam') {
        hostileBlast(e.x, e.z, m.radius, m.damage, m.slow || 0);
    } else if (m.kind === 'volley') {
        const base = Math.atan2(p.x - e.x, p.z - e.z);
        for (let i = 0; i < m.shots; i++) {
            // A ring goes all the way round and ignores where you are; a fan is aimed. The first
            // is a room you have to leave, the second is a line you have to step off.
            const dir = m.ring ? (i / m.shots) * Math.PI * 2
                               : base + (i - (m.shots - 1) / 2) * (m.spread || 0.3);
            hostileShot(e, dir, m.damage, m.speed);
        }
        G.sfx('shoot');
    } else if (m.kind === 'charge') {
        const dir = Math.atan2(p.x - e.x, p.z - e.z);
        e.act = { move: m, phase: 'charge', t: m.time,
                  vx: Math.sin(dir) * m.speed, vz: Math.cos(dir) * m.speed };
        G.sfx('dash');
    } else if (m.kind === 'summon') {
        for (let i = 0; i < m.n; i++) {
            // Round the boss, but only where there is floor to stand on. The ring was taken on
            // faith before, and a boss fighting with its back to a pillar was summoning bodies
            // straight into the rock, where they stayed.
            const at = ringSpot(d, e, (i / m.n) * Math.PI * 2);
            const kind = m.kinds[Math.floor(Math.random() * m.kinds.length)];
            s.enemies.push(spawnAt(kind, at, s.floor));
        }
        G.sfx('spawn');
    }
}
