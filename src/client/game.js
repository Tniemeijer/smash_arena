// ==================== ORCHESTRATOR ====================
// Owns the state object and the tick order. Everything the simulation needs lives in `G.state`
// as plain data -- no class instances, no references into the renderer -- which is what would let
// this be serialised and sent to a second player later without unpicking anything.

import { G, nid, resetIds, maxHp } from './core.js';
import { CLASSES, DEFAULT_LOOK, SCORE, STAGE_NAME, BIOMES } from './data.js';
import { generateFloor, spotIn, setDoor, inAlcove } from './dungeon.js';
import { newPlayer, updatePlayer } from './systems/player.js';
import { populateBoss, updateEnemies } from './systems/enemies.js';
import { playerAttack, updateShots, hurtEnemy } from './systems/combat.js';
import { useAbility } from './systems/abilities.js';
import { placeCrates, updatePickups } from './systems/loot.js';
import { beginArena, updateArena, updateLair, openExits } from './systems/arena.js';
import { stockShop, stallNear } from './systems/shop.js';
import { addScore, tickScore } from './systems/score.js';
import { beginCrowd, tickCrowd } from './systems/crowd.js';
import { beginFires, updateFires, updateSeeds, updateBurning, updateBrambles } from './systems/terrain.js';

export { G, CLASSES };

let dungeon = null;
export const currentDungeon = () => dungeon;

export function newRun(cls, made = {}) {
    resetIds();
    dungeon = generateFloor(1);
    const p = newPlayer(cls);
    // Whatever character creation decided. Carried on the player rather than held beside it, so
    // the whole character is one serialisable object -- which is what a second player would be.
    p.name = made.name || 'Nameless';
    // Copied rather than referenced, and defaulted from the table rather than from a literal
    // here: a look written out by hand in this file goes stale the first time a new field is
    // added to what a body can be. The model sanitises whatever arrives anyway.
    p.look = { ...DEFAULT_LOOK, ...(made.look || {}) };
    // The moves chosen at creation, and which keys they sit on. Both come across as plain arrays
    // for the same reason the skills do: the draft character in the creation screen is the same
    // shape as the live one, so nothing has to be translated between them.
    p.known = made.known || [];
    p.slots = made.slots || [null, null, null, null];
    // Health is set last, because maxHp() reads what is attached above.
    p.hp = maxHp(p);
    const at = spotIn(dungeon.start);
    p.x = at.x; p.z = at.z;
    G.state = {
        player: p, floor: 1, coins: 0,
        enemies: [], crates: [], shots: [], blasts: [], pickups: [],
        inGate: false, over: null,
        // The arcade's books. `chain` is the run of kills that has not gone cold yet and `chainT`
        // is how long it has left; the whole multiplier is those two numbers.
        score: 0, chain: 0, chainT: 0, bossId: null, arena: null, shop: null,
        crowd: beginCrowd(), fires: beginFires(), seeds: [],
        lairDone: false, exitT: 0, hitStop: 0,
        stats: { kills: 0, dealt: 0, floors: 1, crates: 0, found: 0, fabled: 0,
                 bosses: 0, prizes: 0, best: 0 }
    };
    enterFloor(1);
    return G.state;
}

// Everything that has to happen when a floor begins, whichever of the three kinds it is. The
// first floor and every one after it come through here, so a stage can never be half set up
// because one of two paths forgot about it.
//
// The scene is told about the floor and nothing else: it reconciles the player's model against
// whoever it is drawing every frame, so a new character -- or a new sword -- needs no announcing.
function enterFloor(floor) {
    const s = G.state;
    const at = spotIn(dungeon.start);
    s.player.x = at.x; s.player.z = at.z;
    s.shots = []; s.blasts = []; s.pickups = []; s.fires = []; s.seeds = []; s.brambles = [];
    // Whatever was alight is out: the fire that lit it is in the room you just left.
    s.player.burn = 0; s.player.burnTick = 0;
    s.player.gx = 0; s.player.gz = 0; s.player.chill = 0; s.player.kx = 0; s.player.kz = 0;
    s.player.parry = 0; s.player.quickdraw = 0; s.player.steady = 0;
    s.inGate = false;
    s.bossId = null;
    s.arena = null;
    s.crates = [];

    s.shop = null;
    s.lairDone = false;
    s.exitT = 0;
    s.enemies = [];

    if (dungeon.stage === 'shop') {
        // The one room with nothing in it, so its gates are lit the moment you arrive -- there
        // is nothing here to earn them with.
        openExits(dungeon);
        s.shop = stockShop(s.player, floor);
        G.onToast('The Market', 'good');
    } else if (dungeon.stage === 'boss') {
        for (const dw of dungeon.doorways) setDoor(dungeon, dw, false);
        s.enemies = populateBoss(dungeon, floor);      // it announces itself
    } else {
        // Nothing is placed in advance: an arena is empty until the first gate goes up.
        s.arena = beginArena(dungeon, floor);
        s.crates = placeCrates(dungeon, floor);
        // The room says what it is before the first gate goes up. What that MEANS -- the ice
        // will not hold you, the oil is waiting for a spark -- only the first time you see the
        // place; after that its name is enough.
        const b = BIOMES[dungeon.biome];
        s.seenBiomes = s.seenBiomes || {};
        const first = !s.seenBiomes[dungeon.biome];
        s.seenBiomes[dungeon.biome] = true;
        if (b) G.onToast(first ? `${b.name}. ${b.say}` : b.name, 'bad');
    }
    // Hung on the shared runtime so the HUD can label the gates without being handed the room
    // through four function signatures.
    G.dungeon = dungeon;
    if (G.scene) G.scene.buildDungeon(dungeon);
}

// What kind of floor this is, for anything that wants to say so out loud.
export const stageName = () => STAGE_NAME[dungeon && dungeon.stage] || '';

// Down a floor. The player carries their level and whatever health they have left, which is what
// makes the choice to press on rather than explore a real one.
// Down a floor whenever you are stood on the stair. It used to demand the floor be cleared
// first, which sounded like a design and played like a chore: the last two enemies are usually
// asleep in a room you never had reason to enter, so the stair sat inert with no way to know why.
// Leaving early forfeits the experience you did not collect, which is cost enough.
// Which way out you have walked into, if any. An alcove is only reachable through its gate and a
// gate only opens when the room is finished, so being in one at all means you are leaving -- there
// is no guard to write, only a question to answer: which door?
function gateUnder(s) {
    if (!dungeon.exitGates) return null;
    for (const i of dungeon.exitGates) {
        const dw = dungeon.doorways[i];
        if (dw.open && inAlcove(dw, s.player.x, s.player.z)) return dw;
    }
    return null;
}

export function descend() {
    const s = G.state;
    if (!s || s.over) return false;
    const gate = gateUnder(s);
    if (!gate) return false;

    // Getting out of a room alive is worth something in itself, and worth more the deeper it was.
    addScore(SCORE.floor * (1 + 0.25 * (s.floor - 1)), 'floor');

    s.floor++;
    s.stats.floors = s.floor;
    dungeon = generateFloor(s.floor);
    enterFloor(s.floor);
    G.sfx('level');
    return true;
}

// The counter you are close enough to trade at, for the prompt and for the E key.
export const nearStall = () => {
    const s = G.state;
    if (!s || s.over || !s.shop) return null;
    return stallNear(dungeon, s.player.x, s.player.z);
};
G.nearStall = nearStall;

export function attack(aim) {
    const s = G.state;
    if (!s || s.over) return;
    playerAttack(aim.x, aim.z);
}

// A number key. The index is which key, not which move: what sits there is the character's
// business, and it can be changed between fights.
export function special(index, aim) {
    const s = G.state;
    if (!s || s.over) return false;
    return useAbility(index, aim);
}

export function tick(dt, intent) {
    const s = G.state;
    if (!s || !dungeon) return;
    // A finished run still renders -- you look at where you died -- but nothing in it moves.
    if (s.over) return;

    // Hit stop. A couple of frames where the world holds still, spent on the two moments worth
    // spending them on: something big dying, and you being hit. It costs nothing, it is invisible
    // as a mechanic, and without it every impact in the game lands with the same weight.
    if (s.hitStop > 0) { s.hitStop -= dt; return; }

    updatePlayer(dungeon, dt, intent);
    updateEnemies(dungeon, dt);
    updateShots(dungeon, dt);
    updatePickups(dt);
    // The gauntlet's director runs after the fight it is directing, so a wave wiped out this
    // frame is noticed this frame rather than the next one.
    if (s.arena) updateArena(dungeon, dt);
    updateFires(dungeon, dt);
    updateBurning(dt);
    updateSeeds(dt);
    updateBrambles(dt);
    tickCrowd(dt);
    if (dungeon.stage === 'boss') updateLair(dungeon, dt);
    tickScore(dt);

    // Walking through a lit gate takes it. No key press: a passage behind a gate you had to earn
    // is already a decision, and asking for a keystroke on top of it is a keystroke for nothing.
    // The short dwell is only so that brushing the threshold at a dead run does not count as
    // having chosen.
    s.inGate = !!gateUnder(s);
    if (s.inGate) {
        s.exitT += dt;
        if (s.exitT > 0.4) descend();
    } else s.exitT = 0;
    for (const c of s.crates) c.flash = Math.max(0, c.flash - dt);

    for (const b of [...s.blasts]) {
        b.t += dt;
        if (b.t > 0.34) s.blasts = s.blasts.filter(x => x !== b);
    }
}
