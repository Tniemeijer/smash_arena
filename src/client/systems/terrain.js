// ==================== WHAT IS ON THE FLOOR ====================
// Oil does nothing at all until something sets it off. Then it takes the tile it was lit on, and
// the tile next to that, and keeps going for as long as there is oil to take -- which turns a
// harmless black smear across the sand into a wall of fire running the length of the room.
//
// The fire does not know whose side anybody is on. That is the whole design: lighting it is a
// decision about where YOU are standing, not a button that damages enemies. A druid who drops a
// seed-burst on a slick has just drawn a line across the arena and has to live on one side of it.

import { G, dist } from '../core.js';
import { SURFACE, TERRAIN, GRID, ENEMIES } from '../data.js';
import { surfaceAt, setSurface } from '../dungeon.js';
import { hurtPlayer, hurtEnemy } from './combat.js';

// Fire is kept as a list rather than as a state on the tile, because a burning tile has a clock
// and a tile is a number. The surface says "on fire"; this says how much longer for.
export const beginFires = () => [];

// Something went off here. Every oil tile inside the radius catches, and each becomes a seed for
// the spread. Anything that is not oil is unchanged -- you cannot set sand alight.
//
// A blast is heat as well as a spark, so the same pass melts what it goes off on: ice to water,
// snow down to the sand under it. That is how an icehouse changes as you fight in it -- every
// burst thaws a patch, and the floor you started on is not the floor you finish on. Returns only
// what it LIT, because that is the question the callers are asking.
export function igniteAt(d, x, z, radius) {
    const s = G.state;
    if (!d || !s) return 0;
    let lit = 0;
    for (let tz = Math.floor(z - radius); tz <= z + radius; tz++)
        for (let tx = Math.floor(x - radius); tx <= x + radius; tx++) {
            if (dist(x, z, tx + 0.5, tz + 0.5) > radius) continue;
            const here = surfaceAt(d, tx, tz);
            if (here === SURFACE.ice) setSurface(d, tx, tz, SURFACE.water);
            else if (here === SURFACE.snow) setSurface(d, tx, tz, SURFACE.sand);
            if (here !== SURFACE.oil) continue;
            light(d, s, tx, tz);
            lit++;
        }
    if (lit) G.sfx('blast');
    return lit;
}

function light(d, s, tx, tz) {
    setSurface(d, tx, tz, SURFACE.fire);
    s.fires.push({ x: tx, z: tz, t: TERRAIN.fireTime, next: TERRAIN.spread });
}

export function updateFires(d, dt) {
    const s = G.state;
    if (!s || !s.fires || !s.fires.length) return;
    const p = s.player;

    for (const f of [...s.fires]) {
        f.t -= dt;
        // It reaches for the oil beside it, one tile at a time, which is what makes a slick burn
        // ALONG rather than all at once -- and what gives you a moment to get off it.
        f.next -= dt;
        if (f.next <= 0) {
            f.next = TERRAIN.spread;
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
                if (surfaceAt(d, f.x + dx, f.z + dz) === SURFACE.oil) light(d, s, f.x + dx, f.z + dz);
        }
        if (f.t <= 0) {
            // Burnt out. The tile is scorched, not oily: a slick only burns once.
            setSurface(d, f.x, f.z, SURFACE.ash);
            s.fires = s.fires.filter(x => x !== f);
        }
    }

    // Standing in it sets you alight. The fire does not damage you here -- it only lights you --
    // because what is actually burning is the body, not the tile, and a body carries it out with
    // it. That is the difference between a fire you sprint through and a fire you walk into.
    const burning = (x, z) => surfaceAt(d, x, z) === SURFACE.fire;
    if (!s.over && burning(p.x, p.z)) p.burn = TERRAIN.burnTime;
    for (const e of s.enemies)
        if (burning(e.x, e.z) && !(ENEMIES[e.kind] || {}).fireproof) e.burn = TERRAIN.burnTime;
}

// What being alight costs, for everything that is. Separate from the fires themselves because it
// has to keep running after the last tile has burnt out -- and because a body on fire is a state
// of the body.
//
// It lands in bites rather than per frame for two reasons: a frame's worth of damage rounds to
// nothing in a floating number, and it used to go through the ordinary hurt path, which handed
// the player a mercy window for each fraction of a point and made the flames the safest tile in
// the room. Enemies take it through hurtEnemy, so a kill by fire flashes, pays, drops and scores
// like any other kill instead of quietly deleting a body.
export function updateBurning(dt) {
    const s = G.state;
    if (!s) return;
    const p = s.player;
    const d = G.dungeon;
    // Water puts you out. The one answer to being alight that is not "wait", and the reason a
    // pool next to a slick is worth knowing about before anybody lights it.
    const doused = (b) => d && surfaceAt(d, b.x, b.z) === SURFACE.water;
    if (p.burn > 0 && doused(p)) { p.burn = 0; p.burnTick = 0; G.sfx('burn'); }
    for (const e of s.enemies) if (e.burn > 0 && doused(e)) { e.burn = 0; e.burnTick = 0; }

    if (p.burn > 0 && !s.over) {
        p.burn -= dt;
        p.burnTick = (p.burnTick || 0) + dt;
        if (p.burnTick >= TERRAIN.burnBite) {
            hurtPlayer(TERRAIN.fireDamage * p.burnTick, { mercy: false, kind: 'burn', sfx: 'burn' });
            p.burnTick = 0;
        }
    } else p.burnTick = 0;

    for (const e of [...s.enemies]) {
        if (!(e.burn > 0)) continue;
        e.burn -= dt;
        e.burnTick = (e.burnTick || 0) + dt;
        if (e.burnTick >= TERRAIN.burnBite) {
            const bite = TERRAIN.fireDamage * e.burnTick;
            e.burnTick = 0;
            // No knockback: it is being cooked, not hit.
            hurtEnemy(e, bite, e.x, e.z, 0);
        }
    }
}

// How fast you move on this. Water is the only thing that slows you, and it slows everything
// equally -- a pool is a place neither side wants to be caught in.
export function surfaceSpeed(d, x, z) {
    const s = surfaceAt(d, x, z);
    if (s === SURFACE.water) return TERRAIN.waterSlow;
    if (s === SURFACE.snow) return TERRAIN.snowSlow;
    if (s === SURFACE.ice) return TERRAIN.iceSpeed;      // quicker, once you are moving at all
    return 1;
}

// Ice is the one surface that changes how you move rather than how fast. Asked as a question
// because the player system has to know whether to carry your last direction or simply take the
// one you are holding.
export const isSlippery = (d, x, z) => surfaceAt(d, x, z) === SURFACE.ice;


// ---------- brambles ----------
// A patch of thorns from a druid's burst or dash. Holds back whatever walks through it for as long
// as it lasts. No damage: the druid's damage is the burst that planted it; this is the garden.
export function updateBrambles(dt) {
    const s = G.state;
    if (!s || !s.brambles || !s.brambles.length) return;
    for (const b of s.brambles) {
        b.t -= dt;
        for (const e of s.enemies)
            if (!e.boss && dist(b.x, b.z, e.x, e.z) < b.r + e.size * 0.5) e.slow = Math.max(e.slow || 0, 0.25);
    }
    s.brambles = s.brambles.filter(b => b.t > 0);
}

// ---------- seeds ----------
// A planted seed is a place, not an effect: it sits there draining whatever comes near it and
// handing the difference to whoever planted it. Kept here with the other things that belong to
// the floor rather than to a body.
export function updateSeeds(dt) {
    const s = G.state;
    if (!s || !s.seeds || !s.seeds.length) return;
    const p = s.player;
    for (const sd of [...s.seeds]) {
        sd.t -= dt;
        sd.tick += dt;
        // Applied in quarter-second bites rather than per frame, so the numbers that float off a
        // drained body are readable instead of a blur of ones.
        if (sd.tick >= 0.25) {
            const share = sd.tick;
            sd.tick = 0;
            let taken = 0;
            for (const e of [...s.enemies]) {
                if (dist(sd.x, sd.z, e.x, e.z) > sd.radius + e.size) continue;
                const bite = sd.dps * share;
                taken += bite;
                hurtEnemy(e, bite, sd.x, sd.z, 0);
            }
            if (taken > 0) {
                const mend = taken * sd.leech;
                const before = p.hp;
                p.hp = Math.min(G.maxHp(p), p.hp + mend);
                if (p.hp > before) G.onDamage(p.x, p.z, Math.round(p.hp - before), 'heal');
            }
        }
        if (sd.t <= 0) s.seeds = s.seeds.filter(x => x !== sd);
    }
}
