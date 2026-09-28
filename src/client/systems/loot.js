// ==================== WHAT THINGS LEAVE BEHIND ====================
// Rolling drops and breaking crates. Kept apart from combat so the question "what did that leave"
// is answered in one place, whether the thing that died was a skeleton or a box.
//
// There is no gear any more: a body leaves coin, sometimes a drink, and now and then one of the
// coloured stones the crowd throws down -- which is worth about fifteen seconds and then gone.

import { G, nid, dist } from '../core.js';
import { DROP_COIN, DROP_POTION, DROP_POWER, CRATE_COIN, CRATE_HP, CRATES_PER_FLOOR,
         POWERUPS, PRIZES, PRIZE_TIERS, POTION_HEAL, PICKUP, CROWD } from '../data.js';
import { canStand, setTile, FLOOR, PROP } from '../dungeon.js';
import { addScore } from './score.js';

const between = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));

export function dropFromKill(e) {
    const s = G.state;
    const at = { x: e.x, z: e.z };
    s.pickups.push({ id: nid(), kind: 'coin', amount: between(DROP_COIN), ...at, t: 0 });
    if (Math.random() < DROP_POTION) s.pickups.push({ id: nid(), kind: 'potion', ...scatter(at), t: 0 });
    if (Math.random() < DROP_POWER)
        s.pickups.push({ id: nid(), kind: 'power', power: rollPowerup(s.player.cls), ...scatter(at), t: 0 });
}

// A crate is worth a swing: a purse, usually a drink, and now and then a stone.
export function breakCrate(c) {
    const s = G.state;
    s.crates = s.crates.filter(x => x !== c);
    // Give the tile back. A crate that is gone must stop being somewhere you cannot walk, or the
    // room quietly fills up with invisible furniture over the course of a fight.
    if (c.tile) setTile(G.dungeon, c.tile.x, c.tile.z, FLOOR);
    s.pickups.push({ id: nid(), kind: 'coin', amount: between(CRATE_COIN), x: c.x, z: c.z, t: 0 });
    if (Math.random() < 0.45) s.pickups.push({ id: nid(), kind: 'potion', ...scatter({ x: c.x, z: c.z }), t: 0 });
    if (Math.random() < 0.3)
        s.pickups.push({ id: nid(), kind: 'power', power: rollPowerup(s.player.cls), ...scatter({ x: c.x, z: c.z }), t: 0 });
    s.stats.crates++;
    G.sfx('crate');
}

// ---------- what a room pays out ----------
// What a cleared room and a dead boss leave behind. Deliberately the same function for both, with
// different odds: the payout for a fight should differ in size, not in kind, or the game starts
// having two economies.
export function dropReward(room, o = {}) {
    const s = G.state;
    const at = { x: room.mx ?? (room.x + room.w / 2), z: room.mz ?? (room.z + room.h / 2) };
    const coin = o.coin ? between(o.coin) : 0;
    if (coin) s.pickups.push({ id: nid(), kind: 'coin', amount: coin, ...scatter(at), t: 0 });
    if (Math.random() < (o.powerup || 0))
        s.pickups.push({ id: nid(), kind: 'power', power: rollPowerup(s.player.cls), ...scatter(at), t: 0 });
    if (Math.random() < (o.prize || 0))
        s.pickups.push({ id: nid(), kind: 'prize', prize: rollPrize(), ...scatter(at), t: 0 });
    if (Math.random() < (o.potion ?? 0.4))
        s.pickups.push({ id: nid(), kind: 'potion', ...scatter(at), t: 0 });
}

// A boss is the only fight in the game guaranteed to be worth it: two stones, a prize and a
// purse, because the room before it was long and the one after is worse.
export function dropFromBoss(e) {
    const at = { x: e.x, z: e.z };
    const s = G.state;
    s.pickups.push({ id: nid(), kind: 'coin', amount: 90 + Math.floor(Math.random() * 90), ...at, t: 0 });
    for (let i = 0; i < 2; i++)
        s.pickups.push({ id: nid(), kind: 'power', power: rollPowerup(s.player.cls), ...scatter(at), t: 0 });
    s.pickups.push({ id: nid(), kind: 'prize', prize: rollPrize(true), ...scatter(at), t: 0 });
    for (let i = 0; i < 2; i++) s.pickups.push({ id: nid(), kind: 'potion', ...scatter(at), t: 0 });
}

// Only stones this one can use: two that anybody can, plus the two cut for their calling. A
// Knight handed a fistful of arrows has been handed nothing.
export function rollPowerup(cls) {
    const keys = Object.keys(POWERUPS).filter(k => !POWERUPS[k].only || POWERUPS[k].only === cls);
    return keys[Math.floor(Math.random() * keys.length)];
}
// `rich` leans the roll up a tier, which is how a boss ends up leaving a crown and an ordinary
// room usually leaves a cup.
function rollPrize(rich = false) {
    let roll = Math.random() * (rich ? 0.55 : 1);
    for (const [k, w] of Object.entries(PRIZE_TIERS)) { if (roll < w) return k; roll -= w; }
    return Object.keys(PRIZES)[0];
}

// Money over the wall. It falls -- `drop` is how high it still has to come, which the renderer
// reads -- and it scatters, so a purse is something you have to go and collect in the middle of
// whatever you were doing rather than something that lands in your pocket.
//
// This is what the crowd's approval is FOR. Coin is the only currency in the pit that buys
// anything, so fighting the way they came to see is not merely worth points, it is worth arming
// yourself at the next market.
function fromTheStands(kind, extra, spread) {
    const s = G.state, p = s.player;
    const a = Math.random() * Math.PI * 2, r = 1.2 + Math.random() * spread;
    const at = { x: p.x + Math.sin(a) * r, z: p.z + Math.cos(a) * r };
    const spot = canStand(G.dungeon, at.x, at.z, 0.4) ? at : { x: p.x, z: p.z };
    s.pickups.push({ id: nid(), kind, ...extra, x: spot.x, z: spot.z, t: 0,
                     drop: 4.5 + Math.random() * 2.5, thrown: true });
}

// The odd coin, flicked down by somebody who liked that.
export function throwCoins(n) {
    for (let i = 0; i < n; i++) fromTheStands('coin', { amount: 1 + Math.floor(Math.random() * 3) }, 2.2);
}

// A proper purse, and often a stone with it.
export function throwPurse() {
    const s = G.state;
    const coins = between(CROWD.purse);
    for (let i = 0; i < Math.min(6, Math.ceil(coins / 3)); i++)
        fromTheStands('coin', { amount: Math.max(1, Math.round(coins / Math.ceil(coins / 3))) }, 3.2);
    if (Math.random() < CROWD.stone)
        fromTheStands('power', { power: rollPowerup(s.player.cls) }, 2.6);
}

// Spread drops a little so a pile of three does not stack into one unreadable glow.
const scatter = (at) => ({ x: at.x + (Math.random() - 0.5) * 0.7, z: at.z + (Math.random() - 0.5) * 0.7 });

export function placeCrates(d, floor) {
    const out = [];
    const room = d.arena;
    if (!room) return out;
    const n = between(CRATES_PER_FLOOR) + Math.floor(floor / 4);
    // Where you come in, so nothing is placed on top of you and the first thing you see is the
    // room rather than a prize.
    const from = { x: room.mx, z: room.z + room.h - 2.5 };
    for (let i = 0; i < n; i++) {
        let at = null;
        for (let tries = 0; tries < 20 && !at; tries++) {
            const x = room.x + 1.5 + Math.random() * (room.w - 3);
            const z = room.z + 1.5 + Math.random() * (room.h - 3);
            if (!canStand(d, x, z, 0.45)) continue;
            if (dist(x, z, from.x, from.z) < 4) continue;
            at = { x, z };
        }
        if (!at) continue;
        // A crate takes its tile, like every other thing in the room with a body. It was the last
        // piece of furniture you could walk through, which made it read as painted on -- and as
        // cover it is worth more than it ever was as scenery: something to put between you and a
        // charger, at the cost of the loot inside it.
        // Snapped to the middle of its tile. A crate used to be placed anywhere inside the tile
        // it then made solid, so its body could sit half a tile away from the thing that actually
        // blocks you -- you were stopped by one edge while the box you were swinging at was over
        // by the other. Now the box is the tile.
        const tile = { x: Math.floor(at.x), z: Math.floor(at.z) };
        setTile(d, tile.x, tile.z, PROP);
        out.push({ id: nid(), x: tile.x + 0.5, z: tile.z + 0.5,
                   hp: CRATE_HP, maxHp: CRATE_HP, size: 0.5,
                   flash: 0, crate: true, tile });
    }
    return out;
}

// Walking over things. Coin and potions apply where they lie; an item goes on if its slot is
// empty and into the bag otherwise, so the flow of a fight is never interrupted by a menu -- the
// menu is there when you want it, not when the floor decides.
export function updatePickups(dt) {
    const s = G.state, p = s.player;
    const full = p.hp >= G.maxHp(p);
    for (const it of [...s.pickups]) {
        it.t += dt;
        // Still in the air. It cannot be picked up or dragged until it lands.
        if (it.drop > 0) { it.drop = Math.max(0, it.drop - dt * 9); continue; }
        // A draught you cannot use is left where it lies -- it does not fly to you and it is not
        // drunk by walking over it. Wasting the one heal on the floor because you crossed it at
        // full health is the sort of small robbery a player remembers.
        const spare = it.kind === 'potion' && full;
        const d = dist(it.x, it.z, p.x, p.z);
        if (d > PICKUP.reach) {
            if (d < PICKUP.magnet && !spare && d > 1e-4) {
                // Hardest at the end, so a drop drifts toward you and then snaps into your hand.
                const pull = PICKUP.minPull + (PICKUP.pull - PICKUP.minPull) * (1 - d / PICKUP.magnet);
                it.x += (p.x - it.x) / d * pull * dt;
                it.z += (p.z - it.z) / d * pull * dt;
            }
            continue;
        }
        if (spare) continue;
        if (it.kind === 'coin') {
            s.coins += it.amount;
        } else if (it.kind === 'potion') {
            const before = p.hp;
            p.hp = Math.min(G.maxHp(p), p.hp + G.maxHp(p) * POTION_HEAL);
            G.onDamage(p.x, p.z, Math.round(p.hp - before), 'heal');
        } else if (it.kind === 'power') {
            // A power-up is a buff with a loud name. It goes through the same vocabulary a special
            // move's buff uses, so the HUD already knows how to show it and skillMods already
            // knows how to read it -- the only new thing in the game is the box it came in.
            const def = POWERUPS[it.power];
            for (const [key, v] of Object.entries(def.buff)) p.buffs[key] = { v, t: def.time };
            // What it does, the first time you pick one up in a run; after that you know, and
            // the name on the buff row is enough.
            s.seenPowers = s.seenPowers || {};
            G.onToast(s.seenPowers[it.power] ? def.name : `${def.name} — ${def.desc}`, 'good');
            s.seenPowers[it.power] = true;
        } else if (it.kind === 'prize') {
            const def = PRIZES[it.prize];
            s.coins += def.coin;
            addScore(def.score, 'prize');       // the score pops it; no need to say it twice
            s.stats.prizes = (s.stats.prizes || 0) + 1;
        }
        s.pickups = s.pickups.filter(x => x !== it);
        G.sfx(it.kind === 'prize' ? 'relic' : it.kind === 'power' ? 'power' : 'pickup');
    }
}
