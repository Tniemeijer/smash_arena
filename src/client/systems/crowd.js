// ==================== THE CROWD ====================
// They paid to be here and they are not shy about whether it was worth it.
//
// Favour is a second opinion of how you are playing, running alongside the score and saying the
// same thing in a different language. It rises when you press -- chained kills, elites, a kill
// taken while you were nearly dead -- and it bleeds the moment nothing is happening. That bleed
// is the only thing in the game that argues against backing into a corner and waiting, which is
// otherwise always the safe play and never the interesting one.
//
// What they do with it is throw things. Not a buff, not a number: a stone comes over the wall and
// lands on the sand and you have to go and pick it up, in the middle of whatever you were doing.

import { G } from '../core.js';
import { CROWD, CROWD_MOODS } from '../data.js';
import { throwCoins, throwPurse } from './loot.js';

export const beginCrowd = () => ({ favour: CROWD.start, quiet: 0, roaring: false, gifts: 0,
                                   tipT: CROWD.tipEvery, thrown: 0 });

// Where the meter stands, in words. Nobody is reading a number off this -- they are noticing that
// it has gone quiet.
export function crowdMood(favour) {
    let mood = CROWD_MOODS[0];
    for (const m of CROWD_MOODS) if (favour >= m.at) mood = m;
    return mood;
}

function stir(amount) {
    const s = G.state;
    if (!s || !s.crowd) return;
    const c = s.crowd;
    c.favour = Math.max(0, Math.min(CROWD.max, c.favour + amount));
    if (amount > 0) c.quiet = 0;

    // They notice when it gets good.
    const loud = c.favour >= CROWD.roar;
    if (loud !== c.roaring) {
        c.roaring = loud;
        if (loud) G.sfx('roar');
    }
    // And they throw something when you have earned it. Given rather than dropped: it comes over
    // the wall and lands near you, which is a different feeling from finding one on a corpse.
    if (c.favour >= CROWD.gift) {
        c.favour -= CROWD.giftCost;
        c.gifts++;
        throwPurse();
        G.sfx('roar');
    }
}

// A kill. Worth more in a chain, worth far more if it was an elite, and worth more again if you
// were nearly dead when you took it -- which is the moment they came to see.
export function crowdKill(e, multiplier, hpFrac) {
    const gain = (e.boss ? CROWD.boss : e.elite ? CROWD.elite : CROWD.kill)
               + CROWD.chain * Math.max(0, multiplier - 1)
               + (hpFrac < 0.34 ? CROWD.closeCall : 0);
    stir(gain);
}

export const crowdWave = () => stir(CROWD.wave);

// Nothing happening is the one thing they will not sit through -- and while something is, they
// keep flicking coins down. The trickle matters as much as the purse: it means a good fight is
// paying you the whole way through it, not only when a meter fills.
export function tickCrowd(dt) {
    const s = G.state;
    if (!s || !s.crowd || s.over) return;
    const c = s.crowd;
    c.quiet += dt;
    if (c.quiet > CROWD.quiet) stir(-CROWD.decay * dt);

    if (c.favour < CROWD.tipFrom) { c.tipT = CROWD.tipEvery; return; }
    // The louder they are, the faster it comes.
    c.tipT -= dt * (0.6 + (c.favour / CROWD.max) * 1.6);
    if (c.tipT > 0) return;
    c.tipT = CROWD.tipEvery;
    const n = 1 + Math.floor(Math.random() * 2);
    throwCoins(n);
    c.thrown += n;
    G.sfx('pickup');
}
