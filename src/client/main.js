// Boot: build the scene, wire input, and hand the frame loop to the renderer's rAF so the
// simulation and the draw stay in step.

import DungeonScene from './threeScene.js';
import { G, newRun, tick, attack, special, descend, currentDungeon, nearStall } from './game.js';
import { initHud, renderHud, showCreate, showDeath, togglePanel, togglePause,
         isSkillPanelOpen, loadSettings } from './ui/hud.js';
import { initAudio, play as playSfx } from './audio.js';
import * as abilities from './systems/abilities.js';

function boot() {
    const scene = new DungeonScene(document.getElementById('canvas-container'));
    G.scene = scene;

    initAudio();
    G.sfx = playSfx;
    G.settings = loadSettings();

    // Input is collected as raw key state and turned into an intent once per frame, rather than
    // acted on per event. Held keys then behave identically at any frame rate.
    const keys = new Set();
    let wantDash = false, firing = false;
    // Special moves are queued the same way the dash is: pressed here, spent once in the frame
    // loop, so holding a key cannot fire one twice and the aim used is the aim of that frame.
    let wantSpecial = -1;
    addEventListener('keydown', (e) => {
        keys.add(e.code);
        if (e.code === 'Space') { wantDash = true; e.preventDefault(); }
        // E is "do the thing where you are standing": trade at a counter, or take the way out.
        if (e.code === 'KeyE') { if (nearStall()) togglePanel('shop'); else descend(); }
        if (e.code === 'KeyJ' || e.code === 'KeyK' || e.code === 'Tab') { togglePanel('moves'); e.preventDefault(); }
        // Pause. Two keys, because half of everybody reaches for Escape and the other half for P,
        // and a game you cannot put down is a game you stop playing at the wrong moment.
        if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); e.preventDefault(); }
        const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
        if (n !== -1) wantSpecial = n;
    });
    addEventListener('keyup', (e) => keys.delete(e.code));
    const canvas = scene.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) firing = true; });
    addEventListener('pointerup', () => { firing = false; });
    addEventListener('blur', () => { keys.clear(); firing = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const pauseBtn = document.getElementById('pause-btn');
    if (pauseBtn) pauseBtn.addEventListener('click', () => togglePause());

    let deathShown = false;
    initHud({
        onPick: (cls, made) => { deathShown = false; newRun(cls, made); },
        onRestart: () => { deathShown = false; showCreate(); }
    });
    showCreate();

    // A frame has three jobs -- move the world, draw it, and draw the panel over it -- and each
    // one is run so that a failure in it cannot take the other two down with it.
    //
    // This exists because of a bug that froze the game: sync() threw on the first frame of a new
    // room, every frame, and since it threw the screen never updated again. The simulation was
    // still running perfectly underneath, so what a player saw was the old room with a motionless
    // body in it and no error of any kind. A silent freeze is the worst way for anything to fail.
    // Now the picture can break while the HUD keeps moving, which at least says something is
    // wrong, and the console gets the stack once rather than sixty times a second.
    const broken = new Set();
    const guard = (what, fn) => {
        try { fn(); } catch (err) {
            if (!broken.has(what)) {
                broken.add(what);
                console.error(`[deepdelve] ${what} failed and has been reported once:`, err);
                G.onToast(`Something went wrong (${what})`, 'bad');
            }
        }
    };

    scene.onFrame = (dt) => {
        const s = G.state;
        if (!s) return;
        // A panel, or the pause, stops the room. Still rendered behind it, just not ticked -- and
        // guarded the same way, because a picture that breaks while the game is paused is exactly
        // as stuck as one that breaks while it is running.
        if (isSkillPanelOpen()) {
            guard('drawing', () => scene.sync(s, currentDungeon(), 0));
            guard('the hud', () => renderHud(s));
            return;
        }
        const aim = scene.aimPoint();
        // Raw intent only: forward/back along the aim, and sidestep across it. Which way that
        // actually points is resolved in the player system against the facing, so the camera
        // angle never enters into it.
        const intent = {
            fwd: (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0),
            strafe: (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0),
            dash: wantDash, aim
        };

        guard('the world', () => {
            tick(dt, intent);
            if (firing) attack(aim);
            if (wantSpecial !== -1) { special(wantSpecial, aim); wantSpecial = -1; }
        });
        wantSpecial = -1;
        wantDash = false;

        guard('drawing', () => scene.sync(s, currentDungeon(), dt));
        guard('the hud', () => renderHud(s));
        if (s.over && !deathShown) { deathShown = true; showDeath(s.over); }
    };

    // Everything a test or a console poke needs, reached through the instance that is actually
    // running. Importing the modules fresh from outside gets a *different* copy under Vite's HMR,
    // with its own uninitialised dungeon, which fails in a way that looks like a game bug.
    window.game = {
        get state() { return G.state; },
        get dungeon() { return currentDungeon(); },
        G, scene, newRun, descend, tick, attack, special, showCreate, togglePanel, togglePause, nearStall,
        // The system with state worth poking at from a console or a test. Reached through the
        // running instance for the same reason as everything else above.
        abilities
    };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
