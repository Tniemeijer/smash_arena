// ==================== THE GAUNTLET ====================
// The director for an arena floor. One room, four gated entrances, and a list of what is about to
// come through which of them.
//
// It owns no fighting of its own. A wave is ordinary enemies from the ordinary bestiary, and what
// the room pays out goes through the ordinary loot table -- which is the whole trick to bolting
// an arcade onto a dungeon crawler. The arcade is a director; the game underneath it is unchanged,
// so a wave still drops a fabled sword and still pays experience.
//
// The rules, all of them:
//   - the gates are shut and the room is empty when you walk in
//   - a wave opens one or more gates, walks through them, and they clatter down again
//   - when nothing is left standing, the north gate lifts and the stair behind it is yours
//
// Everything a wave does is announced by a gate going up, which is the one thing the room can
// show you from any distance. No markers, no arrivals behind you: if something is coming, there
// is an open gate it is coming through.

import { G, nid } from '../core.js';
import { ARENA, SCORE, WAVE_SHAPES, SHAPE_ORDER, ELITE, BIOMES } from '../data.js';
import { setDoor, canStand } from '../dungeon.js';
import { spawnAt, pickKind } from './enemies.js';
import { addScore } from './score.js';
import { dropReward } from './loot.js';
import { crowdWave } from './crowd.js';

const between = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));

// How many waves, and how big. Both grow slowly: an arena that doubles every floor is a wall, and
// a wall is where people stop playing.
const waveCount = (floor) => between(ARENA.waves) + Math.floor(floor / 4);
const waveSize = (floor) => Math.round(between(ARENA.perWave) + ARENA.waveGrowth * (floor - 1));

export function beginArena(d, floor) {
    for (const dw of d.doorways) setDoor(d, dw, false);
    return {
        floor, wave: 0, waves: waveCount(floor),
        fighting: true, done: false,
        // A moment to look at the room before the first gate goes up.
        grace: ARENA.grace,
        // Bodies stood in an alcove waiting their turn to walk out.
        pending: [],
        // Per gate, how much longer it stays up. A gate with anything still to send is held open;
        // the linger is so it does not slam shut between two of them.
        gateT: {}
    };
}

export function updateArena(d, dt) {
    const s = G.state, a = s.arena;
    if (!a || s.over) return;

    if (a.grace > 0) {
        a.grace -= dt;
        if (a.grace <= 0) startWave(d, a);
        return;
    }

    // Anything whose turn has come walks out of its alcove and into the room.
    for (const q of [...a.pending]) {
        q.t -= dt;
        if (q.t > 0) continue;
        a.pending = a.pending.filter(x => x !== q);
        const e = spawnAt(q.kind, { x: q.x, z: q.z, awake: true }, a.floor, q.elite);
        // Facing into the room, so the first thing it does is walk in rather than turn round.
        e.facing = Math.atan2(q.into.x, q.into.z);
        s.enemies.push(e);
        a.gateT[q.gate] = Math.max(a.gateT[q.gate] || 0, ARENA.linger);
        G.sfx('spawn');
    }

    // A gate is up while it still has somebody to send, for a breath afterwards, and for as long
    // as anything is still stood underneath it.
    //
    // That last clause is not politeness. A closed gate is solid rock, and a body the gate closes
    // on is left overlapping it, where canStand() refuses every direction it could move in. For
    // the player that is the run over; for one of them it is worse, because a body wedged in an
    // alcove is a body that can never be killed, and the wave it belongs to never ends.
    const holding = new Set(a.pending.map(q => q.gate));
    for (const dw of d.doorways) {
        if (dw.role !== 'spawn') continue;
        if (a.gateT[dw.i] > 0) a.gateT[dw.i] -= dt;
        const want = holding.has(dw.i) || a.gateT[dw.i] > 0 || occupied(dw, s);
        if (want !== dw.open) { setDoor(d, dw, want); G.sfx('gate'); }
    }

    if (!a.fighting) return;
    // A wave is over when nothing is left standing and nothing is still waiting to come through.
    if (s.enemies.length || a.pending.length) return;
    if (a.wave < a.waves) startWave(d, a);
    else finish(d, a);
}

// ---------- sending a wave in ----------
// Which gates open is the shape of the wave: one gate is a queue you can hold, three gates is a
// room you have to keep moving in. Later waves use more of them, so the floor gets harder in a
// way you can see coming rather than only feel afterwards.
function startWave(d, a) {
    a.wave++;
    // The shape is chosen first and the bodies are drawn from it. The opening wave of every room
    // is a rush, so a room starts by telling you plainly what it is before it starts lying.
    const shape = a.wave === 1 ? WAVE_SHAPES.rush : pickShape(a.floor);
    a.shape = shape;
    const n = Math.max(2, Math.round((waveSize(a.floor) + (a.wave - 1) * 2) * shape.size));

    const gates = d.spawnGates.slice();
    for (let i = gates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gates[i], gates[j]] = [gates[j], gates[i]];
    }
    // How many gates is the shape's business, not the wave number's: a rush is one door with a
    // great deal behind it, a swarm is every door at once, and those feel completely different
    // even with the same number of bodies.
    const using = gates.slice(0, Math.min(gates.length, shape.gates));

    // How likely any one body is to come through wearing a crown. Rises with depth and never
    // touches the first couple of rooms, which should be teaching you the plain version first.
    const eliteOdds = a.floor < ELITE.from ? 0
        : Math.min(ELITE.max, ELITE.chance + ELITE.perRoom * (a.floor - ELITE.from));

    for (let i = 0; i < n; i++) {
        const gi = using[i % using.length];
        const dw = d.doorways[gi];
        const nth = Math.floor(i / using.length);
        const at = mouthSpot(d, dw);
        a.pending.push({ id: nid(), gate: gi, kind: pickKind(a.floor, shape, BIOMES[d.biome]),
                         elite: Math.random() < eliteOdds,
                         x: at.x, z: at.z, into: dw.into, t: 0.45 + nth * ARENA.gap });
    }
    for (const gi of using) {
        a.gateT[gi] = Math.max(a.gateT[gi] || 0, 0.6);
        setDoor(d, d.doorways[gi], true);
    }
    G.sfx('gate');
    G.onToast(shape.say ? `Wave ${a.wave} — ${shape.say}` : `Wave ${a.wave}`,
              a.wave === 1 ? 'bad' : '');
}

// Which shapes this deep can field. Later rooms drop the gentler ones off the bottom of the list
// rather than merely adding to it, so floor nine is not still rolling the floor-one wave.
function pickShape(floor) {
    let allowed = SHAPE_ORDER[0].shapes;
    for (const row of SHAPE_ORDER) if (floor >= row.from) allowed = row.shapes;
    const key = allowed[Math.floor(Math.random() * allowed.length)];
    return WAVE_SHAPES[key] || WAVE_SHAPES.mixed;
}

// Somewhere across the mouth of this gate to stand while waiting.
//
// The jitter goes ACROSS the gateway and never along it. Spread on both axes was the original,
// and it was wrong: the waiting spot is the middle of the last tile of the alcove, so half a
// tile of jitter along the depth put bodies a fraction of a tile *behind* the alcove, inside the
// rock -- where canStand() refuses every direction and they are wedged there for good. Checked
// afterwards as well, because a spot that is somehow still solid should cost us a body's variety
// and not a body.
function mouthSpot(d, dw) {
    // Perpendicular to the way in, which is the axis the mouth is spread across.
    const px = dw.into.z, pz = dw.into.x;
    for (let tries = 0; tries < 6; tries++) {
        const off = (Math.random() - 0.5) * 1.7;
        const x = dw.spawn.x + px * off, z = dw.spawn.z + pz * off;
        if (canStand(d, x, z, 0.45)) return { x, z };
    }
    return { x: dw.spawn.x, z: dw.spawn.z };
}

// Is anything -- you, or one of them -- standing in this gateway or the alcove behind it?
// Generous on purpose: half a tile of margin around a body's own width, because the cost of
// holding a gate open a moment too long is nothing at all, and the cost of dropping it a moment
// too early is a wedged body and a fight that cannot be finished.
function occupied(dw, s) {
    const R = 0.85;
    const near = (x, z) => {
        for (const list of [dw.tiles, dw.alcove])
            for (const [tx, tz] of list)
                if (Math.abs(x - (tx + 0.5)) < R && Math.abs(z - (tz + 0.5)) < R) return true;
        return false;
    };
    if (near(s.player.x, s.player.z)) return true;
    return s.enemies.some(e => near(e.x, e.z));
}

// ---------- and the ways out ----------
// The room is done with you, so the ways out open. All of them, at once, and they stay open.
//
// They used to drop one at a time as you walked up to them, which was a nice piece of theatre and
// a bad piece of information: a gate that looks shut until you are stood under it is a gate you
// cannot plan around from across the room. Now there are exactly two states anywhere in the pit --
// a dark gate you cannot pass and a lit one you can -- and you can read both from anywhere.
export function openExits(d) {
    for (const i of d.exitGates) setDoor(d, d.doorways[i], true);
    G.sfx('gate');
}

function finish(d, a) {
    a.fighting = false;
    a.done = true;
    // Only the exits are touched. The spawn gates are left to the loop above, which shuts them
    // once whatever is standing in them has moved, including you.
    openExits(d);
    addScore(SCORE.room, 'room');
    crowdWave();
    G.onToast('Room clear', 'good');
    // Dropped in the middle of the room, where the fight was, rather than into corners you would
    // then have to walk back through.
    dropReward(d.arena, { powerup: 0.6, prize: ARENA.prizeChance, item: 0.45, coin: [14, 30] });
}

// ---------- a lair ----------
// A boss room has no waves and no director worth the name: the gates stay shut until the thing is
// dead, and then they open. Kept here rather than in the boss's own code because "when does the
// way on open" is a question about the room, and every room answers it in this file.
export function updateLair(d, dt) {
    const s = G.state;
    if (s.over || s.lairDone) return;
    if (s.enemies.some(e => e.boss)) return;
    s.lairDone = true;
    openExits(d);
}
