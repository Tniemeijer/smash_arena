// ==================== HUD, THE CELL, AND THE END ====================
// Plain DOM over the canvas. The 3D pass renders at a fraction of the window's resolution, so
// anything with text in it has to live up here or it would be unreadable.

import { surfaceAt } from '../dungeon.js';
import { G, maxHp, xpForLevel, classDef, mods, upgradePrice, upgradeRank, upgradeMaxed } from '../core.js';
import { CLASSES, ABILITY_SLOTS, ABILITY_LEVELS, SCORE, STAGE_NAME, CROWD,
         UPGRADES, UPGRADE_MAX, POWERUPS, BIOMES, SURFACE} from '../data.js';
import { normaliseLook, randomLook } from '../model.js';
import CharacterPreview from '../preview.js';
import { poolFor, abilityDef, isKnown, canLearn, learn, bind, abilityPointsLeft,
         readyFrac } from '../systems/abilities.js';
import { highScores, multiplier, scoreLine } from '../systems/score.js';
import { buy } from '../systems/shop.js';

const $ = (id) => document.getElementById(id);
let onPick = () => {};
let onRestart = () => {};

export function initHud(opts) {
    onPick = opts.onPick || (() => {});
    onRestart = opts.onRestart || (() => {});
    G.onToast = toast;
    G.onDamage = damageNumber;
    G.onScore = scorePop;
}

const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n] || 'th');

// ---------- the cell ----------
// You are not an adventurer who chose this. You are a prisoner with a number, and the only way
// out of the pit is through every room in it -- which is why the screen that starts a run is a
// cell and not a character sheet.
let draft = null;
let preview = null;

// The last prisoner you made, kept between runs. Being handed a stranger every time makes the
// whole screen something to click past; being handed the one you built last time, ready to send
// back in, makes it yours. Wrapped because storage throws outright in a private window.
const SAVE_KEY = 'deepdelve.character';
function remember(d) {
    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({ name: d.name, cls: d.cls, look: d.look }));
    } catch { /* nothing worth interrupting a run over */ }
}
function recall() {
    try {
        const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
        if (!raw) return null;
        return { name: String(raw.name || '').slice(0, 14) || randomName(),
                 cls: CLASSES[raw.cls] ? raw.cls : 'knight',
                 look: normaliseLook(raw.look) };
    } catch { return null; }
}

export function showCreate() {
    // The draft is a whole prisoner, level and all, because canLearn() and mods() read it exactly
    // as they read a live one -- what you build here is what walks out onto the sand.
    if (!draft) {
        const was = recall();
        draft = { name: was ? was.name : randomName(), cls: was ? was.cls : 'knight',
                  level: 1, known: [], slots: new Array(ABILITY_SLOTS).fill(null),
                  upgrades: {}, buffs: {},
                  // A face is rolled rather than built. Nobody chose to be down here.
                  look: was ? was.look : randomLook() };
        openWith(draft, poolFor(draft.cls)[0].id);
    }
    renderCreate();
}

const NAMES = ['Aldric', 'Bryn', 'Cassia', 'Dunmar', 'Elowen', 'Fenn', 'Gisla', 'Hale',
               'Ivo', 'Jora', 'Kestrel', 'Lorne', 'Maeve', 'Neve', 'Orrin', 'Perrin'];
const randomName = () => NAMES[Math.floor(Math.random() * NAMES.length)];

// The four callings, compared on the same scale. Damage is per second rather than per hit,
// because per hit made the bard look useless and the knight look like the only choice -- the
// druid's number is low for a different reason, and the kit text says what it is.
const statScale = () => {
    const rows = Object.values(CLASSES).map(c => ({
        hp: c.hp, dps: c.attack.damage / c.attack.cooldown, reach: c.attack.range, speed: c.speed }));
    const max = {};
    for (const k of ['hp', 'dps', 'reach', 'speed']) max[k] = Math.max(...rows.map(r => r[k]));
    return max;
};

function renderCreate() {
    const el = $('screen');
    const def = CLASSES[draft.cls];
    const pool = poolFor(draft.cls);
    const opening = draft.known[0] || null;
    const openDef = opening ? abilityDef(draft.cls, opening) : null;
    const max = statScale();
    const bar = (label, v, of, shown) =>
        `<div class="st"><i>${label}</i><u><s style="width:${Math.round(100 * v / of)}%"></s></u><b>${shown}</b></div>`;
    preview = preview || new CharacterPreview();
    const kit = def.kit || {};

    el.hidden = false;
    // Nothing of the fight behind the menu: the empty health bar and a skill bar with nothing on
    // it were showing through, and a menu over a broken-looking game is a worse first screen
    // than a menu over nothing.
    document.body.classList.add('menu');
    el.innerHTML = `
        <div class="sc-inner pick">
            <h1>DEEPDELVE</h1>
            <p class="sc-tag">Nobody walks out. But the crowd pays for a good fight.</p>

            <div class="cards">
                ${Object.entries(CLASSES).map(([id, c], i) => `
                    <button class="card ${id === draft.cls ? 'on' : ''}" data-cls="${id}">
                        <img src="${preview.portrait(id, draft.look)}" alt="">
                        <b>${c.name}</b><span>${c.role}</span><em>${i + 1}</em>
                    </button>`).join('')}
            </div>

            <div class="cr-body">
              <div class="cr-doll">
                <div id="cr-doll-host"></div>
                <button class="mini wide" data-roll>Another face</button>
              </div>
              <div class="cr-pick">
                <div class="cr-row">
                    <input id="cr-name" type="text" maxlength="14" value="${draft.name}" aria-label="Name">
                    <button class="mini" data-reroll title="Another name">↻</button>
                </div>
                <p class="cr-blurb">${def.blurb}</p>
                <div class="stats">
                    ${bar('Health', def.hp, max.hp, def.hp)}
                    ${bar('Damage', def.attack.damage / def.attack.cooldown, max.dps, Math.round(def.attack.damage / def.attack.cooldown))}
                    ${bar('Reach', def.attack.range, max.reach, def.attack.range.toFixed(1))}
                    ${bar('Speed', def.speed, max.speed, def.speed.toFixed(1))}
                </div>
                <div class="kit">
                    <div><i>Attack</i><span>${kit.attack || ''}</span></div>
                    <div><i>Dash</i><span>${kit.dash || ''}</span></div>
                    ${kit.passive ? `<div><i>Also</i><span>${kit.passive}</span></div>` : ''}
                </div>
              </div>
            </div>

            <div class="cr-move">
                <div class="tree-head"><span>Opening move</span>
                    <span class="pts">${openDef ? openDef.desc : 'pick one'}</span></div>
                <div class="chips">
                    ${pool.map(a => {
                        const locked = draft.level < (a.req || 1);
                        return `<button class="chip ${opening === a.id ? 'on' : ''} ${locked ? 'locked' : ''}"
                            data-open="${a.id}" ${locked ? 'disabled' : ''}
                            title="${locked ? `Learn it at level ${a.req}: ${a.desc}` : a.desc}">${a.name}${locked ? `<small>Lv ${a.req}</small>` : ''}</button>`;
                    }).join('')}
                </div>
            </div>

            <button class="sc-again" data-descend>Into the arena <small>Enter</small></button>
            ${controlsHtml()}

            ${scoreTable()}
        </div>`;

    el.querySelector('#cr-name').addEventListener('input', (e) => { draft.name = e.target.value; });
    el.querySelector('[data-reroll]').addEventListener('click', () => { draft.name = randomName(); renderCreate(); });
    // Appearance is one button. A screen between you and the game is a screen you click past --
    // whoever wants a particular face can roll until they get one, and everybody else is
    // fighting ten seconds sooner.
    el.querySelector('[data-roll]').addEventListener('click', () => { draft.look = randomLook(); renderCreate(); });
    el.querySelectorAll('[data-cls]').forEach(b => b.addEventListener('click', () => pickCalling(b.dataset.cls)));
    el.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
        openWith(draft, b.dataset.open);
        G.sfx('pickup');
        renderCreate();
    }));
    el.querySelector('[data-descend]').addEventListener('click', enterArena);

    preview.mountInto(el.querySelector('#cr-doll-host'));
    preview.set(draft.cls, draft.look);
}

function pickCalling(cls) {
    if (!draft || draft.cls === cls) return;
    draft.cls = cls;
    // Moves belong to the calling, so changing it picks the new one's opening move.
    draft.known = []; draft.slots = new Array(ABILITY_SLOTS).fill(null);
    openWith(draft, poolFor(draft.cls)[0].id);
    G.sfx('pickup');
    renderCreate();
}

function enterArena() {
    if (!draft) return;
    const el = $('screen');
    el.hidden = true;
    document.body.classList.remove('menu');
    draft.name = draft.name.trim() || randomName();
    remember(draft);
    if (preview) preview.stop();
    onPick(draft.cls, { name: draft.name, look: draft.look, known: draft.known, slots: draft.slots });
    draft = null;
}

// The screen's own keys: 1-4 choose a calling, Enter goes in. Only while the screen is up, and
// never while the name box has the keyboard -- a prisoner called "K2" should be possible.
addEventListener('keydown', (e) => {
    if (!draft || $('screen').hidden) return;
    if (document.activeElement && document.activeElement.id === 'cr-name') {
        if (e.code === 'Enter') { e.preventDefault(); enterArena(); }
        return;
    }
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (n !== -1) { pickCalling(Object.keys(CLASSES)[n]); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.code === 'Enter') { e.preventDefault(); enterArena(); }
}, true);

// The one move you walk in with. Swapping it is a swap, not a second purchase -- there is exactly
// one opening move and picking a different one puts the first back.
function openWith(d, id) {
    d.known = [id];
    d.slots = new Array(ABILITY_SLOTS).fill(null);
    d.slots[0] = id;
}

// ---------- moves ----------
// The one thing left that makes two knights different from each other. You go in knowing one, and
// are taught another at levels 2, 4, 6 and 8 -- or buy one from the trader if you would rather not
// wait. Four keys and six moves per calling, so nobody ever carries all of them.
function movesHtml(p) {
    const left = abilityPointsLeft(p);
    const pool = poolFor(p.cls);
    const next = ABILITY_LEVELS.find(l => l > p.level);
    const head = left ? `${left} to learn`
                      : next ? `next at level ${next}` : `${(p.known || []).length} known`;
    return `<div class="tree moves">
        <div class="tree-head"><span>Special moves</span><span class="pts">${head}</span></div>
        ${pool.map(a => {
            const known = isKnown(p, a.id);
            const can = canLearn(p, a.id);
            const slot = (p.slots || []).indexOf(a.id);
            const locked = p.level < (a.req || 1);
            return `<div class="move ${known ? 'known' : ''} ${locked ? 'locked' : ''}">
                <div class="m-top">
                    <b>${a.name}</b>
                    <i>${locked ? `needs level ${a.req}` : `${a.cool}s`}</i>
                </div>
                <span class="m-desc">${a.desc}</span>
                <div class="m-keys">
                    ${known
                        ? [0, 1, 2, 3].map(i => `<button class="kbind ${slot === i ? 'on' : ''}"
                              data-bind="${a.id}" data-slot="${i}">${i + 1}</button>`).join('')
                          + (slot !== -1 ? `<button class="kbind off" data-unbind="${slot}">off</button>` : '')
                        : `<button class="learn" data-learn="${a.id}" ${can ? '' : 'disabled'}>Learn</button>`}
                </div>
            </div>`;
        }).join('')}
    </div>`;
}
function wireMoves(el, p, rerender) {
    el.querySelectorAll('[data-learn]').forEach(b =>
        b.addEventListener('click', () => { if (learn(p, b.dataset.learn)) rerender(); }));
    el.querySelectorAll('[data-bind]').forEach(b =>
        b.addEventListener('click', () => { if (bind(p, +b.dataset.slot, b.dataset.bind)) { G.sfx('pickup'); rerender(); } }));
    el.querySelectorAll('[data-unbind]').forEach(b =>
        b.addEventListener('click', () => { if (bind(p, +b.dataset.unbind, null)) rerender(); }));
}

// ---------- what you have bought ----------
// Five lines, five ranks each, and the price of the next one. This is the whole of character
// building now, which is the point: it fits on a card and you can read it mid-fight.
function upgradesHtml(p, floor, forSale) {
    const s = G.state;
    return `<div class="tree">
        <div class="tree-head"><span>${forSale ? 'Upgrades' : 'What you are'}</span>
            <span class="pts">${forSale ? `${s.coins} coin` : `Level ${p.level}`}</span></div>
        ${Object.entries(UPGRADES).map(([key, up]) => {
            const rank = upgradeRank(p, key);
            const maxed = upgradeMaxed(p, key);
            const price = upgradePrice(p, key, floor);
            const afford = s.coins >= price;
            return `<div class="ware ${maxed ? 'sold' : ''}">
                <div class="w-top">
                    <b>${up.name} <em class="pips">${'●'.repeat(rank)}${'○'.repeat(UPGRADE_MAX - rank)}</em></b>
                    ${forSale ? `<i class="${maxed || afford ? '' : 'poor'}">${maxed ? 'full' : `${price} coin`}</i>` : ''}
                </div>
                <span>${up.desc}</span>
                ${forSale && !maxed ? `<button class="mini wide" data-buy="upgrade" data-key="${key}"
                    ${afford ? '' : 'disabled'}>Buy</button>` : ''}
            </div>`;
        }).join('')}
    </div>`;
}

// ---------- the market ----------
function shopHtml(p) {
    const s = G.state, shop = s.shop;
    if (!shop) return '<p class="moves-note">Nothing for sale here.</p>';
    const row = (name, desc, price, attr, sold, afford) => `
        <div class="ware ${sold ? 'sold' : ''}">
            <div class="w-top"><b>${name}</b><i class="${afford || sold ? '' : 'poor'}">${sold ? 'sold' : `${price} coin`}</i></div>
            <span>${desc}</span>
            ${sold ? '' : `<button class="mini wide" ${attr} ${afford ? '' : 'disabled'}>Buy</button>`}
        </div>`;

    const moves = shop.moves.map((m, i) => {
        const a = abilityDef(p.cls, m.id);
        return row(a.name, a.desc, m.price, `data-buy="move" data-key="${i}"`, m.sold, s.coins >= m.price);
    }).join('') || '<p class="moves-note">Nothing left to teach you.</p>';

    const powers = shop.powers.map((w, i) => {
        const def = POWERUPS[w.id];
        return row(def.name, `${def.desc} — ${def.time}s, from the moment you take it`,
                   w.price, `data-buy="power" data-key="${i}"`, w.sold, s.coins >= w.price);
    }).join('');

    const hurt = p.hp < maxHp(p);
    const mend = row('Mending', hurt ? 'Back to full health' : 'You are not hurt', shop.mend.price,
                     'data-buy="mend" data-key="0"', shop.mend.sold || !hurt,
                     s.coins >= shop.mend.price && hurt);

    return `${upgradesHtml(p, shop.floor, true)}
        <div class="tree shop">
            <div class="tree-head"><span>The trader</span><span class="pts">${s.coins} coin</span></div>
            <p class="moves-note">Whatever is left on the table is here only until you walk out
               of the gate.</p>
            <div class="shop-head">Moves</div>${moves}
            <div class="shop-head">Stones</div>${powers}
            <div class="shop-head">Services</div>${mend}
        </div>`;
}
function wireShop(el, rerender) {
    el.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
        const key = b.dataset.buy === 'upgrade' ? b.dataset.key : +b.dataset.key;
        const res = buy(b.dataset.buy, key);
        if (!res) return;
        if (res.bad) toast(res.bad, 'bad');
        else toast(res.text, res.good ? 'good' : '');
        rerender();
    }));
}

// ---------- the panel, and the pause ----------
// Opening either one stops the room. Deciding what you are becoming, and putting the game down,
// are both things that should not happen while three things are walking at you.
let panelOpen = false;
let paused = false;
let panelTab = 'moves';
export const isSkillPanelOpen = () => panelOpen || paused;
export const isPaused = () => paused;

export function togglePanel(tab) {
    const s = G.state;
    if (!s || s.over) return;
    if (paused) return;
    if (panelOpen && (!tab || tab === panelTab)) { closePanel(); return; }
    panelTab = tab || panelTab;
    panelOpen = true;
    renderPanel();
}
function closePanel() { panelOpen = false; $('screen').hidden = true; }

export function togglePause() {
    const s = G.state;
    if (!s || s.over) return;
    if (panelOpen) { closePanel(); return; }
    paused = !paused;
    if (paused) renderPause(); else $('screen').hidden = true;
}

// ---------- settings ----------
// One, so far: which way the keys push you. Kept in the browser, because it is a preference about
// your hands and not about any particular prisoner.
const SETTINGS_KEY = 'deepdelve.settings';
export function loadSettings() {
    try { return { move: 'fixed', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch { return { move: 'fixed' }; }
}
function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(G.settings)); } catch { /* not worth a crash */ }
}

// The controls, said once and shown wherever there is room to read them -- the character screen
// and the pause screen, never over the fight itself.
export function controlsHtml() {
    const move = (G.settings && G.settings.move === 'aim')
        ? '<b>W</b> toward the cursor, <b>S</b> away, <b>A D</b> circle'
        : '<b>WASD</b> move';
    return `<p class="controls">${move} &middot; <b>mouse</b> aims &middot; <b>click</b> attacks &middot;
            <b>Space</b> dashes &middot; <b>1–4</b> moves &middot; <b>E</b> trade / take a gate &middot;
            <b>J</b> moves &middot; <b>P</b> pause</p>`;
}

function renderPause() {
    const el = $('screen');
    const p = G.state.player;
    const move = (G.settings && G.settings.move) || 'fixed';
    el.hidden = false;
    el.innerHTML = `
        <div class="sc-inner create">
            <h1>HELD</h1>
            <p class="sc-tag">${p.name} · ${CLASSES[p.cls].name} · Room ${G.state.floor}</p>
            ${upgradesHtml(p, G.state.floor, false)}
            <div class="setting">
                <span>Movement</span>
                <button class="mini ${move === 'fixed' ? 'on' : ''}" data-move="fixed">Fixed to the screen</button>
                <button class="mini ${move === 'aim' ? 'on' : ''}" data-move="aim">Follows the aim</button>
            </div>
            <button class="sc-again" data-close>Back to it</button>
            ${controlsHtml()}
        </div>`;
    el.querySelector('[data-close]').addEventListener('click', () => { paused = false; el.hidden = true; });
    el.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => {
        G.settings = { ...(G.settings || {}), move: b.dataset.move };
        saveSettings();
        renderPause();
    }));
}

const TAB_MOVES = ['moves', 'Moves', 'J'];
const TAB_SHOP = ['shop', 'Market', 'E'];
function renderPanel() {
    const el = $('screen');
    const p = G.state.player;
    if (preview) preview.stop();
    const tabs = G.state.shop ? [TAB_MOVES, TAB_SHOP] : [TAB_MOVES];
    if (!tabs.some(t => t[0] === panelTab)) panelTab = 'moves';
    const badge = { moves: abilityPointsLeft(p), shop: 0 };
    el.hidden = false;
    el.innerHTML = `
        <div class="sc-inner create">
            <h1>${p.name}</h1>
            <p class="sc-tag">${CLASSES[p.cls].name} · Level ${p.level} · Room ${G.state.floor}</p>
            <div class="tabs">
                ${tabs.map(([id, label, key]) => `<button class="tab ${panelTab === id ? 'on' : ''}"
                    data-tab="${id}">${label} <i>${key}</i>${badge[id] ? `<em>${badge[id]}</em>` : ''}</button>`).join('')}
            </div>
            ${panelTab === 'shop' ? shopHtml(p) : movesHtml(p) + upgradesHtml(p, G.state.floor, false)}
            <button class="sc-again" data-close>Back to it</button>
        </div>`;
    wireMoves(el, p, renderPanel);
    wireShop(el, renderPanel);
    el.querySelectorAll('[data-tab]').forEach(b =>
        b.addEventListener('click', () => { panelTab = b.dataset.tab; renderPanel(); }));
    el.querySelector('[data-close]').addEventListener('click', closePanel);
}

// ---------- the cabinet's memory ----------
function scoreTable(highlight = -1) {
    const rows = highScores();
    if (!rows.length) return '';
    return `<div class="tree scores">
        <div class="tree-head"><span>Longest held out</span><span class="pts">best of ${rows.length}</span></div>
        ${rows.map((r, i) => `<div class="hs ${i === highlight - 1 ? 'mine' : ''}">
            <i>${i + 1}</i>
            <b>${r.score.toLocaleString()}</b>
            <span>${scoreLine(r)}</span>
            <em>room ${r.floor}${r.chain ? ` · ×${1 + Math.floor(r.chain / SCORE.comboStep)} chain` : ''}</em>
        </div>`).join('')}
    </div>`;
}

export function showDeath(over) {
    const el = $('screen');
    if (preview) preview.stop();
    panelOpen = paused = false;
    el.hidden = false;
    const row = (k, v) => `<span><i>${k}</i><b>${v}</b></span>`;
    el.innerHTML = `
        <div class="sc-inner">
            <h1>YOU DIED</h1>
            <p class="sc-tag">${over.name} the ${CLASSES[over.cls].name.toLowerCase()} got as far as room ${over.floor}.<br>
               They are already selling tickets for the next one.</p>
            <div class="final-score">
                <i>Score</i><b>${(over.score || 0).toLocaleString()}</b>
                ${over.place ? `<em>${over.place === 1 ? 'A new best' : `${ordinal(over.place)} best`}</em>` : ''}
            </div>
            <div class="sc-score">
                ${row('Rooms reached', over.floor)}
                ${row('Level', over.level)}
                ${row('Kills', over.stats.kills)}
                ${row('Best chain', over.stats.best || 0)}
                ${row('Damage dealt', Math.round(over.stats.dealt))}
                ${row('Coin', over.coins)}
                ${row('Prizes', over.stats.prizes || 0)}
                ${row('Bosses felled', over.stats.bosses || 0)}
            </div>
            ${scoreTable(over.place)}
            <button class="sc-again" data-again>Send somebody else</button>
        </div>`;
    el.querySelector('[data-again]').addEventListener('click', () => { el.hidden = true; onRestart(); });
}

// ---------- per frame ----------
export function renderHud(s) {
    if (!s || !s.player) return;
    const p = s.player, def = classDef(p);
    const hp = Math.max(0, p.hp), mx = maxHp(p);
    $('v-class').textContent = def.name;
    $('v-level').textContent = `Lv ${p.level}`;
    $('v-hp').style.width = `${Math.min(100, (hp / mx) * 100)}%`;
    $('v-hp-txt').textContent = `${Math.ceil(hp)} / ${mx}`;
    $('v-xp').style.width = `${Math.min(100, (p.xp / xpForLevel(p.level)) * 100)}%`;

    // The edges bleed as your health goes, because your eyes are in the middle of the screen on
    // the thing that is about to hit you, and the health bar is not.
    const bleed = $('hurt');
    if (bleed) {
        const frac = hp / mx;
        const want = frac > 0.5 ? 0 : Math.min(1, (0.5 - frac) / 0.38);
        if (Math.abs((bleed._v ?? -1) - want) > 0.02) {
            bleed.style.opacity = String(want);
            bleed._v = want;
        }
        const crit = frac <= 0.25;
        if (bleed._c !== crit) { bleed.classList.toggle('critical', crit); bleed._c = crit; }
    }
    // "Room", not "floor": there are no floors any more, only one room after another -- and no
    // last one either. It counts up until you stop.
    $('d-floor').textContent = `Room ${s.floor}`;
    const purse = $('d-coins');
    if (purse) purse.textContent = `${s.coins} coin${s.coins === 1 ? '' : 's'}`;

    const d = G.dungeon;
    const stage = (d && d.stage) || 'arena';
    const st = $('d-stage');
    // Where you are beats what kind of room it is: "The Icehouse" tells you about the floor you
    // are standing on, and "Arena" tells you what you already know from looking at it. The market
    // and a lair keep their own names, because those say something the walls do not.
    const place = stage === 'arena' && d && BIOMES[d.biome] ? BIOMES[d.biome].name : STAGE_NAME[stage];
    if (st) st.textContent = place || '';
    // Only the one number that is not already visible: which wave of how many. What is left
    // standing is on the sand, and whether the way out is open is written in the torches.
    const a = s.arena;
    const waveLine = a && a.fighting && a.wave > 0 ? `Wave ${a.wave} of ${a.waves}` : '';
    const dl = $('d-left');
    if (dl.textContent !== waveLine) dl.textContent = waveLine;

    // ---- the score ----
    // Written only when it changes. Assigning textContent sixty times a second with the same
    // string is sixty needless invalidations, and the score is static most of the time.
    const num = $('sc-num');
    if (num && num._v !== s.score) { num.textContent = (s.score || 0).toLocaleString(); num._v = s.score; }
    const mult = $('sc-mult');
    if (mult) {
        const m = multiplier(s);
        mult.hidden = m <= 1;
        if (m > 1) {
            mult.querySelector('b').textContent = `×${m}`;
            mult.querySelector('i').style.width = `${Math.max(0, (s.chainT / SCORE.comboTime) * 100)}%`;
        }
    }

    // The crowd has no bar any more. They are drawn on the terraces jumping, waving and roaring,
    // which says how they feel about you better than a meter ever did -- and a meter is one more
    // thing to read in a game that should be read off the sand.

    // ---- whatever has a name ----
    const bossEl = $('boss');
    if (bossEl) {
        const b = s.enemies.find(e => e.boss);
        bossEl.hidden = !b;
        if (b) {
            bossEl.querySelector('b').textContent = b.name;
            bossEl.querySelector('span').textContent = b.title;
            $('b-hp').style.width = `${Math.max(0, (b.hp / b.maxHp) * 100)}%`;
        }
    }

    // The prompt is the only thing that ever mentions a key, so it has to be on screen the instant
    // standing where you are means one would do something.
    const pr = $('prompt');
    if (pr) {
        const stall = G.nearStall && G.nearStall();
        if (stall) {
            pr.hidden = false;
            pr.innerHTML = `Press <b>E</b> to trade &middot; <i>${STALL_NAME[stall.kind] || ''}</i>`;
        } else if (s.inGate) {
            pr.hidden = false;
            pr.innerHTML = `Going through&hellip;`;
        } else pr.hidden = true;
    }

    // Cooldowns wipe from the bottom, so a full square is a ready move.
    const wipe = (slot, frac, ready) => {
        const el = $(slot);
        el.querySelector('i').style.height = `${Math.round(frac * 100)}%`;
        el.classList.toggle('ready', ready);
    };
    wipe('slot-attack', p.cool / def.attack.cooldown, p.cool <= 0);
    // The rhythm on the basic attack, as pips along the top of its square: a bard's count to
    // four, an archer's steadiness. The last pip lit means the NEXT one is the big one -- the
    // chord, the Sure Shot -- which is the only thing the pips are for.
    const atk = $('slot-attack');
    if (atk) {
        const a = def.attack;
        let lit = -1, of = 0;
        if (a.chord) { of = a.chord.every - 1; lit = p.strum || 0; }
        else if (a.steady) { of = a.steady - 1; lit = p.quickdraw > 0 ? of : (p.steady || 0); }
        let pips = atk.querySelector('.pips');
        if (of && !pips) { pips = document.createElement('b'); pips.className = 'pips'; atk.appendChild(pips); }
        if (pips) {
            const html = Array.from({ length: of }, (_, i) => `<u class="${i < lit ? 'on' : ''}"></u>`).join('');
            if (pips._v !== html) { pips.innerHTML = html; pips._v = html; }
            atk.classList.toggle('primed', lit >= of);
        }
    }
    wipe('slot-dash', p.dashCool / def.dash.cooldown, p.dashCool <= 0);

    for (let i = 0; i < ABILITY_SLOTS; i++) {
        const el = $(`slot-a${i + 1}`);
        if (!el) continue;
        const id = (p.slots || [])[i];
        const a = id ? abilityDef(p.cls, id) : null;
        el.classList.toggle('empty', !a);
        const nameEl = el.querySelector('.n');
        const nm = a ? a.name : '';
        if (nameEl._v !== nm) { nameEl.textContent = nm; nameEl._v = nm; }
        el.querySelector('i').style.height = `${Math.round(readyFrac(p, id) * 100)}%`;
        el.classList.toggle('ready', !!a && readyFrac(p, id) <= 0);
    }

    // Whatever you are holding, named, because a number quietly changing is not feedback.
    const buffs = $('buffs');
    if (buffs) {
        const names = { damage: 'Fury', guard: 'Hardened', haste: 'Hastened', regen: 'Mending',
                        spread: 'Scattering', reach: 'Reaving', blast: 'Blooming', knock: 'Discord' };
        // And what is being done TO you, in the same row: a slow you cannot see on your own
        // body is a slow you blame on the controls.
        const ails = [];
        if (p.burn > 0) ails.push(`<span class="buff bad">Burning <i>${p.burn.toFixed(1)}s</i></span>`);
        if (p.chill > 0) ails.push(`<span class="buff cold">Chilled <i>${p.chill.toFixed(1)}s</i></span>`);
        if (p.parry > 0) ails.push(`<span class="buff cold">Shield up <i>${p.parry.toFixed(1)}s</i></span>`);
        if (def.waterMend && G.dungeon && surfaceAt(G.dungeon, p.x, p.z) === SURFACE.water)
            ails.push(`<span class="buff good">Rooted</span>`);
        const html = ails.join('') + Object.entries(p.buffs || {})
            .map(([k, b]) => `<span class="buff">${names[k] || k} <i>${b.t.toFixed(1)}s</i></span>`).join('');
        // innerHTML reparses whatever it is handed, so it is only handed something when the
        // something has changed -- which, with no stones held, is never.
        if (buffs._v !== html) { buffs.innerHTML = html; buffs._v = html; }
    }
}

const STALL_NAME = { upgrade: 'upgrades', move: 'a move', power: 'a stone' };

// ---------- transient bits ----------
function toast(text, kind = '') {
    const wrap = $('toast');
    const el = document.createElement('div');
    el.className = 'toast-item ' + kind;
    el.textContent = text;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 2200);
}

// Points arriving, shown where the score is rather than where the kill was.
function scorePop(amount, kind) {
    if (kind === 'kill') return;              // far too many of those to announce
    const wrap = $('sc-pop');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'pop';
    el.textContent = `+${amount.toLocaleString()}`;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 1100);
}

// Floating combat numbers. Capped, because a wave of nine bodies taking a whirlwind each is
// forty of these in one frame, and forty animated elements is a stutter you can feel.
const MAX_NUMBERS = 22;
let liveNumbers = 0;
function damageNumber(x, z, amount, kind) {
    if (!G.scene || liveNumbers >= MAX_NUMBERS) return;
    const p = G.scene.project(x, z, 1.1);
    const el = document.createElement('div');
    el.className = 'dmg ' + kind;
    el.textContent = kind === 'hurt' || kind === 'burn' ? `-${amount}` : amount;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    document.body.appendChild(el);
    liveNumbers++;
    const drift = (Math.random() - 0.5) * 26;
    const start = performance.now();
    const step = (now) => {
        const t = (now - start) / 620;
        if (t >= 1) { el.remove(); liveNumbers--; return; }
        el.style.transform = `translate(calc(-50% + ${drift * t}px), calc(-50% - ${34 * t}px))`;
        el.style.opacity = String(1 - t * t);
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}
