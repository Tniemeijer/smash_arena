// ==================== SOUND ====================
// Synthesised at runtime from oscillators and filtered noise, same as the lab game. No files, no
// licensing, and it suits the look: a dungeon made of cubes should sound like it was made of
// arithmetic. Every sound aims to be readable rather than realistic -- you should know a hit
// landed, a thing died, or you got hurt, without looking away from what you're aiming at.

const DEFS = {
    swing:     { voices: [{ noise: true, dur: 0.14, gain: 0.16, band: 1400, q: 0.8 }] },
    swingHit:  { voices: [{ noise: true, dur: 0.1, gain: 0.26, band: 700, q: 1.1 },
                          { type: 'square', f: 180, to: 90, dur: 0.12, gain: 0.2, a: 0.003, d: 0.11 }] },
    shoot:     { voices: [{ type: 'triangle', f: 700, to: 420, dur: 0.1, gain: 0.16, a: 0.003, d: 0.09 }] },
    blast:     { voices: [{ noise: true, dur: 0.34, gain: 0.3, band: 320, q: 0.5 },
                          { type: 'sine', f: 140, to: 60, dur: 0.36, gain: 0.26, a: 0.006, d: 0.35 }] },
    hurt:      { voices: [{ type: 'sawtooth', f: 240, to: 120, dur: 0.22, gain: 0.26, a: 0.004, d: 0.21, lp: 900 }] },
    kill:      { voices: [{ type: 'square', f: 300, to: 120, dur: 0.16, gain: 0.18, a: 0.004, d: 0.15 },
                          { noise: true, dur: 0.16, gain: 0.14, band: 500, q: 0.7, delay: 0.03 }] },
    level:     { voices: [{ type: 'sine', f: 523, to: 523, dur: 0.12, gain: 0.24, a: 0.004, d: 0.11 },
                          { type: 'sine', f: 659, to: 659, dur: 0.12, gain: 0.24, a: 0.004, d: 0.11, delay: 0.1 },
                          { type: 'sine', f: 880, to: 880, dur: 0.3, gain: 0.26, a: 0.004, d: 0.29, delay: 0.2 }] },
    pickup:    { voices: [{ type: 'sine', f: 620, to: 930, dur: 0.14, gain: 0.2, a: 0.004, d: 0.13 }] },
    dash:      { voices: [{ noise: true, dur: 0.16, gain: 0.14, band: 2200, q: 0.6 }] },
    // A hiss rather than a thump: being on fire is a sound that keeps happening.
    burn:      { voices: [{ noise: true, dur: 0.24, gain: 0.14, band: 2600, q: 0.7, a: 0.01, d: 0.22 }] },
    crate:     { voices: [{ noise: true, dur: 0.26, gain: 0.3, band: 900, q: 0.6 },
                          { type: 'square', f: 160, to: 70, dur: 0.2, gain: 0.18, a: 0.004, d: 0.19 }] },
    relic:     { voices: [{ type: 'sine', f: 740, to: 740, dur: 0.14, gain: 0.2, a: 0.004, d: 0.13 },
                          { type: 'sine', f: 1110, to: 1110, dur: 0.3, gain: 0.16, a: 0.005, d: 0.29, delay: 0.09 }] },
    death:     { voices: [{ type: 'sine', f: 200, to: 70, dur: 0.9, gain: 0.3, a: 0.04, d: 0.85 },
                          { type: 'sine', f: 203, to: 72, dur: 0.9, gain: 0.22, a: 0.04, d: 0.85 }] },
    // ---- the arcade floors ----
    // A portcullis dropping: iron on stone, with the weight of it underneath. The same sound
    // plays when they open, which is right -- it is the same gate.
    gate:      { voices: [{ noise: true, dur: 0.3, gain: 0.3, band: 240, q: 0.7 },
                          { type: 'square', f: 120, to: 48, dur: 0.34, gain: 0.22, a: 0.004, d: 0.33 }] },
    // Something arriving where the marker was.
    spawn:     { voices: [{ type: 'sawtooth', f: 90, to: 220, dur: 0.16, gain: 0.16, a: 0.006, d: 0.15, lp: 1200 }] },
    // A boss winding up. Rising, so it reads as a question you have about a second to answer.
    wind:      { voices: [{ type: 'sine', f: 180, to: 520, dur: 0.5, gain: 0.18, a: 0.05, d: 0.45 }] },
    // And a boss noticing you.
    boss:      { voices: [{ type: 'sawtooth', f: 110, to: 55, dur: 0.8, gain: 0.3, a: 0.02, d: 0.78, lp: 700 },
                          { type: 'square', f: 55, to: 41, dur: 0.9, gain: 0.2, a: 0.03, d: 0.86 }] },
    // The crowd. Filtered noise with a slow swell, which at this resolution of sound is as close
    // to a stadium as arithmetic gets -- and the only sound in the game that is made by people.
    roar:      { voices: [{ noise: true, dur: 1.1, gain: 0.26, band: 620, q: 0.5, a: 0.18, d: 0.9 },
                          { noise: true, dur: 0.9, gain: 0.16, band: 1400, q: 0.4, a: 0.22, d: 0.66, delay: 0.06 }] },
    // A song. Three notes of a chord with the top one held, which is as close to a lute as
    // arithmetic gets and is unmistakably not a weapon.
    song:      { voices: [{ type: 'triangle', f: 392, to: 392, dur: 0.5, gain: 0.16, a: 0.01, d: 0.48 },
                          { type: 'triangle', f: 494, to: 494, dur: 0.5, gain: 0.14, a: 0.01, d: 0.48, delay: 0.07 },
                          { type: 'sine', f: 587, to: 587, dur: 0.75, gain: 0.15, a: 0.02, d: 0.72, delay: 0.14 }] },
    // A power-up. The only fanfare in the game that goes up three times.
    power:     { voices: [{ type: 'square', f: 660, to: 660, dur: 0.09, gain: 0.18, a: 0.003, d: 0.08 },
                          { type: 'square', f: 880, to: 880, dur: 0.09, gain: 0.18, a: 0.003, d: 0.08, delay: 0.07 },
                          { type: 'square', f: 1320, to: 1320, dur: 0.22, gain: 0.2, a: 0.004, d: 0.21, delay: 0.14 }] }
};

// A fight makes a lot of noise at once. Identical sounds inside this window collapse into one,
// and there is a hard cap on voices, or a big swing into a pack is a click rather than a hit.
const THROTTLE = 0.05;
const MAX_VOICES = 14;

let ctx = null, master = null, muted = false, volume = 0.7;
const lastPlayed = new Map();
let active = 0;

export const isMuted = () => muted;
export const getVolume = () => volume;
export function setMuted(v) {
    muted = !!v;
    if (master) master.gain.value = muted ? 0 : volume;
    try { localStorage.setItem('deepdelveMute', muted ? '1' : '0'); } catch (e) {}
}
export function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master && !muted) master.gain.value = volume;
    try { localStorage.setItem('deepdelveVol', String(volume)); } catch (e) {}
}

export function initAudio() {
    try {
        muted = localStorage.getItem('deepdelveMute') === '1';
        const v = parseFloat(localStorage.getItem('deepdelveVol'));
        if (Number.isFinite(v)) volume = v;
    } catch (e) {}
    const start = () => {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!ctx) {
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = muted ? 0 : volume;
            master.connect(ctx.destination);
        }
        // A context can be created and still be suspended. Left that way it silently drops every
        // sound for the rest of the session, which is indistinguishable from having no audio.
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart'])
        window.addEventListener(ev, start, { passive: true });
}

// Exported so the same code can be rendered into an OfflineAudioContext and measured, rather than
// the sounds only ever existing as something nobody can check.
export function renderVoice(audio, out, v, at) {
    const t = at + (v.delay || 0);
    const g = audio.createGain();
    const peak = v.gain ?? 0.2;
    const atk = v.a ?? 0.005, dec = v.d ?? Math.max(0.01, v.dur - atk);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
    let node;
    if (v.noise) {
        const len = Math.max(1, Math.ceil(audio.sampleRate * v.dur));
        const buf = audio.createBuffer(1, len, audio.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        const src = audio.createBufferSource();
        src.buffer = buf;
        const bp = audio.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = v.band ?? 800; bp.Q.value = v.q ?? 1;
        src.connect(bp); bp.connect(g);
        node = src;
    } else {
        const osc = audio.createOscillator();
        osc.type = v.type || 'sine';
        osc.frequency.setValueAtTime(v.f, t);
        if (v.to && v.to !== v.f) osc.frequency.exponentialRampToValueAtTime(Math.max(1, v.to), t + v.dur);
        if (v.lp) {
            const lp = audio.createBiquadFilter();
            lp.type = 'lowpass'; lp.frequency.value = v.lp;
            osc.connect(lp); lp.connect(g);
        } else osc.connect(g);
        node = osc;
    }
    g.connect(out);
    node.start(t);
    node.stop(t + v.dur + 0.02);
    return node;
}

export function play(name) {
    const def = DEFS[name];
    if (!def || !ctx || muted || ctx.state === 'suspended') return false;
    const now = ctx.currentTime;
    if (now - (lastPlayed.get(name) || -1) < THROTTLE) return false;
    lastPlayed.set(name, now);
    if (active + def.voices.length > MAX_VOICES) return false;
    for (const v of def.voices) {
        const node = renderVoice(ctx, master, v, now);
        active++;
        node.onended = () => { active--; };
    }
    return true;
}

export const soundNames = () => Object.keys(DEFS);
export const soundDef = (n) => DEFS[n];
export const audioReady = () => !!ctx;
