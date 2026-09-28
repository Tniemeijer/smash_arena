// ==================== THE MARKET ====================
// Every fifth room, and always the one straight after a boss: between bouts they let a trader
// down to the cells, and whatever the crowd threw at you is suddenly worth something.
//
// It sells three things, and they are three different kinds of promise: a number that is yours
// for the rest of the run, a move that is yours for good, and a stone that is yours for fifteen
// seconds. Nothing here is gear -- there is none left in the game -- so the question is never
// "which sword" but "what am I becoming".
//
// The stock is rolled once when you walk in and stored on the run, not regenerated per render: a
// table that reshuffles while you are looking at it is a table you cannot decide from.

import { G, maxHp, upgradePrice, upgradeRank, upgradeMaxed } from '../core.js';
import { SHOP, UPGRADES, POWERUPS } from '../data.js';
import { poolFor, isKnown, teach } from './abilities.js';

const priced = (base, floor) => Math.round(base * (1 + SHOP.depthPrice * (floor - 1)));
const shuffle = (list) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
};

export function stockShop(p, floor) {
    // Moves you could use and have not been taught. The level gate still applies, so this is a
    // shortcut through the level curve rather than a way round it.
    const canTeach = poolFor(p.cls).filter(a => !isKnown(p, a.id) && p.level >= (a.req || 1));
    const moves = shuffle(canTeach).slice(0, SHOP.moves)
        .map(a => ({ id: a.id, price: priced(SHOP.move, floor), sold: false }));

    // And stones. Only ones this calling can use, because the trader knows who is buying.
    const usable = Object.keys(POWERUPS).filter(k => !POWERUPS[k].only || POWERUPS[k].only === p.cls);
    const powers = shuffle(usable).slice(0, SHOP.powers)
        .map(k => ({ id: k, price: priced(SHOP.power, floor), sold: false }));

    return { floor, moves, powers, mend: { price: priced(SHOP.mend, floor), sold: false } };
}

// ---------- buying ----------
// One entry point, because every purchase is the same three steps: can you afford it, does it
// apply, and take the coin. Returns a line to toast so the caller never has to know what was
// bought.
export function buy(kind, key) {
    const s = G.state;
    const shop = s && s.shop;
    if (!shop) return null;
    const p = s.player;

    if (kind === 'upgrade') {
        const up = UPGRADES[key];
        if (!up || upgradeMaxed(p, key)) return null;
        const price = upgradePrice(p, key, shop.floor);
        if (s.coins < price) return null;
        s.coins -= price;
        p.upgrades[key] = upgradeRank(p, key) + 1;
        // Vigour is the one upgrade that would otherwise be invisible until the next time
        // something hit you, so the health it adds arrives filled.
        if (up.effect.hp) p.hp += up.effect.hp;
        G.sfx('level');
        return { text: `${up.name} ${p.upgrades[key]} — ${up.desc}`, good: true };
    }

    if (kind === 'move') {
        const m = shop.moves[key];
        if (!m || m.sold || s.coins < m.price) return null;
        if (!teach(p, m.id)) return null;
        s.coins -= m.price;
        m.sold = true;
        return { text: 'Taught. It is on a key already', good: true };
    }

    if (kind === 'power') {
        const it = shop.powers[key];
        if (!it || it.sold || s.coins < it.price) return null;
        const def = POWERUPS[it.id];
        s.coins -= it.price;
        it.sold = true;
        // Bought stones burn from the moment they are handed over, same as the ones off the sand.
        // Buying one on the way out of the market is the point: it is a fifteen-second head start
        // on the next room, spent when you choose rather than when it lands at your feet.
        for (const [k, v] of Object.entries(def.buff)) p.buffs[k] = { v, t: def.time };
        G.sfx('power');
        return { text: `${def.name} — ${def.desc}`, good: true };
    }

    if (kind === 'mend') {
        const m = shop.mend;
        if (m.sold || s.coins < m.price || p.hp >= maxHp(p)) return null;
        s.coins -= m.price;
        m.sold = true;
        const before = p.hp;
        p.hp = maxHp(p);
        G.sfx('pickup');
        return { text: `Patched up. +${Math.round(p.hp - before)}`, good: true };
    }
    return null;
}

// Which counter you are close enough to trade at, if any. Generous, because the counters are
// solid now and you cannot stand on top of one.
export function stallNear(d, x, z) {
    if (!d || !d.stalls) return null;
    for (const st of d.stalls)
        if (Math.hypot(st.x - x, st.z - z) < 2.4) return st;
    return null;
}
