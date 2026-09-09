#!/usr/bin/env node
/* ==========================================================================
 * smoke-test.js - Head-less test of the *simulation* (no DOM, no canvas).
 *
 *   npm test        (or: node tools/smoke-test.js)
 *
 * It boots the real game modules with tiny stubs for the browser-only parts
 * (canvas, HUD, Screens, Sfx, AdManager) and then plays a full round in
 * fast-forward, asserting that:
 *   - the world populates and keeps itself populated
 *   - snakes move, eat and grow
 *   - collisions kill the right snake (body, wall, head-on)
 *   - dead bots respawn
 *   - the rewarded-revive restores score/position
 *   - coins / skins / high score persist through SR.Storage
 * ========================================================================== */
'use strict';

const path = require('path');
const WWW = path.join(__dirname, '..', 'www');

/* ------------------------------------------------------------------ stubs */
const noop = () => {};
const fakeCanvas = {
  width: 360, height: 640,
  getContext: () => null,
  getBoundingClientRect: () => ({ width: 360, height: 640, left: 0, top: 0 })
};

globalThis.window = globalThis;
globalThis.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop,
  createElement: () => ({ width: 0, height: 0, getContext: () => null, style: {} }),
  hidden: false,
  readyState: 'complete'
};
globalThis.innerWidth = 360;
globalThis.innerHeight = 640;
globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = noop;

/* ---------------------------------------------------------------- modules */
require(path.join(WWW, 'js/core/config.js'));
require(path.join(WWW, 'js/core/utils.js'));
require(path.join(WWW, 'js/core/events.js'));
require(path.join(WWW, 'js/core/storage.js'));
require(path.join(WWW, 'js/data/skins.js'));
require(path.join(WWW, 'js/data/botNames.js'));
require(path.join(WWW, 'js/world/spatialHash.js'));
require(path.join(WWW, 'js/entities/food.js'));
require(path.join(WWW, 'js/entities/snake.js'));
require(path.join(WWW, 'js/entities/particles.js'));
require(path.join(WWW, 'js/world/world.js'));
require(path.join(WWW, 'js/ai/botBrain.js'));
require(path.join(WWW, 'js/render/camera.js'));
require(path.join(WWW, 'js/render/renderer.js'));
require(path.join(WWW, 'js/game/game.js'));

const SR = globalThis.SR;
const CONFIG = SR.CONFIG;
const Utils = SR.Utils;

/* browser-only modules, stubbed for the run */
SR.Hud = { reset: noop, setVisible: noop, update: noop, drawMinimap: noop, updateLeaderboard: noop };
SR.Screens = { show: noop, hideAll: noop, hide: noop, clearStack: noop, toast: noop, current: null };
SR.Sfx = { play: noop, unlock: noop, setEnabled: noop };
SR.AdManager = {
  isShowing: () => false,
  isRewardedReady: () => true,
  showRewarded: (o) => { o.onReward && o.onReward(); o.onClose && o.onClose(true); },
  showInterstitial: (o) => { o.onClose && o.onClose(true); },
  preload: noop
};

/* ------------------------------------------------------------- assertions */
let passed = 0;
const failures = [];

function assert(cond, label, extra) {
  if (cond) { passed++; console.log('  \u001b[32m✓\u001b[0m ' + label); }
  else {
    failures.push(label + (extra ? ' :: ' + extra : ''));
    console.log('  \u001b[31m✗\u001b[0m ' + label + (extra ? ' \u001b[90m' + extra + '\u001b[0m' : ''));
  }
}
function section(name) { console.log('\n\u001b[36m' + name + '\u001b[0m'); }

/* =========================================================================
 * 1. Pure helpers
 * ========================================================================= */
section('Utils & SpatialHash');
{
  assert(Utils.clamp(5, 0, 3) === 3, 'clamp caps the upper bound');
  assert(Math.abs(Utils.angleDelta(0.1, Math.PI * 2 - 0.1) + 0.2) < 1e-6, 'angleDelta wraps the short way');
  assert(Utils.hexToRGB('#ff0000').join() === '255,0,0', 'hexToRGB parses colours');
  assert(Utils.wrap(-1, 10) === 9, 'wrap handles negatives');

  const hash = new SR.SpatialHash(100, 1000, 1000);
  const a = { x: 50, y: 50 }, b = { x: 950, y: 950 }, c = { x: 500, y: 500 };
  hash.insert(a); hash.insert(b); hash.insert(c);
  assert(hash.queryCircle(50, 50, 10).length === 1, 'queryCircle finds a nearby point');
  assert(hash.queryCircle(50, 50, 700).length === 2, 'queryCircle radius is respected');
  hash.remove(a);
  assert(hash.count === 2, 'remove drops the item');
  hash.clear();
  assert(hash.count === 0, 'clear empties the index');
}

/* =========================================================================
 * 2. Storage / progression
 * ========================================================================= */
section('Storage & economy');
{
  SR.Storage.reset();
  assert(SR.Storage.getCoins() === 0, 'fresh profile starts with 0 coins');
  const res = SR.Storage.submitRun({ score: 450, length: 120, coins: 7, kills: 2, foodEaten: 30, revives: 0 });
  assert(res.isNewBest === true, 'first run is a new best');
  assert(SR.Storage.getBestScore() === 450, 'high score is stored');
  // 7 collected + floor(450/25) = 18 bonus
  assert(SR.Storage.getCoins() === 25, 'coins = collected + score bonus', 'got ' + SR.Storage.getCoins());

  const res2 = SR.Storage.submitRun({ score: 100, length: 20, coins: 0 });
  assert(res2.isNewBest === false, 'a worse run is not a new best');
  assert(SR.Storage.getBestScore() === 450, 'best score is not overwritten');

  assert(SR.Storage.isSkinUnlocked('neon-blue') === true, 'default skin is unlocked');
  assert(SR.Storage.isSkinUnlocked('golden-viper') === false, 'paid skin starts locked');
  assert(SR.Storage.spendCoins(1000) === false, 'cannot spend coins you do not have');
  SR.Storage.addCoins(500);
  assert(SR.Storage.spendCoins(400) === true, 'spending works when affordable');
  SR.Storage.unlockSkin('golden-viper');
  SR.Storage.selectSkin('golden-viper');
  assert(SR.Storage.getSelectedSkin() === 'golden-viper', 'skin selection persists');
  assert(SR.SKINS.length >= 3, 'at least 3 skins are defined (spec)', 'count=' + SR.SKINS.length);
  SR.Storage.reset();
}

/* =========================================================================
 * 3. Snake physics
 * ========================================================================= */
section('Snake entity');
{
  const world = new SR.World();
  const snake = new SR.Snake({ world, x: 1000, y: 1000, angle: 0, length: 20 });
  const startX = snake.x;
  for (let i = 0; i < 60; i++) snake.update(1 / 60);
  assert(snake.x > startX + 100, 'snake moves along its heading', 'dx=' + (snake.x - startX).toFixed(1));
  assert(snake.segments.length === 20, 'body keeps its joint count');

  const spacingErr = Math.abs(Utils.dist(snake.segments[4].x, snake.segments[4].y,
    snake.segments[5].x, snake.segments[5].y) - snake.spacing);
  assert(spacingErr < 0.5, 'joints stay spaced correctly', 'err=' + spacingErr.toFixed(3));

  const before = snake.segments.length;
  snake.grow(6);
  assert(snake.segments.length === before + 6, 'grow() adds joints');
  assert(snake.radius > 0 && snake.spacing > 0, 'metrics stay sane after growth');
  const removed = snake.shrink(4);
  assert(removed === 4, 'shrink() removes the requested joints');

  // turning is bounded by the turn rate
  const s2 = new SR.Snake({ world, x: 500, y: 500, angle: 0, length: 10 });
  s2.setTargetAngle(Math.PI);
  s2.update(1 / 60);
  assert(Math.abs(s2.angle) < s2.turnRate / 60 + 1e-6, 'turn rate is limited per step');

  // snapshot / restore (used by the rewarded revive)
  s2.score = 999;
  const snap = s2.snapshot();
  const s3 = new SR.Snake({ world, x: 0, y: 0, length: 5 });
  s3.restore(snap);
  assert(s3.score === 999 && Math.abs(s3.x - s2.x) < 1e-6, 'restore() brings back score & position');
  assert(s3.invulnerable > 0, 'restored snake is briefly protected');
}

/* =========================================================================
 * 4. Full round in fast-forward
 * ========================================================================= */
section('Full round simulation (90s fast-forward)');
let game;
{
  game = new SR.Game({ canvas: fakeCanvas, input: null });
  game.startRun();
  assert(!!game.player && game.player.alive, 'player spawned');
  assert(game.world.snakes.length === CONFIG.game.botCount + 1, 'player + configured bots spawned',
    'got ' + game.world.snakes.length);
  assert(CONFIG.game.botCount >= 5 && CONFIG.game.botCount <= 10, 'bot count is within 5..10 (spec)');
  assert(game.world.foods.length >= CONFIG.world.foodTarget * 0.9, 'arena is filled with energy dots',
    'foods=' + game.world.foods.length);
  assert(game.world.coins.length === CONFIG.world.coinTarget, 'coins spawned', 'coins=' + game.world.coins.length);

  const lengthsSpread = game.world.snakes.filter(s => !s.isPlayer)
    .map(s => s.segments.length);
  const minL = Math.min.apply(null, lengthsSpread);
  const maxL = Math.max.apply(null, lengthsSpread);
  assert(maxL > minL, 'bots have various sizes (spec)', minL + '..' + maxL);

  // keep the player alive artificially (no input) so we observe bot behaviour
  game.player.invulnerable = 1e9;
  const startFood = game.world.snakes.reduce((a, s) => a + s.foodEaten, 0);
  // distance travelled (path length, not displacement: bots legitimately
  // circle around while hunting, so they can end up near where they started)
  const startPositions = game.world.snakes.map(s => ({ s, d: s.distance }));

  const STEP = 1 / 60;
  let deaths = 0;
  SR.Events.on('bot:died', () => { deaths++; });

  for (let i = 0; i < 90 * 60; i++) game.step(STEP);

  const moved = startPositions.filter(o => o.s.alive)
    .every(o => (o.s.distance - o.d) > 2000);
  assert(moved, 'every surviving snake travelled (AI is navigating)');

  const totalEaten = game.world.snakes.reduce((a, s) => a + s.foodEaten, 0);
  assert(totalEaten > startFood + 50, 'snakes actively seek and eat food', 'eaten=' + totalEaten);

  const alive = game.world.getAliveSnakes().length;
  assert(alive >= CONFIG.game.minBots, 'dead bots are replaced (roster stays full)', 'alive=' + alive);
  assert(deaths > 0, 'bots crash into each other / walls (permadeath works)', 'deaths=' + deaths);

  const outOfBounds = game.world.getAliveSnakes().filter(s => !game.world.isInside(s.x, s.y, -1));
  assert(outOfBounds.length === 0, 'no living snake escapes the arena');

  assert(game.world.foods.length > CONFIG.world.foodTarget * 0.5, 'food population is maintained',
    'foods=' + game.world.foods.length);
}

/* =========================================================================
 * 5. Collision rules
 * ========================================================================= */
section('Permadeath rules');
{
  const g = new SR.Game({ canvas: fakeCanvas, input: null });
  g.startRun();

  /* --- wall --- */
  const victim = g.spawnBot({ length: 20 });
  victim.invulnerable = 0;                 // past the spawn shield
  victim.x = 5; victim.y = 500;
  g.world.rebuildSnakeHash();
  g._checkWalls();
  assert(!victim.alive && victim.deathCause === 'wall', 'hitting the wall is fatal');

  /* --- another snake's body --- */
  const g2 = new SR.Game({ canvas: fakeCanvas, input: null });
  g2.startRun();
  const a = g2.spawnBot({ length: 40, x: 2000, y: 2000 });
  const b = g2.spawnBot({ length: 20, x: 2000, y: 2200 });
  a.angle = 0; a.targetAngle = 0;
  b.angle = 0; b.targetAngle = 0;
  // drop b's head right on top of a's body
  for (let i = 0; i < 6; i++) { a.update(1 / 60); }
  b.x = a.segments[8].x; b.y = a.segments[8].y;
  b.invulnerable = 0;
  a.invulnerable = 0;
  g2.world.rebuildSnakeHash();
  g2._checkBodies();
  assert(!b.alive && b.deathCause === 'snake', 'touching another body is fatal', 'cause=' + b.deathCause);
  assert(b.killedBy === a, 'the kill is attributed to the body owner');
  assert(a.alive, 'the snake that was hit survives');

  /* --- head on --- */
  const g3 = new SR.Game({ canvas: fakeCanvas, input: null });
  g3.startRun();
  const big = g3.spawnBot({ length: 60, x: 1500, y: 1500 });
  const small = g3.spawnBot({ length: 15, x: 1502, y: 1500 });
  big.invulnerable = 0; small.invulnerable = 0;
  g3._checkHeadOn();
  assert(!small.alive && big.alive, 'in a head-on crash the smaller snake dies');

  /* --- death drops food --- */
  const before = g3.world.foods.length;
  const doomed = g3.spawnBot({ length: 80, x: 900, y: 900 });
  g3._killSnake(doomed, 'snake', null);
  assert(g3.world.foods.length > before + 10, 'a dying snake explodes into collectible dots',
    '+' + (g3.world.foods.length - before));
}

/* =========================================================================
 * 6. Eating & coins
 * ========================================================================= */
section('Pickups');
{
  const g = new SR.Game({ canvas: fakeCanvas, input: null });
  g.startRun();
  const p = g.player;

  // remove any collectible that randomly spawned on top of the player,
  // otherwise it would be eaten in the same tick and skew the numbers
  const clearNear = (list, remover) => {
    for (let i = list.length - 1; i >= 0; i--) {
      if (Utils.dist(p.x, p.y, list[i].x, list[i].y) < 120) remover(list[i]);
    }
  };
  clearNear(g.world.foods, (f) => g.world.removeFood(f));
  clearNear(g.world.coins, (c) => g.world.removeCoin(c));

  const lenBefore = p.segments.length;
  const scoreBefore = p.score;

  g.world.addFood(SR.Food.createEnergy(p.x, p.y, 3));
  g._checkPickups();
  assert(p.segments.length === lenBefore + 3 * CONFIG.snake.growthPerMass, 'eating grows the snake');
  assert(p.score === scoreBefore + 3 * CONFIG.game.scorePerMass, 'eating raises the score');

  const coinsBefore = p.coins;
  g.world.addCoin(SR.Food.createCoin(p.x, p.y, 2));
  g._checkPickups();
  assert(p.coins === coinsBefore + 2, 'coins are collected');

  const coinCount = g.world.coins.length;
  assert(coinCount >= CONFIG.world.coinTarget - 1, 'coin population is restored after pickup');
}

/* =========================================================================
 * 7. Rewarded revive
 * ========================================================================= */
section('Rewarded revive (AdMob flow)');
{
  const g = new SR.Game({ canvas: fakeCanvas, input: null });
  g.startRun();
  const p = g.player;
  p.score = 1234;
  p.coins = 9;
  const deathX = p.x, deathY = p.y;

  g._killSnake(p, 'snake', g.world.snakes[1]);
  assert(g.state === SR.Game.STATE.GAMEOVER, 'death ends the round');
  assert(g.reviveUsed === false, 'revive is available once per run');

  g.requestRevive();                       // stubbed ad grants instantly
  assert(g.reviveUsed === true, 'revive can only be used once');
  assert(g.player.alive, 'player is alive again');
  assert(g.player.score === 1234, 'score is preserved');
  assert(g.player.coins === 9, 'coins are preserved');
  assert(g.state === SR.Game.STATE.PLAYING, 'round continues after the revive');

  const moved = Utils.dist(g.world.snakes.length ? g.player.x : 0, 0, deathX, deathY);
  assert(Utils.dist(g.player.x, g.player.y, deathX, deathY) < 700,
    'respawn happens at (or very near) the death spot', 'moved=' + moved.toFixed(0));
  assert(g.player.invulnerable > 0, 'revived player gets a shield');

  // second revive attempt must be refused
  const before = g.player.alive;
  g.requestRevive();
  assert(before === g.player.alive, 'a second revive is blocked');
}

/* =========================================================================
 * 8. Ads (simulator contract)
 * ========================================================================= */
section('AdManager contract');
{
  const calls = [];
  SR.AdManager.showRewarded = (o) => {
    calls.push('rewarded');
    if (o.onReward) o.onReward();
    if (o.onClose) o.onClose(true);
  };
  SR.AdManager.showInterstitial = (o) => { calls.push('interstitial'); if (o.onClose) o.onClose(true); };

  const g = new SR.Game({ canvas: fakeCanvas, input: null });
  g.startRun();
  g.player.score = 10;
  g._killSnake(g.player, 'wall', null);
  g.requestRevive();
  assert(calls.indexOf('rewarded') >= 0, 'revive requests a rewarded ad');

  g.playAgain();
  assert(calls.indexOf('interstitial') >= 0, 'a new round plays an interstitial first');
  assert(g.state === SR.Game.STATE.PLAYING, 'the new round actually starts');
}

/* =========================================================================
 * 9. Performance sanity
 * ========================================================================= */
section('Performance');
{
  const g = new SR.Game({ canvas: fakeCanvas, input: null });
  g.startRun();
  g.player.invulnerable = 1e9;
  // grow the roster so we measure a worst case frame
  for (let i = 0; i < 4; i++) g.spawnBot({ length: 120 });

  const t0 = Date.now();
  const steps = 600;                       // 10 seconds of gameplay
  for (let i = 0; i < steps; i++) g.step(1 / 60);
  const ms = Date.now() - t0;
  const perStep = ms / steps;
  console.log('  \u001b[90m' + g.world.snakes.length + ' snakes, ' +
    g.world.snakes.reduce((a, s) => a + s.segments.length, 0) + ' joints -> ' +
    perStep.toFixed(3) + ' ms per simulation step\u001b[0m');
  assert(perStep < 4, 'simulation step is fast enough for 60fps (budget 16ms)', perStep.toFixed(2) + 'ms');
}

/* =========================================================================
 * Report
 * ========================================================================= */
console.log('\n' + '-'.repeat(56));
if (failures.length) {
  console.log('\u001b[31mFAILED\u001b[0m ' + failures.length + ' check(s):');
  failures.forEach(f => console.log('  • ' + f));
  console.log('\u001b[32m' + passed + '\u001b[0m passed');
  process.exit(1);
} else {
  console.log('\u001b[32mALL ' + passed + ' CHECKS PASSED\u001b[0m');
  process.exit(0);
}
