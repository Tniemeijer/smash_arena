// ==================== THE ONE YOU CONTROL ====================
// Movement, the dash, and picking things up. Input arrives as a plain intent object rather than
// as key events, so the same code would drive a second player over a network without caring where
// the intent came from.

import { G, classDef, maxHp, mods, dist, damageMul } from '../core.js';
import { CLASSES, TERRAIN, SURFACE, VIEW } from '../data.js';
import { moveWithSlide, unstick, surfaceAt } from '../dungeon.js';
import { surfaceSpeed, isSlippery } from './terrain.js';
import { hurtEnemy, plantBrambles } from './combat.js';
import { updateAbilities } from './abilities.js';

export const PLAYER_RADIUS = 0.3;

export function newPlayer(cls) {
    // Falls back rather than dying at the first frame with an unreadable error if handed a class
    // name that doesn't exist.
    const def = CLASSES[cls] || CLASSES.knight;
    return {
        cls: CLASSES[cls] ? cls : 'knight', level: 1, xp: 0, hp: def.hp,
        x: 0, z: 0, facing: 0,
        name: '', look: null,
        // What you bought, what you can do and what is on the keys. All plain data hung on the
        // player, so the whole prisoner -- face, upgrades and moves -- is still one object that
        // could be sent to a second machine when there are two of you down here.
        upgrades: {}, known: [], slots: [null, null, null, null],
        abilityCool: {}, abilityFull: {}, buffs: {}, castFlash: 0,
        cool: 0, dashCool: 0, invuln: 0, swing: 0, swingTime: 0.18, hurtFlash: 0,
        dashing: 0, dvx: 0, dvz: 0, chargeDamage: 0, chargeKnock: 0,
        // What your feet are actually doing, as opposed to what you asked for. Only ice
        // ever lets the two differ, but it has to live somewhere that survives a room.
        gx: 0, gz: 0, burn: 0, burnTick: 0, chill: 0, kx: 0, kz: 0
    };
}
export function updatePlayer(d, dt, intent) {
    const s = G.state, p = s.player;
    if (s.over) return;
    const def = classDef(p), m = mods(p);

    // If anything has managed to put you inside a wall, walking out of it is the only thing you
    // do this frame. Cheap insurance: the alternative is a run that ends with nothing to do but
    // watch, which is the worst bug this game could have.
    if (unstick(d, p, dt, PLAYER_RADIUS)) return;

    // Skills that simply tick along in the background.
    if (m.regen) p.hp = Math.min(maxHp(p), p.hp + m.regen * dt);
    // A druid mends standing in water -- any water, a pool the room came with or one they raised.
    if (def.waterMend && surfaceAt(d, p.x, p.z) === SURFACE.water)
        p.hp = Math.min(maxHp(p), p.hp + def.waterMend * dt);
    p.quickdraw = Math.max(0, (p.quickdraw || 0) - dt);

    p.cool = Math.max(0, p.cool - dt);
    p.dashCool = Math.max(0, p.dashCool - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.swing = Math.max(0, p.swing - dt);
    p.hurtFlash = Math.max(0, p.hurtFlash - dt);

    // Aim first, because movement is expressed relative to it. You face the cursor at all times;
    // W walks toward it, S backs away from it, A and D sidestep. Keeping the whole scheme
    // anchored to the aim means you can circle something while never taking your weapon off it,
    // which is the entire point of aiming with the mouse in the first place.
    if (intent.aim) p.facing = Math.atan2(intent.aim.x - p.x, intent.aim.z - p.z);

    // A dash is a short burst of committed movement: you can't steer it, which is what makes
    // spending it a decision rather than a free extra speed button.
    if (p.dashing > 0) {
        p.dashing -= dt;
        moveWithSlide(d, p, p.dvx * dt, p.dvz * dt, PLAYER_RADIUS);
        // A Charge is an ordinary dash carrying its own damage, which is why the move needed no
        // movement code of its own. Each body is hit once per dash, tracked on the dash rather
        // than on the enemy, so it resets cleanly every time you spend one.
        const cut = p.chargeDamage || 0;
        if (cut) {
            p.dashHit = p.dashHit || new Set();
            for (const e of [...G.state.enemies]) {
                if (p.dashHit.has(e.id) || dist(p.x, p.z, e.x, e.z) > e.size + PLAYER_RADIUS + 0.2) continue;
                p.dashHit.add(e.id);
                hurtEnemy(e, cut, p.x, p.z, Math.max(2.0, p.chargeKnock || 0));
            }
        }
        if (p.dashing <= 0) { p.chargeDamage = 0; p.chargeKnock = 0; }
    } else {
        // Which way the keys push you. By default W is up the SCREEN, whatever you are aiming
        // at -- the Smash TV scheme: one hand moves, the other aims, and the two never interfere.
        // Running away from something while shooting it is the whole game, and with movement
        // tied to the cursor that took holding S and thinking backwards.
        //
        // The old scheme -- W toward the cursor, A and D circling it -- is still there for anyone
        // who prefers it, chosen on the pause screen.
        let fx, fz, rx, rz;
        if (G.settings && G.settings.move === 'aim') {
            fx = Math.sin(p.facing); fz = Math.cos(p.facing);
            // Negated: "right of where the character is facing" is not "right of the screen".
            rx = -Math.cos(p.facing); rz = Math.sin(p.facing);
        } else {
            fx = VIEW.up.x; fz = VIEW.up.z;
            rx = VIEW.right.x; rz = VIEW.right.z;
        }
        let mx = fx * intent.fwd + rx * intent.strafe;
        let mz = fz * intent.fwd + rz * intent.strafe;
        const len = Math.hypot(mx, mz);
        if (len > 1) { mx /= len; mz /= len; }        // no free speed on the diagonal
        // Ankle deep costs you half your legs, and a dash out of it is worth spending. A frost
        // wolf's bite costs you a third of them for as long as the chill lasts.
        const sp = def.speed * m.speed * surfaceSpeed(d, p.x, p.z) * (p.chill > 0 ? TERRAIN.chillSlow : 1);
        // What you asked for, and then what your feet actually did about it. On anything but ice
        // those are the same thing and this is the old direct step. On ice your feet take a
        // moment to agree with you and a moment to stop agreeing -- so you skate into the turn
        // you asked for a beat late, and you keep going after you let go. It is the one surface
        // that changes how you move rather than how fast, which is what makes standing on it a
        // decision rather than a tax.
        const wantX = mx * sp, wantZ = mz * sp;
        if (isSlippery(d, p.x, p.z)) {
            const k = Math.min(1, dt * TERRAIN.iceGrip);
            p.gx += (wantX - p.gx) * k;
            p.gz += (wantZ - p.gz) * k;
        } else { p.gx = wantX; p.gz = wantZ; }
        // Walking loses an archer's steadiness. Only walking you asked for: a slide on ice or a
        // shove from a rock is not you moving your feet.
        if (len > 0.001) p.steady = 0;
        if (Math.hypot(p.gx, p.gz) > 0.02) {
            moveWithSlide(d, p, p.gx * dt, p.gz * dt, PLAYER_RADIUS);
            // Sliding is not walking: the legs only work while you are actually asking them to.
            p.moving = len > 0.001;
        } else { p.gx = 0; p.gz = 0; p.moving = false; }

        // Dashing while standing still throws you the way you're aiming, which is how you get
        // out of a corner you've been backed into.
        if (intent.dash && p.dashCool <= 0) {
            // Dashing with nothing held throws you toward the cursor, which is how you close a
            // gap; holding S first is how you get out of one.
            const dir = len > 0.001 ? Math.atan2(mx, mz) : p.facing;
            const speed = def.dash.distance / 0.16;
            p.dvx = Math.sin(dir) * speed; p.dvz = Math.cos(dir) * speed;
            p.dashing = 0.16;
            p.dashHit = new Set();
            p.dashCool = def.dash.cooldown;
            p.invuln = Math.max(p.invuln, def.dash.invuln);
            // Every dash feeds the attack that comes after it. That is the whole design of these:
            // not four different escapes, but four different ways of setting up the next blow.
            const trait = def.dash.trait;
            if (trait === 'barge') {
                // Straight through them, shoulder first.
                p.chargeDamage = def.dash.barge * damageMul(p);
                p.chargeKnock = def.dash.bargeKnock;
            } else if (trait === 'quickdraw') {
                p.quickdraw = 2;                          // the next arrow is a Sure Shot
            } else if (trait === 'thorns') {
                plantBrambles(p.x, p.z, 1.6, 2.6);        // left where you were standing
            } else if (trait === 'flourish') {
                p.strum = def.attack.chord.every - 1;     // landing on the last beat of the bar
            }
            G.sfx('dash');
        }
    }

    // Being shoved: a stonethrower's rock, so far. A decaying velocity rather than a teleport,
    // the same as the enemies get, so it can put you into a wall -- or into a fire.
    if (Math.abs(p.kx || 0) + Math.abs(p.kz || 0) > 0.01) {
        moveWithSlide(d, p, p.kx * dt, p.kz * dt, PLAYER_RADIUS);
        p.kx *= 0.8; p.kz *= 0.8;
    }
    p.chill = Math.max(0, (p.chill || 0) - dt);

    updateAbilities(dt);
}
