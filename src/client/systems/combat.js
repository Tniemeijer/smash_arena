// ==================== HITTING THINGS ====================
// One place where damage is resolved, whoever dealt it. Both sides of the fight come through
// here, so the rules (mercy windows, knockback, death) can't drift apart between them.

import { G, nid, dist, angleDiff, classDef, damageMul, maxHp, xpForLevel, mods } from '../core.js';
import { INVULN_AFTER_HIT, SCORE, ENEMIES, ELITE, WAKE_DAMAGE, TERRAIN } from '../data.js';
import { moveWithSlide, isSolid } from '../dungeon.js';
import { dropFromKill, dropFromBoss, breakCrate } from './loot.js';
import { justEarnedAMove } from './abilities.js';
import { addScore, scoreKill, recordScore, multiplier } from './score.js';
import { crowdKill } from './crowd.js';
import { igniteAt } from './terrain.js';

// Everything an attack can land on. Crates are not enemies -- they do not move, think or hurt you
// -- but they are hit by exactly the same swings, so the three attack shapes iterate this rather
// than knowing about two separate lists.
export const targets = () => [...G.state.enemies, ...G.state.crates];

export function hurtEnemy(e, amount, fromX, fromZ, knock = 0) {
    const s = G.state;
    // A crate takes the hit and splinters; none of the conditional damage below applies to
    // scenery, and neither does knockback -- a box that slides across the room is comedy.
    if (e.crate) {
        e.hp -= amount;
        e.flash = 0.12;
        G.onDamage(e.x, e.z, Math.round(amount), 'hit');
        if (e.hp <= 0) { breakCrate(e); addScore(SCORE.crate, 'crate'); }
        return;
    }
    // Hitting something asleep wakes it, and wakes it hard. That is the trade the Lullaby makes:
    // a quiet room, bought with the knowledge that you have to spend it before it wears off.
    if (e.sleep > 0) {
        amount *= WAKE_DAMAGE;
        e.sleep = 0;
        G.onDamage(e.x, e.z, Math.round(amount), 'crit');
    }
    s.stats.dealt += amount;
    e.hp -= amount;
    e.flash = 0.12;                       // the white blink that makes a hit land visually
    G.onDamage(e.x, e.z, Math.round(amount), 'hit');
    if (knock > 0) {
        const d = Math.hypot(e.x - fromX, e.z - fromZ) || 1;
        e.kx = (e.x - fromX) / d * knock;
        e.kz = (e.z - fromZ) / d * knock;
    }
    if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
    const s = G.state;
    s.enemies = s.enemies.filter(x => x !== e);
    // A bloat bursts however it dies. Shooting one across the room is free; killing one that has
    // walked into the middle of everything is a decision you should have made earlier.
    const def = ENEMIES[e.kind] || {};
    if (e.ai === 'bloat' && !e.burst) {
        e.burst = true;
        hostileBlast(e.x, e.z, (def.blast || 2.4) * (e.elite ? 1.25 : 1),
                     (def.blastDamage || 18) * (e.elite ? 1.35 : 1));
    }
    // A puff where it stood. Nothing hits anything -- it is there so that a body leaving the
    // screen is an event rather than a disappearance.
    s.blasts.push({ id: nid(), x: e.x, z: e.z, r: e.size * 1.5, t: 0, puff: true });
    // Something big going down stops the world for a couple of frames. Used sparingly: on every
    // rat it would read as the game stuttering, and on nothing at all a boss dies like a rat.
    if (e.elite || e.boss) s.hitStop = Math.max(s.hitStop || 0, e.boss ? 0.14 : 0.08);
    s.stats.kills++;
    scoreKill(e, s.floor);
    // The crowd saw it, and cares how close it was.
    crowdKill(e, multiplier(s), s.player.hp / maxHp(s.player));
    gainXp(e.xp);
    dropFromKill(e);
    G.sfx('kill');
    // The thing the floor was named after. Worth a great deal of score, a great deal of loot, and
    // the only kill in the game that gets its own line.
    if (e.boss) {
        s.bossId = null;
        s.stats.bosses = (s.stats.bosses || 0) + 1;
        const gained = addScore(SCORE.boss, 'boss');
        G.onToast(`${e.name} falls. +${gained}`, 'good');
        dropFromBoss(e);
    }
}

export function gainXp(n) {
    const s = G.state, p = s.player;
    p.xp += n;
    while (p.xp >= xpForLevel(p.level)) {
        p.xp -= xpForLevel(p.level);
        p.level++;
        p.hp = maxHp(p);                  // a level-up is a full heal, and the reason to push on
        G.onToast(justEarnedAMove(p.level)
            ? `Level ${p.level}. A new move to learn (J)`
            : `Level ${p.level}. Tougher, and hitting harder`, 'good');
        G.sfx('level');
    }
}

// `opts.mercy: false` is for harm that is not a blow -- burning, so far. It neither respects the
// mercy window nor grants one, and both halves of that matter. Fire went through the ordinary
// path at first, and the result was that a fraction of a point of burn damage bought you 0.35
// seconds of invulnerability to everything else in the room: standing in the flames was the
// safest place to be, and the fire itself did about half a point a second. A fire has to be a
// place you cannot stand, or it is only scenery.
export function hurtPlayer(amount, opts = {}) {
    const s = G.state, p = s.player;
    if (s.over) return false;
    const mercy = opts.mercy !== false;
    if (mercy && p.invuln > 0) return false;
    // Shield up. A blow is turned aside -- only a blow: a fire you are standing in is not
    // something a shield can do anything about -- and whoever threw it is paid back.
    if (mercy && p.parry > 0) { riposte(opts.from); return false; }
    amount *= mods(p).taken;
    p.hp -= amount;
    if (mercy) p.invuln = INVULN_AFTER_HIT;
    p.hurtFlash = 0.25;
    // And when it is you. A moment of stopped time is the difference between noticing you were
    // hit and looking at your health bar afterwards wondering when. Not for a burn: stopping
    // time three times a second while you stand in a fire is a stutter, not a punch.
    if (mercy) s.hitStop = Math.max(s.hitStop || 0, 0.06);
    G.onDamage(p.x, p.z, Math.round(amount), opts.kind || 'hurt');
    G.sfx(opts.sfx || 'hurt');
    if (p.hp <= 0) {
        p.hp = 0;
        s.over = { reason: 'died', floor: s.floor, stats: { ...s.stats }, level: p.level, cls: p.cls,
                   name: p.name, coins: s.coins, score: s.score };
        s.over.place = recordScore(s.over);
        G.sfx('death');
    }
    // Whether it landed, for the few blows that do something beyond the damage.
    return true;
}

// The payback. Against a body it is a hard counter-cut and a stagger; without one (a blast,
// something with no hands) the blow is still turned aside, it simply has nobody to answer.
export function riposte(from) {
    const s = G.state, p = s.player;
    const def = p.parryDef || { damage: 30, knock: 8, stun: 1.2 };
    p.parry = 0;
    p.invuln = Math.max(p.invuln, 0.45);
    p.swingKind = 'bash'; p.swing = p.swingTime = 0.22;
    s.hitStop = Math.max(s.hitStop || 0, 0.09);
    G.onDamage(p.x, p.z, 'parry', 'crit');
    G.sfx('crate');
    if (from && s.enemies.includes(from)) {
        hurtEnemy(from, def.damage * damageMul(p), p.x, p.z, def.knock);
        from.slow = Math.max(from.slow || 0, def.stun);
        from.wind = 0; from.rush = 0;
        from.cool = Math.max(from.cool || 0, def.stun);
    }
}

// Brambles: a patch of thorns that holds back whatever walks through it for a moment. Planted
// by a druid's burst, and by a druid's dash where it started.
export function plantBrambles(x, z, r, time) {
    const s = G.state;
    if (!s.brambles) s.brambles = [];
    s.brambles.push({ id: nid(), x, z, r, t: time, life: time });
}

// ---------- the three attack shapes ----------
// Called when the player swings or looses. Which shape runs is the only thing that differs
// between the four classes at the moment of attacking.
export function playerAttack(aimX, aimZ) {
    const s = G.state, p = s.player;
    if (p.cool > 0 || s.over) return false;
    const def = classDef(p), a = def.attack, m = mods(p);
    p.cool = a.cooldown * m.cooldown;
    p.swing = 0.18; p.swingTime = 0.18;   // drives the weapon animation
    const facing = Math.atan2(aimX - p.x, aimZ - p.z);
    p.facing = facing;

    if (a.kind === 'arc') {
        // A sword alternates. Strictly, so it is a rhythm you can count rather than a coin flip:
        // the slash is wide and the thrust is a line, and knowing which is next is most of what
        // makes them worth having.
        let alt = a.alt ? a.alt[(p.swingAlt = p.swingAlt === 'slash' ? 'stab' : 'slash')]
                        : { arc: 1, range: 1, damage: 1, knock: 1 };
        p.swingKind = a.alt ? p.swingAlt : (p.cls === 'bard' ? 'strum' : 'slash');
        // A lute counts to four. Every swing is counted, landed or not, because a rhythm that
        // only advances when you hit something is not a rhythm you can play to.
        let chord = false;
        if (a.chord) {
            p.strum = (p.strum || 0) + 1;
            if (p.strum >= a.chord.every) { chord = true; p.strum = 0; alt = a.chord; p.swingKind = 'play'; }
        }
        // A thrust takes a moment longer to come back, which is the price of its reach.
        p.swingTime = p.swing = p.swingKind === 'stab' ? 0.22 : 0.18;
        // A swing cannot come in threes, so anything that multiplies a throw buys a swinger reach
        // and width instead -- every stone on the sand is worth picking up whoever you are.
        const wide = 1 + 0.16 * m.spread;
        // The chord's arc is an absolute 360, not a multiple of the strum's.
        const arc = chord ? 360 : Math.min(360, a.arc * m.arc * wide * alt.arc);
        const reach = (a.range + m.reach) * wide * alt.range;
        const hits = coneHit(p, facing, reach, arc,
                             a.damage * damageMul(p) * alt.damage,
                             (a.knock || 0) * m.knock * alt.knock, a.slow || 0);
        if (chord) {
            // The ring the whole room sees, and the one time a basic attack gets a sound of its own.
            s.blasts.push({ id: nid(), x: p.x, z: p.z, r: reach, t: 0, song: true });
            G.sfx('song');
        } else G.sfx(hits ? 'swingHit' : 'swing');
    } else {
        p.swingKind = a.kind === 'burst' ? 'cast' : 'shoot';
        // bolt and burst are the same object in flight; what differs is what happens when it
        // stops, which `blast` decides.
        // One shot, plus any extras a skill has granted, fanned either side of where you aimed.
        const shots = 1 + m.spread;
        // Steadiness. Counted per arrow loosed while standing still, and lost the moment you
        // walk (see updatePlayer). The third is a Sure Shot -- and so is the first after a dash.
        let sure = false;
        if (a.steady) {
            if (p.quickdraw > 0) { sure = true; p.quickdraw = 0; p.steady = 0; }
            else if ((p.steady = (p.steady || 0) + 1) >= a.steady) { sure = true; p.steady = 0; }
        }
        for (let i = 0; i < shots; i++) {
            const spread = shots === 1 ? 0 : (i - (shots - 1) / 2) * 0.26;
            spawnShot(p, facing + spread, {
                damage: a.damage * damageMul(p) * (sure ? a.sure.damage : 1),
                speed: a.speed * (sure ? a.sure.speed : 1), range: a.range + m.reach,
                blast: (a.blast || 0) * m.blast,
                // Through everything in the line. A Sure Shot is the answer to a queue.
                pierce: sure ? 99 : (a.pierce || 0),
                kind: sure ? 'sure' : a.kind, bramble: a.bramble || null
            });
        }
        G.sfx(sure ? 'relic' : 'shoot');
    }
    return true;
}

// ---------- the shapes, on their own ----------
// The basic attack and the special moves are the same three things -- a cone, a projectile, a
// blast -- with different numbers. Factoring them out here is what lets a new move be a line of
// data rather than a new copy of the hit loop, and it means a fix to how a cone decides what it
// caught fixes it for every move at once.

// Everything inside `arcDeg` degrees of `facing`, out to `reach`. Returns how many it caught, so
// the caller can pick between the hit and the miss sound.
export function coneHit(p, facing, reach, arcDeg, damage, knock = 0, slow = 0) {
    const half = (arcDeg / 2) * Math.PI / 180;
    let hits = 0;
    for (const e of targets()) {
        if (dist(p.x, p.z, e.x, e.z) > reach + e.size) continue;
        // A full circle has no facing to be outside of, which is what makes `nova` moves work
        // through this same function.
        if (arcDeg < 360) {
            const to = Math.atan2(e.x - p.x, e.z - p.z);
            if (Math.abs(angleDiff(facing, to)) > half) continue;
        }
        hurtEnemy(e, damage, p.x, p.z, knock);
        if (slow) e.slow = Math.max(e.slow, slow);
        hits++;
    }
    return hits;
}

export function spawnShot(p, dir, o) {
    const speed = o.speed || 14;
    G.state.shots.push({
        id: nid(), x: p.x, z: p.z,
        vx: Math.sin(dir) * speed, vz: Math.cos(dir) * speed,
        life: (o.range || 10) / speed, damage: o.damage,
        blast: o.blast || 0, pierce: o.pierce || 0, slow: o.slow || 0,
        hit: new Set(), kind: o.kind || 'bolt',
        ignites: !!o.ignites, bramble: o.bramble || null
    });
}

// A blast with no projectile in front of it: what a move detonates at your feet, or where you
// pointed, without anything having to fly there first.
export function blastAt(x, z, r, damage, knock = 2.2, slow = 0) {
    const s = G.state;
    s.blasts.push({ id: nid(), x, z, r, t: 0 });
    // Anything that goes off lights any oil it goes off on. Yours included -- a druid who bursts
    // a seed on a slick has drawn a line across the room and has to live on one side of it.
    igniteAt(G.dungeon, x, z, r);
    for (const e of targets())
        if (dist(x, z, e.x, e.z) <= r + e.size) {
            hurtEnemy(e, damage, x, z, knock);
            if (slow) e.slow = Math.max(e.slow, slow);
        }
    G.sfx('blast');
}

// ---------- things that shoot back ----------
// Until a boss existed, everything in flight belonged to the player, and `updateShots` could
// assume a shot was looking for an enemy. These two are the other direction: same list, same
// movement, same wall rules, but they look for you.
export function hostileShot(from, dir, damage, speed = 8, extra = {}) {
    G.state.shots.push({
        id: nid(), x: from.x, z: from.z,
        vx: Math.sin(dir) * speed, vz: Math.cos(dir) * speed,
        life: 3.2, damage, blast: 0, pierce: 0, slow: 0,
        hit: new Set(), kind: 'hex', hostile: true, ...extra
    });
}
export function hostileBlast(x, z, r, damage, slow = 0) {
    const s = G.state, p = s.player;
    s.blasts.push({ id: nid(), x, z, r, t: 0, hostile: true });
    igniteAt(G.dungeon, x, z, r);
    if (dist(x, z, p.x, p.z) <= r) hurtPlayer(damage);
    if (G.scene) G.scene.shake = Math.max(G.scene.shake || 0, 1.2);
    G.sfx('blast');
}

// Where a shot has been this frame, not merely where it ended up.
//
// An arrow travels seventeen tiles a second, which at one frame is most of a tile and at a slow
// frame is nearly two -- so testing only the position it landed on let shots pass clean through
// bodies narrower than a step. And a shot stopped by a wall stopped wherever it happened to be
// BEFORE the step, which could be a tile and a half short of the crate whose tile stopped it:
// that is why crates were unhittable from some angles and fine from others.
//
// So the segment is walked instead. The sweep stops at the first solid tile, but only AFTER
// testing that tile -- because the thing that made it solid may be exactly what was being aimed
// at.
function sweep(d, from, to, hit) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.min(10, Math.ceil(len / 0.3)));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + dx * t, z = from.z + dz * t;
        if (hit(x, z)) return true;
        if (isSolid(d, Math.floor(x), Math.floor(z))) return false;
    }
    return false;
}

// A shot stopped by a wall has hit whatever made that wall. A crate's collision IS its tile, so
// an arrow blocked by that tile has struck the crate -- and until this existed it simply vanished
// against thin air an inch from a box it was aimed squarely at.
//
// The four corners of the shot's own width are tested, not just its centre, because that is what
// stopped it: coming in diagonally, a shot is blocked when its edge clips the CORNER of the tile,
// which is further from the crate's middle than any sane hit radius reaches. That is why crates
// were destructible from the sides and not from the diagonals.
function crateBlocking(s, at, r = 0.13) {
    for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
        const tx = Math.floor(at.x + dx), tz = Math.floor(at.z + dz);
        const c = (s.crates || []).find(k => k.tile && k.tile.x === tx && k.tile.z === tz);
        if (c) return c;
    }
    return null;
}

export function updateShots(d, dt) {
    const s = G.state;
    for (const sh of [...s.shots]) {
        sh.life -= dt;
        const from = { x: sh.x, z: sh.z };
        // Where it would go with nothing in the way: what the sweep is tested against, so a wall
        // that stops the arrow does not also hide whatever is standing in that wall's tile.
        const want = { x: sh.x + sh.vx * dt, z: sh.z + sh.vz * dt };
        const step = { x: sh.x, z: sh.z };
        moveWithSlide(d, step, sh.vx * dt, sh.vz * dt, 0.12);
        // Sliding means a shot that clips a corner keeps going along it, which looks wrong for a
        // projectile: if it didn't travel the full step, it hit something solid.
        const moved = Math.hypot(step.x - sh.x, step.z - sh.z);
        const wanted = Math.hypot(sh.vx * dt, sh.vz * dt);
        sh.x = step.x; sh.z = step.z;
        const struckWall = moved < wanted - 1e-4;

        // A boss's shot only ever cares about one target, and it is not an enemy.
        if (sh.hostile) {
            const p = s.player;
            const landed = p.invuln <= 0 &&
                sweep(d, from, want, (x, z) => dist(x, z, p.x, p.z) < 0.42);
            // Turned on the shield: it is yours now, twice as hard, and on its way home.
            if (landed && p.parry > 0) {
                riposte(null);
                sh.hostile = false;
                sh.vx *= -1.4; sh.vz *= -1.4;
                sh.x = p.x + sh.vx * 0.04; sh.z = p.z + sh.vz * 0.04;
                sh.damage *= 2; sh.life = 2; sh.pierce = 0; sh.hit = new Set();
                continue;
            }
            if (landed && hurtPlayer(sh.damage)) {
                // A rock puts you on your back foot; an ember sets you alight. Both only on a
                // blow that actually landed.
                if (sh.heavy) {
                    const l = Math.hypot(sh.vx, sh.vz) || 1;
                    p.kx = sh.vx / l * 9; p.kz = sh.vz / l * 9;
                }
                if (sh.ignites) p.burn = Math.max(p.burn || 0, TERRAIN.burnTime);
            }
            if (landed || struckWall || sh.life <= 0) {
                // Wherever an ember comes down, the floor there catches -- which on the Sands is
                // nothing and in the Pitch is the room.
                if (sh.ignites) igniteAt(d, sh.x, sh.z, 0.9);
                s.shots = s.shots.filter(x => x !== sh);
            }
            continue;
        }

        // An arrow alight sets fire to the oil under it as it flies, not only where it stops --
        // which is what lets one shot draw a line of fire across a slick.
        if (sh.ignites) igniteAt(d, sh.x, sh.z, 0.5);

        let struck = null;
        sweep(d, from, want, (x, z) => {
            for (const e of targets()) {
                if (sh.hit.has(e.id)) continue;
                if (dist(x, z, e.x, e.z) > e.size + 0.16) continue;
                struck = e;
                // The blast, if there is one, goes off where it actually met the thing.
                sh.x = x; sh.z = z;
                return true;
            }
            return false;
        });
        // Blocked by a crate's tile counts as hitting the crate.
        if (!struck && struckWall) {
            const c = crateBlocking(s, want);
            if (c && !sh.hit.has(c.id)) struck = c;
        }
        if (struck) {
            sh.hit.add(struck.id);
            if (!sh.blast) {
                hurtEnemy(struck, sh.damage, sh.x - sh.vx, sh.z - sh.vz, 1.6);
                if (sh.slow) struck.slow = sh.slow;
                if (sh.ignites && !struck.crate && !(ENEMIES[struck.kind] || {}).fireproof)
                    struck.burn = Math.max(struck.burn || 0, TERRAIN.burnTime);
            }
        }
        if (struckWall || sh.life <= 0 || (struck && (sh.blast || sh.hit.size > sh.pierce))) {
            if (sh.blast) detonate(sh);
            s.shots = s.shots.filter(x => x !== sh);
        }
    }
}

function detonate(sh) {
    const s = G.state;
    s.blasts.push({ id: nid(), x: sh.x, z: sh.z, r: sh.blast, t: 0 });
    if (sh.bramble) plantBrambles(sh.x, sh.z, sh.bramble.radius, sh.bramble.time);
    igniteAt(G.dungeon, sh.x, sh.z, sh.blast);
    for (const e of targets())
        if (dist(sh.x, sh.z, e.x, e.z) <= sh.blast + e.size) {
            hurtEnemy(e, sh.damage, sh.x, sh.z, 2.2);
            if (sh.slow) e.slow = sh.slow;
        }
    G.sfx('blast');
}
