// ==================== THE LOOK ====================
// Isometric, orthographic, and rendered at a fraction of the window's resolution then scaled back
// up with nearest-neighbour filtering. That last part is the whole aesthetic: it turns clean 3D
// boxes into chunky pixels and hides the fact that every model here is a handful of cubes.
//
// The cost of that trick, same as in the lab game: any animation subtler than a few pixels is
// invisible. Everything that moves here moves a long way.

import * as THREE from 'three';
import { GRID } from './data.js';
import { WALL, FLOOR, DOOR, PROP, tileAt, isSolid, inAlcove, surfaceAt } from './dungeon.js';
import { CLASSES, ENEMIES, BOSSES, POWERUPS, PRIZES, SURFACE, TERRAIN, BIOMES } from './data.js';
import { buildPlayerModel, disposeModel, lmat, box, cyl } from './model.js';

const RES_SCALE = 0.4;
const WALL_H = 1.5;

// Boxes of flame drawn at once, across every fire and every burning body in the room. Nine to a
// blaze -- three tongues of three -- so this is fifty-odd separate fires, more than a room has
// oil for, and all of it one draw call.
const FLAME_POOL = 468;

// How far a wall standing between the camera and you fades, and how fast it gets there and back.
// Not all the way to nothing: a wall you can see straight through stops reading as a wall, and
// then the room you are in has no shape. A quarter left behind keeps the outline.
const WALL_FADE = 0.22;          // opacity a fully faded wall settles at
const FADE_RATE = 7;             // per second, both directions

// Where the camera sits relative to whoever it is following, and what it looks at. Shared,
// because the fade has to trace the line along exactly the axis the camera is actually on -- the
// two drifting apart would fade the wrong wall, which is worse than fading none.
const CAM = { d: 13, h: 15, look: 0.4 };

// A darker or lighter version of a colour, for the second square of a checker and for the faces
// of a boulder. Kept as integer maths on the channels so a palette stays one number per thing.
const shaded = (hex, k) => (Math.min(255, Math.round(((hex >> 16) & 255) * k)) << 16)
                        | (Math.min(255, Math.round(((hex >> 8) & 255) * k)) << 8)
                        |  Math.min(255, Math.round((hex & 255) * k));

// What colour a tile is for what is lying on it. One table, used when a room is built and again
// whenever the simulation changes a tile, so a patch of ice melted by a blast is painted exactly
// the colour a pool laid at generation would have been.
//
// They have to be told apart at a glance and from across the room:
//   water  BLUE and mid-bright -- the only saturated blue on any floor
//   oil    near black with a violet cast, and it shimmers (see _animateFloor)
//   ash    warm grey dust: what oil is once it has burnt, so it must never read as oil
//   ice    pale blue, far brighter than water, so a frozen pool never reads as a pool
//   snow   the lightest thing in any room
// Water and oil were once a shade apart, and in a dim room they were the same colour -- which is
// the one mistake the floor cannot make, because one slows you and the other burns you.
const SURFACE_HEX = {
    [SURFACE.water]: [0x3d7596, 0x366a89],
    [SURFACE.oil]:   [0x231d30, 0x1d1828],
    [SURFACE.ash]:   [0x3b3632, 0x34302c],
    [SURFACE.snow]:  [0xd9dfe4, 0xcdd5dc],
    [SURFACE.ice]:   [0xa6cde2, 0x96c0d8],
    [SURFACE.fire]:  [0x5a200a, 0x4e1c08]
};
const surfaceHex = (surf, x, z) => (SURFACE_HEX[surf] || [0xff00ff, 0xff00ff])[(x + z) % 2 ? 0 : 1];

export default class DungeonScene {
    constructor(container) {
        this.container = container;
        this.elapsed = 0;
        this.clock = new THREE.Clock();
        this.enemyMeshes = new Map();
        this.shotMeshes = new Map();
        this.pickupMeshes = new Map();
        this.crateMeshes = new Map();
        this.blastMeshes = new Map();
        this.seedMeshes = new Map();
        this.brambleMeshes = new Map();
        this.pointer = new THREE.Vector2();
        this._v3 = new THREE.Vector3();
        this.aim = { x: 0, z: 0 };
        this._initRenderer();
        this._initScene();
        this._bindEvents();
        this._animate();
    }

    _initRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(1);
        this.renderer.domElement.id = 'lab-canvas';
        this.container.appendChild(this.renderer.domElement);
        this._resize();
        window.addEventListener('resize', () => this._resize());
    }

    _initScene() {
        this.scene = new THREE.Scene();
        // Background and fog share a colour on purpose: mismatched, the fog's far plane reads as a
        // visible edge of the world rather than as darkness.
        this.scene.background = new THREE.Color(0x0a0c10);
        // The camera sits about twenty-four units from whoever it is following, so a near plane
        // of eighteen was fogging the player's own feet by a quarter and everything at arm's
        // length with them. That is atmosphere paid for with legibility, and in a room where six
        // things are walking at you from three directions, legibility is the game. Pushed out to
        // beyond the far wall: the arena is clear, and the dark still closes in past it.
        this.scene.fog = new THREE.Fog(0x0a0c10, 27, 54);

        this.frustum = 9;
        const aspect = this._w / this._h;
        this.camera = new THREE.OrthographicCamera(-this.frustum * aspect, this.frustum * aspect,
                                                    this.frustum, -this.frustum, 0.1, 200);
        this.camAngle = Math.PI / 4;
        this.camera.position.set(12, 14, 12);
        this.camera.lookAt(0, 0, 0);

        // Underground, but still a game you have to be able to read. The ambient is high enough
        // that stone is always legible as stone; the torch riding the player is what gives the
        // room warmth and a centre, not what makes it visible in the first place. Erring dark
        // here looks atmospheric in a still and is miserable to actually play.
        this.ambient = new THREE.AmbientLight(0x9aa6bd, 1.1);
        this.sky = new THREE.HemisphereLight(0xa8b6d0, 0x3a2f26, 0.7);
        this.scene.add(this.ambient, this.sky);
        this.torch = new THREE.PointLight(0xffc089, 2.4, 17, 1.4);
        this.torch.position.set(0, 2.4, 0);
        this.scene.add(this.torch);
        const fill = new THREE.DirectionalLight(0xc6d2e4, 0.7);
        fill.position.set(5, 10, 4);
        this.scene.add(fill);

        this.world = new THREE.Group();
        this.scene.add(this.world);
        this.player = buildPlayerModel('knight', null);
        this.scene.add(this.player);

        // A small pool of notes, made once and reused, so a bard playing for ten minutes never
        // allocates anything.
        this.notePool = [];
        for (let i = 0; i < 14; i++) {
            const m = box(0.1, 0.16, 0.04, 0xffe3a0, { transparent: true, opacity: 0, emissive: 0xd9a441 });
            const tail = box(0.04, 0.2, 0.04, 0xffe3a0, { transparent: true, opacity: 0, emissive: 0xd9a441 });
            tail.position.set(0.05, 0.16, 0);
            m.add(tail);
            m.visible = false;
            this.scene.add(m);
            this.notePool.push({ mesh: m, live: 0, vx: 0, vz: 0, spin: 0 });
        }
    }

    // ---------- walls that get out of the way ----------
    // The one thing an isometric camera is genuinely bad at: you walk north, a wall comes between
    // you and the lens, and you are fighting something you cannot see. Rather than cutting the
    // wall away or moving the camera -- both of which break the room's shape -- the stone between
    // you and the camera simply goes mostly transparent while you are behind it.
    // Per drawn tile: which instance it is, and how faded. The fade is per tile rather than per
    // mesh so a sconce bolted to a wall vanishes with the stone it is bolted to.
    _fadeTile(x, z) {
        const key = z * GRID + x;
        let g = this.wallTiles.get(key);
        if (!g) { g = { key, x, z, instance: -1, extras: [], fade: 0, ghost: null }; this.wallTiles.set(key, g); }
        return g;
    }

    // Which drawn tiles stand between the camera and something worth seeing. Traced rather than
    // guessed from the geometry: a handful of rays up the camera axis from the body's silhouette,
    // stopping as soon as they clear the top of the walls, which is a few dozen grid lookups a
    // frame and exact about corners in a way a radius test never is.
    _occluders(state) {
        const hits = this._hits || (this._hits = new Set());
        hits.clear();
        const d = this.dungeon;
        if (!d) return hits;
        const len = Math.hypot(CAM.d, CAM.h - CAM.look, CAM.d);
        const dx = CAM.d / len, dy = (CAM.h - CAM.look) / len, dz = CAM.d / len;
        const sx = 0.707, sz = -0.707, STEP = 0.25;
        const cast = (ox, oz, y0) => {
            let x = ox, y = y0, z = oz;
            while (y < WALL_H) {
                x += dx * STEP; y += dy * STEP; z += dz * STEP;
                const tx = Math.floor(x), tz = Math.floor(z);
                if (isSolid(d, tx, tz)) hits.add(tz * GRID + tx);
            }
        };
        const p = state.player;
        for (const y of [0.15, 0.55, 0.95]) cast(p.x, p.z, y);
        for (const o of [-0.3, 0.3]) cast(p.x + sx * o, p.z + sz * o, 0.55);
        // And whatever is close enough to be hitting you. Being killed by something you cannot
        // see is the version of this problem that actually costs you a run.
        for (const e of state.enemies || []) {
            if (Math.hypot(e.x - p.x, e.z - p.z) > 5) continue;
            cast(e.x, e.z, 0.5);
        }
        return hits;
    }

    // Walls are one instanced mesh, which is one draw call for four hundred of them -- and an
    // instance cannot have its own opacity. So a tile that needs to fade hands its place to a
    // GHOST: a real mesh with a real material, taken from a small pool, while its instance is
    // scaled to nothing. Only a handful are ever faded at once, so the pool is tiny and the rest
    // of the room stays in the one cheap draw call.
    _ghost() {
        for (const g of this.ghosts) if (!g.tile) return g;
        const mesh = new THREE.Mesh(this.wallGeo, lmat(0x8d8275, { transparent: true }));
        mesh.visible = false;
        this.scene.add(mesh);
        const g = { mesh, tile: null };
        this.ghosts.push(g);
        return g;
    }
    _setInstance(tile, shown) {
        if (tile.instance < 0 || !this.wallMesh) return;
        const m = this._tmpM;
        m.makeScale(shown ? 1 : 0.0001, shown ? 1 : 0.0001, shown ? 1 : 0.0001);
        m.setPosition(tile.x + 0.5, WALL_H / 2, tile.z + 0.5);
        this.wallMesh.setMatrixAt(tile.instance, m);
        this.wallMesh.instanceMatrix.needsUpdate = true;
    }

    _updateWallFade(state, dt) {
        if (!this.wallTiles) return;
        const hits = this._occluders(state);
        // Only tiles that are hiding you, or still on their way back from having done, rather
        // than every drawn wall in the room every frame.
        const active = this._active || (this._active = new Set());
        for (const key of hits) if (this.wallTiles.has(key)) active.add(key);
        for (const key of active) {
            const tile = this.wallTiles.get(key);
            // Belt and braces for the above: a tile that is no longer part of this room is simply
            // forgotten rather than dereferenced.
            if (!tile) { active.delete(key); continue; }
            const target = hits.has(tile.key) ? 1 : 0;
            if (tile.fade === target && !tile.ghost) { if (!target) active.delete(key); continue; }
            // A ghost stands in for a wall instance while it fades, so only a tile that HAS a
            // wall instance gets one. A brazier's tile is solid and has no masonry on it, and
            // handing it a ghost conjured a transparent stone box around the fire -- the same
            // mistake as drawing walls on prop tiles, arriving by a different road. What fades on
            // a tile like that is whatever is actually standing there, which is its `extras`.
            if (target > 0 && !tile.ghost && tile.instance >= 0) {
                // Hand the tile over to a ghost the moment it starts to fade.
                const g = this._ghost();
                g.tile = tile;
                g.mesh.visible = true;
                g.mesh.position.set(tile.x + 0.5, WALL_H / 2, tile.z + 0.5);
                g.mesh.material.color.setHex(tile.colour);
                g.mesh.material.opacity = 1;
                tile.ghost = g;
                this._setInstance(tile, false);
            }
            const step = Math.min(Math.abs(target - tile.fade), FADE_RATE * dt);
            tile.fade += Math.sign(target - tile.fade) * step;
            const op = 1 - (1 - WALL_FADE) * tile.fade;
            if (tile.ghost) {
                tile.ghost.mesh.material.opacity = op;
                if (tile.fade <= 0.001) {
                    // Fully back: the instance takes over again and the ghost returns to the pool.
                    tile.ghost.mesh.visible = false;
                    tile.ghost.tile = null;
                    tile.ghost = null;
                    this._setInstance(tile, true);
                }
            }
            for (const m of tile.extras) {
                m.material.opacity = op;
                m.material.transparent = tile.fade > 0.002;
            }
        }
    }

    // Hands the previous room's geometry back before the next one is built.
    _clearWorld() {
        const geos = new Set(), mats = new Set();
        this.world.traverse(o => {
            if (!o.isMesh && !o.isPoints && !o.isInstancedMesh) return;
            geos.add(o.geometry);
            (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m));
        });
        geos.forEach(g => g.dispose());
        mats.forEach(m => m.dispose());
        this.world.clear();
        this.wallTiles = new Map();
        // The set of tiles part-way through fading belongs to the room that was here, and the
        // tiles are about to be replaced. Carrying it over meant looking up a tile from the last
        // room in this room's map, getting nothing, and reading a property off it -- which threw
        // inside sync(), every frame, forever.
        //
        // It only ever bit when the new room was a different SHAPE, because two arenas are the
        // same size and their walls land on the same tiles, so the stale keys happened to still
        // exist. Walking out of the market -- nineteen by fifteen, into an arena twenty-five by
        // nineteen -- was the one move in the game guaranteed to produce a key that no longer
        // means anything.
        if (this._active) this._active.clear();
        this.torches = [];
        this.flames = null;
        this.gateLamps = [];
        this.veils = [];
        this.crowd = null;
        this.doorMeshes = new Map();
        for (const g of this.ghosts || []) { g.tile = null; g.mesh.visible = false; }
    }

    // ---------- the room ----------
    // Floors and walls are two instanced meshes rather than nine hundred separate ones. That is
    // the whole performance story of this file: a room used to cost a draw call per tile and now
    // costs two, plus a handful for the gates, the braziers and whatever is standing in it.
    buildDungeon(d) {
        this._clearWorld();
        this.dungeon = d;
        this.wallTiles = new Map();
        this.floorIndex = new Map();
        // The room's palette. One table decides the stone, the sand and the air, so a place
        // reads as a place from the first frame rather than as the same room with different
        // puddles in it. Everything below asks `pal` rather than naming a colour.
        const pal = this.pal = BIOMES[d.biome] || BIOMES.sands;
        this.scene.fog.color.setHex(pal.fog);
        this.scene.background = new THREE.Color(pal.fog);
        if (pal.air) {
            this.ambient.color.setHex(pal.air.ambient);
            this.ambient.intensity = pal.air.strength;
            this.sky.color.setHex(pal.air.sky);
        }
        // Painted from scratch below, so anything changed before the room was drawn is already
        // in the picture.
        if (d.dirty) d.dirty.clear();
        this.ghosts = this.ghosts || [];
        this._tmpM = this._tmpM || new THREE.Matrix4();
        this.wallGeo = new THREE.BoxGeometry(1, WALL_H, 1);

        const floorGeo = new THREE.BoxGeometry(1, 0.2, 1);
        const rubbleGeo = new THREE.BoxGeometry(0.2, 0.1, 0.22);
        const floors = [], walls = [], rubble = [];

        // Every tile that belongs to a passage behind a gate, and every piece of rock that walls
        // one in. They are coloured far darker than the room, which is the whole trick: a lit
        // grey recess reads as a dent in the wall, and the same recess in shadow reads as
        // somewhere that keeps going.
        const passage = new Map();
        for (const dw of d.doorways || []) for (const [x, z] of dw.alcove) passage.set(z * GRID + x, dw);
        const passageRock = new Set();
        for (const key of passage.keys()) {
            const px = key % GRID, pz = Math.floor(key / GRID);
            for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
                const x = px + dx, z = pz + dz;
                if (tileAt(d, x, z) === WALL) passageRock.add(z * GRID + x);
            }
        }
        for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
            const t = tileAt(d, x, z);
            if (t === WALL) {
                // Only walls that border something walkable are drawn. The rest of the rock is
                // never seen from this camera.
                let borders = false;
                for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]])
                    if (tileAt(d, x + dx, z + dz) !== WALL) { borders = true; break; }
                if (borders) walls.push([x, z]);
            } else {
                // A PROP tile gets its floor drawn -- whatever stands on it is standing on
                // something -- but no rubble, because the rubble would be inside the brazier.
                floors.push([x, z]);
                if (t === PROP) continue;
                // Scattered rubble and bone, stable per tile rather than per frame, so the floor
                // has something for the eye to catch on.
                const r = (x * 7919 + z * 104729) % 100;
                if (r < 8) rubble.push([x, z, r]);
            }
        }

        const m = this._tmpM;
        const colour = new THREE.Color();
        this.floorMesh = new THREE.InstancedMesh(floorGeo, lmat(0xffffff), floors.length);
        floors.forEach(([x, z], i) => {
            m.makeTranslation(x + 0.5, -0.1, z + 0.5);
            this.floorMesh.setMatrixAt(i, m);
            // Checkerboarded, so the floor has a readable grid at a glance -- and much darker
            // down a passage, fading with every tile further in, so the eye reads distance.
            const dw = passage.get(z * GRID + x);
            if (dw) {
                // Every passage is dark stone, an exit no different from a hole things come out
                // of. Painting the exits warm made them look open while their gate was still down,
                // which is precisely the thing the player must not be told. What separates them
                // is the lamp, and the lamp only burns once you can actually walk through.
                const depth = Math.max(Math.abs(x - dw.tiles[0][0]), Math.abs(z - dw.tiles[0][1]));
                const k = Math.max(0, 1 - depth * 0.3);
                colour.setHex(0x2a2521).multiplyScalar(0.35 + k * 0.8);
            } else colour.setHex((x + z) % 2 ? pal.floor[0] : pal.floor[1]);
            // What is lying on the tile, if anything. Water and oil are painted into the floor
            // rather than laid on top of it as their own geometry: at this resolution a colour IS
            // a surface, and it costs nothing on a mesh that is already instanced.
            const surf = surfaceAt(d, x, z);
            if (surf !== SURFACE.sand) colour.setHex(surfaceHex(surf, x, z));
            this.floorMesh.setColorAt(i, colour);
            // Remembered so a tile that catches fire can be recoloured on the frame it does.
            this.floorIndex.set(z * GRID + x, i);
        });
        this.world.add(this.floorMesh);

        this.wallMesh = new THREE.InstancedMesh(this.wallGeo, lmat(0xffffff), walls.length);
        walls.forEach(([x, z], i) => {
            m.makeTranslation(x + 0.5, WALL_H / 2, z + 0.5);
            this.wallMesh.setMatrixAt(i, m);
            const hex = passageRock.has(z * GRID + x) ? ((x + z) % 2 ? 0x322c26 : 0x272220)
                      : (x + z) % 2 ? pal.wall : shaded(pal.wall, 0.88);
            this.wallMesh.setColorAt(i, colour.setHex(hex));
            const tile = this._fadeTile(x, z);
            tile.instance = i;
            tile.colour = hex;
        });
        this.world.add(this.wallMesh);

        if (rubble.length) {
            const rm = new THREE.InstancedMesh(rubbleGeo, lmat(pal.rubble), rubble.length);
            rubble.forEach(([x, z, r], i) => {
                m.makeRotationY(r);
                m.setPosition(x + 0.3 + (r % 5) * 0.08, 0.04, z + 0.3 + (r % 4) * 0.1);
                rm.setMatrixAt(i, m);
            });
            this.world.add(rm);
        }

        this._addGates(d);
        this._addFlames();
        this._addRocks(d);
        this._addBraziers(d);
        this._addCrowd(d);
        this._addStalls(d);
        this._addMotes();
        return { floors: floors.length, walls: walls.length };
    }

    // ---------- the gates ----------
    // A portcullis in each gateway, and behind the ones you can actually leave by, light. That is
    // the only thing that tells you which of four identical arches is a way out while the fight
    // is still going: an exit has somewhere on the other side of it, and somewhere has a torch.
    _addGates(d) {
        for (const dw of d.doorways) {
            this._addArch(d, dw);
            const mx = dw.tiles.reduce((n, t) => n + t[0] + 0.5, 0) / dw.tiles.length;
            const mz = dw.tiles.reduce((n, t) => n + t[1] + 0.5, 0) / dw.tiles.length;
            const along = dw.tiles.length > 1 && dw.tiles[0][0] === dw.tiles[1][0];
            const meshes = [];
            for (const [tx, tz] of dw.tiles) {
                const gate = new THREE.Group();
                const frame = box(1, 0.16, 0.34, 0x2a231c);
                frame.position.y = WALL_H - 0.08;
                gate.add(frame);
                for (let i = 0; i < 4; i++) {
                    const bar = box(0.1, WALL_H - 0.1, 0.16, 0x4a4038);
                    bar.position.set(-0.36 + i * 0.24, (WALL_H - 0.1) / 2, 0);
                    gate.add(bar);
                }
                const rail = box(1, 0.12, 0.2, 0x4a4038);
                rail.position.y = 0.5;
                gate.add(rail);
                gate.position.set(tx + 0.5, 0, tz + 0.5);
                if (along) gate.rotation.y = Math.PI / 2;
                gate.visible = true;
                this.world.add(gate);
                meshes.push(gate);
                // The gate fades with the wall it sits in.
                const tile = this._fadeTile(tx, tz);
                gate.traverse(o => { if (o.isMesh) { o.material.transparent = false; tile.extras.push(o); } });
            }
            this.doorMeshes.set(dw.i, meshes);

            // A roof over the passage. The veil closes the opening as seen from the FRONT, and
            // this camera does not only look from the front -- it looks down, over the top of a
            // wall that is a tile and a half high, into what was an open trench in the rock. So
            // the tunnel gets a ceiling, flush with the top of the wall, and from above a gateway
            // is simply more stone.
            //
            // One slab for the whole passage rather than one per tile: it is a rectangle, the
            // camera never sees its underside, and four gateways' worth of per-tile ceiling would
            // be fifty draw calls for a surface nobody looks at.
            const covered = [...dw.tiles, ...dw.alcove];
            const rx = covered.map(t => t[0]), rz = covered.map(t => t[1]);
            const x0 = Math.min(...rx), x1 = Math.max(...rx) + 1;
            const z0 = Math.min(...rz), z1 = Math.max(...rz) + 1;
            const roof = box(x1 - x0 + 0.04, 0.42, z1 - z0 + 0.04, 0x2f2924,
                             { transparent: true, opacity: 1 });
            roof.position.set((x0 + x1) / 2, WALL_H - 0.21, (z0 + z1) / 2);
            this.world.add(roof);

            // The veil: a panel filling the opening, flush with the wall. It is the entire answer
            // to "I can see inside the gate" -- there is no longer anything to see. What the
            // opening shows is a colour and nothing else: black when you cannot go through it,
            // burning when you can.
            //
            // It lifts only for whatever is actually passing: you, when you step into the
            // gateway, and a spawn gate while it is sending a wave. Otherwise the inside of a
            // gate is not a place, it is a state.
            const veil = box(dw.tiles.length + 0.12, WALL_H - 0.04, 0.14, 0x100d0b,
                             { transparent: true, opacity: 1 });
            veil.position.set(mx - dw.into.x * 0.42, (WALL_H - 0.04) / 2, mz - dw.into.z * 0.42);
            veil.rotation.y = Math.atan2(dw.into.x, dw.into.z);
            this.world.add(veil);
            // Not handed to the fade system as an `extra` -- that would set its opacity too, and
            // the two would argue over it every frame. It keeps a reference to its tile instead
            // and folds the fade in itself below.
            this.veils.push({ dw, veil, roof, lit: 0,
                              tile: this._fadeTile(dw.tiles[0][0], dw.tiles[0][1]) });

            if (dw.role !== 'exit') continue;
            // Somewhere on the other side. Dim while the gate is down -- light through bars -- and
            // full once it lifts. A spawn gate gets none of this: behind those there is nothing
            // but the dark they come out of.
            // Light just inside the opening, spilling out of it. The camera looks down at
            // forty-five degrees, so a passage running away from it is hidden behind the rock
            // above its own opening -- what you can see is the mouth and the floor in front of
            // it, and that is where the light has to be.
            const lamp = new THREE.PointLight(0xffc089, 0, 9, 1.4);
            lamp.position.set(mx - dw.into.x * 1.1, 1.0, mz - dw.into.z * 1.1);
            this.world.add(lamp);
            // And the wedge of it on the floor of the room, in front of the gate, widening as it
            // goes the way light through a doorway does.
            const glow = box(dw.tiles.length + 1.4, 0.05, 4.2, 0xffc089,
                             { transparent: true, opacity: 0 });
            glow.position.set(mx + dw.into.x * 1.9, 0.035, mz + dw.into.z * 1.9);
            glow.rotation.y = Math.atan2(dw.into.x, dw.into.z);
            this.world.add(glow);
            // A torch bracketed either side of the opening. Unlit stone while the gate is shut,
            // burning once it is not -- which is the signal read from furthest away, because a
            // flame is the only thing in a dark room the eye goes to on its own.
            const flames = [];
            const across = { x: dw.into.z, z: dw.into.x };       // along the wall, not through it
            for (const sx of [-1, 1]) {
                const bx = mx + across.x * sx * (dw.tiles.length / 2 + 0.55);
                const bz = mz + across.z * sx * (dw.tiles.length / 2 + 0.55);
                // Clear of the stone, and low enough to burn under the top of it. Both halves
                // were wrong before: at 0.35 out of the mouth's line the bracket was still
                // INSIDE the wall cube, which is half a tile thick, so the torch was buried in
                // the rock and what you saw of its flame was the part that came out of the top
                // of the wall. Mounted on the face at head height instead, with the flame given
                // less room than the wall is tall.
                const out = 0.82, y = 0.8;
                const bracket = box(0.16, 0.34, 0.16, 0x3a2f26);
                bracket.position.set(bx + dw.into.x * out, y, bz + dw.into.z * out);
                this.world.add(bracket);
                const flame = box(0.2, 0.26, 0.2, 0x3a332c);
                flame.position.set(bx + dw.into.x * out, y + 0.23, bz + dw.into.z * out);
                this.world.add(flame);
                flames.push(flame);
            }
            this.gateLamps.push({ dw, lamp, glow, flames, seed: Math.random() * 10 });
        }
    }

    // ---------- fire you can see ----------
    // A burning tile used to be a recoloured floor square, which read as a warm patch of sand and
    // nothing more: the thing that was supposed to be the most dangerous place in the room was the
    // one thing in it with no silhouette. Flames are geometry now -- four tongues per tile out of
    // one instanced mesh, so a slick the length of the room costs a single draw call.
    //
    // They are unlit and unfogged on purpose. Fire is the brightest thing in the pit; a flame that
    // dims with distance like stone does stops reading as fire.
    _addFlames() {
        const geo = new THREE.BoxGeometry(1, 1, 1);
        // Translucent, and it does not write depth: tongues overlap constantly, and a flame that
        // punches an opaque hole through the one behind it reads as a stack of cut-out shapes
        // rather than as fire. Depth TESTING stays on, so a body still stands in front of it.
        const mat = new THREE.MeshBasicMaterial({ fog: false, toneMapped: false,
                                                  transparent: true, opacity: 0.78,
                                                  depthWrite: false });
        this.flames = new THREE.InstancedMesh(geo, mat, FLAME_POOL);
        this.flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.flames.frustumCulled = false;
        this.flames.count = 0;
        this.world.add(this.flames);
    }

    // Every tongue in the room, tiles and bodies alike, written into the one mesh each frame.
    // `count` is set to however many were used, so an unlit room draws nothing at all.
    _animateFlames(state, dt) {
        const fm = this.flames;
        if (!fm) return;
        const m = this._flameM || (this._flameM = new THREE.Matrix4());
        const q = this._flameQ || (this._flameQ = new THREE.Quaternion());
        const pos = this._flameP || (this._flameP = new THREE.Vector3());
        const scl = this._flameS || (this._flameS = new THREE.Vector3());
        const col = this._flameC || (this._flameC = new THREE.Color());
        let i = 0;

        // One box of a tongue. Everything about a flame here is silhouette: narrow, tall, and
        // leaning, because at this resolution the outline is the only thing that survives.
        const slab = (x, y, z, w, h, sway, hex, lick) => {
            if (i >= FLAME_POOL) return;
            pos.set(x + sway, y + h / 2, z + sway * 0.7);
            scl.set(w, h, w);
            m.compose(pos, q, scl);
            fm.setMatrixAt(i, m);
            // Brightened a little on the lick, but not into white: a flame whose core goes white
            // every few frames reads as a lamp, and the first pass at this looked like a row of
            // fat candles standing in the sand.
            col.setHex(hex).multiplyScalar(0.78 + lick * 0.22);
            fm.setColorAt(i, col);
            i++;
        };

        // A tongue: three boxes, each narrower and further over than the one below it. The taper
        // is what makes it a flame rather than a block, and the lean is what makes it move --
        // the higher the box, the further the wind has had it.
        const tongue = (x, y, z, w, seed, heat, scale) => {
            // Two slow sines rather than one fast absolute. |sin| has a cusp at every zero, and
            // that cusp is a visible snap -- it made the flames flicker like a strobe instead of
            // moving like fire. Two frequencies that do not divide into each other never repeat
            // in any way the eye can catch, and both are slow.
            const lick = 0.62 + Math.sin(this.elapsed * 5.5 + seed) * 0.22
                              + Math.sin(this.elapsed * 3.1 + seed * 1.7) * 0.16;
            const wind = Math.sin(this.elapsed * 2.6 + seed * 1.9) * 0.07;
            const tall = heat * lick * scale * 1.9;
            const h0 = 0.3 * tall, h1 = 0.3 * tall, h2 = 0.28 * tall;
            slab(x, y, z, w, h0, wind * 0.2, 0xffe6a0, lick);
            slab(x, y + h0, z, w * 0.72, h1, wind, 0xffa02a, lick);
            slab(x, y + h0 + h1, z, w * 0.48, h2, wind * 2.1, 0xe8430e, lick);
        };

        // A tile alight: one tongue up the middle and two smaller ones off the sides, so the
        // thing has a ragged edge instead of a single stalk.
        // `size` scales the whole flame, height included. It used to scale only the width, which
        // is why a gate bracket -- asked for a small flame -- threw one a tile high and put it
        // straight through the arch above the gateway.
        const blaze = (x, y, z, size, heat, seed) => {
            tongue(x, y, z, 0.3 * size, seed, heat, size);
            tongue(x - 0.27 * size, y, z + 0.15 * size, 0.2 * size, seed + 3.1, heat, 0.72 * size);
            tongue(x + 0.25 * size, y, z - 0.17 * size, 0.18 * size, seed + 5.9, heat, 0.64 * size);
        };

        // A body alight. The same flames in a ring around it rather than one up the middle: a
        // tongue through the centre of a character this small simply deletes it, and you still
        // have to be able to see what it is you have set fire to.
        const alight = (x, y, z, size, heat, seed) => {
            for (let k = 0; k < 3; k++) {
                const a = seed + k * 2.1;
                tongue(x + Math.sin(a) * 0.3 * size, y, z + Math.cos(a) * 0.3 * size,
                       0.17 * size, a * 3.3, heat, 0.72 * size);
            }
        };

        // The braziers and the gate brackets, first, because they are few and fixed: if a slick
        // running the length of the room ever exhausts the pool, it should cost the far end of
        // the slick a tongue or two and not put the room's standing lights out.
        for (const t of this.torches || [])
            blaze(t.flame.position.x, 0.88, t.flame.position.z, 0.52, 1, t.seed * 2.7);
        for (const lamp of this.gateLamps || []) {
            // Only a gate you can actually walk through burns. That is the one signal the room
            // gives you from across it, and a bracket throwing flames over a shut gate would be
            // a lie told in the most visible way available.
            if (!lamp.dw.open) continue;
            for (const f of lamp.flames)
                blaze(f.position.x, f.position.y - 0.06, f.position.z, 0.3, 1, lamp.seed + f.position.x);
        }

        for (const f of state.fires || []) {
            // Rises over the first moment and dies down over the last, so a slick catching and a
            // slick going out both read from across the room.
            const heat = Math.min(1, Math.min(f.t / 1.1, (TERRAIN.fireTime - f.t) / 0.35));
            blaze(f.x + 0.5, 0.05, f.z + 0.5, 1, Math.max(0.15, heat), f.x * 2.3 + f.z * 3.7);
        }
        // And whatever is carrying fire around with it.
        const p = state.player;
        if (p && p.burn > 0) alight(p.x, 0.15, p.z, 1, Math.min(1, p.burn / 0.4), this.elapsed * 0.6);
        for (const e of state.enemies || [])
            if (e.burn > 0) alight(e.x, 0.12, e.z, 0.9 + e.size * 0.5, Math.min(1, e.burn / 0.4), e.id * 1.7);

        fm.count = i;
        fm.instanceMatrix.needsUpdate = true;
        if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
    }

    // ---------- what fell in here ----------
    // Boulders. Three boxes on top of each other at odd angles, which at this resolution is all
    // a rock is. They take the same fade as the walls do, because they are chest high and stand
    // between the camera and you exactly as a wall does -- an unfading rock is a rock you fight
    // an entire wave behind.
    _addRocks(d) {
        for (const k of d.rocks || []) {
            const pal = this.pal;
            const lumps = [
                { w: 0.82, h: 0.5, y: 0.25, c: shaded(pal.wall, 0.72) },
                { w: 0.62, h: 0.38, y: 0.62, c: shaded(pal.wall, 0.84) },
                { w: 0.34, h: 0.24, y: 0.9, c: shaded(pal.wall, 0.66) }
            ];
            const tile = this._fadeTile(k.tx, k.tz);
            lumps.forEach((l, i) => {
                const m = box(l.w, l.h, l.w, l.c);
                // Nudged off centre and turned, so a row of them is not a row of the same rock.
                m.position.set(k.x + (k.seed * 7 % 1 - 0.5) * 0.16 * i,
                               l.y, k.z + (k.seed * 13 % 1 - 0.5) * 0.16 * i);
                m.rotation.y = k.seed * 9 + i * 0.7;
                this.world.add(m);
                tile.extras.push(m);
            });
        }
    }

    _addBraziers(d) {
        // Drawn where the grid says they are, and wide enough to fill the tile that was carved
        // solid for them -- a slim brazier on a solid tile stops you a foot short of thin air.
        for (const b of d.braziers || []) {
            const base = cyl(0.26, 0.4, 0.55, 6, 0x3a332c);
            base.position.set(b.x, 0.27, b.z);
            const bowl = cyl(0.44, 0.26, 0.24, 6, 0x4a4038);
            bowl.position.set(b.x, 0.66, b.z);
            // A bed of embers in the bowl. What you actually see burning above it is drawn with
            // the same flames the oil fires use -- a brazier of solid orange next to a slick
            // throwing real tongues made the brazier look like a lamp somebody had left on.
            const fire = box(0.4, 0.18, 0.4, 0xd9571a);
            fire.position.set(b.x, 0.84, b.z);
            this.world.add(base, bowl, fire);
            const light = new THREE.PointLight(0xffa03c, 2.2, 13, 1.7);
            light.position.set(b.x, 1.6, b.z);
            this.world.add(light);
            // It is solid and chest high, so it can stand between you and the camera -- which
            // means it fades like the stone does. The flame is left out of that: a brazier going
            // translucent is fine, a fire going translucent looks broken.
            const tile = this._fadeTile(Math.floor(b.x), Math.floor(b.z));
            for (const m of [base, bowl]) tile.extras.push(m);
            // Joins the same guttering list the gate torches use, so nothing in the room burns
            // with a steady flame.
            this.torches.push({ light, flame: fire, seed: Math.random() * 10 });
        }
    }

    // ---------- the people who paid ----------
    // Tiers of them, raked back and up behind the two far walls. Only the far walls: the camera
    // looks from the near corner, so a stand on the south or east side would sit between the lens
    // and the fight, and nothing is worth putting in front of the fight.
    //
    // Two instanced meshes for the lot -- a body and a head each -- so four hundred spectators
    // cost two draw calls. They are unlit by anything in the room, which is right: from down on
    // the sand a crowd is a dark mass with the sky behind it, and the only thing you can read
    // from it is movement.
    _addCrowd(d) {
        this.crowd = null;
        const r = d.arena;
        if (!r) return;

        const TIERS = 4, SPACING = 0.46;
        const seats = [];
        // The stand itself, first. Without it four hundred figures hang in a void and read as
        // scattered dots; with it they are sitting on something, and the something is the reason
        // the room has a horizon at all.
        for (let tier = 0; tier < TIERS; tier++) {
            const back = 1.5 + tier * 0.95;
            const top = WALL_H - 0.35 + tier * 0.5;
            const shade = [0x4a433b, 0x433d35, 0x3c362f, 0x35302a][tier];
            const stepN = box(r.w + 5, 0.5, 1.0, shade);
            stepN.position.set(r.x + r.w / 2, top - 0.25, r.z - back);
            const stepW = box(1.0, 0.5, r.h + 5, shade);
            stepW.position.set(r.x - back, top - 0.25, r.z + r.h / 2);
            this.world.add(stepN, stepW);

            const y = top + 0.21;
            for (let x = r.x - 2.2; x < r.x + r.w + 2.2; x += SPACING)
                seats.push({ x: x + (Math.random() - 0.5) * 0.14, y, z: r.z - back });
            for (let z = r.z - 2.2; z < r.z + r.h + 2.2; z += SPACING)
                seats.push({ x: r.x - back, y, z: z + (Math.random() - 0.5) * 0.14 });
        }
        for (const st of seats) {
            st.phase = Math.random() * Math.PI * 2;
            // A few of them are always more excitable than the rest, which is what stops a
            // stadium reading as one animation played four hundred times.
            st.eager = 0.6 + Math.random() * 1.0;
        }

        const bodyGeo = new THREE.BoxGeometry(0.28, 0.4, 0.2);
        const headGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
        const bodies = new THREE.InstancedMesh(bodyGeo, lmat(0xffffff), seats.length);
        const heads = new THREE.InstancedMesh(headGeo, lmat(0xffffff), seats.length);
        const m = new THREE.Matrix4(), col = new THREE.Color();
        // Lit by nothing in the room, so the colours themselves have to carry them: dull cloth
        // and faces just bright enough to pick a head out of the mass.
        const CLOTH = [0x554a3e, 0x4a4136, 0x635447, 0x40382f, 0x5c4f42, 0x6b5a49];
        const SKIN = [0xb08a66, 0x96724f, 0xc79c74, 0x7d5c40, 0xa8825e];
        seats.forEach((st, i) => {
            m.makeTranslation(st.x, st.y, st.z);
            bodies.setMatrixAt(i, m);
            m.makeTranslation(st.x, st.y + 0.29, st.z);
            heads.setMatrixAt(i, m);
            bodies.setColorAt(i, col.setHex(CLOTH[i % CLOTH.length]).multiplyScalar(0.7 + Math.random() * 0.55));
            heads.setColorAt(i, col.setHex(SKIN[(i * 7) % SKIN.length]).multiplyScalar(0.7 + Math.random() * 0.45));
        });
        this.world.add(bodies, heads);

        // Torches up in the stand, so the mass has an edge to read against and the dark behind it
        // has a depth.
        for (let i = 0; i < 8; i++) {
            const st = seats[Math.floor((i + 0.5) * seats.length / 8) % seats.length];
            const post = box(0.1, 0.5, 0.1, 0x2a231c);
            post.position.set(st.x, st.y + 0.45, st.z);
            const fire = box(0.2, 0.3, 0.2, 0xffb04a, { emissive: 0xff9a2e });
            fire.position.set(st.x, st.y + 0.82, st.z);
            this.world.add(post, fire);
        }

        this.crowd = { seats, bodies, heads, m: new THREE.Matrix4(), t: 0 };
    }

    // Water moves and fire burns, and both are the same instanced floor being recoloured a tile
    // at a time. Only tiles that are doing something are touched -- a still floor costs nothing.
    _animateFloor(state, d, dt) {
        if (!this.floorMesh || !d || !d.surface) return;
        const col = this._col || (this._col = new THREE.Color());
        const mesh = this.floorMesh;
        let touched = false;

        // Whatever the simulation changed since the last frame -- ice melted, snow thawed, a
        // slick burnt down to ash -- painted back to what it now is. Before the animated passes
        // below, so a tile that is now water or fire gets their treatment on top.
        if (d.dirty && d.dirty.size) {
            const pal = this.pal || BIOMES.sands;
            for (const key of d.dirty) {
                const i = this.floorIndex.get(key);
                if (i === undefined) continue;
                const x = key % GRID, z = Math.floor(key / GRID), surf = d.surface[key];
                col.setHex(surf === SURFACE.sand ? ((x + z) % 2 ? pal.floor[0] : pal.floor[1])
                                                 : surfaceHex(surf, x, z));
                mesh.setColorAt(i, col);
            }
            d.dirty.clear();
            touched = true;
        }

        // A slow swell across the water, so a pool reads as liquid rather than as blue floor --
        // and a slower, colder shimmer across oil, which is how a slick reads as something wet
        // lying on the sand rather than as a dark patch of it.
        for (const [key, i] of this.floorIndex) {
            const surf = d.surface[key];
            if (surf !== SURFACE.water && surf !== SURFACE.oil) continue;
            const x = key % GRID, z = Math.floor(key / GRID);
            if (surf === SURFACE.water) {
                const wave = Math.sin(this.elapsed * 1.7 + x * 0.6 + z * 0.4) * 0.5 + 0.5;
                col.setHex(0x366a89).multiplyScalar(0.85 + wave * 0.4);
            } else {
                // A sheen that slides along the slick, violet into a sick green and back. Blended
                // between two hex colours rather than built with setRGB: three takes RGB as LINEAR
                // light and brightens it on the way to the screen, which turned "near black" into
                // a pale lilac patch lighter than the sand around it -- oil you could mistake for
                // anything but oil.
                const k = Math.sin(this.elapsed * 0.9 + x * 0.45 - z * 0.3) * 0.5 + 0.5;
                const sheen = this._sheen || (this._sheen = new THREE.Color(0x1b2a20));
                col.setHex(0x251d34).lerp(sheen, k);
            }
            mesh.setColorAt(i, col);
            touched = true;
        }
        // And the fires, which flicker hard and unevenly.
        for (const f of state.fires || []) {
            const i = this.floorIndex.get(f.z * GRID + f.x);
            if (i === undefined) continue;
            const fade = Math.min(1, f.t / 1.2);
            const lick = 0.55 + Math.abs(Math.sin(this.elapsed * 19 + f.x * 2.1 + f.z * 1.3)) * 0.45;
            // Embers, not flame. The flames are geometry standing on top of this now, and a tile
            // painted flame-bright underneath them washed the whole slick into one orange smear.
            col.setRGB(0.62 * lick * fade, 0.2 * lick * fade, 0.05 * lick * fade);
            mesh.setColorAt(i, col);
            touched = true;
        }

        if (touched && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

        // One light for the whole blaze rather than one per tile: a fire this size is a glow in
        // the room, and forty point lights is a slideshow.
        const fires = state.fires || [];
        if (!this._fireLight) {
            this._fireLight = new THREE.PointLight(0xff8a30, 0, 14, 1.6);
            this.scene.add(this._fireLight);
        }
        if (fires.length) {
            let mx = 0, mz = 0;
            for (const f of fires) { mx += f.x + 0.5; mz += f.z + 0.5; }
            this._fireLight.position.set(mx / fires.length, 1.1, mz / fires.length);
            const want = Math.min(4.5, 1.2 + fires.length * 0.25);
            this._fireLight.intensity += (want - this._fireLight.intensity) * Math.min(1, dt * 6);
        } else {
            this._fireLight.intensity += (0 - this._fireLight.intensity) * Math.min(1, dt * 4);
        }
    }

    // How hard they are on their feet. Silent is a slow shuffle; roaring is four hundred people
    // jumping, slightly out of time with each other.
    _animateCrowd(dt, favour) {
        const c = this.crowd;
        if (!c) return;
        const heat = Math.max(0, Math.min(1, favour / 100));
        const amp = 0.015 + heat * heat * 0.4;
        const rate = 2.4 + heat * 9;
        c.t += dt;
        const m = c.m;
        for (let i = 0; i < c.seats.length; i++) {
            const st = c.seats[i];
            // Absolute sine, so they leave the bench and come back to it rather than sinking
            // through it.
            const lift = Math.abs(Math.sin(c.t * rate * st.eager + st.phase)) * amp * st.eager;
            m.makeTranslation(st.x, st.y + lift, st.z);
            c.bodies.setMatrixAt(i, m);
            m.makeTranslation(st.x, st.y + 0.3 + lift * 1.15, st.z);
            c.heads.setMatrixAt(i, m);
        }
        c.bodies.instanceMatrix.needsUpdate = true;
        c.heads.instanceMatrix.needsUpdate = true;
    }

    // What makes a gateway read as a way somewhere rather than a square cut in a wall: a heavy
    // arch around the mouth, and ribs running back down the passage behind it. From this camera
    // the ribs are the whole illusion -- three bands receding and getting darker is a tunnel, and
    // the same hole without them is a grey box.
    _addArch(d, dw) {
        const tiles = dw.tiles;
        const mx = tiles.reduce((n, t) => n + t[0] + 0.5, 0) / tiles.length;
        const mz = tiles.reduce((n, t) => n + t[1] + 0.5, 0) / tiles.length;
        const along = tiles.length > 1 && tiles[0][0] === tiles[1][0];   // gateway runs north-south
        const g = new THREE.Group();
        const span = tiles.length;

        // Jambs either side of the mouth, in dressed stone a shade lighter than the rough wall
        // they are set into -- so the arch reads as built and the hole between them as dark.
        for (const sx of [-1, 1]) {
            const jamb = box(0.44, WALL_H + 0.28, 1.15, 0x9a9086);
            jamb.position.set(sx * (span / 2 + 0.18), (WALL_H + 0.28) / 2, 0);
            g.add(jamb);
            const cap = box(0.6, 0.24, 1.3, 0xa8a094);
            cap.position.set(sx * (span / 2 + 0.18), WALL_H + 0.38, 0);
            g.add(cap);
        }
        // A lintel over the top, and a keystone on it.
        const lintel = box(span + 1.2, 0.36, 1.05, 0xa8a094);
        lintel.position.y = WALL_H + 0.18;
        g.add(lintel);
        const key = box(0.5, 0.32, 1.18, 0xb8b0a2);
        key.position.y = WALL_H + 0.46;
        g.add(key);

        // Nothing is built down the passage any more. Ribs receding into the dark were an attempt
        // to give the hole depth, and what they actually did was show you the inside of it: a
        // little room with walls and a floor and an end, which is exactly what a way out must not
        // look like. The opening is veiled instead -- see _addGates.


        g.position.set(mx, 0, mz);
        // `into` points into the room, so the ribs are laid away from it.
        g.rotation.y = Math.atan2(dw.into.x, dw.into.z);
        if (along) { /* rotation already follows `into` for both axes */ }
        this.world.add(g);
        // The arch belongs to the wall it is set into, so it fades with it.
        for (const [tx, tz] of tiles) {
            const tile = this._fadeTile(tx, tz);
            g.traverse(o => { if (o.isMesh && !tile.extras.includes(o)) tile.extras.push(o); });
            break;                     // once is enough; they all fade together
        }
    }

    // The market's furniture. Three counters and somebody behind them -- placed from the same
    // list the simulation reads, so the counter you are stood at is the counter you can see.
    _addStalls(d) {
        if (!d.stalls) return;
        // Drawn to match the tiles that were carved solid for them, so the counter you can see is
        // exactly the counter you cannot walk through.
        const top = { upgrade: 0xb4392f, move: 0x7a5aa8, power: 0x4a7fa8 };
        for (const st of d.stalls) {
            const counter = box(st.w, 0.8, st.h, 0x6b4a2a);
            counter.position.set(st.x, 0.4, st.z);
            const cloth = box(st.w + 0.16, 0.12, st.h + 0.16, top[st.kind] || 0x8a6a3a);
            cloth.position.set(st.x, 0.82, st.z);
            this.world.add(counter, cloth);
            // A post and a lantern, so a counter reads as a stall rather than as a crate.
            const px = st.x + (st.w < st.h ? 0 : st.w / 2 - 0.2);
            const pz = st.z + (st.w < st.h ? st.h / 2 - 0.2 : -0.3);
            const post = box(0.12, 1.6, 0.12, 0x4a3524);
            post.position.set(px, 0.8, pz);
            const lantern = box(0.24, 0.26, 0.24, 0xffc089, { emissive: 0x6b4a10 });
            lantern.position.set(px, 1.7, pz);
            this.world.add(post, lantern);
            // Same as the braziers: solid, so it fades rather than hiding you behind it.
            const tile = this._fadeTile(Math.floor(st.x), Math.floor(st.z));
            for (const m of [counter, cloth]) tile.extras.push(m);
        }
        // One lamp for the whole market rather than one per counter: three point lights in a room
        // that has four braziers already is two more than the scene can spare.
        const mid = d.stalls[Math.floor(d.stalls.length / 2)];
        const l = new THREE.PointLight(0xffc089, 2.6, 16, 1.6);
        l.position.set(mid.x, 2.4, mid.z);
        this.world.add(l);

        if (d.keeper) {
            // Not a person so much as a shape in a hood: the only thing down here not trying to
            // kill you, and it should read as strange rather than friendly.
            const robe = cyl(0.2, 0.42, 1.0, 7, 0x2f2a25);
            robe.position.set(d.keeper.x, 0.5, d.keeper.z);
            const hood = cyl(0.04, 0.26, 0.34, 7, 0x3a332c);
            hood.position.set(d.keeper.x, 1.15, d.keeper.z);
            this.world.add(robe, hood);
            for (const sx of [-1, 1]) {
                const eye = box(0.05, 0.05, 0.03, 0xffc860, { emissive: 0xffc860 });
                eye.position.set(d.keeper.x + sx * 0.07, 1.08, d.keeper.z + 0.22);
                this.world.add(eye);
            }
        }
    }

    // Dust in the light. The cloud is anchored to the WORLD, not to the player: motes that travel
    // with you read as specks on the lens rather than as air in the room, which is what the first
    // version looked like. Instead each mote wraps individually once it falls too far behind, so
    // the dust stays put while you move through it and there is always some of it around you.
    _addMotes() {
        // Kept deliberately thin: dust should be something you notice in a torch beam when you
        // stop moving, not a weather effect between you and the game. Fewer, smaller and much
        // fainter than the first pass, which read as snow.
        const mo = (this.pal && this.pal.motes) ||
                   { colour: 0xe8c898, size: 0.035, opacity: 0.18, rise: 0.1, sway: 0.05, count: 110 };
        this.moteDef = mo;
        const N = mo.count, pos = new Float32Array(N * 3);
        // Seeded across the whole grid, since they live in world space now rather than in a box
        // that follows the camera.
        for (let i = 0; i < N; i++) {
            pos[i * 3] = Math.random() * GRID;
            pos[i * 3 + 1] = Math.random() * 3.2;
            pos[i * 3 + 2] = Math.random() * GRID;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({ color: mo.colour, size: mo.size, transparent: true,
                                               opacity: mo.opacity, depthWrite: false });
        this.motes = new THREE.Points(geo, mat);
        this.motes.frustumCulled = false;
        this.world.add(this.motes);
    }

    // ---------- people ----------
    // Every body is the same handful of cubes, built in model.js so that the creation screen and
    // the dungeon can never disagree about what somebody looks like. What arrives here is only
    // the question of WHEN to build one.

    // The model is rebuilt whenever the character it is drawing stops matching it. Checked here
    // rather than announced by whoever changed something, so nothing has to remember to tell the
    // renderer. The look is compared by reference, which is enough: it is replaced wholesale when
    // a prisoner is made and never edited during a run.
    _ensureModel(p) {
        const m = this._modelOf;
        if (m && m.cls === p.cls && m.look === p.look) return;
        this._modelOf = { cls: p.cls, look: p.look };
        if (this.player) { this.scene.remove(this.player); disposeModel(this.player); }
        this.player = buildPlayerModel(p.cls, p.look);
        this.scene.add(this.player);
    }

    _buildEnemy(e) {
        if (e.boss) return this._buildBoss(e);
        const def = ENEMIES[e.kind];
        const g = new THREE.Group();
        const s = def.size * (e.elite ? 1.18 : 1);
        const legs = box(s * 0.6, s * 0.5, s * 0.5, 0x241d18); legs.position.y = s * 0.25;
        const torso = box(s * 0.9, s * 0.8, s * 0.7, def.colour); torso.position.y = s * 0.9;
        const head = box(s * 0.6, s * 0.55, s * 0.6, def.colour); head.position.y = s * 1.55;
        g.add(legs, torso, head);
        // Two dots of eyeshine, the one warm thing about any of them. Placed after the body has
        // been shaped (see below), because several kinds carry their head low and forward and an
        // eye left at the upright height floats in the air above it.
        const eyes = [];
        for (const sx of [-1, 1]) {
            const eye = box(s * 0.12, s * 0.1, s * 0.05, 0xff6b4a);
            eye.userData.side = sx;
            g.add(eye);
            eyes.push(eye);
        }
        // What it is, said in silhouette. At this size a body has about three shapes' worth of
        // room to tell you how it behaves, and how it behaves is the only thing worth saying.
        if (e.kind === 'skeleton') {
            const rib = box(s * 0.95, s * 0.08, s * 0.75, 0xe8e0cc); rib.position.y = s * 0.95; g.add(rib);
        }
        if (e.kind === 'brute') {
            const club = box(s * 0.22, s * 0.8, s * 0.22, 0x4a3a2a);
            club.position.set(s * 0.7, s * 0.9, 0); g.add(club);
        }
        if (e.kind === 'hound') {
            // Low and long, head down: reads as something that runs at you before it has.
            torso.scale.set(0.85, 0.7, 1.5);
            torso.position.y = s * 0.7;
            head.position.set(0, s * 1.1, s * 0.55);
            for (const sx of [-1, 1]) {
                const horn = box(s * 0.1, s * 0.26, s * 0.1, 0xe8dcc6);
                horn.position.set(sx * s * 0.2, s * 1.36, s * 0.5);
                g.add(horn);
            }
        }
        if (e.kind === 'slinger') {
            // A sling held out to one side, so the thing that throws is visible from behind the
            // three melee bodies in front of it.
            const arm = box(s * 0.18, s * 0.5, s * 0.18, def.colour);
            arm.position.set(s * 0.6, s * 1.1, 0);
            arm.rotation.z = -0.5;
            const stone = box(s * 0.26, s * 0.26, s * 0.26, 0x8a8f96);
            stone.position.set(s * 0.85, s * 1.4, 0);
            g.add(arm, stone);
        }
        // ---- the ones that belong somewhere ----
        if (e.kind === 'drowned') {
            // Hunched and weed-hung, head pushed forward. Most of the time in its own room you
            // will see only the top half of this: in water it sinks to the shoulders.
            torso.scale.set(1.05, 0.9, 0.9);
            head.position.set(0, s * 1.42, s * 0.2);
            for (const sx of [-1, 1]) {
                const weed = box(s * 0.12, s * 0.75, s * 0.12, 0x2f4a3a);
                weed.position.set(sx * s * 0.44, s * 0.95, s * 0.18);
                g.add(weed);
            }
        }
        if (e.kind === 'imp') {
            // Small, red and horned, with the next thing it throws already alight in its hand.
            // The coal is the tell: an imp with a lit hand is an imp about to set the floor off.
            for (const sx of [-1, 1]) {
                const horn = box(s * 0.1, s * 0.34, s * 0.1, 0x2a1410);
                horn.position.set(sx * s * 0.22, s * 1.92, 0);
                horn.rotation.z = -sx * 0.4;
                g.add(horn);
            }
            const coal = new THREE.Mesh(new THREE.OctahedronGeometry(s * 0.24),
                                        lmat(0xffa040, { emissive: 0xff5a10 }));
            coal.position.set(s * 0.66, s * 1.25, 0);
            g.add(coal);
            g.userData.coal = coal;
        }
        if (e.kind === 'wolf') {
            // The hound's shape gone white, with a ruff of frost across the shoulders -- the same
            // silhouette on purpose, because it does the same thing. What differs is where.
            torso.scale.set(0.9, 0.72, 1.55);
            torso.position.y = s * 0.7;
            head.position.set(0, s * 1.05, s * 0.6);
            const ruff = box(s * 1.0, s * 0.32, s * 0.5, 0xf2f7fb);
            ruff.position.set(0, s * 1.0, s * 0.22);
            g.add(ruff);
            // Eyes the colour of the ice, lower and further forward than the ordinary eyeshine
            // because the head is.
            for (const sx of [-1, 1]) {
                const eye = box(s * 0.12, s * 0.1, s * 0.05, 0x9fe6ff);
                eye.position.set(sx * s * 0.15, s * 1.12, s * 0.9);
                g.add(eye);
            }
            for (const sx of [-1, 1]) {
                const ear = box(s * 0.12, s * 0.24, s * 0.1, 0x3a4a56);
                ear.position.set(sx * s * 0.18, s * 1.38, s * 0.55);
                g.add(ear);
            }
        }
        if (e.kind === 'thrower') {
            // Broad and stooped, with a rock the size of its own head held overhead. Big enough
            // to pick out at the back of a wave, which is where it will be.
            torso.scale.set(1.25, 1.0, 1.0);
            const arm = box(s * 0.22, s * 0.62, s * 0.22, def.colour);
            arm.position.set(s * 0.55, s * 1.62, 0);
            const rock = box(s * 0.5, s * 0.42, s * 0.46, 0x9a948a);
            rock.position.set(s * 0.32, s * 2.08, 0);
            rock.rotation.set(0.3, 0.5, 0.2);
            g.add(arm, rock);
        }
        if (e.kind === 'bloat') {
            // Round, and lit from inside by the thing it is about to do.
            torso.scale.set(1.35, 1.25, 1.35);
            torso.position.y = s * 0.85;
            head.scale.set(0.7, 0.7, 0.7);
            const sac = new THREE.Mesh(new THREE.OctahedronGeometry(s * 0.42),
                                       lmat(0xd9e05a, { emissive: 0x6b7a1a }));
            sac.position.y = s * 0.9;
            g.add(sac);
            g.userData.sac = sac;
        }
        // Now the head is wherever this kind keeps it, put the eyes on it. A wolf has its own,
        // the colour of the ice.
        for (const eye of eyes) {
            if (e.kind === 'wolf') { g.remove(eye); continue; }
            eye.position.set(eye.userData.side * s * 0.16, head.position.y + s * 0.05,
                             head.position.z + s * 0.3);
        }
        // A crown, for the ones worth killing first -- and a bar, so "worth killing first" is a
        // decision you can keep making as the fight goes on. The boss has one of these in the
        // HUD; an elite is not important enough for the top of the screen and is far too
        // important to have no answer to "how much is left in it".
        if (e.elite) {
            const bar = new THREE.Group();
            const back = box(s * 1.3, s * 0.12, 0.04, 0x1a1512);
            const fill = box(s * 1.26, s * 0.09, 0.05, 0xd9a441);
            fill.position.z = 0.01;
            bar.add(back, fill);
            bar.position.y = s * 2.25;
            g.add(bar);
            g.userData.bar = bar;
            g.userData.barFill = fill;
            g.userData.barWidth = s * 1.26;
        }
        if (e.elite) {
            for (const sx of [-1, 1]) {
                const spike = box(s * 0.1, s * 0.3, s * 0.1, 0xd9a441);
                spike.position.set(sx * s * 0.2, s * 1.95, 0);
                g.add(spike);
            }
            const band = box(s * 0.66, s * 0.1, s * 0.66, 0xd9a441);
            band.position.y = s * 1.85;
            g.add(band);
        }
        g.userData.kind = e.kind;
        g.userData.base = def.colour;
        g.userData.parts = [];
        g.traverse(o => {
            // The health bar is not part of the body: flashing it white on every hit would make
            // the one thing that has to stay readable the least readable thing on the screen.
            if (o.isMesh && !(g.userData.bar && g.userData.bar.children.includes(o)))
                g.userData.parts.push([o.material, o.material.color.getHex()]);
        });
        return g;
    }

    // Bigger, heavier, and lit from inside while it is winding up to do something. The wind-up
    // glow is the whole fight: it is the difference between a boss you read and a boss you are
    // simply hit by.
    _buildBoss(e) {
        const def = BOSSES[e.boss];
        const g = new THREE.Group();
        const s = def.size;
        const legs = box(s * 0.7, s * 0.45, s * 0.6, 0x1d1815); legs.position.y = s * 0.22;
        const torso = box(s * 1.05, s * 0.85, s * 0.8, def.colour); torso.position.y = s * 0.85;
        const head = box(s * 0.55, s * 0.5, s * 0.55, def.colour); head.position.y = s * 1.5;
        const mantle = box(s * 1.25, s * 0.18, s * 0.9, 0x1d1815); mantle.position.y = s * 1.22;
        g.add(legs, torso, head, mantle);
        // A crown of horns, so the silhouette says "this one is different" from across the room.
        for (const sx of [-1, 1]) {
            const horn = box(s * 0.1, s * 0.3, s * 0.1, def.accent);
            horn.position.set(sx * s * 0.2, s * 1.8, 0);
            horn.rotation.z = sx * 0.3;
            g.add(horn);
        }
        for (const sx of [-1, 1]) {
            const eye = box(s * 0.12, s * 0.1, s * 0.05, def.accent);
            eye.position.set(sx * s * 0.14, s * 1.55, s * 0.28);
            g.add(eye);
        }
        const glow = new THREE.PointLight(def.accent, 0, 8, 2);
        glow.position.y = s * 1.1;
        g.add(glow);
        g.userData = { kind: e.kind, base: def.colour, parts: [], glow };
        g.traverse(o => { if (o.isMesh) g.userData.parts.push([o.material, o.material.color.getHex()]); });
        return g;
    }

    // ---------- what the body is doing ----------
    // One arm rotated forward used to be every attack in the game: the knight's sword, the
    // archer's bow and the bard's lute all did the identical thing at different speeds. At this
    // pixel size a body has very little room to say anything, and "what did that just do" is the
    // most useful thing it can say -- so each attack is now its own shape.
    //
    // `t` runs 0 to 1 across the swing and `k` is the out-and-back of it. Every pose is written
    // from the rest position and lerped back to it, so nothing drifts.
    _poseArms(ud, p, dt) {
        const arm = ud.arm, off = ud.off, body = ud.body;
        const home = ud.armHome, offHome = ud.offHome;
        const t = p.swing > 0 ? 1 - p.swing / (p.swingTime || 0.18) : -1;
        const k = t >= 0 ? Math.sin(t * Math.PI) : 0;
        const kind = p.swingKind || 'slash';

        // A bard is never not playing. Standing still, the off hand works across the strings and
        // the lute arm holds its shape -- because a musician who only moves when attacking is a
        // person holding a lute, and the whole character is that they are playing the thing.
        const bard = ud.cls === 'bard';

        // Idle: the off hand swings with the walk, the weapon arm hangs.
        let ax = home.x, ay = home.y, az = home.z, arx = -0.25, ary = 0, arz = 0;
        let ox = offHome.x, oy = offHome.y, oz = offHome.z;
        let orx = p.moving ? Math.sin(this.elapsed * 11) * 0.5 : -0.1, ory = 0, orz = 0;
        let twist = 0, lean = 0;
        if (bard && t < 0) {
            // Strumming along, whether or not anything is happening.
            const strum = Math.sin(this.elapsed * 5.5);
            ox = offHome.x + strum * 0.13;
            oy = offHome.y - Math.abs(strum) * 0.04;
            orx = -1.05;
            arx = -0.85;
            ary = 0.18;
        }

        if (t >= 0) {
            if (kind === 'slash') {
                // A horizontal cut: the blade comes round the body rather than down onto it.
                arx = -1.45 - k * 0.25;
                ary = 1.15 - t * 2.3;
                arz = k * 0.4;
                twist = 0.5 - t * 1.0;
                ax = home.x - k * 0.06;
            } else if (kind === 'stab') {
                // Straight out and straight back, shoulder behind it.
                arx = -1.55;
                ary = -0.12;
                az = home.z + k * 0.42;
                ax = home.x - k * 0.14;
                lean = k * 0.1;
                twist = -k * 0.28;
                // The shield comes up across the body as the sword goes out.
                orx = -0.9 * k - 0.1;
                ory = k * 0.7;
            } else if (kind === 'bash') {
                // The shield leads and the sword arm drops out of the way.
                oz = offHome.z + k * 0.55;
                ox = offHome.x + k * 0.1;
                orx = -1.5;
                ory = k * 0.35;
                arx = -0.1 + k * 0.5;
                ary = 0.5 * k;
                lean = k * 0.22;
                twist = k * 0.5;
            } else if (kind === 'guard') {
                // Shield up and square, sword drawn back to answer. Held, not swung: the whole
                // window is the pose, because the window is the thing you are reading.
                oz = offHome.z + 0.42;
                ox = offHome.x + 0.12;
                orx = -1.55;
                ory = 0.3;
                arx = -0.6; ary = 0.9;
                ax = home.x - 0.08;
                lean = -0.06;
                twist = 0.35;
            } else if (kind === 'spin') {
                // All the way round, both arms out.
                arx = -1.5; ary = t * Math.PI * 2;
                orx = -1.5; ory = t * Math.PI * 2;
                twist = t * Math.PI * 2;
            } else if (kind === 'slam') {
                // Up over the head and down into the floor.
                arx = -2.6 + t * 3.4;
                ary = 0;
                lean = k * 0.18;
                orx = -2.2 + t * 2.6;
            } else if (kind === 'shoot') {
                // The bow arm holds the line; the string hand snaps from the cheek.
                arx = -1.5; ary = -0.08;
                ax = home.x - 0.04;
                oz = offHome.z - 0.28 * (1 - t);
                ox = offHome.x + 0.16 * (1 - t);
                orx = -1.4;
                twist = -0.22;
            } else if (kind === 'strum') {
                // Across the strings and back.
                orx = -1.2;
                ox = offHome.x + 0.34 * Math.sin(t * Math.PI);
                oy = offHome.y - k * 0.08;
                arx = -0.9;
                twist = k * 0.3;
            } else if (kind === 'play') {
                // A song: the lute comes up and the hand works hard across it.
                const fast = Math.sin(t * Math.PI * 5);
                arx = -1.25;
                ary = 0.25;
                ax = home.x - 0.05;
                ox = offHome.x + fast * 0.22;
                oy = offHome.y - 0.06;
                orx = -1.25;
                lean = -k * 0.1;
                twist = fast * 0.12;
            } else {                       // 'cast'
                // Both hands up, weapon overhead.
                arx = -2.3 - k * 0.5;
                orx = -2.1 - k * 0.4;
                lean = -k * 0.12;
            }
        }

        // Lerped rather than set, so the return to rest is a movement and not a snap. Fast enough
        // that the strike itself still lands on the frame it is meant to.
        const rate = Math.min(1, dt * (t >= 0 ? 34 : 13));
        const to = (o, key, v) => { o[key] += (v - o[key]) * rate; };
        to(arm.position, 'x', ax); to(arm.position, 'y', ay); to(arm.position, 'z', az);
        to(arm.rotation, 'x', arx); to(arm.rotation, 'y', ary); to(arm.rotation, 'z', arz);
        to(off.position, 'x', ox); to(off.position, 'y', oy); to(off.position, 'z', oz);
        to(off.rotation, 'x', orx); to(off.rotation, 'y', ory); to(off.rotation, 'z', orz);
        to(body.rotation, 'y', twist);
        to(body.position, 'z', lean);
    }

    // Notes coming off the instrument. Purely a picture -- the simulation has no idea these
    // exist -- which is why they live here and are spawned by watching the body rather than by
    // being told. They are also the only way, at this size, to show that a sound happened.
    _notes(ud, p, dt) {
        this.notePool = this.notePool || [];
        if (ud.cls === 'bard') {
            // A note on the beat while playing, and a burst of them on a song.
            const singing = p.swing > 0 && (p.swingKind === 'play' || p.swingKind === 'strum');
            this.noteT = (this.noteT || 0) - dt;
            if (this.noteT <= 0) {
                this.noteT = singing ? 0.07 : 0.42;
                const n = this.notePool.find(q => !q.live);
                if (n) {
                    n.live = 1;
                    n.mesh.visible = true;
                    n.mesh.position.set(p.x + Math.sin(p.facing + 1.2) * 0.34, 0.85,
                                        p.z + Math.cos(p.facing + 1.2) * 0.34);
                    n.vx = (Math.random() - 0.5) * 0.5;
                    n.vz = (Math.random() - 0.5) * 0.5;
                    n.spin = (Math.random() - 0.5) * 6;
                }
            }
        }
        for (const n of this.notePool) {
            if (!n.live) continue;
            n.live -= dt * 1.1;
            n.mesh.position.x += n.vx * dt;
            n.mesh.position.z += n.vz * dt;
            n.mesh.position.y += dt * 0.85;
            n.mesh.rotation.y += n.spin * dt;
            n.mesh.scale.setScalar(0.6 + n.live * 0.7);
            n.mesh.material.opacity = Math.max(0, n.live) * 0.85;
            if (n.live <= 0) { n.live = 0; n.mesh.visible = false; }
        }
    }

    // ---------- per frame ----------
    sync(state, dungeon, dt) {
        if (!state) return;
        const p = state.player;

        // Camera rides the player at a fixed offset. No smoothing on purpose: at this pixel size
        // a lagging camera reads as the whole world sliding around rather than as weight.
        // A knock when something lands on you. Decays fast: a shake you can still feel a second
        // later reads as a broken camera rather than as a hit.
        this.shake = Math.max(0, (this.shake || 0) - dt * 4.5);
        const sh = this.shake * this.shake;
        const jx = (Math.random() - 0.5) * sh * 1.4, jz = (Math.random() - 0.5) * sh * 1.4;

        this.camera.position.set(p.x + CAM.d + jx, CAM.h, p.z + CAM.d + jz);
        this.camera.lookAt(p.x + jx * 0.5, CAM.look, p.z + jz * 0.5);
        this.torch.position.set(p.x, 2.2, p.z);
        this.torch.intensity = 2.3 + Math.sin(this.elapsed * 7) * 0.18;   // a candle, not a bulb

        // Wall torches gutter out of step with each other. One shared sine would read as the
        // whole dungeon breathing in unison, which is worse than no flicker at all.
        for (const t of this.torches || []) {
            const f = Math.sin(this.elapsed * 9 + t.seed) * 0.5 + Math.sin(this.elapsed * 23 + t.seed * 3) * 0.25;
            t.light.intensity = 1.5 + f * 0.45;
            t.flame.scale.set(1 + f * 0.12, 1 + f * 0.22, 1 + f * 0.12);
        }

        // Motes rise, and wrap around the player one at a time in world space. The wrap is what
        // keeps them on screen; because it moves individual specks rather than the whole cloud,
        // the dust you are looking at never slides along with you.
        if (this.motes) {
            const a = this.motes.geometry.attributes.position;
            const R = 11;
            const mo = this.moteDef || { rise: 0.1, sway: 0.05 };
            for (let i = 0; i < a.count; i++) {
                // Up for dust and embers, down for drips and snow, and wrapped either way.
                let y = a.getY(i) + dt * mo.rise;
                if (y > 3.2) y -= 3.2; else if (y < 0) y += 3.2;
                a.setY(i, y);
                // a sideways wander, so they are not falling in perfect columns
                let x = a.getX(i) + Math.sin(this.elapsed * 0.3 + i) * dt * mo.sway;
                let z = a.getZ(i);
                if (x - p.x > R) x -= R * 2; else if (x - p.x < -R) x += R * 2;
                if (z - p.z > R) z -= R * 2; else if (z - p.z < -R) z += R * 2;
                a.setX(i, x); a.setZ(i, z);
            }
            a.needsUpdate = true;
        }

        // --- the player ---
        this._ensureModel(p);
        this._updateWallFade(state, dt);
        this.player.position.set(p.x, 0, p.z);
        this.player.rotation.y = p.facing;
        const ud = this.player.userData;
        ud.body.position.y = p.moving && !p.dashing ? Math.abs(Math.sin(this.elapsed * 11)) * 0.06 : 0;
        // The lean is on z and the bob is on y, so the two never argue.
        // The swing: the arm whips forward over the attack's first fraction and returns. Big,
        // because at this resolution small is nothing.
        // Divided by the duration this particular swing was given, because a special move winds
        // up over longer than an ordinary one and would otherwise start the arm behind its back.
        this._poseArms(ud, p, dt);
        this._notes(ud, p, dt);
        // A cloak that stays rigid while you run reads as a plank strapped to your back. It
        // trails when you move, snaps out behind a dash, and settles when you stand still.
        if (ud.cloak) {
            const want = p.dashing > 0 ? 0.85 : p.moving ? 0.3 + Math.sin(this.elapsed * 9) * 0.07 : 0.04;
            ud.cloak.rotation.x += (want - ud.cloak.rotation.x) * Math.min(1, dt * 9);
        }
        // Hurt and mercy-window flashes, drawn on the torso so they read without a health bar.
        if (p.hurtFlash > 0.24) this.shake = Math.max(this.shake, 1);   // fires once, on the hit
        // The cast light is the class's own colour; a raised shield borrows it for a cold white
        // and hands it back afterwards.
        if (ud.castHex === undefined) ud.castHex = ud.castLight.color.getHex();
        if (p.parry > 0) {
            // A cold, steady light while the shield is up: from across the room, "the knight
            // is waiting for you to swing" should be the brightest thing about them.
            ud.castLight.color.setHex(0xcfe0ff);
            // A rim, not a floodlight: at 2.4 it washed the knight to a pale blue silhouette and
            // the raised shield -- the thing being signalled -- disappeared into the glow.
            ud.castLight.intensity = 1.0 + Math.sin(this.elapsed * 18) * 0.3;
        } else if (p.castFlash > 0) {
            ud.castLight.color.setHex(ud.castHex);
            ud.castLight.intensity = (p.castFlash / 0.3) * 3.2;
            if (p.castFlash > 0.26) this.shake = Math.max(this.shake, 0.45);
        } else ud.castLight.intensity = 0;
        this.player.visible = !(p.invuln > 0 && p.hurtFlash <= 0 && Math.sin(this.elapsed * 26) < -0.4);

        this._animateCrowd(dt, state.crowd ? state.crowd.favour : 0);
        this._animateFloor(state, dungeon, dt);
        this._animateFlames(state, dt);

        // --- the gates ---
        // Two states and no animation between them: bars in the way, or no bars and the light on.
        // A portcullis grinding down was a lovely thing to watch once and a thing you then had to
        // wait for every time, and worse, it meant "can I walk through this" had a half-second
        // during which the honest answer was "not quite yet".
        if (dungeon && dungeon.doorways) {
            for (const dw of dungeon.doorways) {
                const meshes = this.doorMeshes.get(dw.i);
                if (!meshes) continue;
                for (const m of meshes) m.visible = !dw.open;
            }
        }
        // The veils. What an opening shows is a colour: black if you cannot pass, burning if you
        // can -- and it lifts only for whatever is actually going through it.
        const p2 = state.player;
        for (const v of this.veils || []) {
            const exit = v.dw.role === 'exit';
            // Out of the way for whoever is passing: you, stepping into a gateway, or a wave on
            // its way out of one. Everything else sees a panel.
            const passing = exit ? inAlcove(v.dw, p2.x, p2.z) : v.dw.open;
            const wantLit = exit && v.dw.open ? 1 : 0;
            v.lit += (wantLit - v.lit) * Math.min(1, dt * 5);
            // Out of the way for whoever is passing, and thinned along with the stone it sits in
            // when that stone is standing between you and the camera.
            const occluded = 1 - (1 - WALL_FADE) * (v.tile ? v.tile.fade : 0);
            const want = (passing ? 0 : 1) * occluded;
            const m = v.veil.material;
            m.opacity += (want - m.opacity) * Math.min(1, dt * 9);
            v.veil.visible = m.opacity > 0.02;
            // The ceiling lifts for whoever is under it, or you would walk into a gateway and
            // simply stop existing for the half second before the next room begins.
            const rm = v.roof.material;
            rm.opacity += ((passing ? 0 : 1) - rm.opacity) * Math.min(1, dt * 9);
            v.roof.visible = rm.opacity > 0.02;
            // Cold ash to firelight, so the opening itself is the signal rather than something
            // hung next to it.
            m.color.setRGB(0.06 + v.lit * 0.94, 0.05 + v.lit * 0.72, 0.04 + v.lit * 0.42);
            m.emissive.setRGB(v.lit * 0.85, v.lit * 0.6, v.lit * 0.32);
        }

        // An exit you can walk through is lit; one you cannot is dark stone. The torches either
        // side of it are the same statement made loudly enough to read across the room.
        for (const gl of this.gateLamps || []) {
            const lit = gl.dw.open;
            const want = lit ? 4.6 : 0;
            gl.lamp.intensity += (want - gl.lamp.intensity) * Math.min(1, dt * 5);
            gl.lamp.intensity *= 1 + Math.sin(this.elapsed * 6 + gl.seed) * 0.04;
            gl.glow.material.opacity = Math.min(0.34, gl.lamp.intensity * 0.07);
            for (const f of gl.flames) {
                // Cold stone when unlit; a guttering flame when lit.
                f.material.color.setHex(lit ? 0xffb04a : 0x3a332c);
                const g = lit ? 1 + Math.sin(this.elapsed * 11 + gl.seed) * 0.16 : 1;
                f.scale.set(g, lit ? g * 1.2 : 0.7, g);
            }
        }

        // --- enemies ---
        this._reconcile(this.enemyMeshes, state.enemies, e => this._buildEnemy(e), (mesh, e) => {
            mesh.position.set(e.x, 0, e.z);
            mesh.rotation.y = e.facing;
            const lunge = e.swing > 0 ? Math.sin((1 - e.swing / 0.2) * Math.PI) * 0.22 : 0;
            mesh.position.x += Math.sin(e.facing) * lunge;
            mesh.position.z += Math.cos(e.facing) * lunge;
            mesh.position.y = e.awake ? Math.abs(Math.sin(this.elapsed * 9 + e.id)) * 0.04 : 0;
            // A sleeper sags and breathes; a burning one is lit from beneath.
            mesh.rotation.z = e.sleep > 0 ? 0.42 : 0;
            if (e.sleep > 0) mesh.position.y = Math.sin(this.elapsed * 2 + e.id) * 0.02;
            // The drowned go under in their own water. Eased rather than snapped, so one wades in
            // and rises out instead of dropping through the floor at the edge of a pool.
            const edef = ENEMIES[e.kind];
            if (edef && edef.wades) {
                const ud = mesh.userData;
                const want = this.dungeon && surfaceAt(this.dungeon, e.x, e.z) === SURFACE.water ? edef.size * 0.8 : 0;
                ud.sink = (ud.sink || 0) + (want - (ud.sink || 0)) * Math.min(1, dt * 5);
                mesh.position.y -= ud.sink;
            }
            // An imp's coal pulses, and flares while it is winding up to throw.
            if (mesh.userData.coal) {
                const k = e.wind > 0 ? 1.6 : 1 + Math.sin(this.elapsed * 6 + e.id) * 0.15;
                mesh.userData.coal.scale.setScalar(k);
            }
            // A hit blinks the whole body white. Cheapest possible feedback and the most legible.
            // White for a hit; the telegraph colour while it is winding up to do something. A
            // wind-up nobody can see is not a telegraph, it is just a delay.
            const hit = e.flash > 0;
            let tint = null;
            if (hit) tint = 0xffffff;
            // Asleep: gone grey and slumped, and plainly not coming at you.
            else if (e.sleep > 0) tint = 0x4a4a52;
            // Turned: a slow pink pulse. It is still an enemy, and it will be again.
            else if (e.charm > 0) tint = Math.sin(this.elapsed * 7 + e.id) > 0 ? 0xd98ac4 : null;
            else if (e.wind > 0 || e.rush > 0) {
                const pulse = Math.sin(this.elapsed * 26) > 0;
                const warn = e.windKind === 'burst' ? 0xd9e05a
                           : e.windKind === 'shot' ? 0xe8e0cc : 0xff5a3c;
                tint = e.rush > 0 ? 0xff5a3c : (pulse ? warn : null);
            }
            for (const [mat, hex] of mesh.userData.parts) mat.color.setHex(tint ?? hex);
            // The bar faces the camera rather than the way the body happens to be looking, and
            // shrinks from the left so it empties the way every health bar in the world does.
            if (mesh.userData.bar) {
                mesh.userData.bar.rotation.y = Math.PI / 4 - e.facing;
                const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
                const w = mesh.userData.barWidth;
                mesh.userData.barFill.scale.x = Math.max(0.001, frac);
                mesh.userData.barFill.position.x = -(w * (1 - frac)) / 2;
                mesh.userData.bar.visible = frac < 0.999;
            }
            // A bloat's sac swells as its fuse burns down.
            if (mesh.userData.sac && e.wind > 0) {
                const k = 1 + (1 - e.wind / 0.8) * 0.5;
                mesh.userData.sac.scale.setScalar(k);
            }
            if (mesh.userData.glow) {
                // Burns while it is winding up and gutters out once the blow has landed.
                mesh.userData.glow.intensity = (e.glow || 0) * 5;
                mesh.position.y = (e.glow || 0) * 0.06 * Math.sin(this.elapsed * 30);
            }
        });

        // --- what the druid planted ---
        // Brambles: a low ring of dark thorns, the radius drawn so you can see where the slow is.
        this._reconcile(this.brambleMeshes, state.brambles || [], b => {
            const g = new THREE.Group();
            const thorns = [];
            // Chunky enough to read as thorns rather than grass at this resolution: the first pass
            // was a scatter of hair-thin sticks that looked like the floor had sprouted.
            const n = 12;
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
                const rr = b.r * (0.3 + Math.random() * 0.65);
                const thorn = box(0.13, 0.46, 0.13, i % 3 === 0 ? 0x6b4a2a : i % 2 ? 0x3d5a2a : 0x2f4520);
                thorn.position.set(Math.sin(a) * rr, 0.22, Math.cos(a) * rr);
                thorn.rotation.set((Math.random() - 0.5) * 0.9, a, (Math.random() - 0.5) * 0.9);
                g.add(thorn);
                thorns.push(thorn);
            }
            g.userData = { thorns };
            return g;
        }, (mesh, b) => {
            mesh.position.set(b.x, 0, b.z);
            // Up out of the ground when planted, back into it as it withers.
            const grow = Math.min(1, (b.life - b.t) / 0.18) * Math.min(1, b.t / 0.4);
            for (const th of mesh.userData.thorns) th.scale.y = Math.max(0.01, grow);
        });

        this._reconcile(this.seedMeshes, state.seeds, () => {
            const g = new THREE.Group();
            const bulb = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), lmat(0x8fbf5a, { emissive: 0x33591c }));
            bulb.position.y = 0.3;
            g.add(bulb);
            // Roots reaching out to the edge of what it drains, so the radius is a thing you can
            // see rather than a number you have to learn.
            const roots = [];
            for (let i = 0; i < 8; i++) {
                const root = box(0.07, 0.07, 1, 0x4f7a46, { transparent: true, opacity: 0.8 });
                root.rotation.y = (i / 8) * Math.PI * 2;
                g.add(root);
                roots.push(root);
            }
            const l = new THREE.PointLight(0x8fbf5a, 1.6, 5, 2);
            l.position.y = 0.5;
            g.add(l);
            g.userData = { bulb, roots, light: l };
            return g;
        }, (mesh, sd) => {
            mesh.position.set(sd.x, 0, sd.z);
            const k = Math.max(0, sd.t / sd.life);
            const pulse = 0.85 + Math.sin(this.elapsed * 6) * 0.15;
            mesh.userData.bulb.scale.setScalar((0.7 + k * 0.5) * pulse);
            mesh.userData.bulb.rotation.y = this.elapsed * 1.4;
            mesh.userData.light.intensity = 1.2 * k * pulse;
            mesh.userData.roots.forEach((root, i) => {
                const reach = sd.radius * (0.55 + Math.sin(this.elapsed * 3 + i) * 0.1);
                root.scale.z = reach;
                root.position.set(Math.sin(root.rotation.y) * reach / 2, 0.05,
                                  Math.cos(root.rotation.y) * reach / 2);
                root.material.opacity = 0.25 + k * 0.4;
            });
        });

        // --- projectiles, blasts, pickups ---
        this._reconcile(this.shotMeshes, state.shots, sh => {
            const g = new THREE.Group();
            if (sh.kind === 'hex') {
                // Something thrown at YOU. Deliberately unlike anything you throw: round, dark
                // red, and lit, so a screen full of your own arrows never hides one of these.
                // Lit from inside rather than by a light of its own: a boss's ring is twelve of
                // these in the air at once, and twelve point lights is a frame you can feel.
                const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.17), lmat(0xff5a3c, { emissive: 0xff5a3c }));
                g.add(orb);
            } else if (sh.kind === 'sure') {
                // Longer, gold, and lit: the arrow the archer stood still for. It should read as
                // different from across the room, because it is about to go through everything.
                const shaft = box(0.06, 0.06, 0.62, 0xf2d27a, { emissive: 0x8a6a1a });
                shaft.rotation.x = Math.PI / 2; g.add(shaft);
                const head = box(0.1, 0.1, 0.14, 0xfff2c0, { emissive: 0xd9a441 });
                head.position.z = 0.36; g.add(head);
            } else if (sh.kind === 'fire') {
                const shaft = box(0.05, 0.05, 0.46, 0x6b4a2a);
                shaft.rotation.x = Math.PI / 2; g.add(shaft);
                const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.14),
                                             lmat(0xffb040, { emissive: 0xff5a10 }));
                flame.position.z = 0.26; g.add(flame);
                g.userData.flame = flame;
            } else if (sh.kind === 'ember') {
                // A coal with a halo. Not the colour of anything you throw, and not the colour of
                // the ordinary hex either: this one sets the floor alight where it comes down.
                const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.15),
                                            lmat(0xffc060, { emissive: 0xff7a1a }));
                const halo = new THREE.Mesh(new THREE.OctahedronGeometry(0.26),
                                            new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true,
                                                                          opacity: 0.4, depthWrite: false }));
                g.add(core, halo);
            } else if (sh.kind === 'rock') {
                // Big and slow and grey. You are meant to see it coming a long way off, and to
                // put a boulder between you and it.
                g.add(box(0.36, 0.3, 0.34, 0x6e675e));
            } else if (sh.kind === 'burst') {
                const seed = cyl(0.1, 0.14, 0.2, 6, 0x8fbf5a, { emissive: 0x3f6a2a }); g.add(seed);
            } else {
                const shaft = box(0.05, 0.05, 0.42, 0xd9c9a4);
                shaft.rotation.x = Math.PI / 2; g.add(shaft);
                const head = box(0.07, 0.07, 0.1, 0xc8cdd4); head.position.z = 0.24; g.add(head);
            }
            return g;
        }, (mesh, sh) => {
            mesh.position.set(sh.x, 0.7, sh.z);
            mesh.rotation.y = Math.atan2(sh.vx, sh.vz);
            if (sh.kind === 'burst' || sh.kind === 'hex' || sh.kind === 'ember') mesh.rotation.x = this.elapsed * 9;
            if (mesh.userData.flame) mesh.userData.flame.scale.setScalar(1 + Math.sin(this.elapsed * 30) * 0.25);
            // A rock tumbles, slowly, which is how it reads as heavy.
            if (sh.kind === 'rock') { mesh.rotation.x = this.elapsed * 3; mesh.position.y = 0.8; }
        });

        this._reconcile(this.blastMeshes, state.blasts, b => {
            const g = new THREE.Group();
            // Yours are green, theirs are red, and a puff where a body fell is smoke. One colour
            // rule across the whole screen: if it is warm, it is not yours and you should not be
            // stood in it.
            const col = b.song ? 0xb48ad9 : b.water ? 0x5fb0e0 : b.puff ? 0x8a8275 : b.hostile ? 0xff5a3c : 0x9fd06a;
            const ring = cyl(b.r, b.r, 0.08, 14, col, { transparent: true, opacity: 0.5 });
            g.add(ring);
            // A puff is smoke and gets no light of its own; a real blast lights the room.
            if (!b.puff) { const l = new THREE.PointLight(col, 2.2, 6, 2); l.position.y = 0.6; g.add(l); }
            g.userData.ring = ring;
            g.userData.light = g.children.find(c => c.isLight) || null;
            return g;
        }, (mesh, b) => {
            const k = Math.min(1, b.t / 0.32);
            mesh.position.set(b.x, 0.12, b.z);
            mesh.scale.setScalar(0.3 + k * 1.1);
            mesh.userData.ring.material.opacity = (b.puff ? 0.32 : 0.55) * (1 - k);
            if (mesh.userData.light) mesh.userData.light.intensity = 2.4 * (1 - k);
        });

        // Crates. Slats and a band, and a hard white blink when hit so you can tell you are
        // damaging it rather than swinging at scenery that does not care.
        this._reconcile(this.crateMeshes, state.crates, () => {
            const g = new THREE.Group();
            const body = box(0.62, 0.55, 0.62, 0x6b4a2a); body.position.y = 0.28;
            const band1 = box(0.66, 0.07, 0.66, 0x4a3524); band1.position.y = 0.16;
            const band2 = box(0.66, 0.07, 0.66, 0x4a3524); band2.position.y = 0.42;
            const lid = box(0.66, 0.06, 0.66, 0x7d5730); lid.position.y = 0.58;
            g.add(body, band1, band2, lid);
            g.userData.parts = [];
            g.traverse(o => { if (o.isMesh) g.userData.parts.push([o.material, o.material.color.getHex()]); });
            return g;
        }, (mesh, c) => {
            mesh.position.set(c.x, 0, c.z);
            const hit = c.flash > 0;
            for (const [mat, hex] of mesh.userData.parts) mat.color.setHex(hit ? 0xffffff : hex);
            // leans a little further the closer it is to bursting
            const hurt = 1 - c.hp / c.maxHp;
            mesh.rotation.z = Math.sin(this.elapsed * 3 + c.id) * 0.03 + hurt * 0.08;
        });

        this._reconcile(this.pickupMeshes, state.pickups, (it) => {
            const g = new THREE.Group();
            if (it.kind === 'coin') {
                // a small stack, so a big purse reads as more than a small one
                const n = Math.min(3, 1 + Math.floor((it.amount || 1) / 6));
                for (let i = 0; i < n; i++) {
                    const c = cyl(0.09, 0.09, 0.03, 8, 0xd9a441, { emissive: 0x6b4a10 });
                    c.position.set((i % 2) * 0.05 - 0.02, 0.02 + i * 0.035, (i % 3) * 0.04 - 0.02);
                    g.add(c);
                }
                // No light of its own. A dozen coins on the sand used to be a dozen point lights,
                // and every one of them costs every lit surface in the room a little more work --
                // which is most of where the stutter in a busy wave was coming from. Emissive is
                // free and, at this pixel size, indistinguishable.
            } else if (it.kind === 'power') {
                // A rune box that throws its own colour around. Power-ups are meant to be seen
                // from the far side of a chamber you are currently losing.
                const def = POWERUPS[it.power] || {};
                const col = def.colour || 0xffffff;
                const shell = box(0.3, 0.3, 0.3, col, { transparent: true, opacity: 0.55, emissive: col });
                const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), lmat(col, { emissive: col }));
                g.add(shell, core);
                const l = new THREE.PointLight(col, 2.4, 5, 2); l.position.y = 0.2; g.add(l);
                g.userData.spin = shell;
            } else if (it.kind === 'prize') {
                const def = PRIZES[it.prize] || {};
                const col = def.colour || 0xd9a441;
                const cup = cyl(0.16, 0.07, 0.2, 8, col); cup.position.y = 0.12;
                const stem = cyl(0.03, 0.09, 0.12, 8, col); stem.position.y = -0.02;
                g.add(cup, stem);
                const l = new THREE.PointLight(col, 3, 6, 2); l.position.y = 0.3; g.add(l);
                g.userData.prize = true;
            } else {
                // A draught. Lit from inside rather than by a light of its own -- see the note on
                // the coin above.
                const glass = cyl(0.09, 0.11, 0.2, 7, 0xb4392f, { emissive: 0x5a1a14 });
                const cork = box(0.07, 0.06, 0.07, 0xd9c9a4); cork.position.y = 0.13;
                g.add(glass, cork);
            }
            return g;
        }, (mesh, it) => {
            const bob = Math.sin(this.elapsed * 3 + it.id) * 0.06;
            // Something thrown in from the stands is still in the air until it lands, and it
            // tumbles on the way down. That fall is the whole difference between a gift and a
            // drop: one of them came from somebody.
            const fall = it.drop || 0;
            mesh.position.set(it.x, (it.kind === 'coin' ? 0.12 : 0.35) + bob + fall, it.z);
            if (fall > 0) mesh.rotation.z = fall * 2.2;
            mesh.rotation.y = this.elapsed * (it.kind === 'prize' ? 2.6 : 1.6);
            if (mesh.userData.spin) mesh.userData.spin.rotation.set(this.elapsed * 1.6, 0, this.elapsed * 1.1);
            // Only the fabled ones tumble; the rest turn on the spot, so a rare find is calm and
            // an extremely rare one is not.
            if (mesh.userData.fabled) mesh.userData.gem.rotation.x = this.elapsed * 1.7;
        });
    }

    // Same mesh-pooling shape as the lab game: create on first sight, update every frame after,
    // drop when the thing stops existing. Keyed by id so nothing is rebuilt per frame.
    _reconcile(map, list, create, update) {
        const seen = new Set();
        for (const item of list || []) {
            seen.add(item.id);
            let mesh = map.get(item.id);
            if (!mesh) { mesh = create(item); this.scene.add(mesh); map.set(item.id, mesh); }
            update(mesh, item);
        }
        for (const [id, mesh] of map) if (!seen.has(id)) { this.scene.remove(mesh); map.delete(id); }
    }

    // Everything the simulation needs from the mouse: where on the floor the cursor is pointing.
    // Unprojected onto the y=0 plane, since an isometric camera has no useful notion of depth.
    _bindEvents() {
        const el = this.renderer.domElement;
        el.addEventListener('pointermove', (e) => {
            const r = el.getBoundingClientRect();
            this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
            this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
        });
    }
    aimPoint() {
        const ray = new THREE.Raycaster();
        ray.setFromCamera(this.pointer, this.camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5);
        const hit = new THREE.Vector3();
        if (ray.ray.intersectPlane(plane, hit)) { this.aim.x = hit.x; this.aim.z = hit.z; }
        return this.aim;
    }
    // Screen position of a world point, for the damage numbers and the labels over the gates.
    //
    // The canvas rectangle is cached rather than measured. getBoundingClientRect() forces the
    // browser to flush layout, and this is called several times a frame from the HUD -- so the
    // honest version of this function was quietly making the game stutter in exactly the rooms
    // where the most was going on.
    project(x, z, y = 1) {
        const v = this._v3.set(x, y, z).project(this.camera);
        const r = this._rect || (this._rect = this.renderer.domElement.getBoundingClientRect());
        return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
    }

    _resize() {
        this._rect = null;              // measured again next time somebody asks
        this._w = this.container.clientWidth || window.innerWidth;
        this._h = this.container.clientHeight || window.innerHeight;
        this.renderer.setSize(this._w * RES_SCALE, this._h * RES_SCALE, false);
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        if (this.camera) {
            const aspect = this._w / this._h;
            this.camera.left = -this.frustum * aspect;
            this.camera.right = this.frustum * aspect;
            this.camera.top = this.frustum;
            this.camera.bottom = -this.frustum;
            this.camera.updateProjectionMatrix();
        }
    }

    _animate() {
        requestAnimationFrame(() => this._animate());
        const dt = Math.min(this.clock.getDelta(), 0.1);
        this.elapsed += dt;
        if (this.onFrame) this.onFrame(dt);
        this.renderer.render(this.scene, this.camera);
    }
}
