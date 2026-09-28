// ==================== THE TEST HARNESS ====================
// Nothing in the simulation imports three.js, so the whole game runs in node with no browser and
// no canvas. That is the entire reason these tests are worth having: they can step the world a
// frame at a time and look at every body on every frame, which is how a wave of enemies spawning
// at NaN -- invisible, harmless, and silent -- was eventually caught.
//
// Two rules learned the hard way, both from tests that lied:
//
//   Ask the game, not the walker. This harness walks in straight lines and the rooms are full of
//   solid furniture now. "Did it reach the crate" was testing the walker; "can a body stand where
//   the crate was" tests the game.
//
//   Kill things the way the game kills them. Emptying `state.enemies` is faster and skips the
//   entire death path, which is how bloats were reported as never bursting when they always did.

import { G, newRun, tick, attack, special, currentDungeon } from '../src/client/game.js';
import { canStand, setTile, FLOOR } from '../src/client/dungeon.js';
import { VIEW } from '../src/client/data.js';

export const fails = [];

// Every frame this harness steps is watched, whoever stepped it. A body that loses its
// coordinates is invisible, harmless and silent -- the only way that bug was ever going to be
// caught is by something counting on every frame rather than looking once at the end.
export const watch = { frames: 0, bodies: 0, lost: 0, reset() { this.frames = this.bodies = this.lost = 0; } };
function frame(dt, intent) {
    tick(dt, intent);
    watch.frames++;
    for (const e of G.state.enemies) {
        watch.bodies++;
        if (!Number.isFinite(e.x) || !Number.isFinite(e.z)) watch.lost++;
    }
}
export function check(name, ok, detail = '') {
    console.log(`${ok ? '  ok  ' : '  FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
}
export const section = (name) => console.log(`\n${name}`);

// The keys that walk you in a given direction on the floor. Movement is fixed to the screen, so a
// test that wants to go "toward +z" has to say which keys that is -- the same sum a player does
// without noticing.
export function steer(dx, dz) {
    const l = Math.hypot(dx, dz) || 1;
    return { fwd: (dx * VIEW.up.x + dz * VIEW.up.z) / l, strafe: (dx * VIEW.right.x + dz * VIEW.right.z) / l };
}
export const finite = (n) => Number.isFinite(n);

export function start(cls = 'knight', move = 'bash') {
    newRun(cls, { name: 'Test', look: {}, known: [move], slots: [move, null, null, null] });
    const p = G.state.player;
    return {
        p,
        // Steps the world, keeping the body alive: these tests are about mechanics, not survival.
        step(secs) {
            for (let i = 0; i < Math.round(secs / 0.05); i++) {
                p.hp = 9999;
                frame(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: p.x, z: p.z + 1 } });
            }
        },
        // Walks, and stops the moment the room changes -- otherwise it carries on in the next room
        // toward a target that belonged to the last one, and a market's gates are open on arrival.
        //
        // It also goes AROUND things. This walker used to march in a straight line, and a room
        // with solid furniture in it -- a crate on the way to a gate, a counter in a market --
        // would stop it dead and the test would report the game as stuck. Three separate false
        // failures came from that before it was worth fixing properly. A player walks round a
        // crate without thinking about it; so does this now.
        walkTo(x, z, secs) {
            const from = G.state.floor;
            let stalled = 0, side = 1, was = Math.hypot(x - p.x, z - p.z);
            for (let i = 0; i < Math.round(secs / 0.05); i++) {
                p.hp = 9999;
                const dx = x - p.x, dz = z - p.z, l = Math.hypot(dx, dz) || 1;
                let ax = dx / l, az = dz / l;
                // No progress for a third of a second means something is in the way: lean hard
                // across the line until there is progress again, then swap sides if that failed
                // too. It is not pathfinding, it is what a person does in a doorway.
                if (stalled > 6) {
                    ax = (dx / l) * 0.35 - (dz / l) * side;
                    az = (dz / l) * 0.35 + (dx / l) * side;
                    const n = Math.hypot(ax, az) || 1;
                    ax /= n; az /= n;
                    if (stalled > 22) { side = -side; stalled = 7; }
                }
                frame(0.05, { ...steer(ax, az), dash: false, aim: { x: p.x + ax, z: p.z + az } });
                if (G.state.floor !== from) return;
                const now = Math.hypot(x - p.x, z - p.z);
                if (was - now > 0.02) { stalled = 0; side = 1; } else stalled++;
                was = now;
            }
        },
        // Kills by swinging at it, so everything that happens on death actually happens. Works on
        // crates as well as bodies -- they take the same swings and they are not in the same list,
        // which is a distinction only this function should have to know about.
        slay(e, tries = 60) {
            const alive = () => G.state.enemies.includes(e) || G.state.crates.includes(e);
            for (let i = 0; i < tries && alive(); i++) {
                p.x = e.x - 1.0; p.z = e.z; p.cool = 0; p.hp = 9999;
                attack({ x: e.x, z: e.z });
                frame(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: e.x, z: e.z } });
            }
        },
        // Clears the room the way a player would, then takes a gate.
        clearRoom(limit = 40) {
            for (let i = 0; i < limit && G.state.arena && G.state.arena.fighting; i++) {
                this.step(1.0);
                for (const e of [...G.state.enemies]) this.slay(e, 14);
                if (G.state.enemies.length > 6) { for (const e of [...G.state.enemies]) e.hp = 0; G.state.enemies.length = 0; }
                this.step(0.2);
            }
        },
        killBoss(limit = 900) {
            const b = G.state.enemies.find(e => e.boss);
            if (!b) return;
            for (let i = 0; i < limit && G.state.enemies.some(e => e.boss); i++) {
                p.x = b.x - 1.3; p.z = b.z; p.cool = 0; p.hp = 9999;
                attack({ x: b.x, z: b.z });
                this.step(0.05);
            }
        },
        // Empties the room of scenery. The focused tests below are about one mechanic each, and a
        // crate rolled into the middle of them is not a finding, it is noise -- it blocks a walk,
        // or a body spawns on it, and the test reports the wrong thing.
        // Bare sand, and nothing burning. A biome lays its own water, oil, ice and snow, so any
        // check that puts down its own hazard -- or assumes there is none -- has to say so: a
        // blast that happens to go off on the room's own oil lights a fire, and the fire kills
        // whatever the check had standing there, which reads as the blast doing it.
        clearGround() {
            const d = currentDungeon();
            d.surface.fill(0);
            G.state.fires.length = 0;
        },
        // Everything a room scatters that a test is not about: crates, and the boulders a
        // quarry drops in. Both are cover, and cover between the walker and whatever it was
        // sent to do is a false failure -- it reports the game as broken when the shot was
        // simply stopped by a rock, which is the rock working.
        clearFurniture() {
            const d = currentDungeon();
            for (const c of G.state.crates) setTile(d, c.tile.x, c.tile.z, FLOOR);
            G.state.crates.length = 0;
            for (const k of d.rocks || []) setTile(d, k.tx, k.tz, FLOOR);
            if (d.rocks) d.rocks.length = 0;
        },
        // Walks out through a gate, and keeps trying from a different distance if it did not
        // work. A single attempt from a fixed spot was landing the body inside whatever the room
        // had scattered three tiles in front of the doorway -- and a caller that quietly does not
        // change rooms makes every later check test the wrong room without saying so.
        takeGate(secs = 6) {
            const d = currentDungeon();
            const from = G.state.floor;
            for (const back of [2, 3.5, 1.2]) {
                const g = d.doorways[d.exitGates[0]];
                const gx = g.tiles.reduce((n, t) => n + t[0] + 0.5, 0) / g.tiles.length;
                const gz = g.tiles.reduce((n, t) => n + t[1] + 0.5, 0) / g.tiles.length;
                const sx = gx + g.into.x * back, sz = gz + g.into.z * back;
                if (canStand(d, sx, sz, 0.3)) {
                    p.x = sx; p.z = sz;
                    this.walkTo(gx - g.into.x * 1.5, gz - g.into.z * 1.5, secs);
                    if (G.state.floor !== from) return true;
                }
            }
            return G.state.floor !== from;
        }
    };
}

// Somewhere clear to stand a given distance from a point. Teleporting to a fixed offset put the
// body inside a wall whenever the target happened to be near one -- and a body in rock does not
// move at all, which looks exactly like whatever bug the test was hunting.
export function clearSpotNear(d, x, z, r = 2.5) {
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
        const px = x + dx * r, pz = z + dz * r;
        if (canStand(d, px, pz, 0.35)) return { x: px, z: pz };
    }
    return { x, z };
}

export { G, newRun, tick, attack, special, currentDungeon };
