#!/usr/bin/env node
/* ==========================================================================
 * render-test.js - Exercises the Canvas2D renderer with a recording mock.
 *
 *   node tools/render-test.js
 *
 * jsdom has no Canvas2D, so the renderer is the one part of the game that
 * the other two test harnesses cannot reach. This file fakes a 2D context
 * that records every call and checks every numeric argument, then plays a
 * real round through it.
 *
 * It catches the two nastiest classes of canvas bug:
 *   1. runtime errors inside draw code (typos, undefined variables)
 *   2. NaN / Infinity coordinates - one NaN silently blanks the whole frame
 *      and is almost impossible to spot by eye on a phone.
 * ========================================================================== */
'use strict';

const path = require('path');
const WWW = path.join(__dirname, '..', 'www');

/* ------------------------------------------------------------------ mocks */
const nonFinite = [];
const callCount = Object.create(null);

function makeContext(tag) {
  const target = {
    canvas: { width: 360, height: 640 },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    measureText: () => ({ width: 12 }),
    getImageData: () => ({ data: [] })
  };

  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return function () {
        callCount[prop] = (callCount[prop] || 0) + 1;
        for (let i = 0; i < arguments.length; i++) {
          const a = arguments[i];
          if (typeof a === 'number' && !Number.isFinite(a)) {
            nonFinite.push((tag ? tag + '.' : '') + prop + '(' + Array.prototype.join.call(arguments, ', ') + ')');
          }
        }
        return undefined;
      };
    },
    set(t, prop, value) {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        nonFinite.push((tag ? tag + '.' : '') + prop + ' = ' + value);
      }
      t[prop] = value;
      return true;
    }
  });
}

function makeElement(tag) {
  const el = {
    tagName: tag || 'div',
    width: 360, height: 640,
    offsetWidth: 132, offsetHeight: 58,
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    children: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    getContext() { return makeContext(); },
    getBoundingClientRect() {
      const w = el.width || 132, h = el.height || 132;
      return { width: w, height: h, left: 0, top: 0, right: w, bottom: h };
    },
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {},
    querySelector() { return makeElement(); },
    querySelectorAll() { return []; },
    closest() { return null; }
  };
  return el;
}

const elements = Object.create(null);
globalThis.window = globalThis;
globalThis.innerWidth = 360;
globalThis.innerHeight = 640;
globalThis.devicePixelRatio = 3;                 // deliberately above maxDPR
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.document = {
  getElementById(id) { return elements[id] || (elements[id] = makeElement()); },
  querySelector() { return makeElement(); },
  querySelectorAll() { return []; },
  createElement(tag) { return makeElement(tag); },
  addEventListener() {},
  hidden: false
};

/* ---------------------------------------------------------------- modules */
['core/config', 'core/utils', 'core/events', 'core/storage', 'data/skins', 'data/botNames',
  'world/spatialHash', 'entities/food', 'entities/snake', 'entities/particles', 'world/world',
  'ai/botBrain', 'render/camera', 'render/sprites', 'render/renderer',
  'ui/hud', 'ui/screens', 'ui/shop', 'game/game'].forEach(m => {
  require(path.join(WWW, 'js', m + '.js'));
});

const SR = globalThis.SR;
const noop = () => {};
SR.Screens = { show: noop, hideAll: noop, hide: noop, clearStack: noop, toast: noop, current: null, init: noop };
SR.Sfx = { play: noop, unlock: noop, setEnabled: noop, suspend: noop, resume: noop };
SR.AdManager = { isShowing: () => false, isRewardedReady: () => true, preload: noop };

/* -------------------------------------------------------------- assertions */
let passed = 0;
const failures = [];
function assert(cond, label, extra) {
  if (cond) { passed++; console.log('  \u001b[32m✓\u001b[0m ' + label); }
  else { failures.push(label + (extra ? ' :: ' + extra : '')); console.log('  \u001b[31m✗\u001b[0m ' + label + (extra ? ' \u001b[90m' + extra + '\u001b[0m' : '')); }
}

console.log('\n\u001b[36mRenderer smoke test\u001b[0m');

const canvas = makeElement('canvas');
const game = new SR.Game({ canvas, input: null });

let fatal = null;
try {
  game.startRun();

  /* --- 1. a normal round: stepping + rendering every frame ------------- */
  for (let i = 0; i < 900; i++) {           // 15 seconds
    game.step(1 / 60);
    game.render(1 / 60);
  }
} catch (e) { fatal = e; }
assert(!fatal, '15s of simulation + rendering runs without errors', fatal && fatal.stack.split('\n')[0]);

/* --- 2. the camera must actually track the player ---------------------- */
assert(Number.isFinite(game.camera.x) && Number.isFinite(game.camera.y), 'camera position is finite');
assert(game.camera.zoom > 0 && game.camera.zoom <= SR.CONFIG.camera.maxZoom, 'camera zoom is sane', game.camera.zoom.toFixed(3));
const camDist = Math.hypot(game.camera.x - game.player.x, game.camera.y - game.player.y);
assert(camDist < 600, 'camera stays close to the player', camDist.toFixed(0) + 'u');

/* --- 3. device pixel ratio is capped ----------------------------------- */
assert(canvas.width === 360 * SR.CONFIG.render.maxDPR, 'DPR is capped at render.maxDPR',
  canvas.width + 'px for a 360px viewport');

/* --- 4. effects: boost, explosion, revive shield ------------------------ */
let fatal2 = null;
try {
  game.player.boosting = true;
  for (let i = 0; i < 60; i++) { game.step(1 / 60); game.render(1 / 60); }

  game.camera.addShake(1.2);               // death shake
  game._killSnake(game.player, 'snake', game.world.snakes[1]);
  for (let i = 0; i < 30; i++) { game.render(1 / 60); }

  game.revivePlayer();                     // shield + restore path
  for (let i = 0; i < 60; i++) { game.step(1 / 60); game.render(1 / 60); }
} catch (e) { fatal2 = e; }
assert(!fatal2, 'boost / explosion / revive-shield rendering runs clean', fatal2 && fatal2.stack.split('\n')[0]);

/* --- 5. extreme zoom levels (very small & very large snakes) ----------- */
let fatal3 = null;
try {
  game.player.grow(400);
  for (let i = 0; i < 30; i++) { game.step(1 / 60); game.render(1 / 60); }
  const longSnakeZoom = game.camera.zoom;
  game.player.shrink(game.player.segments.length - 6);
  for (let i = 0; i < 30; i++) { game.step(1 / 60); game.render(1 / 60); }
  assert(game.camera.zoom >= longSnakeZoom, 'camera zooms out for big snakes, back in for small ones',
    longSnakeZoom.toFixed(2) + ' -> ' + game.camera.zoom.toFixed(2));
} catch (e) { fatal3 = e; }
assert(!fatal3, 'rendering survives extreme snake sizes', fatal3 && fatal3.stack.split('\n')[0]);

/* --- 6. wrap-around arena (the other world mode) ------------------------ */
let fatal4 = null;
try {
  SR.CONFIG.world.wrap = true;
  const g2 = new SR.Game({ canvas, input: null });
  g2.startRun();
  for (let i = 0; i < 300; i++) { g2.step(1 / 60); g2.render(1 / 60); }
  assert(g2.world.getAliveSnakes().length > 3, 'wrap-around mode keeps snakes alive');
} catch (e) { fatal4 = e; }
assert(!fatal4, 'wrap-around arena renders cleanly', fatal4 && fatal4.stack.split('\n')[0]);
SR.CONFIG.world.wrap = false;

/* --- 7. sprites & previews --------------------------------------------- */
let fatal5 = null;
try {
  SR.SKINS.forEach(skin => SR.drawSkinPreview(makeElement('canvas'), skin, { locked: !SR.Storage.isSkinUnlocked(skin.id) }));
  SR.Sprites.glow('#35e6ff', 40);
  SR.Sprites.dot('#ffd257', 12);
  SR.Sprites.coin(20);
} catch (e) { fatal5 = e; }
assert(!fatal5, 'skin previews and sprite cache render', fatal5 && fatal5.stack.split('\n')[0]);
assert(Object.keys(SR.Sprites.cache).length > 0, 'sprite cache is populated', Object.keys(SR.Sprites.cache).length + ' sprites');

/* --- 8. resize ---------------------------------------------------------- */
let fatal6 = null;
try {
  globalThis.innerWidth = 800; globalThis.innerHeight = 400;   // landscape
  game.resize();
  game.render(1 / 60);
  globalThis.innerWidth = 360; globalThis.innerHeight = 800;   // tall portrait
  game.resize();
  game.render(1 / 60);
} catch (e) { fatal6 = e; }
assert(!fatal6, 'resizing / rotating the device is handled', fatal6 && fatal6.stack.split('\n')[0]);

/* --------------------------------------------------------------- results */
console.log('\n  \u001b[90mdraw calls recorded: ' +
  Object.entries(callCount).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, v]) => k + ' ' + v).join(', ') + '\u001b[0m');

assert(nonFinite.length === 0, 'no NaN / Infinity ever reaches the canvas',
  nonFinite.slice(0, 3).join(' | ') + (nonFinite.length > 3 ? ' (+' + (nonFinite.length - 3) + ' more)' : ''));

console.log('\n' + '-'.repeat(56));
if (failures.length) {
  console.log('\u001b[31mFAILED\u001b[0m ' + failures.length + ' check(s):');
  failures.forEach(f => console.log('  • ' + f));
  console.log('\u001b[32m' + passed + '\u001b[0m passed');
  process.exit(1);
}
console.log('\u001b[32mALL ' + passed + ' RENDER CHECKS PASSED\u001b[0m');
process.exit(0);
