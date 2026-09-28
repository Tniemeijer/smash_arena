// ==================== THE ROOM ====================
// Every floor is one big room with gated alcoves cut into its walls, and nothing else. There are
// no corridors any more and nothing happens off screen: you can see the whole level from
// anywhere inside it, which is the entire reason this shape works. What differs between an arena,
// a lair and a market is what is standing in the room and which gates open when -- not the walls.
//
// The grid is the single source of truth for what is solid. The renderer builds its walls from
// it and the simulation collides against it, so the two can never disagree about where a wall is.
// A gate follows the same rule: an open gate is not a DOOR tile at all, it is written back to
// FLOOR, so the collision code never has to learn what a door is.

import { GRID, ARENA, STAGE_CYCLE, SURFACE, TERRAIN, BIOMES, BIOME_ORDER, BIOME_FROM } from './data.js';

// There is no staircase tile any more. A gate IS the way to the next room: walk through an open
// one and you are in the next bout. A ladder in the corner of an arena was always a lie about
// what this place is -- nobody is climbing out of here, they are opening a door for you.
// PROP is solid and is NOT stone. It exists because "you cannot walk here" and "draw a wall
// here" turned out to be two different statements: marking a brazier's tile as WALL stopped the
// player walking into it and also built a block of masonry around it, with the fire burning
// inside. Anything standing on a PROP tile is drawn by whoever put it there.
export const WALL = 0, FLOOR = 1, DOOR = 3, PROP = 4;

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const shuffled = (list) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
};

// What kind of room this one is. The cycle is data; this is the only line that reads it.
export const stageFor = (floor) => STAGE_CYCLE[(floor - 1) % STAGE_CYCLE.length];

// The one door everything else goes through. Which generator ran is recorded on the dungeon as
// `stage`, because the director only has business on one of the three and the renderer dresses
// each of them differently.
export function generateFloor(floor) {
    const stage = stageFor(floor);
    const d = stage === 'boss' ? generateBoss(floor)
            : stage === 'shop' ? generateShop(floor)
            : generateArena(floor);
    d.stage = stage;
    return d;
}

// ---------- the room, and its gates ----------
// Four alcoves, one in the middle of each wall, each with a portcullis at its mouth. Things spawn
// at the back of an alcove and walk in when the gate lifts, which is what makes a wave arrive
// from somewhere rather than simply appear -- and an alcove marked as a way out has a stair at
// the back of it instead.
//
// `exits` says how many of the four are ways on. They are chosen here, at generation, so the
// marks above them can be seen and thought about during the fight rather than sprung at the end.
function bigRoom(floor, o) {
    const tiles = new Uint8Array(GRID * GRID);
    const set = (x, z, v) => { if (x >= 0 && z >= 0 && x < GRID && z < GRID) tiles[z * GRID + x] = v; };
    const { w, h } = o;
    const { mouth, depth } = ARENA;
    // Clamped, and defaulted, because a missing tunable here does not fail loudly: it multiplies
    // into a position, and a body at NaN is drawn nowhere, hit by nothing and impossible to see.
    // That is the worst shape a bug can have, so the arithmetic refuses to produce one.
    const spawnDepth = Math.min(depth, ARENA.spawnDepth ?? 2);
    const x0 = Math.floor((GRID - w) / 2), z0 = Math.floor((GRID - h) / 2);
    for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++) set(x, z, FLOOR);

    const cx = x0 + Math.floor(w / 2), cz = z0 + Math.floor(h / 2);
    const half = Math.floor(mouth / 2);
    const doorways = [];

    // `out` is the direction away from the room. The gate sits in the wall itself; the alcove is
    // the rock behind it, carved out and stood in by whatever is about to arrive.
    const carve = (side, out) => {
        const gateTiles = [], alcove = [];
        for (let k = -half; k <= half; k++) {
            const ax = out.x ? 0 : k, az = out.x ? k : 0;
            const gx = (out.x ? (out.x > 0 ? x0 + w : x0 - 1) : cx) + ax;
            const gz = (out.z ? (out.z > 0 ? z0 + h : z0 - 1) : cz) + az;
            gateTiles.push([gx, gz]);
            for (let dpt = 1; dpt <= depth; dpt++) {
                const fx = gx + out.x * dpt, fz = gz + out.z * dpt;
                set(fx, fz, FLOOR);
                alcove.push([fx, fz]);
            }
        }
        for (const [x, z] of gateTiles) set(x, z, DOOR);
        // Where a body waits before it walks out: a little way down the passage, not at the far
        // end of it. The passage is long for the look of it and nothing should have to march the
        // length of it to reach the fight.
        const gx0 = out.x ? (out.x > 0 ? x0 + w : x0 - 1) : cx;
        const gz0 = out.z ? (out.z > 0 ? z0 + h : z0 - 1) : cz;
        const back = { x: gx0 + out.x * spawnDepth + 0.5, z: gz0 + out.z * spawnDepth + 0.5 };
        doorways.push({ i: doorways.length, side, open: false, role: 'spawn',
                        tiles: gateTiles, alcove, spawn: back, into: { x: -out.x, z: -out.z } });
    };
    carve('north', { x: 0, z: -1 });
    carve('east',  { x: 1, z: 0 });
    carve('south', { x: 0, z: 1 });
    carve('west',  { x: -1, z: 0 });

    // Which of them are ways on. The south gate is the one you came in by, so it is never the way
    // forward -- walking back out the way you came would be the one move with nothing behind it.
    // They are otherwise identical: no marks, no promises, nothing to choose between.
    const candidates = shuffled(doorways.filter(dw => dw.side !== 'south'));
    const wanted = Math.max(1, Math.min(candidates.length, o.exits ?? 1));

    const exits = [];
    candidates.slice(0, wanted).forEach((dw) => {
        dw.role = 'exit';
        // Shut until the room is finished with you, and then simply open. `through` is a tile in
        // the passage beyond -- standing there means you have gone through, and the next room
        // begins.
        dw.through = { x: Math.round(dw.spawn.x - 0.5), z: Math.round(dw.spawn.z - 0.5) };
        exits.push(dw.i);
    });

    // Braziers in the four corners, and they are solid. They are the only thing standing on the
    // sand besides you, and walking through one was the single clearest way this room said "none
    // of this is really here" -- so each one takes its tile, becomes cover, and enemies have to
    // come round it too.
    const braziers = [];
    for (const [fx, fz] of [[0.14, 0.14], [0.86, 0.14], [0.14, 0.86], [0.86, 0.86]]) {
        const bx = Math.floor(x0 + w * fx), bz = Math.floor(z0 + h * fz);
        set(bx, bz, PROP);
        braziers.push({ x: bx + 0.5, z: bz + 0.5 });
    }

    const room = { x: x0, z: z0, w, h, cx, cz, mx: cx + 0.5, mz: cz + 0.5 };
    // What is lying ON the tiles, as opposed to what they are. Kept beside the grid rather than
    // encoded into it, because a tile can be both walkable and on fire.
    const surface = new Uint8Array(GRID * GRID);
    return {
        tiles, surface, rooms: [room], arena: room, doorways, braziers, floor,
        // You always start at the southern end, looking up the room.
        start: { x: cx - 1, z: z0 + h - 4, w: 3, h: 3 },
        // Kept for anything that still wants a single "the way on", though the point of this
        // shape is that there is usually more than one.
        exitAt: doorways[exits[0]].through,
        spawnGates: doorways.filter(dw => dw.role === 'spawn').map(dw => dw.i),
        exitGates: exits
    };
}

// ---------- an arena ----------
export function generateArena(floor) {
    const d = bigRoom(floor, { w: ARENA.w, h: ARENA.h, exits: rnd(...ARENA.exits) });
    dress(d, floor, pickBiome(floor));
    return d;
}

// Which place this room is. The first couple are always the Sands: the opening rooms of a run
// have to teach the plain version of the game before it starts putting ice under your feet. After
// that it is any of them but the one you just left -- two Cisterns in a row reads as the game
// having run out of rooms rather than as a place you have been taken to.
let lastBiome = null;
export function pickBiome(floor) {
    if (floor < BIOME_FROM) return (lastBiome = 'sands');
    const pool = BIOME_ORDER.filter(k => k !== lastBiome);
    return (lastBiome = pool[Math.floor(Math.random() * pool.length)]);
}

// Everything that makes a room the place it is rather than a grey box: what is underfoot, and
// what is standing on it. Kept together because they have to agree -- a boulder dropped into a
// pool after the pool was laid is a rock in a puddle, which is fine, but a pool laid over a
// boulder is water the boulder is standing in the middle of and nobody can reach.
function dress(d, floor, key, o = {}) {
    d.biome = key;
    d.rocks = [];
    const b = BIOMES[key] || BIOMES.sands;
    if (o.rocks !== false) rocks(d, b);
    if (o.spill !== false) spill(d, floor, b);
}

// ---------- what got spilled in here ----------
// Water and oil, laid over the floor of an arena. Never in every room: a hazard you meet every
// time stops being a thing you notice and becomes a thing you route around without thinking, and
// the whole value of these is that you have to look at the floor when you walk in.
//
// Both keep well clear of where you arrive. Being dropped into a pool, or onto a slick, before
// you have seen the room would be the game making the decision for you.
function spill(d, floor, b) {
    const r = d.arena;
    const safe = { x: r.mx, z: r.z + r.h - 2.5 };
    const clear = (x, z, pad) => Math.hypot(x - safe.x, z - safe.z) > pad
        && x > r.x + 0.5 && x < r.x + r.w - 1.5 && z > r.z + 0.5 && z < r.z + r.h - 1.5;
    const at = (x, z) => d.surface[Math.floor(z) * GRID + Math.floor(x)];

    // A ragged blob of something. Water, a drift of snow and a sheet of ice are the same shape
    // with a different name on it, so they are the same code -- `over` says what it is allowed to
    // cover, which is the only way they differ: ice will take a pool and freeze it, snow will not.
    const patch = (kind, count, size, over) => {
        let laid = 0;
        for (let i = 0, n = rnd(...count); i < n; i++) {
            const rad = size[0] + Math.random() * (size[1] - size[0]);
            let cx = 0, cz = 0, tries = 0;
            do { cx = r.x + 2 + Math.random() * (r.w - 4); cz = r.z + 2 + Math.random() * (r.h - 4); }
            while (!clear(cx, cz, 6.5) && tries++ < 30);
            for (let z = Math.floor(cz - rad); z <= cz + rad; z++)
                for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
                    // A ragged edge rather than a circle: a puddle is not a compass drawing.
                    const dd = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) + (Math.random() - 0.5) * 0.9;
                    if (dd < rad && tileAt(d, x, z) === FLOOR && clear(x, z, 4.5) && over.includes(at(x, z))) {
                        d.surface[z * GRID + x] = kind;
                        laid++;
                    }
                }
        }
        return laid;
    };

    // Rolls for a hazard, and then insists. A biome whose chance is 1 is a biome NAMED for the
    // thing -- the Cistern's water, the Pitch's oil -- and a placement pass can legitimately find
    // nowhere to put it and lay nothing. A room that promises a hazard and then has none is worse
    // than a plain room, so those get another go rather than a shrug.
    const lay = (chance, place) => {
        if (Math.random() >= chance) return;
        for (let tries = 0; tries < 8; tries++) if (place() > 0 || chance < 1) return;
    };

    lay(b.pools, () => patch(SURFACE.water, b.poolCount || TERRAIN.pools,
                             b.poolSize || TERRAIN.poolSize, [SURFACE.sand]));
    // Ice goes down after the water and is allowed to take it: a frozen pool is the same pool.
    lay(b.sheets, () => patch(SURFACE.ice, b.sheetCount || [2, 3],
                              b.sheetSize || [2.6, 4.4], [SURFACE.sand, SURFACE.water]));
    lay(b.drifts, () => patch(SURFACE.snow, b.driftCount || [2, 4],
                              b.driftSize || [2.4, 4.0], [SURFACE.sand]));

    lay(b.slicks, () => {
        let total = 0;
        for (let i = 0, n = rnd(...(b.slickCount || TERRAIN.slicks)); i < n; i++) {
            let laid = 0;
            // Tried a few times: a trail that wanders out of the room lays nothing, and a hazard
            // that silently fails to appear in most rooms is a hazard nobody ever learns.
            for (let attempt = 0; attempt < 6 && laid < 4; attempt++) {
                let x = r.mx + (Math.random() - 0.5) * (r.w - 7);
                let z = r.mz + (Math.random() - 0.5) * (r.h - 7);
                // Aimed roughly across the room rather than at random, so a slick reads as a
                // line you can be on one side of.
                let a = Math.random() * Math.PI * 2;
                const len = rnd(...(b.slickLength || TERRAIN.slickLength));
                for (let k = 0; k < len; k++) {
                    a += (Math.random() - 0.5) * 0.5;        // it ran where the floor sloped
                    x += Math.sin(a); z += Math.cos(a);
                    // Turned back at the walls instead of running off into them.
                    if (x < r.x + 1.5 || x > r.x + r.w - 1.5) { a = -a; x = Math.max(r.x + 1.5, Math.min(r.x + r.w - 1.5, x)); }
                    if (z < r.z + 1.5 || z > r.z + r.h - 1.5) { a = Math.PI - a; z = Math.max(r.z + 1.5, Math.min(r.z + r.h - 1.5, z)); }
                    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1]]) {
                        const tx = Math.floor(x) + dx, tz = Math.floor(z) + dz;
                        if ((dx || dz) && Math.random() < 0.55) continue;
                        const key = tz * GRID + tx;
                        // Only ever on bare floor. Oil on ice, or on a drift, is a hazard nobody
                        // can read -- and oil that floats on a pool would burn the water.
                        if (tileAt(d, tx, tz) === FLOOR && d.surface[key] === SURFACE.sand && clear(tx, tz, 4.5)) {
                            d.surface[key] = SURFACE.oil;
                            laid++; total++;
                        }
                    }
                }
            }
        }
        return total;
    });
}

// ---------- what fell in here ----------
// Boulders. They are cover, and they are the only thing in this game that is purely in the way:
// no damage, nothing inside them, nothing to break. A room whose only obstacles are the four
// braziers in the corners is a room where every fight happens in the same open middle, and the
// Quarry exists to ask a different question -- where do you stand when the room has shape.
function rocks(d, b) {
    d.rocks = [];
    if (!b.rocks) return;
    const r = d.arena;
    const gates = d.doorways.flatMap(dw => [...dw.tiles, ...dw.alcove]);
    for (let i = 0, n = rnd(...b.rocks); i < n; i++) {
        for (let tries = 0; tries < 40; tries++) {
            const x = r.x + 2 + Math.floor(Math.random() * (r.w - 4));
            const z = r.z + 2 + Math.floor(Math.random() * (r.h - 4));
            if (tileAt(d, x, z) !== FLOOR) continue;
            // Not where you arrive, not in a gateway, and not in the lane in front of one --
            // a boulder in a doorway is a wave that cannot get out of its own alcove.
            if (Math.hypot(x - r.mx, z - (r.z + r.h - 2.5)) < 5) continue;
            if (gates.some(([gx, gz]) => Math.abs(gx - x) <= 1 && Math.abs(gz - z) <= 2)) continue;
            if (gates.some(([gx, gz]) => Math.abs(gz - z) <= 1 && Math.abs(gx - x) <= 2)) continue;
            // And never shoulder to shoulder with another: two rocks touching make a wall with a
            // dead end behind it.
            if (d.rocks.some(k => Math.abs(k.tx - x) <= 1 && Math.abs(k.tz - z) <= 1)) continue;
            d.tiles[z * GRID + x] = PROP;
            d.rocks.push({ x: x + 0.5, z: z + 0.5, tx: x, tz: z, seed: Math.random() });
            break;
        }
    }
}

// ---------- a lair ----------
// The same room with four pillars in it. They are the only design here: without something to
// break line of sight, a boss that throws things is a boss you beat by walking backwards.
export function generateBoss(floor) {
    const d = bigRoom(floor, { w: ARENA.bossW, h: ARENA.bossH, exits: 1 });
    const r = d.arena;
    for (const [px, pz] of [[0.24, 0.28], [0.76, 0.28], [0.24, 0.72], [0.76, 0.72]]) {
        const cx = r.x + Math.round(r.w * px), cz = r.z + Math.round(r.h * pz);
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) d.tiles[(cz + dz) * GRID + cx + dx] = WALL;
    }
    // A lair is somewhere too, and it gets the floor and the spills that go with it -- but no
    // boulders. It already has four pillars, and the thing in here with you is the size of two
    // of them: more cover would be a fight spent losing sight of it.
    dress(d, floor, pickBiome(floor), { rocks: false });
    // It is waiting at the far end, between you and the way on.
    d.bossAt = { x: r.mx, z: r.z + 3.5 };
    return d;
}

// ---------- a market ----------
// No waves and no gates to hold shut: the only room in the game where nothing is trying to kill
// you. The stalls are placed here rather than in the renderer because the simulation has to know
// where you are allowed to stand and which counter you are close enough to trade at.
export function generateShop(floor) {
    const d = bigRoom(floor, { w: ARENA.shopW, h: ARENA.shopH, exits: 2 });
    const r = d.arena;
    // The one room that is always the same place. Nothing is spilled here and nothing has fallen
    // in: the market is the game's only flat floor, and it should look like somewhere they sweep.
    dress(d, floor, 'sands', { rocks: false, spill: false });
    // Counters down the sides, not across the middle. They are solid, and a row of them through
    // the centre of the room put a table between the door you come in by and the gate you leave
    // by -- passable, but only by walking round something for no reason. Against the walls they
    // are somewhere you go to, and the middle of the room stays a clear lane. Each is also offset
    // from the gate on its own wall, so no counter is ever standing in a doorway.
    d.stalls = [
        { kind: 'upgrade', x: r.mx - 6.5, z: r.mz - 2.5, w: 1, h: 3 },
        { kind: 'move',    x: r.mx - 6.5, z: r.mz + 2.5, w: 1, h: 3 },
        { kind: 'power',   x: r.mx + 6.5, z: r.mz - 2.5, w: 1, h: 3 }
    ];
    // Behind a counter and out of every doorway. The trader is a body now, and a body was standing
    // squarely on the line between the middle of the room and the west gate -- which nobody
    // noticed while you could walk through them.
    d.keeper = { x: r.mx - 8.2, z: r.mz - 2.5 };
    d.tiles[Math.floor(d.keeper.z) * GRID + Math.floor(d.keeper.x)] = PROP;
    // The counters are solid. Walking through a table to get at the far side of it made the whole
    // room read as scenery; having to come round the front makes it a place.
    for (const st of d.stalls) {
        const x0 = Math.round(st.x - st.w / 2), z0 = Math.round(st.z - st.h / 2);
        for (let z = z0; z < z0 + st.h; z++)
            for (let x = x0; x < x0 + st.w; x++) d.tiles[z * GRID + x] = PROP;
        // Where you stand to be served: the side of the counter that faces the room.
        st.front = st.w < st.h ? { x: st.x + (r.mx > st.x ? 1.4 : -1.4), z: st.z }
                               : { x: st.x, z: st.z + 1.4 };
    }
    return d;
}

// ---------- reading it ----------
export function tileAt(d, x, z) {
    // Written as `!(x >= 0)` rather than `x < 0` so that NaN lands here too. Anything that has
    // lost its coordinates reads as solid rock, which makes canStand() refuse it -- the
    // alternative is that NaN passes every comparison, is judged perfectly walkable, and a body
    // quietly exists nowhere.
    if (!(x >= 0) || !(z >= 0) || x >= GRID || z >= GRID) return WALL;
    return d.tiles[z * GRID + x];
}
export const isSolid = (d, x, z) => {
    const t = tileAt(d, x, z);
    return t === WALL || t === DOOR || t === PROP;
};

// Is this point inside the alcove behind a particular gate -- that is, has somebody gone through?
export function inAlcove(dw, x, z) {
    for (const [tx, tz] of dw.alcove)
        if (x >= tx && x < tx + 1 && z >= tz && z < tz + 1) return true;
    return false;
}

// Writing a single tile. Exists so that anything which appears or disappears during a fight -- a
// crate, so far -- can take a tile and give it back, without reaching into the array itself.
export function setTile(d, x, z, v) {
    if (!d || x < 0 || z < 0 || x >= GRID || z >= GRID) return;
    d.tiles[z * GRID + x] = v;
}

// ---------- the surface ----------
export const surfaceAt = (d, x, z) => {
    if (!d || !d.surface || !(x >= 0) || !(z >= 0) || x >= GRID || z >= GRID) return SURFACE.sand;
    return d.surface[Math.floor(z) * GRID + Math.floor(x)];
};
export function setSurface(d, x, z, v) {
    if (!d || !d.surface || !(x >= 0) || !(z >= 0) || x >= GRID || z >= GRID) return;
    const key = Math.floor(z) * GRID + Math.floor(x);
    if (d.surface[key] === v) return;
    d.surface[key] = v;
    // Told to whoever draws the floor, which repaints exactly these tiles and nothing else. A Set,
    // so a tile that changes three times between frames is repainted once, and so a simulation
    // running with nobody drawing it cannot grow this past the size of the room.
    (d.dirty || (d.dirty = new Set())).add(key);
}

// ---------- doors ----------
// Opening writes FLOOR and shutting writes DOOR, so the grid never disagrees with itself about
// what is solid. The doorway keeps its own tile list, which is the only record that those floor
// tiles were ever a door.
export function setDoor(d, dw, open) {
    if (!dw || dw.open === open) return false;
    dw.open = open;
    for (const [x, z] of dw.tiles) d.tiles[z * GRID + x] = open ? FLOOR : DOOR;
    return true;
}


// World coordinates put tile (0,0) at the corner and centre each tile on its own square, which is
// what lets everything else treat a position as "which tile am I standing on" by flooring it.
export const tileToWorld = (x, z) => ({ x: x + 0.5, z: z + 0.5 });
export const worldToTile = (wx, wz) => ({ x: Math.floor(wx), z: Math.floor(wz) });

// Can a body of this radius stand centred here? Checked against the four tiles its circle can
// overlap rather than just the one under its centre, or you can stand half inside a wall.
export function canStand(d, wx, wz, radius) {
    for (const [dx, dz] of [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]]) {
        const t = worldToTile(wx + dx, wz + dz);
        if (isSolid(d, t.x, t.z)) return false;
    }
    return true;
}

// Move as far as you can, sliding along whatever you hit instead of stopping dead against it.
// Axis-at-a-time is the cheapest way to get that and is what keeps running into a corridor wall
// feeling like a graze rather than a full stop.
export function moveWithSlide(d, body, dx, dz, radius) {
    if (dx !== 0 && canStand(d, body.x + dx, body.z, radius)) body.x += dx;
    if (dz !== 0 && canStand(d, body.x, body.z + dz, radius)) body.z += dz;
}

// ---------- getting out of a wall ----------
// Nothing should ever be inside the rock, and bodies occasionally are anyway -- a spawn rolled a
// hair too far, a knock landed oddly, a gate came down. It matters more than it sounds: a body
// wedged in a wall is one canStand() refuses to move in any direction, which for one of them is
// a wave that can never end and for you is the run over.
//
// Centre-of-body inside a solid tile is the test. A tight corner fails a radius check all the
// time and is not stuck. Once it is true the body is moved WITHOUT a collision check, because the
// collision check is precisely what is holding it there.
const UNSTICK_SPEED = 4;
export function unstick(d, body, dt, radius = 0.4) {
    const t = worldToTile(body.x, body.z);
    if (!isSolid(d, t.x, t.z)) return false;
    let best = null, bestD = Infinity;
    for (let r = 1; r <= 5 && !best; r++) {
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const x = t.x + dx, z = t.z + dz;
            if (isSolid(d, x, z) || !canStand(d, x + 0.5, z + 0.5, radius)) continue;
            const dd = (x + 0.5 - body.x) ** 2 + (z + 0.5 - body.z) ** 2;
            if (dd < bestD) { bestD = dd; best = { x: x + 0.5, z: z + 0.5 }; }
        }
    }
    if (!best) return false;
    const dx = best.x - body.x, dz = best.z - body.z, len = Math.hypot(dx, dz) || 1;
    body.x += dx / len * UNSTICK_SPEED * dt;
    body.z += dz / len * UNSTICK_SPEED * dt;
    return true;
}

// Somewhere in this room that isn't a wall, for dropping an enemy or the player.
export function spotIn(room) {
    return { x: room.x + 0.5 + Math.random() * (room.w - 1), z: room.z + 0.5 + Math.random() * (room.h - 1) };
}

// Is there clear line of sight between two points? Stepped along the line and tested against the
// grid. Used so enemies in the next room don't start walking at you through a wall.
export function lineOfSight(d, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const steps = Math.ceil(Math.hypot(dx, dz) * 3);
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const p = worldToTile(ax + dx * t, az + dz * t);
        if (isSolid(d, p.x, p.z)) return false;
    }
    return true;
}
