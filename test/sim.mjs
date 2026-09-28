// ==================== REGRESSION SUITE ====================
// Run with `npm test`. Every check here exists because something was once wrong: the notes say
// which, because a check whose purpose is forgotten is a check somebody deletes.

import { G, check, fails, section, start, clearSpotNear, watch, steer,
         currentDungeon, attack, special, tick } from './harness.mjs';
import { isSolid, tileAt, canStand, setTile, surfaceAt, setSurface, WALL, PROP, FLOOR } from '../src/client/dungeon.js';
import { spawnAt, pickKind } from '../src/client/systems/enemies.js';
import { hurtEnemy, hostileShot } from '../src/client/systems/combat.js';
import { maxHp } from '../src/client/core.js';
import { PICKUP, CROWD, SURFACE, BIOMES, BIOME_FROM, ENEMIES, TERRAIN, VIEW } from '../src/client/data.js';
import { igniteAt } from '../src/client/systems/terrain.js';
import { generateFloor, isSolid as solidAt } from '../src/client/dungeon.js';
import { openExits } from '../src/client/systems/arena.js';
import { crowdMood } from '../src/client/systems/crowd.js';

// ---------------------------------------------------------------- the room
section('The room');
{
    const t = start();
    const d = currentDungeon();
    check('a room is one big arena', d.stage === 'arena' && !!d.arena);
    check('with four gateways', d.doorways.length === 4);
    check('and one to three ways out', d.exitGates.length >= 1 && d.exitGates.length <= 3,
          `${d.exitGates.length}`);
    check('none of them marked', d.doorways.every(dw => dw.boon === undefined));
    check('the exits start shut', d.exitGates.every(i => !d.doorways[i].open));
    check('and shut means solid',
          d.exitGates.every(i => d.doorways[i].tiles.every(([x, z]) => isSolid(d, x, z))));
}

// ---------------------------------------------------------- solid, and stone
// Two separate bugs came from conflating "you cannot walk here" with "draw stone here": the
// renderer built a block around every brazier, and later the wall fade conjured a transparent
// ghost of a block that was never there. The census pins the whole set down.
section('What is solid');
{
    const t = start();
    const d = currentDungeon();
    const solidNotStone = [];
    for (let z = 0; z < 44; z++) for (let x = 0; x < 44; x++)
        if (isSolid(d, x, z) && tileAt(d, x, z) !== WALL) solidNotStone.push([x, z, tileAt(d, x, z)]);
    const gateTiles = d.doorways.reduce((n, dw) => n + dw.tiles.length, 0);
    check('solid-but-not-stone is only gates, braziers, rocks and crates',
          solidNotStone.length === gateTiles + d.braziers.length + d.rocks.length + G.state.crates.length,
          `${solidNotStone.length} = ${gateTiles} gate + ${d.braziers.length} brazier + ` +
          `${d.rocks.length} rock + ${G.state.crates.length} crate`);
    check('and none of it is a wall tile', solidNotStone.every(([, , v]) => v !== WALL));

    const b = d.braziers[0];
    check('a brazier holds its tile', tileAt(d, Math.floor(b.x), Math.floor(b.z)) === PROP);
    const from = clearSpotNear(d, b.x, b.z, 3);
    t.p.x = from.x; t.p.z = from.z;
    t.walkTo(b.x, b.z, 4);
    check('and you cannot walk through it', Math.hypot(t.p.x - b.x, t.p.z - b.z) > 0.7,
          `stopped ${Math.hypot(t.p.x - b.x, t.p.z - b.z).toFixed(2)} away`);
    check('no brazier stands in a gateway',
          d.braziers.every(br => d.doorways.every(dw =>
              dw.tiles.every(([x, z]) => !(x === Math.floor(br.x) && z === Math.floor(br.z))))));
}

// ------------------------------------------------------------------- crates
section('Crates');
{
    const t = start();
    const d = currentDungeon();
    check('a room has crates', G.state.crates.length > 0, `${G.state.crates.length}`);
    const c = G.state.crates[0];
    check('a crate holds its tile', tileAt(d, c.tile.x, c.tile.z) === PROP);
    check('no crate sits on another',
          new Set(G.state.crates.map(x => `${x.tile.x},${x.tile.z}`)).size === G.state.crates.length);
    const from = clearSpotNear(d, c.x, c.z, 3);
    t.p.x = from.x; t.p.z = from.z;
    t.walkTo(c.x, c.z, 4);
    // Measured in tiles, not in distance. A crate is placed anywhere within its tile, so it can
    // sit close to an edge -- and then a body standing legitimately outside the tile is nearer to
    // the crate's centre than any fixed distance would allow for.
    check('and stops you', Math.floor(t.p.x) !== c.tile.x || Math.floor(t.p.z) !== c.tile.z,
          `player on ${Math.floor(t.p.x)},${Math.floor(t.p.z)} vs crate ${c.tile.x},${c.tile.z}`);
    const tiles = G.state.crates.map(x => ({ ...x.tile }));
    for (const cr of [...G.state.crates]) t.slay(cr);
    check('breaking them gives every tile back',
          tiles.every(x => tileAt(d, x.x, x.z) === FLOOR), `${tiles.length} crates`);
    check('so a body fits where one stood', canStand(d, c.x, c.z, 0.3));
    check('and they left something behind', G.state.pickups.length > 0 || G.state.coins > 0);
}

// ------------------------------------------------ hitting what you aim at
// Crates were destructible from the sides and not from the diagonals, which is a miserable bug to
// meet and an easy one to miss: everything worked, from most angles. Two causes, both worth a
// standing check -- the body sat anywhere inside the tile it made solid, and a shot stopped by
// that tile was never told what had stopped it.
section('Crates take a hit from anywhere');
{
    for (const [cls, move, reach] of [['knight', 'bash', 1.6], ['bard', 'riff', 1.6],
                                      ['archer', 'volley', 5], ['druid', 'swarm', 5]]) {
        const t = start(cls, move);
        if (G.state.arena) G.state.arena.grace = 999;
        G.state.enemies.length = 0;
        t.clearFurniture();
        const d = currentDungeon();
        const tx = Math.floor(d.arena.mx), tz = Math.floor(d.arena.mz);
        const crate = { id: 9001, x: tx + 0.5, z: tz + 0.5, hp: 999, maxHp: 999, size: 0.5,
                        flash: 0, crate: true, tile: { x: tx, z: tz } };
        G.state.crates.push(crate);
        setTile(d, tx, tz, PROP);
        const missed = [];
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            t.p.x = crate.x + Math.sin(a) * reach;
            t.p.z = crate.z + Math.cos(a) * reach;
            crate.hp = 999;
            G.state.shots.length = 0;
            t.p.cool = 0;
            t.p.swingAlt = i % 2 ? 'slash' : 'stab';        // both swings of an alternating sword
            attack({ x: crate.x, z: crate.z });
            for (let k = 0; k < 40 && G.state.shots.length; k++)
                tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: crate.x, z: crate.z } });
            if (crate.hp >= 999) missed.push(`${Math.round(a * 57.3)}°`);
        }
        check(`a ${cls} can break one from any angle`, missed.length === 0, missed.join(' '));
    }
}

// A bolt travels most of a tile per frame and a rat is smaller than that, so testing only where a
// shot ENDED let it pass clean through bodies. The path is swept now.
section('Shots do not pass through things');
{
    const t = start('archer', 'volley');
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0;
    t.clearFurniture();
    let through = 0;
    for (let i = 0; i < 12; i++) {
        G.state.enemies.length = 0;
        G.state.shots.length = 0;
        // Placed at a deliberately awkward distance: between two frames' worth of travel.
        const e = spawnAt('rat', { x: t.p.x + 3.1 + i * 0.07, z: t.p.z, awake: false }, 1);
        e.hp = 9999;
        G.state.enemies.push(e);
        t.p.cool = 0;
        attack({ x: e.x, z: e.z });
        const before = e.hp;
        for (let k = 0; k < 30 && G.state.shots.length; k++)
            tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: e.x, z: e.z } });
        if (e.hp >= before) through++;
    }
    check('an arrow never passes through a body', through === 0, `${through} of 12 went through`);
}

// -------------------------------------------------------------- the gateway
section('Gates');
{
    const t = start();
    const d = currentDungeon();
    t.clearRoom();
    check('clearing the room opens every exit at once',
          d.exitGates.every(i => d.doorways[i].open), `${d.exitGates.length} gates`);
    check('and open means walkable',
          d.exitGates.every(i => d.doorways[i].tiles.every(([x, z]) => !isSolid(d, x, z))));
    t.takeGate();
    check('walking through one takes it', G.state.floor === 2, `room ${G.state.floor}`);
}

// ------------------------------------------------------------ a whole run
section('A run');
{
    const t = start();
    const trail = [];
    watch.reset();
    for (let room = 1; room <= 9; room++) {
        const d = currentDungeon();
        if (G.state.arena) t.clearRoom();
        else if (d.stage === 'boss') t.killBoss();
        t.takeGate();
        trail.push(d.stage);
        if (G.state.floor !== room + 1) {
            const d2 = currentDungeon(), g2 = d2.doorways[d2.exitGates[0]];
            trail.push(`STUCK(${d2.stage} gate=${g2.open ? 'open' : 'shut'}` +
                       ` at=${t.p.x.toFixed(1)},${t.p.z.toFixed(1)}` +
                       ` left=${G.state.enemies.length}` +
                       ` boss=${G.state.enemies.some(e => e.boss)}` +
                       ` fighting=${G.state.arena ? G.state.arena.fighting : '-'}` +
                       ` over=${!!G.state.over} inRock=${isSolid(d2, Math.floor(t.p.x), Math.floor(t.p.z))}` +
                       ` hitStop=${(G.state.hitStop || 0).toFixed(2)})`);
            break;
        }
    }
    check('nine rooms in a row', trail.length === 9 && !trail.includes('STUCK'), trail.join(' '));
    check('arenas, a boss every fourth and a market every fifth',
          trail[3] === 'boss' && trail[4] === 'shop', trail.slice(0, 5).join(' '));
    check('no body ever lost its coordinates', watch.lost === 0 && watch.bodies > 500,
          `${watch.bodies} body-frames over ${watch.frames} frames`);
}

// ------------------------------------------------------------- the market
section('The market');
{
    const t = start();
    for (let i = 0; i < 12 && currentDungeon().stage !== 'shop'; i++) {
        if (G.state.arena) t.clearRoom();
        else if (currentDungeon().stage === 'boss') t.killBoss();
        t.takeGate();
    }
    const d = currentDungeon();
    check('a market turns up', d.stage === 'shop', d.stage);
    if (d.stage === 'shop') {
        check('with three counters', d.stalls.length === 3);
        check('all of them solid',
              d.stalls.every(st => isSolid(d, Math.round(st.x - st.w / 2), Math.round(st.z - st.h / 2))));
        check('and a trader you cannot walk through',
              isSolid(d, Math.floor(d.keeper.x), Math.floor(d.keeper.z)));
        // The trader used to stand squarely on the way out of the west gate, which nobody noticed
        // while you could walk through them.
        const blocked = [];
        for (const i of d.exitGates) {
            const dw = d.doorways[i];
            const mx = dw.tiles.reduce((n, x) => n + x[0] + 0.5, 0) / dw.tiles.length;
            const mz = dw.tiles.reduce((n, x) => n + x[1] + 0.5, 0) / dw.tiles.length;
            for (let k = 1; k <= 6; k++)
                if (isSolid(d, Math.floor(mx + dw.into.x * k), Math.floor(mz + dw.into.z * k)))
                    blocked.push(`${dw.side}@${k}`);
        }
        check('and nothing standing in a doorway', blocked.length === 0, blocked.join(' '));
    }
}

// ------------------------------------------------------------- how it fights
section('The fight');
{
    const t = start();
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0;
    t.clearFurniture();

    // The sword alternates, strictly, and the two swings are genuinely different shapes.
    const order = [];
    for (let i = 0; i < 6; i++) { t.p.cool = 0; attack({ x: t.p.x, z: t.p.z + 2 }); order.push(t.p.swingKind); t.step(1); }
    check('slash and thrust alternate',
          order.every((k, i) => i === 0 || k !== order[i - 1]) && order[0] === 'slash', order.join(','));

    const swingAt = (want, ex, ez) => {
        G.state.enemies.length = 0;
        const e = spawnAt('skeleton', { x: ex, z: ez, awake: true }, 1);
        e.hp = 9999;
        G.state.enemies.push(e);
        t.p.swingAlt = want === 'slash' ? 'stab' : 'slash';
        t.p.cool = 0;
        const before = e.hp;
        attack({ x: t.p.x, z: t.p.z + 2 });
        return e.hp < before;
    };
    t.p.x = 21; t.p.z = 21;
    check('the slash catches what the thrust misses',
          swingAt('slash', t.p.x + 1.35, t.p.z + 1.0) && !swingAt('stab', t.p.x + 1.35, t.p.z + 1.0));
    check('the thrust reaches what the slash cannot',
          swingAt('stab', t.p.x + 0.05, t.p.z + 2.55) && !swingAt('slash', t.p.x + 0.05, t.p.z + 2.55));

    G.state.enemies.length = 0;
    t.p.abilityCool = {}; t.p.cool = 0;
    special(0, { x: t.p.x, z: t.p.z + 2 });
    check('a shield bash animates as a bash', t.p.swingKind === 'bash', t.p.swingKind);
}

// ------------------------------------------------------- what walks in at you
section('Behaviour');
{
    const t = start();
    const seen = new Set();
    let winds = 0, rushes = 0, shots = 0, elites = 0, stops = 0, frames = 0;
    for (let room = 1; room <= 8; room++) {
        if (G.state.arena) {
            for (let i = 0; i < 40 && G.state.arena.fighting; i++) {
                for (let k = 0; k < 44; k++) {
                    t.p.hp = 9999; t.p.invuln = 0;
                    tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x, z: t.p.z + 1 } });
                    frames++;
                    if (G.state.hitStop > 0) stops++;
                    for (const e of G.state.enemies) {
                        seen.add(e.ai);
                        if (e.elite) elites++;
                        if (e.wind > 0) winds++;
                        if (e.rush > 0) rushes++;
                    }
                    shots = Math.max(shots, G.state.shots.filter(x => x.hostile).length);
                }
                for (const e of [...G.state.enemies]) t.slay(e, 12);
                if (G.state.enemies.length) { for (const e of [...G.state.enemies]) e.hp = 0; G.state.enemies.length = 0; }
            }
        } else if (currentDungeon().stage === 'boss') t.killBoss();
        t.takeGate();
    }
    // Asserted, because the bestiary widens with depth: a test that quietly never left room one
    // would see nothing but chasers and report that as the truth about the game.
    check('the fight got deep enough to judge', G.state.floor >= 7, `reached room ${G.state.floor}`);
    // Three, not four: a bloat only comes through in certain waves from room four, so a short run
    // can honestly miss one. What a bloat does is proved exhaustively in its own section below --
    // this check is about waves fielding a variety, not about the bestiary being complete.
    check('waves field a variety of behaviour', seen.size >= 3, [...seen].join('/'));
    check('elites appear', elites > 0);
    check('hit stop fires and never sticks', stops > 0 && stops < frames * 0.25,
          `${(100 * stops / frames).toFixed(1)}% of frames`);
}

// The two behaviours that are not the baseline, proved by spawning one of each rather than by
// waiting to see what the waves happen to field. They used to be checked off the playthrough
// above, and once each room drew its bestiary from a biome that became a coin toss: a run of
// cisterns and quarries is a legitimate run with no charger that ever finished a rush in it, and
// a check that fails on a legitimate run is telling you about the dice, not about the game.
section('Winding up, and shooting');
{
    const t = start();
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0;
    t.clearFurniture();
    const d = currentDungeon();
    const r = d.arena;
    t.p.x = r.mx; t.p.z = r.mz;

    const hound = spawnAt('hound', { x: r.mx, z: r.mz - 5, awake: true }, 4);
    G.state.enemies.push(hound);
    let wound = false, rushed = false;
    for (let i = 0; i < 200; i++) {
        t.p.hp = 9999; t.p.invuln = 99;                 // it is being watched, not fought
        hound.hp = hound.maxHp;
        tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x, z: t.p.z + 1 } });
        if (hound.wind > 0) wound = true;
        if (hound.rush > 0) rushed = true;
        if (wound && rushed) break;
    }
    check('a charger winds up and then rushes', wound && rushed, `wind ${wound}, rush ${rushed}`);

    G.state.enemies.length = 0;
    const slinger = spawnAt('slinger', { x: r.mx, z: r.mz - 6, awake: true }, 4);
    G.state.enemies.push(slinger);
    let shot = 0;
    for (let i = 0; i < 200 && !shot; i++) {
        t.p.hp = 9999; t.p.invuln = 99;
        slinger.hp = slinger.maxHp;
        tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x, z: t.p.z + 1 } });
        shot = G.state.shots.filter(x => x.hostile).length;
    }
    check('a shooter shoots', shot > 0, `${shot} in the air`);
}

// ------------------------------------------------------------------- bloats
// A bloat bursts however it dies, and its blast is the enemy's, not yours -- friendly fire would
// mean the answer to a bloat is to stand back and wait.
section('Bloats');
{
    const t = start();
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0; G.state.blasts.length = 0;
    t.clearFurniture();
    t.p.invuln = 99;
    const far = spawnAt('bloat', { x: t.p.x + 6, z: t.p.z, awake: true }, 5);
    G.state.enemies.push(far);
    far.hp = 1;
    t.slay(far);
    check('one bursts when killed', G.state.blasts.some(b => b.hostile));
    check('and still pays out', G.state.score > 0);

    G.state.enemies.length = 0; G.state.blasts.length = 0;
    t.p.x = 21; t.p.z = 21; t.p.invuln = 0;
    const near = spawnAt('bloat', { x: t.p.x + 2.2, z: t.p.z, awake: true }, 5);
    G.state.enemies.push(near);
    let fuse = false;
    const hp0 = (t.p.hp = 500);
    for (let i = 0; i < 160 && G.state.enemies.includes(near); i++) {
        t.p.invuln = 0;
        if (near.wind > 0) fuse = true;
        tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x, z: t.p.z + 1 } });
    }
    check('one that reaches you lights a fuse and goes off', fuse && !G.state.enemies.includes(near));
    check('and it hurts', t.p.hp < hp0, `${hp0} -> ${Math.round(t.p.hp)}`);

    G.state.enemies.length = 0; G.state.blasts.length = 0;
    t.clearGround();                       // no oil for the blast to light under the rat
    t.p.invuln = 99;
    const victim = spawnAt('rat', { x: 24, z: 21, awake: false }, 5);
    const bomb = spawnAt('bloat', { x: 24.4, z: 21, awake: true }, 5);
    G.state.enemies.push(victim, bomb);
    const ratHp = victim.hp;
    hurtEnemy(bomb, 9999, bomb.x, bomb.z, 0);     // killed from far off, so only the blast can reach the rat
    t.step(2);
    check('the blast does not kill its friends', victim.hp === ratHp, `${victim.hp}/${ratHp}`);
}

// ---------------------------------------------------------------- what drops
section('Pickups');
{
    const t = start();
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0; G.state.pickups.length = 0;
    t.clearFurniture();

    G.state.pickups.push({ id: 1, kind: 'coin', amount: 7, x: t.p.x + PICKUP.magnet - 0.3, z: t.p.z, t: 0 });
    t.step(2);
    check('a coin in range comes to you', G.state.coins === 7, `${G.state.coins} coin`);

    G.state.pickups.length = 0;
    const far = { id: 2, kind: 'coin', amount: 5, x: t.p.x + PICKUP.magnet + 2.5, z: t.p.z, t: 0 };
    G.state.pickups.push(far);
    const fx = far.x;
    t.step(1);
    check('one out of range stays put', Math.abs(far.x - fx) < 0.01 && G.state.pickups.includes(far));

    G.state.pickups.length = 0;
    t.p.hp = maxHp(t.p);
    const potion = { id: 3, kind: 'potion', x: t.p.x + 1.2, z: t.p.z, t: 0 };
    G.state.pickups.push(potion);
    // `step` keeps topping the body up, so this one is driven by hand at full health.
    for (let i = 0; i < 40; i++) tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x, z: t.p.z + 1 } });
    check('a draught is left where it lies while you are whole', G.state.pickups.includes(potion));
    t.p.hp = maxHp(t.p) * 0.4;
    const hurt = t.p.hp;
    for (let i = 0; i < 60 && G.state.pickups.includes(potion); i++)
        tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x, z: t.p.z + 1 } });
    check('and comes to you the moment you are not',
          !G.state.pickups.includes(potion) && t.p.hp > hurt, `${Math.round(hurt)} -> ${Math.round(t.p.hp)}`);
}

section('The crowd');
{
    const t = start();
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0;
    t.clearFurniture();
    const c = G.state.crowd;
    check('they start indifferent', c.favour === CROWD.start, `${c.favour}`);

    // Killing wakes them up.
    const before = c.favour;
    for (let i = 0; i < 6; i++) {
        const e = spawnAt('rat', { x: t.p.x + 1.2, z: t.p.z, awake: true }, 1);
        G.state.enemies.push(e);
        t.slay(e, 20);
    }
    check('kills raise favour', c.favour > before, `${before} -> ${c.favour.toFixed(0)}`);

    // Standing about loses them.
    const peak = c.favour;
    for (let i = 0; i < 200; i++) tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x, z: t.p.z + 1 } });
    check('and standing about loses them', c.favour < peak, `${peak.toFixed(0)} -> ${c.favour.toFixed(0)}`);

    // While they are shouting, coins come down of their own accord. That trickle is the point of
    // the whole system: a good fight pays you while it is happening.
    G.state.pickups.length = 0;
    G.state.coins = 0;
    c.favour = CROWD.tipFrom + 20;
    const purse0 = G.state.coins;
    for (let i = 0; i < 120; i++) {
        c.favour = Math.max(c.favour, CROWD.tipFrom + 20);      // hold their interest
        tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x, z: t.p.z + 1 } });
    }
    const coinsOnSand = G.state.pickups.filter(x => x.thrown && x.kind === 'coin');
    check('a shouting crowd throws coin down', coinsOnSand.length > 0 || G.state.coins > purse0,
          `${c.thrown} thrown, ${G.state.coins} collected`);
    check('and a quiet one does not', (() => {
        G.state.pickups.length = 0;
        c.favour = 5; c.tipT = 0.01; c.thrown = 0;
        for (let i = 0; i < 80; i++) tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x, z: t.p.z + 1 } });
        return c.thrown === 0;
    })(), `${c.thrown} thrown while silent`);

    // Push them over the line and they throw a purse in.
    G.state.pickups.length = 0;
    c.favour = CROWD.gift - 6;
    // Kill until they respond rather than assuming one body tips them over: the exact favour a
    // kill is worth depends on the chain it lands in.
    for (let i = 0; i < 8 && c.gifts === 0; i++) {
        const e = spawnAt('rat', { x: t.p.x + 1.2, z: t.p.z, awake: true }, 1);
        G.state.enemies.push(e);
        t.slay(e, 20);
    }
    const thrown = G.state.pickups.filter(x => x.thrown);
    check('a full house throws a purse in', thrown.length > 0,
          `${c.gifts} purses, ${G.state.pickups.length} on the sand`);
    check('and a purse is money', thrown.some(x => x.kind === 'coin'),
          thrown.map(x => x.kind).join(','));
    check('and it arrives from above', thrown.every(x => x.drop > 0));
    check('favour settles back after', c.favour < CROWD.gift, `${c.favour.toFixed(0)}`);

    // It cannot be taken while it is still in the air.
    const gift = thrown[0] || { x: t.p.x, z: t.p.z, drop: 0 };
    t.p.x = gift.x; t.p.z = gift.z;
    tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x, z: t.p.z + 1 } });
    check('and cannot be caught mid-flight', G.state.pickups.includes(gift));
    for (let i = 0; i < 40 && G.state.pickups.includes(gift); i++)
        tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x, z: t.p.z + 1 } });
    check('but is yours once it lands', !G.state.pickups.includes(gift));

    check('the meter has words for every level',
          crowdMood(0).name === 'silent' && crowdMood(CROWD.max).name === 'ROARING',
          `${crowdMood(0).name} .. ${crowdMood(CROWD.max).name}`);
}

// ---------------------------------------------------- water, oil and fire
section('Water and oil');
{
    // Rooms roll their hazards, so look across a few of them rather than at one.
    let water = 0, oil = 0, rooms = 0;
    for (let i = 0; i < 14; i++) {
        const t = start();
        const d = currentDungeon();
        rooms++;
        let w = 0, o = 0;
        for (let k = 0; k < d.surface.length; k++) {
            if (d.surface[k] === SURFACE.water) w++;
            if (d.surface[k] === SURFACE.oil) o++;
        }
        if (w) water++;
        if (o) oil++;
    }
    check('some rooms have water in them', water > 0 && water < rooms, `${water} of ${rooms}`);
    check('and some have oil', oil > 0 && oil < rooms, `${oil} of ${rooms}`);

    // Water slows you; it must not stop you.
    const t = start();
    const d = currentDungeon();
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0;
    t.clearFurniture();
    t.clearGround();
    const r = d.arena;
    for (let x = Math.floor(r.mx) - 3; x <= Math.floor(r.mx) + 3; x++)
        for (let z = Math.floor(r.mz) - 3; z <= Math.floor(r.mz) + 3; z++) setSurface(d, x, z, SURFACE.water);
    t.p.x = r.mx - 2.5; t.p.z = r.mz;
    const dry = (() => {
        for (let x = Math.floor(r.mx) - 3; x <= Math.floor(r.mx) + 3; x++)
            for (let z = Math.floor(r.mz) - 3; z <= Math.floor(r.mz) + 3; z++) setSurface(d, x, z, SURFACE.sand);
        t.p.x = r.mx - 2.5; t.p.z = r.mz;
        const from = t.p.x;
        t.walkTo(r.mx + 3, r.mz, 1);
        return t.p.x - from;
    })();
    for (let x = Math.floor(r.mx) - 3; x <= Math.floor(r.mx) + 3; x++)
        for (let z = Math.floor(r.mz) - 3; z <= Math.floor(r.mz) + 3; z++) setSurface(d, x, z, SURFACE.water);
    t.p.x = r.mx - 2.5; t.p.z = r.mz;
    const wet = (() => { const from = t.p.x; t.walkTo(r.mx + 3, r.mz, 1); return t.p.x - from; })();
    check('water slows you down', wet < dry * 0.8 && wet > 0, `${dry.toFixed(2)} dry vs ${wet.toFixed(2)} wet`);
}

section('Fire');
{
    const t = start();
    const d = currentDungeon();
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0;
    t.clearFurniture();
    t.clearGround();
    const r = d.arena;
    // A trail of oil straight across the room.
    const z0 = Math.floor(r.mz);
    for (let x = Math.floor(r.x) + 3; x < Math.floor(r.x) + 16; x++) setSurface(d, x, z0, SURFACE.oil);
    const oilTiles = 13;
    igniteAt(d, Math.floor(r.x) + 3.5, z0 + 0.5, 0.9);
    check('a blast lights the oil it goes off on', G.state.fires.length > 0, `${G.state.fires.length} alight`);
    t.p.x = r.mx; t.p.z = r.mz - 5;                 // well clear of it
    t.step(2.5);
    check('and the fire runs along the trail', G.state.fires.length > 3, `${G.state.fires.length} burning`);
    // It burns whoever is in it, including you.
    const e = spawnAt('skeleton', { x: Math.floor(r.x) + 6.5, z: z0 + 0.5, awake: false }, 1);
    e.hp = 500; e.maxHp = 500;
    G.state.enemies.push(e);
    const eBefore = e.hp;
    t.p.x = Math.floor(r.x) + 5.5; t.p.z = z0 + 0.5;
    t.p.hp = 500; t.p.invuln = 0;
    const pBefore = t.p.hp;
    for (let i = 0; i < 20; i++) { t.p.invuln = 0; tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x, z: t.p.z + 1 } }); }
    check('fire burns whatever stands in it', e.hp < eBefore, `enemy ${eBefore} -> ${Math.round(e.hp)}`);
    check('and it does not care that it is yours', t.p.hp < pBefore, `you ${pBefore} -> ${Math.round(t.p.hp)}`);
    // And it burns out.
    for (let i = 0; i < 300 && G.state.fires.length; i++) t.step(0.05);
    check('it burns out and leaves ash', G.state.fires.length === 0 && surfaceAt(d, Math.floor(r.x) + 4, z0) === SURFACE.ash);
    check('so a slick only burns once', igniteAt(d, Math.floor(r.x) + 4.5, z0 + 0.5, 2) === 0);
}

// Being on fire is a state of the BODY, not of the tile, and it is the one kind of harm that
// neither respects the mercy window nor grants one. It went through the ordinary hurt path at
// first, and so a frame's worth of burn -- a third of a point -- bought 0.35s of invulnerability
// to everything else in the room. Standing in the flames was the safest place to be, and the fire
// itself did about half a point a second. Both halves of that are checked here.
section('Being on fire');
{
    const t = start();
    const d = currentDungeon();
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0;
    t.clearFurniture();
    t.clearGround();
    const r = d.arena;
    const z0 = Math.floor(r.mz), x0 = Math.floor(r.x) + 4;
    // Two separate slicks: one to stand in, one to kill something on later. The first is ash by
    // the time the second is needed, and a slick only burns once.
    for (let x = x0; x < x0 + 6; x++) setSurface(d, x, z0, SURFACE.oil);
    for (let x = x0; x < x0 + 6; x++) setSurface(d, x, z0 + 3, SURFACE.oil);

    // `step` on the harness pins health to keep a walker alive, so anything measuring damage has
    // to drive the frame itself.
    const still = { fwd: 0, strafe: 0, dash: false, aim: { x: r.mx, z: r.mz + 1 } };

    t.p.x = x0 + 0.5; t.p.z = z0 + 0.5;
    t.p.hp = maxHp(t.p); t.p.invuln = 0;
    igniteAt(d, x0 + 0.5, z0 + 0.5, 0.9);
    const hp0 = t.p.hp;
    let sawInvuln = false;
    for (let i = 0; i < 24; i++) {
        tick(0.05, still);
        if (t.p.invuln > 0) sawInvuln = true;
    }
    check('standing in it costs you real health', hp0 - t.p.hp > 8, `${Math.round(hp0)} -> ${Math.round(t.p.hp)}`);
    check('and does not make you untouchable', !sawInvuln);

    // Step off it and it comes with you, for a moment.
    t.p.x = r.mx; t.p.z = r.mz - 6;
    const off = t.p.hp;
    for (let i = 0; i < 10; i++) tick(0.05, still);
    check('it clings after you are out of it', t.p.hp < off, `${Math.round(off)} -> ${Math.round(t.p.hp)}`);
    for (let i = 0; i < 60; i++) tick(0.05, still);
    const cold = t.p.hp;
    for (let i = 0; i < 10; i++) tick(0.05, still);
    check('but it does go out', t.p.hp === cold, `${Math.round(cold)}`);

    // A body killed by fire is killed properly: it pays, it drops, it counts. It used to have its
    // health decremented in place and be removed without ever going through a kill.
    t.p.hp = maxHp(t.p);
    const score0 = G.state.score, kills0 = G.state.stats.kills;
    const e = spawnAt('rat', { x: x0 + 1.5, z: z0 + 3.5, awake: false }, 1);
    e.hp = 6; e.maxHp = 6;
    G.state.enemies.push(e);
    igniteAt(d, x0 + 1.5, z0 + 3.5, 0.9);
    for (let i = 0; i < 40 && G.state.enemies.includes(e); i++) tick(0.05, still);
    check('fire kills what it burns', !G.state.enemies.includes(e));
    check('and a kill by fire is a kill', G.state.stats.kills > kills0 && G.state.score > score0,
          `+${G.state.stats.kills - kills0} kill, +${G.state.score - score0}`);
}

section('The druid plants something');
{
    const t = start('druid', 'seed');
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0;
    t.clearFurniture();
    const e = spawnAt('skeleton', { x: t.p.x + 3, z: t.p.z, awake: false }, 1);
    e.hp = 900; e.maxHp = 900;
    // Toothless on purpose: this check is about what the seed gives back, and a skeleton hitting
    // the druid harder than the seed mends was drowning the thing being measured.
    e.damage = 0;
    G.state.enemies.push(e);
    t.p.hp = maxHp(t.p) * 0.4;
    const hp0 = t.p.hp, eHp0 = e.hp;
    t.p.abilityCool = {};
    special(0, { x: e.x, z: e.z });
    check('a seed is planted', G.state.seeds.length === 1);
    for (let i = 0; i < 60; i++) tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: e.x, z: e.z } });
    check('it drains what stands near it', e.hp < eHp0, `${eHp0} -> ${Math.round(e.hp)}`);
    check('and mends you for a share of it', t.p.hp > hp0, `${Math.round(hp0)} -> ${Math.round(t.p.hp)}`);
    for (let i = 0; i < 300 && G.state.seeds.length; i++) tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: e.x, z: e.z } });
    check('and it withers away', G.state.seeds.length === 0);
}

section('The bard sings');
{
    const t = start('bard', 'lullaby');
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0;
    t.clearFurniture();
    const near = [];
    for (let i = 0; i < 4; i++) {
        const e = spawnAt('skeleton', { x: t.p.x + 1.5 + i * 0.6, z: t.p.z + 1, awake: true }, 1);
        e.hp = 900; e.maxHp = 900;
        G.state.enemies.push(e); near.push(e);
    }
    const far = spawnAt('skeleton', { x: t.p.x + 12, z: t.p.z, awake: true }, 1);
    G.state.enemies.push(far);
    t.p.abilityCool = {};
    special(0, { x: t.p.x, z: t.p.z + 2 });
    check('the song puts them down', near.every(e => e.sleep > 0), near.map(e => e.sleep.toFixed(1)).join(' '));
    check('and does not reach the back of the room', !(far.sleep > 0));

    // A sleeper does not fight.
    t.p.hp = 500; t.p.invuln = 0;
    const hp0 = t.p.hp;
    for (let i = 0; i < 20; i++) { t.p.invuln = 0; tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x, z: t.p.z + 1 } }); }
    check('a sleeping body does not swing at you', t.p.hp === hp0, `${hp0} -> ${Math.round(t.p.hp)}`);

    // But waking one costs it dearly.
    const victim = near[0];
    const before = victim.hp;
    t.p.x = victim.x - 1.0; t.p.z = victim.z; t.p.cool = 0;
    attack({ x: victim.x, z: victim.z });
    const woke = before - victim.hp;
    victim.sleep = 0;
    const awakeHit = (() => {
        const other = near[1];
        other.sleep = 0;
        const b = other.hp;
        t.p.x = other.x - 1.0; t.p.z = other.z; t.p.cool = 0;
        attack({ x: other.x, z: other.z });
        return b - other.hp;
    })();
    check('and the blow that wakes one lands harder', woke > awakeHit * 1.5,
          `${woke.toFixed(0)} asleep vs ${awakeHit.toFixed(0)} awake`);
    check('waking it wakes it', victim.sleep === 0);

    // The mending song.
    const t2 = start('bard', 'anthem');
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0;
    t2.p.hp = maxHp(t2.p) * 0.3;
    const low = t2.p.hp;
    t2.p.abilityCool = {};
    special(0, { x: t2.p.x, z: t2.p.z + 2 });
    check('the mending song starts mending', t2.p.hp > low, `${Math.round(low)} -> ${Math.round(t2.p.hp)}`);
    const justAfter = t2.p.hp;
    for (let i = 0; i < 100; i++) tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t2.p.x, z: t2.p.z + 1 } });
    check('and keeps mending after it', t2.p.hp > justAfter, `${Math.round(justAfter)} -> ${Math.round(t2.p.hp)}`);
}

// ------------------------------------------------------------------ biomes
// A room is a place: the stone, what is spilled on it and what walks through the gates are one
// decision. These check that the three agree -- a Cistern with no water in it, or an Icehouse
// fielding the general bestiary, is the feature not actually being there.
section('Where the room is');
{
    const early = [];
    for (let i = 0; i < 6; i++) early.push(generateFloor(1).biome, generateFloor(2).biome);
    check('the first rooms are always the Sands', early.every(b => b === 'sands'),
          [...new Set(early)].join('/'));

    // Arenas and lairs both draw a place; the market is always the same room and draws nothing,
    // so it is left out rather than counted as a repeat of whatever was around it.
    const deep = [];
    for (let f = BIOME_FROM; f < BIOME_FROM + 60; f++) {
        const d = generateFloor(f);
        if (d.stage !== 'shop') deep.push(d.biome);
    }
    check('and deeper ones are not', new Set(deep).size >= 4, `${new Set(deep).size} kinds`);
    check('never the same place twice running',
          deep.every((b, i) => i === 0 || b !== deep[i - 1]));

    // What each place promises, it has.
    const find = (key, n = 40) => {
        for (let i = 0; i < n; i++) {
            const d = generateFloor(BIOME_FROM + i);
            if (d.biome === key && d.stage === 'arena') return d;
        }
        return null;
    };
    const has = (d, kind) => d.surface.some(v => v === kind);
    const cistern = find('cistern'), pitch = find('pitch'), ice = find('icehouse'), quarry = find('quarry');
    check('a cistern always has its water', cistern && has(cistern, SURFACE.water));
    check('the pitch always has its oil', pitch && has(pitch, SURFACE.oil));
    check('an icehouse has ice and snow', ice && has(ice, SURFACE.ice) && has(ice, SURFACE.snow));
    check('and no oil to light', ice && !has(ice, SURFACE.oil));
    check('a quarry has rocks in it', quarry && quarry.rocks.length >= 4, `${quarry ? quarry.rocks.length : 0}`);
    check('and a rock is solid', quarry && quarry.rocks.every(k => solidAt(quarry, k.tx, k.tz)));
    // A boulder in a gateway is a wave that cannot leave its own alcove.
    const mouths = quarry ? quarry.doorways.flatMap(dw => [...dw.tiles, ...dw.alcove]) : [];
    check('and never in a gateway',
          quarry && quarry.rocks.every(k => !mouths.some(([x, z]) => x === k.tx && z === k.tz)));

    // And what walks in belongs to the place.
    const drawn = new Set();
    for (let i = 0; i < 300; i++) drawn.add(pickKind(9, null, BIOMES.icehouse));
    check('waves are drawn from the biome', [...drawn].every(k => BIOMES.icehouse.kinds[k]),
          [...drawn].join('/'));
    check('and not from the rest of the bestiary', !drawn.has('rat') && !drawn.has('bloat'));
}

// ---------------------------------------------------------- snow, and ice
section('Underfoot');
{
    const t = start();
    const d = currentDungeon();
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0;
    t.clearFurniture();
    t.clearGround();
    const r = d.arena;
    const paint = (kind) => {
        for (let x = Math.floor(r.mx) - 5; x <= Math.floor(r.mx) + 5; x++)
            for (let z = Math.floor(r.mz) - 3; z <= Math.floor(r.mz) + 3; z++) setSurface(d, x, z, kind);
    };
    const runFrom = () => { t.p.x = r.mx - 4; t.p.z = r.mz; t.p.gx = 0; t.p.gz = 0; };

    paint(SURFACE.sand); runFrom();
    const dry = (() => { const from = t.p.x; t.walkTo(r.mx + 4, r.mz, 1); return t.p.x - from; })();
    paint(SURFACE.snow); runFrom();
    const deep = (() => { const from = t.p.x; t.walkTo(r.mx + 4, r.mz, 1); return t.p.x - from; })();
    check('a drift slows you', deep < dry * 0.95 && deep > dry * 0.6, `${dry.toFixed(2)} dry vs ${deep.toFixed(2)} snow`);

    // Ice is about grip, not speed: you keep going after you stop asking to.
    paint(SURFACE.ice); runFrom();
    t.walkTo(r.mx + 1, r.mz, 0.9);
    const stopped = t.p.x;
    for (let i = 0; i < 8; i++) tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x + 1, z: t.p.z } });
    const slid = t.p.x - stopped;
    check('ice carries you after you let go', slid > 0.15, `slid ${slid.toFixed(2)}`);

    paint(SURFACE.sand); runFrom();
    t.walkTo(r.mx + 1, r.mz, 0.9);
    const firm = t.p.x;
    for (let i = 0; i < 8; i++) tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x + 1, z: t.p.z } });
    check('and sand does not', t.p.x - firm < 0.02, `${(t.p.x - firm).toFixed(3)}`);

    // And the slide has to be dropped at the door, or you arrive in the next room still skating
    // toward whatever is standing in it.
    paint(SURFACE.ice);
    t.p.x = r.mx - 4; t.p.z = r.mz;
    t.walkTo(r.mx + 2, r.mz, 0.8);
    check('you leave a room with a slide on', Math.hypot(t.p.gx, t.p.gz) > 0.5,
          `${Math.hypot(t.p.gx, t.p.gz).toFixed(2)}`);
    // The waves were held off for this section, so the room never finished and its gates never
    // lit. Opened by hand, or the walk to the gate is a walk into rock.
    openExits(currentDungeon());
    const was = G.state.floor;
    t.takeGate();
    check('and the walk out worked', G.state.floor > was, `room ${G.state.floor}`);
    check('and arrive in the next one without it', Math.hypot(t.p.gx, t.p.gz) === 0);
}


// ------------------------------------------------------------ things that live somewhere
// One creature to each place, each built from an ordinary behaviour plus a single twist. Every
// twist is checked against the ordinary version of itself, because "the drowned are fast in
// water" means nothing unless something else in the same water is slow.
section('What lives there');
{
    const t = start();
    const d = currentDungeon();
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0;
    t.clearFurniture();
    t.clearGround();
    const r = d.arena;
    const still = { fwd: 0, strafe: 0, dash: false, aim: { x: r.mx, z: r.mz + 1 } };
    const band = (kind) => {
        for (let x = Math.floor(r.x) + 1; x < Math.floor(r.x + r.w) - 1; x++)
            for (let z = Math.floor(r.mz) - 2; z <= Math.floor(r.mz) + 2; z++) setSurface(d, x, z, kind);
    };
    // How far one walks in a second, toward a player standing well out of reach.
    const pace = (kind) => {
        G.state.enemies.length = 0;
        const e = spawnAt(kind, { x: r.x + 3.5, z: r.mz + 0.5, awake: true }, 5);
        G.state.enemies.push(e);
        t.p.x = r.x + r.w - 2; t.p.z = r.mz + 0.5;
        const x0 = e.x;
        for (let i = 0; i < 20; i++) { t.p.hp = 9999; t.p.invuln = 99; tick(0.05, still); }
        G.state.enemies.length = 0;
        return (e.x - x0) / ENEMIES[kind].speed;       // per unit of its own speed
    };

    band(SURFACE.sand);
    const drownedDry = pace('drowned'), skelDry = pace('skeleton');
    band(SURFACE.water);
    const drownedWet = pace('drowned'), skelWet = pace('skeleton');
    check('water slows the ordinary ones', skelWet < skelDry * 0.75,
          `skeleton ${skelDry.toFixed(2)} dry, ${skelWet.toFixed(2)} wet`);
    check('and speeds up the drowned', drownedWet > drownedDry * 1.2,
          `drowned ${drownedDry.toFixed(2)} dry, ${drownedWet.toFixed(2)} wet`);

    band(SURFACE.snow);
    const wolfSnow = pace('wolf'), houndSnow = pace('hound');
    check('a frost wolf does not notice snow', wolfSnow > houndSnow * 1.15,
          `wolf ${wolfSnow.toFixed(2)}, hound ${houndSnow.toFixed(2)}`);

    // A charge on ice skids; a wolf's does not.
    const charge = (kind, surf) => {
        band(surf);
        G.state.enemies.length = 0;
        const e = spawnAt(kind, { x: r.x + 3.5, z: r.mz + 0.5, awake: true }, 5);
        G.state.enemies.push(e);
        t.p.x = r.mx; t.p.z = r.z + 1.5;              // off the line of it
        const def = ENEMIES[kind];
        e.rush = def.rushTime; e.rvx = def.rush; e.rvz = 0; e.rushHit = true; e.facing = Math.PI / 2;
        const x0 = e.x;
        for (let i = 0; i < 60 && e.rush > 0; i++) { t.p.invuln = 99; tick(0.05, still); }
        G.state.enemies.length = 0;
        return e.x - x0;
    };
    const houndSand = charge('hound', SURFACE.sand), houndIce = charge('hound', SURFACE.ice);
    const wolfSand = charge('wolf', SURFACE.sand), wolfIce = charge('wolf', SURFACE.ice);
    check('a charge on ice skids further', houndIce > houndSand * 1.4,
          `${houndSand.toFixed(1)} on sand, ${houndIce.toFixed(1)} on ice`);
    check('except a wolf\'s', Math.abs(wolfIce - wolfSand) < 0.3,
          `${wolfSand.toFixed(1)} on sand, ${wolfIce.toFixed(1)} on ice`);

    // Its bite leaves you chilled, and chilled is slow.
    band(SURFACE.sand);
    G.state.enemies.length = 0;
    t.p.x = r.mx; t.p.z = r.mz; t.p.invuln = 0; t.p.chill = 0; t.p.hp = 500;
    const wolf = spawnAt('wolf', { x: r.mx + 0.8, z: r.mz, awake: true }, 5);
    wolf.cool = 0; wolf.wind = 0;
    G.state.enemies.push(wolf);
    for (let i = 0; i < 30 && !(t.p.chill > 0); i++) { t.p.invuln = 0; tick(0.05, still); }
    check('a wolf\'s bite chills you', t.p.chill > 0, `${(t.p.chill || 0).toFixed(1)}s`);
    G.state.enemies.length = 0;
    // The bite left a moment of hit-stop pending, which would count against the chilled walk.
    const walk = () => { G.state.hitStop = 0; t.p.x = r.x + 3; t.p.z = r.mz; const x0 = t.p.x;
                         t.walkTo(r.x + r.w - 2, r.mz, 0.5); return t.p.x - x0; };
    t.p.chill = 5; const cold = walk();
    t.p.chill = 0; const warm = walk();
    check('and chilled is slow', cold < warm * 0.75, `${warm.toFixed(2)} warm, ${cold.toFixed(2)} chilled`);

    // What an imp throws sets the floor alight where it lands.
    t.clearGround();
    G.state.fires.length = 0;
    const imp = spawnAt('imp', { x: r.x + 3.5, z: r.mz + 0.5, awake: true }, 5);
    for (let x = Math.floor(r.x) + 6; x < Math.floor(r.x) + 9; x++) setSurface(d, x, Math.floor(r.mz), SURFACE.oil);
    t.p.x = r.mx; t.p.z = r.z + 1.5;
    hostileShot(imp, Math.PI / 2, 5, 8, { ignites: true, kind: 'ember' });
    G.state.shots[G.state.shots.length - 1].life = 0.45;     // comes down on the slick
    for (let i = 0; i < 20 && G.state.shots.some(x => x.hostile); i++) tick(0.05, still);
    check('an imp\'s ember lights the oil it lands on', G.state.fires.length > 0, `${G.state.fires.length} alight`);
    // And the imp stands in its own fire unharmed.
    G.state.enemies.length = 0;
    const fx = G.state.fires[0] || { x: Math.floor(r.x) + 7, z: Math.floor(r.mz) };
    imp.x = fx.x + 0.5; imp.z = fx.z + 0.5; imp.awake = false;
    G.state.enemies.push(imp);
    const impHp = imp.hp;
    for (let i = 0; i < 10; i++) tick(0.05, still);
    check('and does not burn in it', imp.hp === impHp && !(imp.burn > 0));
    G.state.enemies.length = 0;
    for (let i = 0; i < 200 && G.state.fires.length; i++) tick(0.05, still);

    // An ember that hits you sets you alight; a rock that hits you shoves you.
    t.clearGround();
    t.p.x = r.mx; t.p.z = r.mz; t.p.invuln = 0; t.p.burn = 0; t.p.hp = 500;
    hostileShot({ x: r.mx - 3, z: r.mz }, Math.PI / 2, 5, 8, { ignites: true, kind: 'ember' });
    for (let i = 0; i < 20 && G.state.shots.some(x => x.hostile); i++) tick(0.05, still);
    check('an ember that hits you sets you alight', t.p.burn > 0);
    t.p.burn = 0;
    for (let i = 0; i < 20; i++) tick(0.05, still);          // out of the mercy window
    t.p.x = r.mx; t.p.z = r.mz; t.p.invuln = 0;
    const px0 = t.p.x;
    hostileShot({ x: r.mx - 3, z: r.mz }, Math.PI / 2, 5, 5.5, { heavy: true, kind: 'rock' });
    for (let i = 0; i < 30 && G.state.shots.some(x => x.hostile); i++) tick(0.05, still);
    for (let i = 0; i < 8; i++) tick(0.05, still);
    check('a rock that hits you shoves you', t.p.x - px0 > 0.4, `moved ${(t.p.x - px0).toFixed(2)}`);

    // And a boulder between you and it takes the rock instead.
    const hp1 = (t.p.hp = 500);
    t.p.x = r.mx; t.p.z = r.mz; t.p.invuln = 0;
    setTile(d, Math.floor(r.mx) - 2, Math.floor(r.mz), PROP);
    hostileShot({ x: r.mx - 4, z: r.mz }, Math.PI / 2, 20, 5.5, { heavy: true, kind: 'rock' });
    for (let i = 0; i < 40 && G.state.shots.some(x => x.hostile); i++) tick(0.05, still);
    check('and a boulder is cover from it', t.p.hp === hp1);
    setTile(d, Math.floor(r.mx) - 2, Math.floor(r.mz), FLOOR);
}

// ------------------------------------------------------------ fire, water and ice
// The surfaces talk to each other. Each of these is a thing a player will try on purpose once
// they have seen it happen by accident, so each has to happen every time.
section('Fire, water and ice');
{
    const t = start();
    const d = currentDungeon();
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0;
    t.clearFurniture();
    t.clearGround();
    const r = d.arena;
    const still = { fwd: 0, strafe: 0, dash: false, aim: { x: r.mx, z: r.mz + 1 } };

    // Water puts you out.
    t.p.x = r.mx; t.p.z = r.mz;
    setSurface(d, Math.floor(r.mx), Math.floor(r.mz), SURFACE.water);
    t.p.burn = TERRAIN.burnTime;
    tick(0.05, still);
    check('stepping into water puts you out', !(t.p.burn > 0));
    // On the same tile as the player's water. `r.mx` is already a tile centre.
    const e = spawnAt('skeleton', { x: Math.floor(r.mx) + 0.5, z: Math.floor(r.mz) + 0.5, awake: false }, 1);
    e.burn = TERRAIN.burnTime;
    G.state.enemies.push(e);
    tick(0.05, still);
    check('and puts them out too', !(e.burn > 0));
    G.state.enemies.length = 0;

    // A blast thaws what it goes off on.
    t.clearGround();
    if (d.dirty) d.dirty.clear();
    const cx = Math.floor(r.mx), cz = Math.floor(r.mz);
    setSurface(d, cx, cz, SURFACE.ice); setSurface(d, cx + 1, cz, SURFACE.snow);
    setSurface(d, cx + 6, cz, SURFACE.ice);                       // well outside it
    d.dirty.clear();
    igniteAt(d, cx + 1, cz + 0.5, 1.6);
    check('a blast melts ice to water', surfaceAt(d, cx, cz) === SURFACE.water);
    check('and snow down to the sand', surfaceAt(d, cx + 1, cz) === SURFACE.sand);
    check('but only where it went off', surfaceAt(d, cx + 6, cz) === SURFACE.ice);
    check('and the floor is told what changed', d.dirty.size === 2, `${d.dirty.size} tiles`);
}


// ------------------------------------------------------------------ movesets
// Each class has a rhythm on its basic attack, a dash that sets that rhythm up, and one move that
// nobody else has. Every one of these is a promise the player learns to rely on -- "the fourth
// strum is the chord", "the arrow after a dash goes through everything" -- so each is checked as
// the promise, counted exactly.
section('Movesets');
{
    const quiet = (t) => {
        if (G.state.arena) G.state.arena.grace = 999;
        G.state.enemies.length = 0;
        t.clearFurniture(); t.clearGround();
        const r = currentDungeon().arena;
        t.p.x = r.mx; t.p.z = r.mz; t.p.hp = 9999;
        return r;
    };
    const idle = (t, n = 1, extra = {}) => {
        for (let i = 0; i < n; i++)
            tick(0.05, { fwd: 0, strafe: 0, dash: false, aim: { x: t.p.x, z: t.p.z + 1 }, ...extra });
    };
    const dummy = (x, z, hp = 999) => {
        const e = spawnAt('skeleton', { x, z, awake: false }, 1);
        e.hp = e.maxHp = hp; e.damage = 0;
        G.state.enemies.push(e);
        return e;
    };

    // ---- knight: the dash is a shoulder ----
    {
        const t = start('knight', 'riposte');
        const r = quiet(t);
        const e = dummy(r.mx, r.mz + 1.4);
        t.p.dashCool = 0;
        tick(0.05, { ...steer(0, 1), dash: true, aim: { x: r.mx, z: r.mz + 5 } });
        idle(t, 6);
        check('a knight\'s dash barges through', e.hp < 999, `999 -> ${Math.round(e.hp)}`);

        // Riposte: a blow in the window is turned aside and paid back.
        G.state.enemies.length = 0;
        t.p.hp = 500; t.p.invuln = 0;
        const foe = spawnAt('skeleton', { x: r.mx, z: r.mz + 0.9, awake: true }, 3);
        foe.hp = foe.maxHp = 999; foe.cool = 0.3;
        G.state.enemies.push(foe);
        t.p.abilityCool = {};
        special(0, { x: foe.x, z: foe.z });
        check('riposte raises the shield', t.p.parry > 0);
        const hp0 = t.p.hp;
        for (let i = 0; i < 16 && foe.hp >= 999; i++) idle(t);
        check('a blow in the window does not land', t.p.hp === hp0, `${hp0} -> ${Math.round(t.p.hp)}`);
        check('and is paid back', foe.hp < 999, `999 -> ${Math.round(foe.hp)}`);
        check('the shield comes down after one', !(t.p.parry > 0));

        // And a thrown thing goes back where it came from.
        G.state.enemies.length = 0; G.state.shots.length = 0;
        for (let i = 0; i < 20; i++) idle(t);
        // Back in the middle: the barge above carried the knight up the room, and a shot along
        // the line it used to stand on meets nothing.
        t.p.x = r.mx; t.p.z = r.mz;
        const thrower = dummy(r.mx - 5, r.mz, 999);
        t.p.invuln = 0; t.p.abilityCool = {};
        special(0, { x: thrower.x, z: thrower.z });
        hostileShot(thrower, Math.PI / 2, 10, 8);
        for (let i = 0; i < 40 && thrower.hp >= 999; i++) idle(t);
        check('a shot on the shield is sent back', thrower.hp < 999, `999 -> ${Math.round(thrower.hp)}`);
    }

    // ---- archer: plant your feet ----
    {
        const t = start('archer', 'fire');
        const r = quiet(t);
        const shotKinds = [];
        for (let i = 0; i < 6; i++) {
            t.p.cool = 0;
            attack({ x: r.mx + 5, z: r.mz });
            shotKinds.push(G.state.shots[G.state.shots.length - 1].kind);
            idle(t);
        }
        check('standing still, every third arrow is a Sure Shot', shotKinds.join(',') === 'bolt,bolt,sure,bolt,bolt,sure',
              shotKinds.join(','));
        G.state.shots.length = 0;
        t.p.steady = 0;
        const moving = [];
        for (let i = 0; i < 4; i++) {
            t.p.cool = 0;
            attack({ x: r.mx + 5, z: r.mz });
            moving.push(G.state.shots[G.state.shots.length - 1].kind);
            tick(0.05, { fwd: 0, strafe: 1, dash: false, aim: { x: r.mx + 5, z: r.mz } });
        }
        check('and walking loses it', !moving.includes('sure'), moving.join(','));

        // A Sure Shot goes through a queue; an ordinary arrow stops at the first.
        G.state.shots.length = 0;
        t.p.x = r.mx - 4; t.p.z = r.mz;
        const line = [0, 1, 2].map(i => dummy(r.mx - 1.5 + i * 1.2, r.mz, 999));
        t.p.steady = 2; t.p.cool = 0;
        attack({ x: r.mx + 5, z: r.mz });
        for (let i = 0; i < 20 && G.state.shots.length; i++) idle(t);
        check('a Sure Shot goes through all of them', line.every(e => e.hp < 999),
              line.map(e => Math.round(999 - e.hp)).join('/'));
        G.state.enemies.length = 0; G.state.shots.length = 0;

        // The dash readies one.
        t.p.steady = 0; t.p.dashCool = 0;
        tick(0.05, { ...steer(-1, 0), dash: true, aim: { x: r.mx + 5, z: r.mz } });
        idle(t, 5);
        t.p.cool = 0;
        attack({ x: r.mx + 5, z: r.mz });
        check('the arrow after a dash is a Sure Shot', G.state.shots[G.state.shots.length - 1].kind === 'sure');
        G.state.shots.length = 0;

        // Fire Arrow: lights the oil it crosses, and what it goes through.
        t.clearGround();
        t.p.x = r.mx - 5; t.p.z = r.mz;
        const z0 = Math.floor(r.mz);
        for (let x = Math.floor(r.mx) - 3; x <= Math.floor(r.mx) + 3; x++) setSurface(currentDungeon(), x, z0, SURFACE.oil);
        const target = dummy(r.mx + 4.5, r.mz, 999);
        t.p.abilityCool = {};
        special(0, { x: r.mx + 6, z: r.mz });
        for (let i = 0; i < 20 && G.state.shots.length; i++) idle(t);
        check('a fire arrow lights the oil it crosses', G.state.fires.length > 0, `${G.state.fires.length} alight`);
        check('and sets alight what it hits', target.burn > 0);
        G.state.enemies.length = 0;
        for (let i = 0; i < 200 && G.state.fires.length; i++) idle(t);
    }

    // ---- druid: the garden ----
    {
        const t = start('druid', 'spring');
        const r = quiet(t);
        G.state.brambles = [];
        t.p.cool = 0;
        attack({ x: r.mx + 4, z: r.mz });
        for (let i = 0; i < 30 && G.state.shots.length; i++) idle(t);
        check('a burst leaves brambles', G.state.brambles.length === 1);
        const b = G.state.brambles[0] || { x: r.mx + 4, z: r.mz };
        const slowed = dummy(b.x, b.z, 999);
        idle(t);
        check('and they hold what walks through', slowed.slow > 0);
        for (let i = 0; i < 60; i++) idle(t);
        check('and wither', G.state.brambles.length === 0);
        G.state.enemies.length = 0;

        t.p.dashCool = 0;
        tick(0.05, { ...steer(-1, 0), dash: true, aim: { x: r.mx + 5, z: r.mz } });
        check('a druid\'s dash leaves thorns behind it', G.state.brambles.length === 1);
        idle(t, 6);                     // let the dash finish, or it carries on after the teleport below
        G.state.brambles.length = 0;

        // Wellspring: water where you point, fire out under it, and the druid mends in it.
        const d = currentDungeon();
        t.p.x = r.mx; t.p.z = r.mz;
        const fx = Math.floor(r.mx) + 4, fz = Math.floor(r.mz);
        setSurface(d, fx, fz, SURFACE.oil);
        igniteAt(d, fx + 0.5, fz + 0.5, 0.6);
        check('(there is a fire to put out)', G.state.fires.length === 1);
        t.p.abilityCool = {};
        special(0, { x: fx + 0.5, z: fz + 0.5 });
        check('wellspring raises water', surfaceAt(d, fx, fz) === SURFACE.water &&
              surfaceAt(d, fx + 1, fz) === SURFACE.water);
        check('and drowns the fire under it', G.state.fires.length === 0);
        let dry = 0;
        for (const dw of d.doorways) for (const [x, z] of [...dw.tiles, ...dw.alcove])
            if (surfaceAt(d, x, z) === SURFACE.water) dry++;
        check('but never floods a gateway', dry === 0);
        t.p.x = fx + 0.5; t.p.z = fz + 0.5;
        t.p.hp = 40;
        idle(t, 20);
        check('a druid mends standing in water', t.p.hp > 43, `40 -> ${t.p.hp.toFixed(1)}`);
    }

    // ---- bard: a bar of four ----
    {
        const t = start('bard', 'discord');
        const r = quiet(t);
        const kinds = [];
        G.state.blasts.length = 0;
        for (let i = 0; i < 8; i++) { t.p.cool = 0; attack({ x: r.mx, z: r.mz + 2 }); kinds.push(t.p.swingKind); idle(t); }
        check('every fourth strum is the chord', kinds.join(',') === 'strum,strum,strum,play,strum,strum,strum,play',
              kinds.join(','));
        // The chord goes all the way round: something behind you is caught by it.
        t.p.strum = 3;
        const behind = dummy(r.mx, r.mz - 1.8, 999);
        t.p.cool = 0;
        attack({ x: r.mx, z: r.mz + 2 });
        check('and it goes all the way round', behind.hp < 999);
        G.state.enemies.length = 0;
        // The dash lands you on the last beat.
        t.p.strum = 0; t.p.dashCool = 0;
        tick(0.05, { ...steer(0, 1), dash: true, aim: { x: r.mx, z: r.mz + 5 } });
        idle(t, 5);
        t.p.cool = 0;
        attack({ x: t.p.x, z: t.p.z + 2 });
        check('the swing after a dash is the chord', t.p.swingKind === 'play');

        // Discord: they turn on each other, and leave you alone while they do.
        t.p.x = r.mx; t.p.z = r.mz; t.p.hp = 500; t.p.invuln = 0;
        const a = spawnAt('skeleton', { x: r.mx + 1.2, z: r.mz, awake: true }, 3);
        const b = spawnAt('skeleton', { x: r.mx + 2.2, z: r.mz, awake: true }, 3);
        a.hp = a.maxHp = 400; b.hp = b.maxHp = 400;
        G.state.enemies.push(a, b);
        t.p.abilityCool = {};
        special(0, { x: a.x, z: a.z });
        check('discord turns them', a.charm > 0 && b.charm > 0);
        const hp0 = t.p.hp;
        for (let i = 0; i < 60; i++) { t.p.invuln = 0; idle(t); }
        check('and they fight each other', a.hp < 400 && b.hp < 400, `${Math.round(a.hp)} / ${Math.round(b.hp)}`);
        check('not you', t.p.hp === hp0, `${hp0} -> ${Math.round(t.p.hp)}`);
    }
}


// ------------------------------------------------------------------ the keys
// W is up the screen and D is right, whatever you are aiming at: movement and aim are two hands
// that never interfere. Checked against the screen axes, and against the old aim-relative scheme
// that is still there for anyone who picks it.
section('The keys');
{
    const t = start();
    if (G.state.arena) G.state.arena.grace = 999;
    G.state.enemies.length = 0;
    t.clearFurniture(); t.clearGround();
    const r = currentDungeon().arena;
    // How far along each screen axis a second of holding these keys takes you.
    const push = (keys, aim) => {
        t.p.x = r.mx; t.p.z = r.mz; t.p.gx = t.p.gz = 0;
        const x0 = t.p.x, z0 = t.p.z;
        for (let i = 0; i < 10; i++) tick(0.05, { ...keys, dash: false, aim: { x: t.p.x + aim[0], z: t.p.z + aim[1] } });
        const dx = t.p.x - x0, dz = t.p.z - z0;
        return { up: dx * VIEW.up.x + dz * VIEW.up.z, right: dx * VIEW.right.x + dz * VIEW.right.z };
    };
    const aims = [[5, 0], [-5, 0], [0, 5], [3, -4]];
    const w = aims.map(a => push({ fwd: 1, strafe: 0 }, a));
    check('W walks up the screen wherever you aim', w.every(m => m.up > 1.5 && Math.abs(m.right) < 0.05),
          w.map(m => `${m.up.toFixed(1)}/${m.right.toFixed(1)}`).join(' '));
    const dkey = aims.map(a => push({ fwd: 0, strafe: 1 }, a));
    check('and D walks right', dkey.every(m => m.right > 1.5 && Math.abs(m.up) < 0.05));

    G.settings = { move: 'aim' };
    const toward = push({ fwd: 1, strafe: 0 }, [5, 0]);
    G.settings = undefined;
    check('the old scheme walks toward the cursor when chosen', toward.up < 1 && t.p.x > r.mx + 1.5,
          `${(t.p.x - r.mx).toFixed(1)} toward +x`);
}


console.log(fails.length ? `\n${fails.length} FAILED\n` : '\nALL PASSED\n');
process.exit(fails.length ? 1 : 0);
