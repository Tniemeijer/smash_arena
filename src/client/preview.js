// ==================== THE ONE ON THE CREATION SCREEN ====================
// A small window onto the actual model, stood on a flagstone in torchlight and turning slowly.
//
// This used to be a paper doll drawn in CSS: forty absolutely-positioned rectangles that were an
// honest likeness right up until either side changed, after which it was a lie about what you
// were about to play. Pointing a second, tiny camera at the real model costs one more WebGL
// context and can never drift.
//
// It is deliberately rendered at half the size it is shown at, for the same reason the dungeon is
// rendered at 0.4 of the window: the character you are building should be made of the same
// pixels as the character you will be.

import * as THREE from 'three';
import { buildPlayerModel, disposeModel, box } from './model.js';

const W = 176, H = 226;          // shown at this size
const SCALE = 0.5;               // rendered at this fraction of it

export default class CharacterPreview {
    constructor() {
        this.el = document.createElement('div');
        this.el.className = 'doll-3d';
        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(W * SCALE, H * SCALE, false);
        const c = this.renderer.domElement;
        c.style.width = `${W}px`;
        c.style.height = `${H}px`;
        this.el.appendChild(c);

        this.scene = new THREE.Scene();
        // Framed on the body rather than on the whole tile: the head and what is on it is what
        // most of these choices actually change.
        const f = 0.72, aspect = W / H;
        this.camera = new THREE.OrthographicCamera(-f * aspect, f * aspect, f, -f, 0.1, 40);
        this.camera.position.set(0, 1.2, 3);
        this.camera.lookAt(0, 0.54, 0);

        this.scene.add(new THREE.AmbientLight(0x9aa6bd, 1.0));
        this.scene.add(new THREE.HemisphereLight(0xa8b6d0, 0x3a2f26, 0.7));
        // Warm from the front left, cold from behind: a face lit flat is a face you cannot read
        // the shape of, and shape is the whole of what a build choice changes.
        const key = new THREE.PointLight(0xffc089, 9, 9, 1.6);
        key.position.set(-1.6, 2.1, 2.2);
        this.scene.add(key);
        const rim = new THREE.DirectionalLight(0x8fa8d0, 0.85);
        rim.position.set(1.4, 1.2, -1.6);
        this.scene.add(rim);

        // Something to stand on, so the body reads as being somewhere rather than floating.
        const slab = box(1.5, 0.16, 1.5, 0x6b6154);
        slab.position.y = -0.08;
        this.scene.add(slab);

        this.turn = Math.PI * 0.12;
        // Slow enough that a full turn is something you notice rather than something you wait
        // through, and it starts nearly face-on: the first thing the screen owes you is a face.
        this.spin = 0.4;                     // radians a second, until you take hold of it
        this.model = null;
        this.running = false;
        this.clock = new THREE.Clock();
        this._bindDrag();
    }

    // Dragging turns the body and stops the idle spin, because the moment you want to see the
    // back of a cloak is the moment the automatic turn is taking it away from you.
    _bindDrag() {
        const c = this.renderer.domElement;
        let last = null;
        c.addEventListener('pointerdown', (e) => {
            last = e.clientX; this.spin = 0;
            c.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        c.addEventListener('pointermove', (e) => {
            if (last === null) return;
            this.turn += (e.clientX - last) * 0.014;
            last = e.clientX;
        });
        const release = () => { last = null; };
        c.addEventListener('pointerup', release);
        c.addEventListener('pointercancel', release);
    }

    // Put the canvas back into whatever markup was just rebuilt. The creation screen redraws
    // itself wholesale on every click, so the element is kept out here and re-parented rather
    // than recreated -- rebuilding a WebGL context per swatch would be absurd.
    mountInto(host) {
        if (host && this.el.parentNode !== host) host.appendChild(this.el);
        this.start();
    }

    set(cls, look, gear) {
        const sig = `${cls}|${JSON.stringify(look)}`;
        if (sig === this.sig) return;
        this.sig = sig;
        if (this.model) { this.scene.remove(this.model); disposeModel(this.model); }
        this.model = buildPlayerModel(cls, look, gear);
        this.scene.add(this.model);
    }

    // A still of somebody, for the class cards: the same model, the same light and the same
    // pixels as the live doll, rendered once and kept as an image. Four live previews would be
    // four WebGL contexts for four pictures that never move; this is one context and a cache.
    portrait(cls, look) {
        const key = `${cls}|${JSON.stringify(look)}`;
        this.portraits = this.portraits || new Map();
        if (this.portraits.has(key)) return this.portraits.get(key);
        const m = buildPlayerModel(cls, look);
        m.rotation.y = Math.PI * 0.16;
        const live = this.model;
        if (live) live.visible = false;
        this.scene.add(m);
        this.renderer.render(this.scene, this.camera);
        // Read in the same task as the render, so the drawing buffer is still there to read.
        const url = this.renderer.domElement.toDataURL();
        this.scene.remove(m);
        disposeModel(m);
        if (live) live.visible = true;
        this.portraits.set(key, url);
        return url;
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.clock.getDelta();
        const loop = () => {
            if (!this.running) return;
            requestAnimationFrame(loop);
            const dt = Math.min(this.clock.getDelta(), 0.1);
            this.turn += this.spin * dt;
            if (this.model) {
                this.model.rotation.y = this.turn;
                // The same idle the dungeon gives them, so the preview breathes rather than
                // hanging there like a shop dummy.
                this.model.userData.body.position.y = Math.abs(Math.sin(performance.now() / 380)) * 0.018;
                this.model.userData.arm.rotation.x = -0.25;
                this.model.userData.off.rotation.x = -0.1;
            }
            this.renderer.render(this.scene, this.camera);
        };
        loop();
    }
    stop() { this.running = false; }
}
