// ==================== EVERY TUNABLE NUMBER ====================
// No logic lives here, only definitions, so the whole feel of the game can be retuned without
// reading a line of the simulation.
//
// The premise, because half these names only make sense with it: the Deepdelve is a pit under the
// city where the condemned are sent to fight instead of hang. Win enough rooms and they open the
// last gate and let you walk. Nobody has, but the crowd keeps paying to watch somebody try.

// ---------- the four ----------
// Each class is defined by the SHAPE of its attack rather than by a damage number, because that
// is what actually makes them play differently. Three shapes:
//
//   arc        a swing in front of you, hitting everything inside a cone. Instant, no travel.
//   bolt       a projectile that flies until it hits something.
//   burst      a projectile that explodes where it lands, damaging an area.
//
// Knight and Bard both swing, but the Knight's cone is narrow, short and heavy while the Bard's is
// wide, long and light: the same verb producing a completely different fight.
export const CLASSES = {
    knight: {
        name: 'Knight', role: 'Stand and fight',
        colour: 0x9aa4b0, accent: 0xb4392f,
        hp: 130, speed: 4.2,
        // The sword alternates: a wide slash, then a thrust that reaches further and hits harder
        // through a much narrower line. It gives the basic attack a rhythm -- the swing that
        // clears the three around you and the one that reaches the slinger behind them are the
        // same button, half a second apart -- and it is readable because it strictly alternates.
        attack: { kind: 'arc', damage: 16, range: 1.9, arc: 100, cooldown: 0.46, knock: 3.4,
                  alt: { slash: { arc: 1.3, range: 0.95, damage: 1, knock: 1 },
                         stab:  { arc: 0.42, range: 1.45, damage: 1.25, knock: 1.4 } } },
        // The dash is a shoulder: whatever it goes through is knocked aside and hurt for it. The
        // knight is the one class whose way out of a crowd is through the middle of it.
        dash: { distance: 2.6, cooldown: 2.4, invuln: 0.22, trait: 'barge', barge: 9, bargeKnock: 6 },
        blurb: 'Heavy, slow, and the only one who can afford to be wrong about where the enemy is.',
        // How they fight, in the three lines the character screen has room for. Written for
        // somebody who has never played: what the button does, not what the numbers are.
        kit: { attack: 'Slash, then thrust, strictly in turn. The slash is wide; the thrust reaches.',
               dash: 'Barge: shoulder through them, and hurt what you hit.' }
    },
    archer: {
        name: 'Archer', role: 'Kill it before it arrives',
        colour: 0x6d8f53, accent: 0xd9a441,
        hp: 78, speed: 5.0,
        // Plant your feet. Every arrow loosed without moving steadies the next, and the third is
        // a Sure Shot: harder, faster, and through everything in the line. Moving loses it --
        // which is the archer's whole question, asked every second: stand and shoot, or run.
        attack: { kind: 'bolt', damage: 11, range: 11, cooldown: 0.34, speed: 17, pierce: 0,
                  steady: 3, sure: { damage: 1.8, speed: 1.35 } },
        // And the other way to a Sure Shot: the first arrow after a dash is one. Get out of
        // trouble, turn, and answer it.
        dash: { distance: 3.4, cooldown: 1.7, invuln: 0.26, trait: 'quickdraw' },
        blurb: 'Fast and fragile. Every hit you take is one you should have walked away from.',
        kit: { attack: 'Stand still and every third arrow is a Sure Shot: through everything in the line.',
               dash: 'Quick draw: the first arrow after a dash is a Sure Shot.' }
    },
    druid: {
        name: 'Druid', role: 'Hit the whole room',
        colour: 0x4f7a46, accent: 0x8fbf5a,
        hp: 96, speed: 4.4,
        // Every seed that bursts leaves brambles where it went off, for a moment: whatever walks
        // through them is held back. The druid does not so much fight a wave as garden it.
        attack: { kind: 'burst', damage: 13, range: 8.5, cooldown: 0.72, speed: 10, blast: 2.0,
                  bramble: { time: 2.2, radius: 1.5 } },
        // The dash leaves a patch of them where you stood, so whatever was chasing you walks
        // into it.
        dash: { distance: 2.8, cooldown: 2.0, invuln: 0.24, trait: 'thorns' },
        // Standing in water mends a druid, a little and steadily. It makes the Cistern the one
        // place the druid wants to be, and it is what Wellspring is for.
        waterMend: 5,
        blurb: 'Throws seed and rot. Worth the slow hands the moment three things come at once.',
        kit: { attack: 'Seeds burst where they land, and leave brambles that hold them back.',
               dash: 'Thorns: brambles spring up where you were standing.',
               passive: 'Mends while standing in water.' }
    },
    bard: {
        name: 'Bard', role: 'Keep them off you',
        colour: 0x7a5aa8, accent: 0xd9a441,
        hp: 100, speed: 4.7,
        // A bar of four. Three strums and then the Chord: all the way round, further out, and
        // it throws them. Strictly every fourth, so it is a count you can play to rather than a
        // chance -- "strum, strum, strum, NOW" is the bard's version of the knight's alternation.
        attack: { kind: 'arc', damage: 8, range: 2.9, arc: 190, cooldown: 0.3, knock: 6.5, slow: 0.45,
                  chord: { every: 4, arc: 360, range: 1.3, damage: 1.7, knock: 1.8 } },
        // A flourish: the dash lands you on the last beat of the bar, so the next swing is the
        // Chord. Dash into the middle of them and play it.
        dash: { distance: 3.0, cooldown: 1.9, invuln: 0.26, trait: 'flourish' },
        blurb: 'A wide, shoving noise. Little damage, but nothing gets to stand next to you.',
        kit: { attack: 'A bar of four: three strums, then a Chord all the way round that throws them.',
               dash: 'Flourish: the next swing is the Chord.' }
    }
};

// ---------- how you look ----------
// Appearance is pure decoration and deliberately separate from the calling: your helm says what
// you are, everything else says who. Kept as indexes into these lists (or as the small named
// strings below) rather than as raw colours, so a character made today is still valid if the
// palettes are ever retuned.
//
// None of it touches a number the simulation reads -- a broad build is not a bigger hitbox, and
// the body's collision radius is the same for everybody. That is deliberate: the moment a face
// costs you health, choosing one stops being free.
export const SKIN_TONES = [0xf6d6bb, 0xf0c9a4, 0xd9a878, 0xc28a5b, 0xb07b4f, 0x8a5a38, 0x6d4529, 0x4f3220];
export const HAIR_COLOURS = [0x2b211a, 0x120f0c, 0x5a3a22, 0x8a6a3a, 0xd9c08a, 0xefe3c4,
                             0xb4392f, 0xa0522d, 0xcfc6b0, 0x8e97a6, 0x4a7fa8, 0x7a5aa8];
export const HAIR_STYLES = ['crop', 'long', 'topknot', 'braids', 'mohawk', 'bald'];
// Worn on the face, coloured from the hair list so a beard always belongs to the head above it.
export const BEARD_STYLES = ['none', 'stubble', 'goatee', 'full'];
export const EYE_COLOURS = [0x2e2118, 0x6b4a2a, 0x4a7fa8, 0x4f7a46, 0x8a8f96, 0xb4392f, 0xd9a441];
export const GARB_COLOURS = [0x9aa4b0, 0x6d8f53, 0x7a5aa8, 0x8a6a3a, 0x4a7fa8, 0xb4392f, 0x3a4046,
                             0xcfc6b0, 0x2f5d4f, 0x8a3a5a, 0x6b6156, 0x1f2430];
// The second colour: belt, shoulders, cloak. Kept as its own list so the pairing is yours rather
// than a lighter shade of whatever you already picked.
export const TRIM_COLOURS = [0x3a332c, 0xd9a441, 0xb4392f, 0xcfc6b0, 0x4a7fa8, 0x5c8f3a,
                             0x8a6a3a, 0x7a5aa8, 0x1f1c19];
// Bulk. Three silhouettes rather than a slider, because at this pixel size anything finer than
// "narrow, ordinary, wide" is invisible by the time it reaches the screen.
export const BUILDS = ['slight', 'average', 'broad'];
export const CLOAKS = ['none', 'half', 'full'];
// A face marking. The colour comes from the mark, not from a palette: warpaint is warpaint.
export const MARKS = ['none', 'warpaint', 'ash', 'scar', 'brand'];
export const MARK_COLOUR = { warpaint: 0xb4392f, ash: 0x4a4a4a, scar: 0xe8c0a8, brand: 0xd9a441 };

// What somebody looks like if nobody said. Every field the model reads appears here, so a look
// saved before a field existed still builds.
export const DEFAULT_LOOK = {
    skin: 1, hair: 0, style: 'crop', beard: 'none', eyes: 0,
    garb: 0, trim: 0, build: 'average', cloak: 'none', mark: 'none'
};

// ---------- what a purse buys ----------
// There is no skill tree any more. What you spend on between fights is a short list of plain
// numbers, each of which can be bought five times and costs more every time -- so by the sixth
// room you are choosing between being harder to kill and killing faster, rather than reading a
// page of nodes. It is an arcade cabinet's idea of character building, and it suits a game whose
// unit is a room rather than a dungeon.
export const UPGRADES = {
    vigour: { name: 'Vigour',    desc: '+25 maximum health', effect: { hp: 25 },          base: 110, step: 1.45 },
    edge:   { name: 'Edge',      desc: '+12% damage',        effect: { damage: 0.12 },    base: 130, step: 1.5 },
    fleet:  { name: 'Fleet',     desc: '+8% movement',       effect: { speed: 0.08 },     base: 120, step: 1.5 },
    hands:  { name: 'Quick Hands', desc: '8% faster attacks', effect: { cooldown: -0.08 }, base: 140, step: 1.5 },
    scars:  { name: 'Scars',     desc: '-6% damage taken',   effect: { taken: -0.06 },    base: 150, step: 1.55 }
};
export const UPGRADE_MAX = 5;

// ---------- what lives down there ----------
// `from` is the first room a kind can appear in, so the bestiary widens as you go down rather
// than all arriving at once.
// `ai` is the whole of what makes a wave interesting, and it is the thing this table was missing
// for a long time: four enemies that all walked at you and swung is one enemy wearing four coats.
// Each behaviour asks a different question of where you are standing --
//
//   chase    walks at you and swings. The baseline, and what a crowd of them is for.
//   charger  stops, winds up, and rushes in a straight line. Punishes standing still and is
//            answered by stepping aside, which is a different skill from backing away.
//   shooter  keeps its distance and throws. Punishes camping a corner, and cannot be ignored
//            while you deal with the melee -- which is exactly why it exists.
//   bloat    walks at you slowly and bursts, whether it reaches you or you kill it. Punishes
//            fighting in a huddle and makes "kill the nearest thing" occasionally wrong.
export const ENEMIES = {
    rat: {
        name: 'Rot Rat', ai: 'chase', colour: 0x6b5a4a, size: 0.42,
        hp: 16, speed: 3.9, damage: 5, cooldown: 0.9, reach: 0.85, xp: 4, from: 1
    },
    skeleton: {
        name: 'Skeleton', ai: 'chase', colour: 0xcfc6b0, size: 0.58,
        hp: 34, speed: 3.0, damage: 9, cooldown: 1.1, reach: 1.0, xp: 9, from: 1
    },
    shade: {
        name: 'Shade', ai: 'chase', colour: 0x584a6b, size: 0.52,
        hp: 26, speed: 4.7, damage: 7, cooldown: 0.8, reach: 0.9, xp: 12, from: 2
    },
    hound: {
        name: 'Pit Hound', ai: 'charger', colour: 0x7a5a3a, size: 0.5,
        hp: 26, speed: 3.4, damage: 8, cooldown: 2.6, reach: 0.9, xp: 14, from: 2,
        // Winds up close and covers the gap fast. Short fuse, so it is a threat you answer in
        // the moment rather than one you plan around.
        lock: 6.5, wind: 0.45, rush: 12, rushTime: 0.45, rushHit: 13
    },
    slinger: {
        name: 'Slinger', ai: 'shooter', colour: 0x4a6b5a, size: 0.54,
        hp: 24, speed: 2.9, damage: 8, cooldown: 1.9, reach: 1.0, xp: 16, from: 2,
        // Holds this far out and backs off if you close. What it throws is slow enough to walk
        // around and fast enough to punish standing still.
        keep: 6.5, range: 11, wind: 0.5, shot: 7.5, shotDamage: 9
    },
    brute: {
        name: 'Brute', ai: 'charger', colour: 0x7a4a3a, size: 0.82,
        hp: 84, speed: 2.2, damage: 17, cooldown: 4.5, reach: 1.3, xp: 26, from: 3,
        lock: 8, wind: 0.8, rush: 10, rushTime: 0.85, rushHit: 26
    },
    bloat: {
        name: 'Bloat', ai: 'bloat', colour: 0x6b7a3a, size: 0.66,
        hp: 30, speed: 2.1, damage: 0, cooldown: 99, reach: 1.2, xp: 18, from: 4,
        // The fuse is lit when it gets close to you OR when it dies, and it does not care which.
        wind: 0.8, blast: 2.7, blastDamage: 24
    },

    // ---- the ones that belong somewhere ----
    // One to each place, built from the same four behaviours as everything above plus a single
    // twist that only matters where it lives. They are what make a biome a place rather than a
    // paint job: each one is ordinary on the Sands and dangerous at home.
    //
    // `wades` - water does not slow it; it goes faster in it, and sinks to the shoulders.
    // `ignites` - what it throws sets the floor alight where it lands.
    // `sure` - ice and snow mean nothing to its feet, and its bite leaves you chilled.
    // `heavy` - it throws rock: slow, hard-hitting, knocks you back, and stopped by cover.
    //
    // Each is coloured against its OWN floor, not against the Sands: a white wolf was the right
    // idea for an icehouse and invisible in one. A creature at home has to be the thing in the
    // room that does not match it -- slate on snow, pale on dark water, ochre on grey stone.
    drowned: {
        name: 'Drowned', ai: 'chase', colour: 0x8aa882, size: 0.6,
        hp: 46, speed: 2.5, damage: 11, cooldown: 1.2, reach: 1.0, xp: 18, from: 3,
        wades: true, waterSpeed: 1.45
    },
    imp: {
        name: 'Pitch Imp', ai: 'shooter', colour: 0x8a3a24, size: 0.44,
        hp: 22, speed: 3.6, damage: 6, cooldown: 2.4, reach: 0.9, xp: 18, from: 3,
        keep: 7, range: 11, wind: 0.6, shot: 8, shotDamage: 7, ignites: true,
        // Born in the stuff. Its own fires do not take it, which is what makes lighting the
        // Pitch a decision: it burns everything in the room except the thing that lit it.
        fireproof: true
    },
    wolf: {
        name: 'Frost Wolf', ai: 'charger', colour: 0x566b7c, size: 0.52,
        hp: 32, speed: 3.8, damage: 9, cooldown: 2.4, reach: 0.9, xp: 18, from: 3,
        lock: 7, wind: 0.5, rush: 13, rushTime: 0.5, rushHit: 12,
        sure: true, chill: 1.8
    },
    thrower: {
        name: 'Stonethrower', ai: 'shooter', colour: 0x8a5a3a, size: 0.7,
        hp: 58, speed: 2.1, damage: 12, cooldown: 3.2, reach: 1.1, xp: 22, from: 3,
        keep: 7.5, range: 12, wind: 0.9, shot: 5.5, shotDamage: 20, heavy: true
    }
};

// ---------- what a wave is made of ----------
// A wave used to be N bodies rolled independently from the bestiary, which made every wave the
// same soup at different strengths. A wave with a SHAPE is a wave you can recognise and answer:
// a rush wants you moving, a firing line wants you closing, an escort wants you picking a target.
// The shape is chosen first and the bodies are drawn from it, so a room has a rhythm.
export const WAVE_SHAPES = {
    rush:   { gates: 1, size: 1.5, kinds: { rat: 8, hound: 3 },
              say: 'They open one gate and a lot comes through it' },
    line:   { gates: 2, size: 0.85, kinds: { skeleton: 6, slinger: 4 },
              say: 'Slingers. Do not stand still' },
    mixed:  { gates: 2, size: 1, kinds: { rat: 4, skeleton: 4, shade: 3, slinger: 2, hound: 2, bloat: 1 } },
    escort: { gates: 2, size: 0.8, kinds: { brute: 3, bloat: 3, skeleton: 3, slinger: 2 },
              say: 'Something heavy is coming' },
    swarm:  { gates: 3, size: 1.8, kinds: { rat: 10, shade: 4 },
              say: 'Every gate at once' }
};
// Which shapes can turn up, by how deep the room is. The first wave of a floor is always a rush,
// so a room opens by telling you plainly what it is.
export const SHAPE_ORDER = [
    { from: 1, shapes: ['rush', 'mixed'] },
    { from: 2, shapes: ['rush', 'mixed', 'line'] },
    { from: 4, shapes: ['mixed', 'line', 'escort', 'swarm'] },
    { from: 7, shapes: ['line', 'escort', 'swarm', 'mixed'] }
];

// ---------- the ones with a crown ----------
// Occasionally a body comes through with more of everything. Worth killing first, worth more
// score, and worth getting out of the way of -- which is three decisions a plain wave does not
// contain.
export const ELITE = {
    from: 3,                   // the first room one can appear in
    // Per body, and it climbs slowly. The first pass compounded to nearly a third of every wave
    // by room six, at which point a crown means "most of them" and stops meaning anything.
    chance: 0.06,
    perRoom: 0.012,
    max: 0.22,
    hp: 2.4, damage: 1.35, size: 1.18, speed: 1.08, xp: 3, score: 3
};

// Every floor deeper makes everything down there tougher. Applied as a multiplier so the numbers
// above stay readable as "what a Skeleton is", not "what a Skeleton is on floor one".
export const DEPTH_HP = 0.22;        // +22% enemy health per floor below the first
export const DEPTH_DAMAGE = 0.16;

// What a body leaves. Coin mostly, sometimes something to drink, and now and then one of the
// coloured stones the crowd throws in -- which is the only kind of gear left in the game and
// lasts about fifteen seconds.
export const DROP_COIN = [2, 6];
export const DROP_POTION = 0.14;
export const DROP_POWER = 0.05;

// Crates are worth a swing: a purse, usually a drink, and now and then a stone.
export const CRATE_COIN = [10, 24];
export const CRATE_HP = 20;
export const CRATES_PER_FLOOR = [2, 4];

// ---------- special moves ----------
// Four slots on the number keys, filled from a pool of six per calling: what you can do is a
// choice made twice over -- which moves you learn, and which of them you keep to hand.
//
// `kind` is the verb, implemented once in systems/abilities.js. Everything else is a number, so
// a new move is a line here unless it needs a verb that does not exist yet.
//
//   cone    a heavy swing in front of you
//   nova    the same, all the way round
//   volley  one or more projectiles, fanned
//   lob     a single projectile that bursts where it lands
//   charge  a long committed rush that cuts what it passes
//   snare   holds everything nearby in place, without much hurting it
//   buff    changes your numbers for a while
//   heal    gives health back, sometimes over time
export const ABILITIES = {
    knight: [
        { anim: 'bash', id: 'bash',   name: 'Shield Bash', kind: 'cone',  cool: 6,  req: 1,
          damage: 18, arc: 120, reach: 2.4, knock: 9,
          desc: 'A shove that hits like a swing. Buys you the step back' },
        { anim: 'spin', id: 'whirl',  name: 'Whirlwind',   kind: 'nova',  cool: 8,  req: 1,
          damage: 20, radius: 2.6, knock: 4,
          desc: 'Everything within arm\'s reach, all at once' },
        { id: 'rally',  name: 'Rally',       kind: 'heal',  cool: 18, req: 1,
          heal: 0.3, buff: { guard: 0.3 }, time: 8,
          desc: 'Mend a third of your health and harden for eight seconds' },
        { anim: 'stab', id: 'charge', name: 'Charge',      kind: 'charge', cool: 9, req: 4,
          distance: 5.5, damage: 26, knock: 6,
          desc: 'Run somebody down, and whatever is stood behind them' },
        { anim: 'slam', id: 'quake',  name: 'Ground Slam', kind: 'nova',  cool: 12, req: 4,
          damage: 14, radius: 3.8, knock: 13, slow: 1.2,
          desc: 'Throws the whole room off its feet' },
        { anim: 'guard', id: 'riposte', name: 'Riposte', kind: 'parry', cool: 9, req: 6,
          time: 1.1, damage: 34, knock: 10, stun: 1.4,
          desc: 'Shield up. The next blow is turned aside and paid back hard -- and a thrown thing goes back where it came from' }
    ],
    archer: [
        { id: 'volley', name: 'Volley',      kind: 'volley', cool: 7, req: 1,
          shots: 5, spread: 0.22, damage: 9,
          desc: 'Five arrows in a fan. Crowds do not like it' },
        { id: 'pin',    name: 'Pinning Shot', kind: 'volley', cool: 8, req: 1,
          shots: 1, damage: 24, slow: 1.6, pierce: 2,
          desc: 'One heavy arrow that goes through and holds what it hits' },
        { id: 'kick',   name: 'Kickback',    kind: 'charge', cool: 6, req: 1,
          distance: 4.5, damage: 8, knock: 3, away: true,
          desc: 'Throw yourself backwards out of whatever just arrived' },
        { id: 'rain',   name: 'Arrow Rain',  kind: 'lob',   cool: 11, req: 4,
          damage: 16, blast: 2.8, speed: 13, range: 10,
          desc: 'Comes down where you pointed, on everything stood there' },
        { id: 'fire',   name: 'Fire Arrow',  kind: 'volley', cool: 9, req: 4,
          shots: 1, damage: 18, pierce: 3, speed: 18, range: 12, bolt: 'fire', ignites: true,
          desc: 'An arrow alight. It sets fire to what it goes through, and to any oil it crosses' },
        { id: 'hail',   name: 'Hail of Bodkins', kind: 'volley', cool: 18, req: 6,
          shots: 9, spread: 0.5, damage: 8, pierce: 2,
          desc: 'Nine arrows, wide, and they do not stop at the first body' }
    ],
    druid: [
        { id: 'thicket', name: 'Thicket',    kind: 'snare', cool: 9,  req: 1,
          radius: 3.4, slow: 2.4, damage: 8,
          desc: 'Roots burst up and hold everything near you' },
        { id: 'swarm',  name: 'Seed Swarm',  kind: 'volley', cool: 10, req: 1,
          shots: 3, spread: 0.3, damage: 11, blast: 1.6, bolt: 'burst', speed: 10,
          desc: 'Three seeds, and each one bursts' },
        { id: 'seed',   name: 'Absorbing Seed', kind: 'seed', cool: 14, req: 1,
          radius: 3.2, time: 7, dps: 9, leech: 0.55,
          desc: 'Plant it. What stands near it withers, and you mend for what it takes' },
        { id: 'bloom',  name: 'Bloomburst',  kind: 'lob',   cool: 12, req: 4,
          damage: 30, blast: 3.6, speed: 9, range: 9,
          desc: 'One heavy seed. The whole room hears it open' },
        { id: 'spring', name: 'Wellspring',  kind: 'spring', cool: 16, req: 4,
          radius: 2.4, range: 7,
          desc: 'A pool rises where you point. It drowns fires, bogs down whatever wades in, and mends you while you stand in it' },
        { id: 'grove',  name: 'Waking Grove', kind: 'nova', cool: 20, req: 6,
          damage: 22, radius: 4.4, slow: 1.6, knock: 3,
          desc: 'The floor itself turns on them' }
    ],
    bard: [
        { id: 'shout',  name: 'Shout',       kind: 'nova',  cool: 6,  req: 1,
          damage: 10, radius: 3.2, knock: 13,
          desc: 'Clears the ring around you. Little damage, lots of distance' },
        { id: 'riff',   name: 'Riff',        kind: 'cone',  cool: 5,  req: 1,
          damage: 14, arc: 200, reach: 3.6, knock: 4, slow: 0.8,
          desc: 'A wide, ugly chord that staggers what it touches' },
        { id: 'anthem', name: 'Mending Song', kind: 'heal',  cool: 17, req: 1,
          heal: 0.12, buff: { regen: 9 }, time: 7,
          desc: 'Sing yourself back together: a little now and a great deal over seven seconds' },
        { id: 'dirge',  name: 'Dirge',       kind: 'snare', cool: 12, req: 4,
          radius: 5, slow: 2, damage: 6,
          desc: 'Everything in earshot slows to a crawl' },
        { id: 'lullaby', name: 'Lullaby',   kind: 'sleep', cool: 15, req: 4,
          radius: 4.6, time: 4.5,
          desc: 'Everything in earshot lies down. Hitting one wakes it, and wakes it hard' },
        { id: 'discord', name: 'Discord',    kind: 'charm', cool: 20, req: 6,
          radius: 4.6, time: 5,
          desc: 'A tune nobody can agree on. Everything in earshot turns on whatever is next to it' }
    ]
};
// One move to open with, then another at each of these levels. Four slots and six moves per
// calling, so a fully grown character still had to leave two behind.
// A sleeping body takes this much more from the blow that wakes it. Sleep is not a way to skip a
// fight -- it is a way to choose which fight you are having, and then to be paid for choosing.
// ---------- where the room is ----------
// Every arena is one of these, chosen when the floor is generated. A biome decides three things
// at once -- what the stone looks like, what got spilled on it, and what comes through the gates
// -- and it is one table rather than three because those three are the same decision. A room of
// ice full of things that only ever appear on ice is a place; the same room with the general
// bestiary walking into it is a reskin.
//
// `pools`, `slicks`, `drifts` and `sheets` are the chance this room has any water, oil, snow or
// ice at all. Nothing is guaranteed except where a biome is named for it: the Cistern always has
// its water and the Pitch always has its oil, because a room that promises a hazard and then has
// none is worse than a plain room.
//
// `air` is the room's light and `motes` is what hangs in it -- dust on the Sands, drips in the
// Cistern, embers over the Pitch, snow in the Icehouse, grit in the Quarry. Negative `rise` falls.
// They are the cheapest thing on this list and they do the most to make a place feel like one.
//
// `kinds` multiplies into whatever the wave's shape asked for, so a rush is still a rush -- it is
// a rush of the things that live here. Where a shape and a biome have nothing in common, the
// biome wins: the place you are in is the stronger fact.
export const BIOMES = {
    sands: {
        name: 'The Sands', say: 'Sand, and whatever the last lot left behind',
        floor: [0x6b6154, 0x615749], wall: 0xb0a596, rubble: 0x5a5145, fog: 0x0a0c10,
        pools: 0.4, slicks: 0.5, drifts: 0, sheets: 0, rocks: [0, 2],
        air: { ambient: 0x9aa6bd, strength: 1.1, sky: 0xa8b6d0 },
        motes: { colour: 0xe8c898, size: 0.035, opacity: 0.18, rise: 0.1, sway: 0.05, count: 110 },
        kinds: { rat: 6, skeleton: 5, shade: 2, hound: 3, slinger: 2, brute: 1, bloat: 1 }
    },
    cistern: {
        name: 'The Cistern', say: 'Knee deep, and something moving in it',
        floor: [0x4f5a5e, 0x475154], wall: 0x8c9a9e, rubble: 0x49534f, fog: 0x080d10,
        pools: 1, slicks: 0.12, drifts: 0, sheets: 0, rocks: [0, 1],
        poolCount: [2, 4], poolSize: [3.0, 5.2],
        air: { ambient: 0x7fa2b4, strength: 1.05, sky: 0x94c0d2 },
        motes: { colour: 0xa8d4e0, size: 0.03, opacity: 0.35, rise: -1.1, sway: 0, count: 90 },
        kinds: { drowned: 7, shade: 6, rat: 4, slinger: 4, skeleton: 2, bloat: 2 }
    },
    pitch: {
        name: 'The Pitch', say: 'It has been waiting a long time for a spark',
        floor: [0x4a423a, 0x413a33], wall: 0x8a7f70, rubble: 0x463d34, fog: 0x0b0806,
        pools: 0.15, slicks: 1, drifts: 0, sheets: 0, rocks: [0, 2],
        slickCount: [2, 4], slickLength: [10, 19],
        air: { ambient: 0xb88a6a, strength: 1.0, sky: 0xd09a6a },
        motes: { colour: 0xff8a3a, size: 0.055, opacity: 0.7, rise: 0.5, sway: 0.35, count: 80 },
        kinds: { imp: 6, bloat: 5, skeleton: 4, hound: 4, brute: 2, rat: 2 }
    },
    icehouse: {
        name: 'The Icehouse', say: 'Cold enough that the floor will not hold you',
        floor: [0x8a9aa8, 0x7e8e9c], wall: 0xc2d2dd, rubble: 0x6f7d88, fog: 0x0c1116,
        pools: 0.2, slicks: 0, drifts: 1, sheets: 1, rocks: [1, 3],
        air: { ambient: 0xb8cce0, strength: 1.25, sky: 0xd6e6f4 },
        motes: { colour: 0xf4f8fc, size: 0.06, opacity: 0.65, rise: -0.55, sway: 0.4, count: 230 },
        kinds: { wolf: 7, hound: 5, shade: 5, brute: 3, skeleton: 3, slinger: 1 }
    },
    quarry: {
        name: 'The Quarry', say: 'Half a room, and half of it fallen in',
        floor: [0x635c55, 0x59534c], wall: 0x9e968a, rubble: 0x565049, fog: 0x0a0a0b,
        pools: 0.35, slicks: 0.3, drifts: 0, sheets: 0, rocks: [6, 11],
        air: { ambient: 0xaaa296, strength: 1.1, sky: 0xbcb2a4 },
        motes: { colour: 0xbcae9c, size: 0.045, opacity: 0.28, rise: 0.03, sway: 0.25, count: 150 },
        kinds: { thrower: 5, brute: 5, skeleton: 4, slinger: 4, rat: 3, hound: 2 }
    }
};
// The order rooms are drawn from. The first two rooms of a run are always the Sands, because the
// first thing a floor has to teach is the plain version of itself.
export const BIOME_ORDER = ['sands', 'cistern', 'pitch', 'quarry', 'icehouse'];
export const BIOME_FROM = 3;          // the first room that can be anywhere but the Sands

export const WAKE_DAMAGE = 2.2;

export const ABILITY_START = 1;
export const ABILITY_LEVELS = [2, 4, 6, 8];
export const ABILITY_SLOTS = 4;

// ---------- what the floor is made of ----------
// A second layer over the tiles, separate from what is solid. A tile can be walkable and also be
// ankle-deep water, or a slick of lamp oil somebody did not clean up.
//
// The point of both is that they make WHERE YOU STAND a decision, which in a game played in one
// room is the only decision there is. Water is a place you are slower in, so it is a place you do
// not want to be caught. Oil is nothing at all until something sets it off, and then it is a wall
// of fire that does not care whose side anybody is on.
export const SURFACE = { sand: 0, water: 1, oil: 2, fire: 3, ash: 4, ice: 5, snow: 6 };
export const TERRAIN = {
    water: 0.5,                // rooms with a pool in them
    oil: 0.45,                 // rooms with oil spilled across them
    waterSlow: 0.58,           // how much of your speed you keep in it
    snowSlow: 0.78,            // and in a drift, which is a nuisance rather than a trap
    iceGrip: 2.2,              // how fast your feet catch up with where you asked to go, on ice
    iceSpeed: 1.12,            // and ice is a shade faster than sand once you are moving
    iceSkid: 0.45,             // a charge on ice runs out of legs this much slower: it skids
    chillSlow: 0.62,           // what a frost wolf's bite leaves of your speed, while it lasts
    fireDamage: 20,            // a second, to anything alight
    burnTime: 1.2,             // how long the flames cling after you are out of them
    burnBite: 0.3,             // burn damage lands in bites this far apart, not per frame
    fireTime: 4.5,             // how long a lit tile burns
    spread: 0.16,              // seconds for fire to take the next tile along
    pools: [1, 2],             // how many pools of water
    poolSize: [2.2, 3.6],
    slicks: [1, 3],            // how many trails of oil
    slickLength: [7, 15]
};

// ---------- what kind of floor this is ----------
// Every floor is one big room. You walk in, the gates come down, waves arrive through them, and
// when the last one falls the gates at the far end go up and you choose which to leave by. That
// is the whole loop, lifted openly from Smash TV, whose best idea is that the room IS the level:
// no corridors to wander, nothing off screen, every decision made in full view.
//
//   arena   waves, then a choice of doors
//   boss    one enormous thing, and the doors open when it stops moving
//   shop    no waves at all. Somebody down here is still trading.
//
// Three fights, a boss, and a shop -- which puts a shop every fifth room, and always right after
// the boss that paid for it.
export const STAGE_CYCLE = ['arena', 'arena', 'arena', 'boss', 'shop'];
// Which way is up the screen, on the floor. The camera sits off the +x,+z corner looking back at
// you, so W walks toward -x,-z. Checked by projecting both vectors through a real three.js camera
// set up exactly as the renderer's -- a sign error here is a game where D walks you left.
export const VIEW = { up: { x: -Math.SQRT1_2, z: -Math.SQRT1_2 }, right: { x: Math.SQRT1_2, z: -Math.SQRT1_2 } };

export const STAGE_NAME = { arena: 'Arena', boss: 'Lair', shop: 'The Market' };

// The room itself, and the gated alcoves cut into its walls. One shape, three dressings.
export const ARENA = {
    w: 25, h: 19,              // the arena, in tiles
    bossW: 23, bossH: 19,
    shopW: 19, shopH: 15,
    mouth: 3,                  // how wide a gateway is
    depth: 4,                  // how far the passage behind a gate runs
    spawnDepth: 2,             // how far down it bodies wait, so a wave does not have to commute
    waves: [3, 4],             // waves on floor one
    perWave: [4, 6],           // bodies per wave on floor one
    waveGrowth: 0.55,          // more of them per floor
    grace: 2.2,                // seconds after arriving before the first gate opens
    gap: 0.4,                  // between one body coming through a gate and the next
    linger: 0.8,               // how long a gate stays open after the last one is through
    prizeChance: 0.6,
    exits: [2, 3]              // how many ways on open when the room is finally quiet
};

// ---------- which door ----------
// Nothing. A way out is a way out.
//
// There was a system here: each gate carried a mark -- Riches, Peril, Quiet -- promising what the
// next room would be, and taking that door made it so. It read well written down and it was a lie
// in play, because the prisoner has never been through any of these doors and has no way of
// knowing what is behind one. A choice you make with information the character could not possibly
// have is a menu, not a decision. So the gates are identical, and which one you take is only
// where you happen to be standing when the room goes quiet.

// ---------- the market ----------
// Between bouts they let a trader down to the cells, because a fighter who can buy something is
// a fighter who lasts another room and sells another ticket. Coin had one use before this --
// being counted on the screen you died on.
export const SHOP = {
    moves: 2,                  // moves the trader is willing to teach
    powers: 2,                 // stones on the table
    depthPrice: 0.12,          // everything costs this much more per room deep
    move: 220,
    power: 90,
    mend: 60
};

// ---------- the big ones ----------
// A boss is an enemy with a name, a great deal of health, and a list of things it does on timers.
// Every `kind` below is a verb implemented once in systems/enemies.js, so a new boss is a line in
// this table unless it needs to do something genuinely new.
//
//   volley  a ring or fan of shots that hurt YOU -- the only things down here that shoot back
//   charge  a committed rush along the line you were last stood on
//   slam    a shockwave centred on itself
//   summon  calls in a handful of the ordinary dead
export const BOSSES = {
    warden: {
        name: 'The Warden', title: 'who holds the keys', colour: 0x8a3a3a, accent: 0xffc089,
        size: 1.45, hp: 380, speed: 2.5, damage: 20, reach: 1.9, cooldown: 1.4, xp: 200,
        moves: [
            { kind: 'slam',   cool: 6.5, wind: 0.7, damage: 26, radius: 3.6, knock: 12 },
            { kind: 'charge', cool: 9,   wind: 0.8, damage: 30, speed: 13, time: 0.75, knock: 8 },
            { kind: 'summon', cool: 13,  wind: 0.5, kinds: ['rat', 'skeleton'], n: 4 }
        ],
        blurb: 'It was a gaoler once.'
    },
    chanter: {
        name: 'The Chanter', title: 'who sang through three sentences', colour: 0x584a6b, accent: 0xb48ad9,
        size: 1.3, hp: 520, speed: 3.1, damage: 16, reach: 1.6, cooldown: 1.2, xp: 320,
        moves: [
            { kind: 'volley', cool: 5,  wind: 0.6, shots: 12, damage: 11, speed: 7.5, ring: true },
            { kind: 'volley', cool: 7.5, wind: 0.5, shots: 5, damage: 14, speed: 11, spread: 0.5 },
            { kind: 'summon', cool: 14, wind: 0.5, kinds: ['shade'], n: 5 }
        ],
        blurb: 'The hymn is the weapon.'
    },
    gravewurm: {
        name: 'Gravewurm', title: 'that they stopped feeding', colour: 0x4f7a46, accent: 0x8fbf5a,
        size: 1.7, hp: 760, speed: 2.2, damage: 26, reach: 2.2, cooldown: 1.6, xp: 460,
        moves: [
            { kind: 'charge', cool: 7,  wind: 0.7, damage: 34, speed: 15, time: 0.9, knock: 10 },
            { kind: 'slam',   cool: 8,  wind: 0.8, damage: 30, radius: 4.4, knock: 14, slow: 1.4 },
            { kind: 'volley', cool: 10, wind: 0.6, shots: 8, damage: 13, speed: 9, ring: true }
        ],
        blurb: 'Everyone who lost down here went somewhere.'
    }
};
// Which one is waiting, by how many boss floors deep you are. Past the end of the list they come
// round again, harder, which is what stops floor sixteen being an anticlimax.
export const BOSS_ORDER = ['warden', 'chanter', 'gravewurm'];
export const BOSS_DEPTH_HP = 0.55;       // per repeat of the list
export const BOSS_DEPTH_DAMAGE = 0.3;

// ---------- what the crowd throws in ----------
// The arcade half of the loot, and now the only half. An upgrade you buy is yours for the run; a
// stone off the sand is yours for fifteen seconds, and that is a completely different feeling --
// it turns a room you were losing into a room you are winning, once, and then it is gone.
//
// Two of them anybody can use. The rest are cut for one calling each, because a Knight who picks
// up a fistful of arrows has been handed nothing, and a power-up that is useless to half the
// roster is a power-up half the roster learns to ignore.
export const POWERUPS = {
    fury:    { name: 'Bloodrush',  time: 10, colour: 0xb4392f, buff: { damage: 0.8 },
               desc: 'Nearly twice the damage, briefly' },
    ward:    { name: 'Wardstone',  time: 11, colour: 0x4a7fa8, buff: { guard: 0.55 },
               desc: 'Most of what lands on you does not' },

    reave:   { name: 'Reaver',     only: 'knight', time: 13, colour: 0x9aa4b0,
               buff: { reach: 1.0, knock: 0.9 },
               desc: 'Your swing reaches half the sand, and everything it touches leaves' },
    wind:    { name: 'Second Wind', only: 'knight', time: 8, colour: 0x8fbf5a, buff: { regen: 5 },
               desc: 'Closing as fast as they can open you' },

    scatter: { name: 'Scattershot', only: 'archer', time: 14, colour: 0x8fbf5a, buff: { spread: 2 },
               desc: 'Three arrows where there was one' },
    quick:   { name: 'Quickhand',  only: 'archer', time: 12, colour: 0xd9a441, buff: { haste: 0.5 },
               desc: 'Half again as fast, at everything' },

    bloom:   { name: 'Overgrowth', only: 'druid', time: 13, colour: 0x8fbf5a, buff: { blast: 0.9 },
               desc: 'Every seed opens twice as wide' },
    swarm:   { name: 'Seedstorm',  only: 'druid', time: 13, colour: 0x4f7a46, buff: { spread: 2 },
               desc: 'Three seeds a throw' },

    discord: { name: 'Cacophony',  only: 'bard', time: 12, colour: 0x7a5aa8,
               buff: { knock: 1.3, reach: 0.7 },
               desc: 'Nothing can stand anywhere near you' },
    encore:  { name: 'Encore',     only: 'bard', time: 11, colour: 0xd9a441, buff: { haste: 0.6 },
               desc: 'The last verse, played at a run' }
};

// ---------- prizes ----------
// Thrown down by the crowd when somebody does something they liked. No use whatsoever, and that
// is the point: it is the only thing in the pit you can want that is not survival.
export const PRIZES = {
    cup:    { name: 'Silver Cup',        score: 1500, coin: 10, colour: 0xcfc6b0 },
    purse:  { name: "Champion's Purse",  score: 4000, coin: 28, colour: 0xd9a441 },
    crown:  { name: "The Governor's Wreath", score: 9000, coin: 55, colour: 0xffe3a0 }
};
export const PRIZE_TIERS = { cup: 0.62, purse: 0.3, crown: 0.08 };

// ---------- the crowd ----------
// The premise has always said that people pay to watch this, and until now the crowd existed only
// in the text on the first screen. They are a system: they are watching, they have an opinion,
// and their opinion has consequences.
//
// What they like is what the game wants you to do anyway -- press, chain kills, take the fight to
// the middle of the sand rather than backing into a corner. So favour is a second voice saying
// the same thing the score says, in a language that is not a number: a noise that rises, and
// things thrown down to you when you have earned them.
//
// What they dislike is nothing happening. Favour bleeds while you are not fighting, which is the
// only pressure in the game against waiting in a corner for your health to come back.
export const CROWD = {
    max: 100,
    start: 20,
    kill: 2.4,                 // per body
    chain: 0.4,                // and this much more per step of the multiplier
    elite: 10,
    boss: 35,
    closeCall: 7,              // killing something while you are nearly gone
    wave: 6,                   // finishing a wave
    quiet: 3.5,                // seconds of nothing before they start to lose interest
    decay: 2.2,                // favour a second once they have
    // What they do with their approval is throw money. Coin is the one thing in this place that
    // buys anything -- upgrades, a move, a patched-up ribcage -- so the crowd's opinion of you is
    // not a score, it is income. Fight the way they came to see and the tribune pays for it.
    tipFrom: 42,               // above this the odd coin starts coming over the wall
    tipEvery: 2.4,             // seconds between them, and faster the louder it gets
    tipCoins: [1, 3],
    gift: 62,                  // a full purse at this much favour
    giftCost: 34,              // and they settle back to this much less
    purse: [9, 20],            // coins in one
    stone: 0.45,               // and this often, a stone comes down with it
    roar: 78                   // above this the noise itself changes
};
// What the meter says at each level. The words matter more than the number: nobody is counting
// favour, they are noticing that it has gone quiet.
export const CROWD_MOODS = [
    { at: 0,  name: 'silent',  colour: '#5a544c' },
    { at: 20, name: 'watching', colour: '#8a8275' },
    { at: 45, name: 'shouting', colour: '#d9a441' },
    { at: 78, name: 'ROARING',  colour: '#e8c04a' }
];

// ---------- there is no way out ----------
// There was a line here that ended the run at room nineteen and let you walk into daylight. It
// was the wrong ending, and wrong in an interesting way: a pit that lets people out is a pit
// with a door, and this place does not have one. Nobody is released. The run ends when you do.
//
// What replaces it is the crowd's money -- see CROWD above. The reason to fight well is not a
// promise about the last room, it is a purse thrown down after this one.

// ---------- the score ----------
// Kept because somebody should be able to say they got further than you did. The multiplier is
// the whole of it: points come from killing quickly and in a row, so the arcade floors reward
// wading in while the delve floors still reward being careful.
export const SCORE = {
    perXp: 9,              // a kill is worth this many points per point of experience
    depth: 0.12,           // and that much more per floor down
    crate: 120,
    wave: 200,
    room: 800,
    floor: 1600,
    boss: 7500,
    comboStep: 4,          // kills per step of the multiplier
    comboMax: 8,           // which stops here
    comboTime: 3.2         // seconds of quiet before a chain is considered over
};
export const HIGH_SCORES = 8;

// ---------- the dungeon ----------
export const GRID = 44;              // tiles square
export const ROOMS_MIN = 6, ROOMS_MAX = 9;
export const ROOM_MIN = 5, ROOM_MAX = 10;
export const TILE = 1;               // world units per tile

// ---------- getting better at it ----------
export const XP_BASE = 34;           // to reach level 2
export const XP_GROWTH = 1.45;
export const LEVEL_HP = 12;          // max health gained per level
export const LEVEL_DAMAGE = 0.09;    // +9% damage per level

// ---------- picking things up ----------
// Coin comes to you. Walking a pixel-perfect line over every drop is busywork in a game whose
// whole subject is where you are standing, and a purse that flies to your hand is one of the
// oldest and cheapest good feelings in the genre. The pull is weak at the edge of its range and
// hard at the end, so a drop drifts and then snaps.
export const PICKUP = {
    reach: 0.7,                      // close enough to take
    magnet: 3.6,                     // close enough to be dragged
    pull: 13,                        // at the last moment
    minPull: 2.2                     // at the edge of the range
};

export const POTION_HEAL = 0.35;     // share of max health a potion returns

export const INVULN_AFTER_HIT = 0.35;   // brief mercy window so a crowd can't stunlock you
