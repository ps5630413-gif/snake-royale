#!/usr/bin/env node
/* ==========================================================================
 * dom-test.js - Boots the REAL index.html inside jsdom and drives the UI.
 *
 *   npm i -D jsdom   (optional - `npm test` does not need it)
 *   node tools/dom-test.js
 *
 * Why: tools/smoke-test.js covers the simulation, but a typo in an element
 * id would only surface in a browser. This harness loads every script,
 * boots the app and clicks through menu -> shop -> game -> pause ->
 * game over -> revive, asserting the DOM actually reacts.
 *
 * Canvas2D is not implemented by jsdom (getContext returns null), so the
 * renderer no-ops - which is fine here: we test the wiring, not the pixels.
 * ========================================================================== */
'use strict';

const path = require('path');
const fs = require('fs');

let JSDOM;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  console.log('\u001b[33mjsdom is not installed - skipping DOM test.\u001b[0m');
  console.log('  npm i -D jsdom && node tools/dom-test.js');
  process.exit(0);
}

const WWW = path.join(__dirname, '..', 'www');

let passed = 0;
const failures = [];
function assert(cond, label, extra) {
  if (cond) { passed++; console.log('  \u001b[32m✓\u001b[0m ' + label); }
  else {
    failures.push(label + (extra ? ' :: ' + extra : ''));
    console.log('  \u001b[31m✗\u001b[0m ' + label + (extra ? ' \u001b[90m' + extra + '\u001b[0m' : ''));
  }
}

const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;

/* ---- stubs for the bits jsdom does not implement ------------------------ */
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { width: 132, height: 132, left: 20, top: 500, right: 152, bottom: 632, x: 20, y: 500 };
};
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get() { return 132; } });
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get() { return 58; } });
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.confirm = () => true;
window.requestAnimationFrame = () => 0;
window.cancelAnimationFrame = () => {};

const errors = [];
window.addEventListener('error', (e) => errors.push(e.message || String(e.error)));
window.onerror = (m) => errors.push(String(m));

/* ---- load every script in the order index.html declares them ------------ */
const scriptSrcs = Array.from(doc.querySelectorAll('script[src]')).map(s => s.getAttribute('src'));
console.log('\n\u001b[36mLoad\u001b[0m');
assert(scriptSrcs.length > 15, 'index.html declares every module', scriptSrcs.length + ' scripts');

scriptSrcs.forEach((src) => {
  const file = path.join(WWW, src);
  if (!fs.existsSync(file)) { errors.push('missing script file: ' + src); return; }
  try {
    window.eval(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push('error in ' + src + ': ' + e.message);
  }
});

const SR = window.SR;
const $ = (id) => doc.getElementById(id);
const isActive = (id) => $(id) && $(id).classList.contains('is-active');
const click = (el) => {
  if (typeof el === 'string') el = $(el);
  if (!el) return false;
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
};

/* ---- tiny async helpers -------------------------------------------------- */
function waitFor(label, cond, next, timeout) {
  const t0 = Date.now();
  const iv = window.setInterval(() => {
    let ok = false;
    try { ok = cond(); } catch (e) { errors.push(label + ': ' + e.message); ok = true; }
    if (ok || Date.now() - t0 > (timeout || 4000)) {
      window.clearInterval(iv);
      next(!ok);
    }
  }, 25);
}

console.log('\u001b[36mBoot\u001b[0m');
waitFor('boot', () => SR && SR.App && SR.App.booted, function (timedOut) {
  assert(!timedOut && errors.length === 0, 'all modules load and boot without errors', errors.join(' | '));
  assert(!!(SR && SR.App && SR.App.game), 'game instance created');

  /* every getElementById() used by the JS must exist in index.html */
  const idsUsed = new Set();
  scriptSrcs.forEach((src) => {
    const code = fs.readFileSync(path.join(WWW, src), 'utf8');
    const re = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(code))) idsUsed.add(m[1]);
  });
  const missing = Array.from(idsUsed).filter(id => !$(id));
  assert(missing.length === 0, 'every element id referenced by JS exists in index.html', missing.join(', '));

  waitFor('menu', () => isActive('screen-menu'), function () {
    runNavigationTests();
  });
});

function runNavigationTests() {
  console.log('\n\u001b[36mNavigation\u001b[0m');
  assert(isActive('screen-menu'), 'main menu is shown after boot');

  click('btn-howto');
  assert(isActive('screen-howto'), 'HOW TO PLAY opens');
  click(doc.querySelector('#screen-howto [data-back]'));
  assert(isActive('screen-menu'), 'back button returns to the menu');

  click('btn-settings');
  assert(isActive('screen-settings'), 'SETTINGS opens');
  const swipeBtn = doc.querySelector('#set-controls button[data-value="touch"]');
  click(swipeBtn);
  assert(SR.Storage.getSettings().controls === 'touch', 'control scheme is persisted');
  assert(swipeBtn.classList.contains('is-active'), 'segmented control reflects the saved value');
  click(doc.querySelector('#set-controls button[data-value="joystick"]'));
  assert(SR.Storage.getSettings().controls === 'joystick', 'control scheme can be switched back');
  click('set-sound');
  assert(SR.Storage.getSettings().sound === false, 'sound toggle is persisted');
  click('set-sound');
  click(doc.querySelector('#screen-settings [data-back]'));

  click('btn-shop');
  assert(isActive('screen-shop'), 'SKINS SHOP opens');
  const cards = doc.querySelectorAll('#shop-grid .skin-card');
  assert(cards.length === SR.SKINS.length, 'a card is rendered for every skin', cards.length + '');
  assert(doc.querySelectorAll('#shop-grid canvas').length === SR.SKINS.length, 'each card has a live preview canvas');

  shopTests(cards);
}

function shopTests(cards) {
  console.log('\n\u001b[36mSkins shop economy\u001b[0m');
  SR.Storage.reset();
  SR.Shop.refreshCards();
  const cards2 = doc.querySelectorAll('#shop-grid .skin-card');

  assert(/150/.test(cards2[1].querySelector('button').textContent), 'locked skin shows its price');
  click(cards2[1].querySelector('button'));
  assert(!SR.Storage.isSkinUnlocked('glowing-red'), 'cannot buy without enough coins');

  SR.Storage.addCoins(500);
  SR.Shop.refreshCards();
  click(doc.querySelectorAll('#shop-grid .skin-card')[1].querySelector('button'));
  assert(SR.Storage.isSkinUnlocked('glowing-red'), 'purchase unlocks the skin');
  assert(SR.Storage.getCoins() === 350, 'coins are deducted', SR.Storage.getCoins() + '');
  assert(SR.Storage.getSelectedSkin() === 'glowing-red', 'purchased skin is equipped');
  assert(/EQUIPPED/.test(doc.querySelectorAll('#shop-grid .skin-card')[1].textContent), 'card shows EQUIPPED');
  assert($('shop-coins').textContent === '350', 'wallet in the header updates');

  click(doc.querySelector('#screen-shop [data-back]'));
  assert(isActive('screen-menu'), 'back to menu from the shop');
  assert($('menu-coins').textContent === '350', 'menu wallet updates too');

  gameplayTests();
}

function gameplayTests() {
  console.log('\n\u001b[36mGameplay\u001b[0m');
  click('btn-play');
  const game = SR.App.game;
  assert(game.state === 'playing', 'PLAY starts a round');
  assert(!isActive('screen-menu'), 'menu is hidden during play');
  assert(!$('hud').classList.contains('is-hidden'), 'HUD is visible during play');
  assert(!$('joystick').classList.contains('is-hidden'), 'virtual joystick is visible (joystick mode)');
  assert(!$('boost-btn').classList.contains('is-hidden'), 'boost button is visible');
  assert(game.player.skin.id === 'glowing-red', 'the equipped skin is used in game');

  // step() = simulation, render() = canvas + HUD (both run in the rAF loop).
  // The player is shielded during the warm-up so this test is deterministic:
  // with no input it would sometimes crash into a bot within 4 seconds.
  game.player.invulnerable = 1e9;
  for (let i = 0; i < 240; i++) { game.step(1 / 60); }
  game.player.invulnerable = 0;
  for (let i = 0; i < 40; i++) game.render(1 / 60);   // HUD throttles itself internally
  assert(game.world.snakes.length >= 6, 'player + bots in the arena', game.world.snakes.length + '');
  assert($('hud-length').textContent === String(game.player.segments.length), 'HUD length tracks the snake');
  assert(doc.querySelectorAll('#leaderboard-list li').length > 0, 'leaderboard is populated');

  click('btn-pause');
  assert(isActive('screen-pause') && game.state === 'paused', 'pause screen opens');
  click('btn-resume');
  assert(!isActive('screen-pause') && game.state === 'playing', 'resume returns to the game');

  gameOverTests(game);
}

function gameOverTests(game) {
  console.log('\n\u001b[36mGame over + rewarded revive\u001b[0m');
  SR.Storage.reset();
  game.player.score = 500;
  game.player.coins = 4;
  const deathX = game.player.x, deathY = game.player.y;
  game._killSnake(game.player, 'wall', null);

  waitFor('gameover', () => isActive('screen-gameover'), function (timedOut) {
    assert(!timedOut && isActive('screen-gameover'), 'game over screen appears');
    assert($('go-score').textContent === '500', 'final score is displayed', $('go-score').textContent);
    assert(SR.Storage.getBestScore() === 500, 'high score persisted to local storage');
    assert(/wall/i.test($('go-cause').textContent), 'death cause is explained', $('go-cause').textContent);
    assert(!$('btn-revive').classList.contains('is-hidden'), 'revive button is offered');
    assert(Number($('go-coins').textContent) > 0, 'coins earned are shown');
    assert(!$('go-newbest').classList.contains('is-hidden'), '"new best" badge shows on a record run');

    /* --- skipped ad must NOT grant the reward ------------------------- */
    let grantedEarly = null;
    SR.AdManager.showRewarded({
      onReward: () => {},
      onClose: (granted) => { grantedEarly = granted; }
    });
    $('ad-close').classList.remove('is-hidden');       // force the X to be visible
    click('ad-close');
    assert(grantedEarly === false, 'closing the ad early forfeits the reward');
    assert(!isActive('screen-ad'), 'ad overlay closes');
    assert(game.player.alive === false, 'player stays dead after a skipped ad');

    /* --- completed ad revives the player ------------------------------ */
    const realShow = SR.AdManager.showRewarded;
    SR.AdManager.showRewarded = function (o) {          // stand-in for a watched ad
      if (o.onReward) o.onReward();
      if (o.onClose) o.onClose(true);
    };
    game.requestRevive();
    SR.AdManager.showRewarded = realShow;

    assert(game.player.alive, 'revived player is alive');
    assert(game.player.score === 500, 'score is preserved by the revive');
    assert(game.player.coins === 4, 'coins are preserved by the revive');
    assert(game.reviveUsed === true, 'revive is marked as used');
    assert(game.state === 'playing', 'the round continues');
    const moved = Math.hypot(game.player.x - deathX, game.player.y - deathY);
    assert(moved < 800, 'respawned at / next to the death spot', 'moved=' + moved.toFixed(0) + 'u');
    assert(game.player.invulnerable > 0, 'revived player gets a shield');

    /* a second revive is refused */
    const aliveBefore = game.player.alive;
    game.requestRevive();
    assert(game.player.alive === aliveBefore, 'a second revive is blocked');

    finish();
  });
}

function finish() {
  console.log('\n' + '-'.repeat(56));
  if (failures.length || errors.length) {
    if (errors.length) console.log('\u001b[31mRuntime errors:\u001b[0m\n  ' + errors.join('\n  '));
    console.log('\u001b[31mFAILED\u001b[0m ' + failures.length + ' check(s):');
    failures.forEach(f => console.log('  • ' + f));
    console.log('\u001b[32m' + passed + '\u001b[0m passed');
    process.exit(1);
  }
  console.log('\u001b[32mALL ' + passed + ' DOM CHECKS PASSED\u001b[0m');
  process.exit(0);
}
