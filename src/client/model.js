// ==================== A BODY ====================
// Everything that turns "who this person is" into a handful of coloured cubes. Lives apart from
// the scene because two places need the identical body: the dungeon, and the preview on the
// creation screen. A paper doll drawn in CSS was the old answer to the second one, and it drifted
// from the model the first time either changed -- so now there is one builder and the preview
// simply points a small camera at its output.
//
// Nothing in here is read by the simulation. A broad build is not a bigger hitbox and a cloak
// does not slow you down: the collision radius is the same for everybody, which is what keeps
// choosing a face free.

import * as THREE from 'three';
import { CLASSES, SKIN_TONES, HAIR_COLOURS, HAIR_STYLES, BEARD_STYLES, EYE_COLOURS, GARB_COLOURS,
         TRIM_COLOURS, BUILDS, CLOAKS, MARKS, MARK_COLOUR, DEFAULT_LOOK } from './data.js';

export const lmat = (c, e = {}) => new THREE.MeshLambertMaterial({ color: c, ...e });
export const box = (w, h, d, c, e) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lmat(c, e));
export const cyl = (rt, rb, h, s, c, e) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s), lmat(c, e));

// Bulk, as multipliers on width, depth and height. Three silhouettes rather than a slider: at
// this pixel size anything finer than "narrow, ordinary, wide" is gone by the time it is drawn.
const SHAPE = {
    slight:  { w: 0.84, d: 0.9,  h: 1.05 },
    average: { w: 1,    d: 1,    h: 1 },
    broad:   { w: 1.2,  d: 1.14, h: 0.96 }
};

const one = (list, v, fallback) => (list.includes(v) ? v : fallback);
const anyOf = (list) => list[Math.floor(Math.random() * list.length)];
const anyIdx = (list) => Math.floor(Math.random() * list.length);

// A look with every field present and in range, whatever it arrived as. Old saves, hand-edited
// console pokes and half-built drafts all go through here, so the builder below can read the
// object straight rather than guarding every field it touches.
export function normaliseLook(look) {
    const l = { ...DEFAULT_LOOK, ...(look || {}) };
    return {
        skin: Math.max(0, Math.min(SKIN_TONES.length - 1, l.skin | 0)),
        hair: Math.max(0, Math.min(HAIR_COLOURS.length - 1, l.hair | 0)),
        eyes: Math.max(0, Math.min(EYE_COLOURS.length - 1, l.eyes | 0)),
        garb: Math.max(0, Math.min(GARB_COLOURS.length - 1, l.garb | 0)),
        trim: Math.max(0, Math.min(TRIM_COLOURS.length - 1, l.trim | 0)),
        style: one(HAIR_STYLES, l.style, DEFAULT_LOOK.style),
        beard: one(BEARD_STYLES, l.beard, DEFAULT_LOOK.beard),
        build: one(BUILDS, l.build, DEFAULT_LOOK.build),
        cloak: one(CLOAKS, l.cloak, DEFAULT_LOOK.cloak),
        mark: one(MARKS, l.mark, DEFAULT_LOOK.mark)
    };
}

// A whole stranger. Beards and marks are deliberately rarer than a flat roll would make them --
// rolled every time, two thirds of everyone would be bearded and painted, which reads as noise
// rather than as a choice somebody made.
export function randomLook() {
    return normaliseLook({
        skin: anyIdx(SKIN_TONES), hair: anyIdx(HAIR_COLOURS), eyes: anyIdx(EYE_COLOURS),
        garb: anyIdx(GARB_COLOURS), trim: anyIdx(TRIM_COLOURS),
        style: anyOf(HAIR_STYLES), build: anyOf(BUILDS),
        beard: Math.random() < 0.45 ? anyOf(BEARD_STYLES.slice(1)) : 'none',
        cloak: Math.random() < 0.5 ? anyOf(CLOAKS.slice(1)) : 'none',
        mark: Math.random() < 0.3 ? anyOf(MARKS.slice(1)) : 'none'
    });
}

// ---------- the body ----------
// What somebody looks like, and nothing else. There is no equipment in the game any more, so a
// body is exactly the choices made on the creation screen plus the weapon their calling carries
// -- which means the preview and the arena are showing the same thing for the same reasons.
export function buildPlayerModel(cls, look) {
    const def = CLASSES[cls] || CLASSES.knight;
    const L = normaliseLook(look);
    const skin = SKIN_TONES[L.skin];
    const hairCol = HAIR_COLOURS[L.hair];
    const eyeCol = EYE_COLOURS[L.eyes];
    const garb = GARB_COLOURS[L.garb];
    const trim = TRIM_COLOURS[L.trim];
    const b = SHAPE[L.build];

    const g = new THREE.Group();
    const body = new THREE.Group();

    // ---- legs and boots ----
    const legs = box(0.26 * b.w, 0.3 * b.h, 0.2 * b.d, 0x2f2a25);
    legs.position.y = 0.15 * b.h;
    body.add(legs);
    // ---- torso, belt, shoulders ----
    const torso = box(0.34 * b.w, 0.4 * b.h, 0.24 * b.d, garb);
    torso.position.y = 0.5 * b.h;
    body.add(torso);
    const belt = box(0.36 * b.w, 0.06 * b.h, 0.26 * b.d, trim);
    belt.position.y = 0.34 * b.h;
    body.add(belt);
    // One yoke across the shoulders rather than a pauldron on each. Two of them sat in the gap
    // between torso and arm, and at this size a shape that small in a gap that small does not read
    // as armour -- it reads as a lump. A single band reads as a collar from any angle.
    const yoke = box(0.38 * b.w, 0.06 * b.h, 0.26 * b.d, trim);
    yoke.position.y = 0.69 * b.h;
    body.add(yoke);
    // ---- head ----
    const headY = 0.82 * b.h;
    const head = box(0.22, 0.22, 0.22, skin);
    head.position.y = headY;
    body.add(head);
    // Two dots of eye, on the front face. A pixel each once the render scale has had them, which
    // is exactly enough to tell which way somebody is looking.
    for (const sx of [-1, 1]) {
        const eye = box(0.05, 0.045, 0.02, eyeCol);
        eye.position.set(sx * 0.055, headY + 0.025, 0.111);
        body.add(eye);
    }
    // A marking, over the eyes or across one cheek. Sits a hair proud of the face so it never
    // z-fights with the skin behind it.
    if (L.mark !== 'none') {
        const mc = MARK_COLOUR[L.mark];
        if (L.mark === 'scar' || L.mark === 'brand') {
            const m = box(0.022, 0.1, 0.012, mc);
            m.position.set(0.062, headY + 0.01, 0.117);
            body.add(m);
        } else {
            // Across the brow, not across the eyes. Painted at eye height it sat in front of them
            // -- two pixels of colour drawn over the only two pixels on the whole body that say
            // which way somebody is looking.
            const m = box(0.226, 0.032, 0.012, mc);
            m.position.set(0, headY + 0.072, 0.117);
            body.add(m);
        }
    }
    // A beard, coloured from the hair, because one that does not match reads as a mistake rather
    // than as a decision.
    if (L.beard !== 'none') {
        if (L.beard === 'stubble') {
            const s = box(0.2, 0.05, 0.02, hairCol);
            s.position.set(0, headY - 0.075, 0.107);
            body.add(s);
        } else if (L.beard === 'goatee') {
            const s = box(0.075, 0.1, 0.035, hairCol);
            s.position.set(0, headY - 0.1, 0.1);
            body.add(s);
        } else {
            const s = box(0.2, 0.16, 0.05, hairCol);
            s.position.set(0, headY - 0.12, 0.095);
            body.add(s);
            for (const sx of [-1, 1]) {
                const side = box(0.03, 0.14, 0.18, hairCol);
                side.position.set(sx * 0.105, headY - 0.05, 0.02);
                body.add(side);
            }
        }
    }

    // Hair goes on before the calling's headgear, so a helm sits over it rather than instead of
    // it and you can still tell two knights apart.
    if (L.style !== 'bald') {
        if (L.style === 'mohawk') {
            const ridge = box(0.07, 0.11, 0.24, hairCol);
            ridge.position.y = headY + 0.16;
            body.add(ridge);
        } else {
            const cap = box(0.24, 0.08, 0.24, hairCol);
            cap.position.y = headY + 0.125;
            body.add(cap);
        }
        if (L.style === 'long') {
            const back = box(0.22, 0.26, 0.07, hairCol);
            back.position.set(0, headY, -0.1);
            body.add(back);
        } else if (L.style === 'topknot') {
            const knot = box(0.09, 0.14, 0.09, hairCol);
            knot.position.set(0, headY + 0.21, -0.02);
            body.add(knot);
        } else if (L.style === 'braids') {
            for (const sx of [-1, 1]) {
                const braid = box(0.06, 0.24, 0.06, hairCol);
                braid.position.set(sx * 0.125, headY - 0.06, 0.01);
                body.add(braid);
            }
        }
    }

    // Class marker, worn on the head, which is the only part never hidden behind anything.
    const hy = headY + 0.13;
    if (cls === 'knight') { const h = box(0.26, 0.14, 0.26, 0xb8bec6); h.position.y = hy; body.add(h); }
    if (cls === 'archer') { const h = box(0.26, 0.09, 0.26, def.accent); h.position.set(0, hy - 0.02, 0.02); body.add(h); }
    if (cls === 'druid')  { const h = cyl(0.02, 0.22, 0.16, 7, def.accent); h.position.y = hy + 0.01; body.add(h); }
    if (cls === 'bard')   { const h = box(0.28, 0.08, 0.28, def.accent); h.position.y = hy - 0.02;
                            const f = box(0.06, 0.18, 0.06, 0xd9a441); f.position.set(0.12, hy + 0.07, 0); body.add(h, f); }

    // ---- a cloak ----
    // Hung off its own group so the frame loop can swing it: a cloak that stays rigid while you
    // run reads as a plank strapped to your back.
    let cloak = null;
    if (L.cloak !== 'none') {
        cloak = new THREE.Group();
        const long = L.cloak === 'full';
        const cape = box(0.38 * b.w, (long ? 0.72 : 0.44) * b.h, 0.05, trim);
        cape.position.y = (long ? -0.36 : -0.22) * b.h;
        cloak.add(cape);
        const collar = box(0.42 * b.w, 0.07 * b.h, 0.14 * b.d, trim);
        collar.position.set(0, 0.02, 0.04);
        cloak.add(collar);
        cloak.position.set(0, 0.7 * b.h, -0.15 * b.d);
        body.add(cloak);
    }

    // ---- the weapon arm ----
    // One group swung by rotation, so the same rig serves a sword, a bow and a staff without any
    // of them needing their own animation code.
    const arm = new THREE.Group();
    const hand = box(0.09, 0.2, 0.09, garb); hand.position.y = -0.1; arm.add(hand);
    const weapon = new THREE.Group();
    if (cls === 'knight') {
        const blade = box(0.07, 0.62, 0.07, 0xc8cdd4); blade.position.y = -0.46;
        const guard = box(0.24, 0.06, 0.08, 0x8a6a3a); guard.position.y = -0.18;
        weapon.add(blade, guard);
    } else if (cls === 'archer') {
        const limb = box(0.05, 0.56, 0.05, 0x7a5a38); limb.position.y = -0.3; limb.rotation.z = 0.1;
        const string = box(0.012, 0.52, 0.012, 0xe8dcc6); string.position.set(0.07, -0.3, 0);
        weapon.add(limb, string);
    } else if (cls === 'druid') {
        const staff = box(0.055, 0.7, 0.055, 0x6b4a2a); staff.position.y = -0.4;
        const knot = cyl(0.09, 0.07, 0.1, 7, def.accent); knot.position.y = -0.72;
        weapon.add(staff, knot);
    } else {
        const body2 = box(0.26, 0.3, 0.09, 0x8a6a3a); body2.position.y = -0.34;
        const neck = box(0.07, 0.34, 0.07, 0x6b4a2a); neck.position.y = -0.62;
        weapon.add(body2, neck);
    }
    weapon.position.y = -0.14;
    arm.add(weapon);
    arm.position.set(0.22 * b.w, 0.66 * b.h, 0);
    body.add(arm);

    const off = new THREE.Group();
    const oh = box(0.09, 0.2, 0.09, garb); oh.position.y = -0.1; off.add(oh);
    // A knight carries a shield in it. Besides being the thing a Shield Bash ought to be bashing
    // with, it is what makes the silhouette read as a knight from the back, where the helm and
    // the sword are both hidden behind the body.
    if (cls === 'knight') {
        const board = box(0.08, 0.42, 0.36, 0x6b5a44);
        board.position.set(-0.06, -0.12, 0.02);
        const rim = box(0.05, 0.46, 0.4, 0x8a8f96);
        rim.position.set(-0.03, -0.12, 0.02);
        const boss = box(0.07, 0.12, 0.12, 0xb8bec6);
        boss.position.set(-0.1, -0.12, 0.02);
        off.add(rim, board, boss);
    }
    off.position.set(-0.22 * b.w, 0.66 * b.h, 0);
    body.add(off);

    g.add(body);
    // Burns only while a special move is going off: at this resolution a move needs a tell that is
    // visible even when the move itself happens off screen behind you.
    const castLight = new THREE.PointLight(def.accent, 0, 4.5, 2);
    castLight.position.y = 0.7;
    g.add(castLight);
    // Where the arms rest. Every animation poses them from here and lerps back to it, so a pose
    // can be as violent as it likes without the body slowly drifting out of shape.
    g.userData = { body, arm, off, weapon, cloak, cls, facing: 0, castLight, height: 0.95 * b.h,
                   armHome: arm.position.clone(), offHome: off.position.clone() };
    return g;
}

// Frees everything a model holds on the GPU. Called whenever one is replaced -- which now happens
// mid-run every time you put something on, not just once at the start of a run.
export function disposeModel(g) {
    if (!g) return;
    g.traverse(o => {
        if (o.isMesh) {
            o.geometry.dispose();
            (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
        }
    });
}
