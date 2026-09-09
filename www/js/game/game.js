/* ==========================================================================
 * game.js - The conductor: state machine, rules, collisions, round flow.
 *
 * States:  idle -> playing <-> paused -> gameover -> (revive | new round)
 *
 * The simulation runs on a FIXED time step (CONFIG.game.fixedStep) so the
 * physics and the AI behave identically on a 60Hz and a 120Hz display, while
 * rendering happens once per animation frame.
 *
 * This module talks to the UI only through SR.Screens / SR.Hud / SR.Sfx /
 * SR.AdManager, which keeps it unit-testable in Node (see tools/smoke-test.js).
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var Utils = SR.Utils;
  var CONFIG = SR.CONFIG;

  var STATE = {
    IDLE: 'idle',
    PLAYING: 'playing',
    PAUSED: 'paused',
    GAMEOVER: 'gameover'
  };

  /**
   * @param {object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {SR.InputManager}   opts.input
   */
  function Game(opts) {
    opts = opts || {};

    this.canvas = opts.canvas;
    this.input = opts.input || null;

    this.camera = new SR.Camera();
    this.renderer = new SR.Renderer(this.canvas, this.camera);
    this.world = null;
    this.player = null;

    this.state = STATE.IDLE;
    this.elapsed = 0;               // seconds of *simulated* time this round
    this._accum = 0;
    this._lastTs = 0;
    this._raf = null;
    this._loop = this._loop.bind(this);

    this.reviveUsed = false;
    this._deathSnapshot = null;
    this._respawnQueue = [];        // [{ t: seconds, isBot:true }]
    this._boostDrainAcc = 0;
    this._botNames = [];

    this.run = this._emptyRun();

    /* let other modules react to the round flow */
    this.events = SR.Events;
  }

  Game.STATE = STATE;

  Game.prototype._emptyRun = function () {
    return { score: 0, length: 0, coins: 0, kills: 0, foodEaten: 0, revives: 0, time: 0 };
  };

  /* ====================================================================== *
   * Round lifecycle
   * ====================================================================== */

  /** Build a fresh arena and drop the player in it. */
  Game.prototype.startRun = function () {
    var self = this;

    this.world = new SR.World();
    this.world.prefill();

    this.elapsed = 0;
    this._accum = 0;
    this._respawnQueue.length = 0;
    this._boostDrainAcc = 0;
    this.reviveUsed = false;
    this._deathSnapshot = null;
    this.run = this._emptyRun();
    this._botNames = [];

    /* --- player --------------------------------------------------------- */
    var skin = SR.getSkin(SR.Storage.getSelectedSkin());
    var spawn = this.world.findSafeSpawn(CONFIG.game.spawnClearRadius);
    var player = new SR.Snake({
      world: this.world,
      x: spawn.x,
      y: spawn.y,
      angle: Utils.randAngle(),
      length: CONFIG.game.startLength,
      isPlayer: true,
      name: 'YOU',
      skin: skin
    });
    this.world.addSnake(player);
    this.player = player;

    /* --- bots ----------------------------------------------------------- */
    var count = Utils.clamp(CONFIG.game.botCount, CONFIG.game.minBots, CONFIG.game.maxBots);
    for (var i = 0; i < count; i++) this.spawnBot();

    /* --- camera & UI ---------------------------------------------------- */
    this.camera.targetZoom = CONFIG.camera.baseZoom;
    this.camera.zoom = CONFIG.camera.baseZoom;
    this.camera.snapTo(player.x, player.y);
    this.camera.shake = 0;

    SR.Hud.reset();
    SR.Hud.setVisible(true);
    if (this.input) {
      // enable first: the joystick must be visible to be measured correctly
      this.input.setEnabled(true);
      this.input.setMode(SR.Storage.getSettings().controls || CONFIG.input.mode);
    }
    SR.Screens.hideAll();
    SR.Screens.clearStack();
    SR.Sfx.play('start');

    this.state = STATE.PLAYING;
    this.events.emit('game:start');
    this.start();
    return this;
  };

  /**
   * Spawn an AI snake away from the player.
   * @param {object} [opts] { length, x, y }
   */
  Game.prototype.spawnBot = function (opts) {
    opts = opts || {};
    var world = this.world;
    if (!world) return null;

    // bots get slightly bigger as the round goes on: the arena gets meaner
    if (opts.length == null) {
      var ramp = Math.min(1, this.elapsed / 180);
      opts.length = Math.round(Utils.rand(
        CONFIG.game.botStartLengthMin + ramp * 18,
        CONFIG.game.botStartLengthMax + ramp * 40
      ));
    }

    var name = SR.pickBotName(this._botNames);
    this._botNames.push(name);

    var pos = (opts.x != null)
      ? { x: opts.x, y: opts.y }
      : world.findSafeSpawn(CONFIG.game.spawnClearRadius, 24, null);

    // bots wear random skins so the arena looks varied
    var skin = SR.SKINS[Utils.randInt(0, SR.SKINS.length - 1)];
    var personality = SR.pickPersonality();

    var bot = new SR.Snake({
      world: world,
      x: pos.x,
      y: pos.y,
      angle: Utils.randAngle(),
      length: opts.length,
      isBot: true,
      name: name,
      skin: skin,
      personality: personality
    });
    bot.brain = new SR.BotBrain(bot, personality);
    world.addSnake(bot);
    return bot;
  };

  /* ====================================================================== *
   * Main loop
   * ====================================================================== */

  Game.prototype.start = function () {
    if (this._raf != null) return;
    this._lastTs = 0;
    this._raf = global.requestAnimationFrame(this._loop);
  };

  Game.prototype.stop = function () {
    if (this._raf != null) {
      global.cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  };

  Game.prototype._loop = function (ts) {
    this._raf = global.requestAnimationFrame(this._loop);

    if (!this._lastTs) this._lastTs = ts;
    var dt = (ts - this._lastTs) / 1000;
    this._lastTs = ts;
    if (dt > CONFIG.game.maxFrameTime) dt = CONFIG.game.maxFrameTime;
    if (dt < 0) dt = 0;

    /* --- simulate ------------------------------------------------------- */
    if (this.state === STATE.PLAYING && !SR.AdManager.isShowing()) {
      this._accum += dt;
      var step = CONFIG.game.fixedStep;
      var guard = 0;
      while (this._accum >= step && guard < 6) {
        this.step(step);
        this._accum -= step;
        guard++;
      }
      if (guard >= 6) this._accum = 0;         // we fell behind: drop the debt
    }

    /* --- render ---------------------------------------------------------- */
    this.render(dt);
  };

  /** One fixed simulation step. */
  Game.prototype.step = function (dt) {
    var world = this.world;
    if (!world) return;

    this.elapsed += dt;
    this.run.time = this.elapsed;

    /* 1. index every body joint for collision queries */
    world.rebuildSnakeHash();

    /* 2. player input */
    this._applyPlayerInput();

    /* 3. AI */
    var ctx = { player: this.player };
    for (var i = 0; i < world.snakes.length; i++) {
      var s = world.snakes[i];
      if (s.brain && s.alive) s.brain.update(dt, world, ctx);
    }

    /* 4. movement */
    for (var j = 0; j < world.snakes.length; j++) {
      var snake = world.snakes[j];
      if (!snake.alive) continue;
      snake.update(dt);
      this._applyBoostDrain(snake, dt);
    }

    /* 5. rules */
    this._checkWalls();
    this._checkBodies();
    this._checkHeadOn();
    this._checkPickups();

    /* 6. world bookkeeping */
    world.update(dt);
    this._tickRespawns(dt);
  };

  /* ====================================================================== *
   * Input
   * ====================================================================== */
  Game.prototype._applyPlayerInput = function () {
    var p = this.player;
    if (!p || !p.alive || !this.input) return;

    var v = this.input.getVector();
    if (v.active) p.setDirection(v.x, v.y);

    var canBoost = p.segments.length > CONFIG.snake.minBoostLength;
    var wantBoost = this.input.isBoosting() && canBoost;
    if (wantBoost && !p.boosting) SR.Sfx.play('boost');
    p.boosting = wantBoost;
  };

  /** Boosting burns mass - and leaves a trail of food behind you. */
  Game.prototype._applyBoostDrain = function (snake, dt) {
    if (!snake.boosting || !snake.alive) return;
    if (snake.segments.length <= CONFIG.snake.minBoostLength) { snake.boosting = false; return; }

    var drain = CONFIG.snake.boostDrain * dt;
    snake._drainAcc = (snake._drainAcc || 0) + drain;

    while (snake._drainAcc >= 1) {
      snake._drainAcc -= 1;
      var removed = snake.shrink(1);
      if (!removed) { snake.boosting = false; break; }
      // leave a dot behind: boosting is a real cost
      var tail = snake.segments[snake.segments.length - 1];
      if (tail && Math.random() < 0.5) {
        this.world.addFood(SR.Food.createEnergy(
          Utils.clamp(tail.x + Utils.rand(-8, 8), 20, this.world.width - 20),
          Utils.clamp(tail.y + Utils.rand(-8, 8), 20, this.world.height - 20),
          1
        ));
      }
    }

    snake.boostTrail += dt;
    if (SR.CONFIG.render.particles && snake.boostTrail > 0.035) {
      snake.boostTrail = 0;
      this.world.particles.boostPuff(snake.x, snake.y, snake.skin.glow);
    }
  };

  /* ====================================================================== *
   * Rules
   * ====================================================================== */

  /** Walls are lethal (unless the arena is configured to wrap). */
  Game.prototype._checkWalls = function () {
    var world = this.world;
    if (world.wrap) return;
    var snakes = world.snakes;
    var r;

    for (var i = 0; i < snakes.length; i++) {
      var s = snakes[i];
      if (!s.alive) continue;
      if (world.isInside(s.x, s.y, s.radius * 0.5)) continue;

      /* A shielded snake (just spawned / just revived) is pushed back inside
         and turned towards the middle instead of dying on the spot. */
      if (s.invulnerable > 0) {
        r = s.radius * 0.5 + 1;
        s.x = Utils.clamp(s.x, r, world.width - r);
        s.y = Utils.clamp(s.y, r, world.height - r);
        s.segments[0].x = s.x;
        s.segments[0].y = s.y;
        s.angle = s.targetAngle = Math.atan2(world.height / 2 - s.y, world.width / 2 - s.x);
        continue;
      }
      this._killSnake(s, 'wall', null);
    }
  };

  /** Head vs. any other snake's body. */
  Game.prototype._checkBodies = function () {
    var world = this.world;
    var snakes = world.snakes;

    for (var i = 0; i < snakes.length; i++) {
      var s = snakes[i];
      if (!s.alive || s.invulnerable > 0) continue;

      var hitR = s.radius + CONFIG.snake.maxRadius + 10;
      var found = world.snakeHash.queryCircle(s.x, s.y, hitR);

      for (var k = 0; k < found.length; k++) {
        var seg = found[k];
        var other = seg.owner;
        if (!other || other === s || !other.alive) continue;
        // NOTE: a shielded snake cannot be killed, but its body is still
        // lethal to everyone else - otherwise a freshly revived player
        // would feel like a ghost.

        var segR = other.radiusAt(seg.index);
        var threshold = s.radius * 0.72 + segR * 0.82;
        var d = Utils.dist(s.x, s.y, seg.x, seg.y);
        if (d < threshold) {
          this._killSnake(s, 'snake', other);
          break;
        }
      }
    }
  };

  /** Head vs head: the smaller snake dies (both die if evenly matched). */
  Game.prototype._checkHeadOn = function () {
    var snakes = this.world.snakes;
    for (var i = 0; i < snakes.length; i++) {
      var a = snakes[i];
      if (!a.alive || a.invulnerable > 0) continue;
      for (var j = i + 1; j < snakes.length; j++) {
        var b = snakes[j];
        if (!b.alive || b.invulnerable > 0) continue;

        var d = Utils.dist(a.x, a.y, b.x, b.y);
        var contact = (a.radius + b.radius) * 0.66;
        if (d > contact) continue;

        var la = a.segments.length, lb = b.segments.length;
        if (la > lb * 1.1) this._killSnake(b, 'head', a);
        else if (lb > la * 1.1) this._killSnake(a, 'head', b);
        else {
          this._killSnake(a, 'head', b);
          this._killSnake(b, 'head', a);
        }
      }
    }
  };

  /** Eating energy dots and coins. */
  Game.prototype._checkPickups = function () {
    var world = this.world;
    var snakes = world.snakes;
    var S = CONFIG.snake;
    var G = CONFIG.game;

    for (var i = 0; i < snakes.length; i++) {
      var s = snakes[i];
      if (!s.alive) continue;

      /* --- energy dots ------------------------------------------------- */
      var reach = s.radius + 18;   // forgiving bite radius: eating should feel good
      var found = world.foodHash.queryCircle(s.x, s.y, reach);
      for (var f = 0; f < found.length; f++) {
        var food = found[f];
        if (!food.alive) continue;
        var d = Utils.dist(s.x, s.y, food.x, food.y);
        if (d > reach + food.radius) continue;

        world.removeFood(food);
        s.grow(food.value * S.growthPerMass);
        s.foodEaten++;
        if (s.isPlayer) {
          s.score += food.value * G.scorePerMass;
          this.run.foodEaten++;
          SR.Sfx.play('eat');
        }
        if (SR.CONFIG.render.particles) {
          world.particles.eatEffect(food.x, food.y, SR.Food.colorFor(food));
        }
      }

      /* --- coins (few enough to scan linearly) --------------------------- */
      for (var c = world.coins.length - 1; c >= 0; c--) {
        var coin = world.coins[c];
        if (!coin.alive) continue;
        var cd = Utils.dist(s.x, s.y, coin.x, coin.y);
        if (cd > reach + coin.radius + 6) continue;

        world.removeCoin(coin);
        s.coins += coin.value;
        if (s.isPlayer) {
          this.run.coins += coin.value;
          SR.Sfx.play('coin');
          SR.Events.emit('player:coin', coin.value);
        }
        if (SR.CONFIG.render.particles) world.particles.coinEffect(coin.x, coin.y);
      }
    }
  };

  /* ====================================================================== *
   * Death
   * ====================================================================== */

  /**
   * @param {Snake} snake
   * @param {string} cause 'wall' | 'snake' | 'head'
   * @param {Snake|null} killer the snake that owns the body we hit
   */
  Game.prototype._killSnake = function (snake, cause, killer) {
    if (!snake.alive) return;

    // remember exactly where the player died so a revive can restore it
    if (snake.isPlayer) this._deathSnapshot = snake.snapshot();

    var wasPlayer = snake.isPlayer;
    var name = snake.name;

    snake.die(cause, killer);
    this.world.explodeSnake(snake);

    if (SR.CONFIG.render.particles) {
      this.world.particles.explosion(snake.x, snake.y, snake.skin.glow, Math.min(3, snake.segments.length / 45));
    }

    /* the player gets credit (and a bonus) for every snake that crashes
       into its body */
    if (killer && killer.isPlayer && killer !== snake) {
      killer.score += CONFIG.game.killBonus;
      killer.kills++;
      this.run.kills++;
      SR.Sfx.play('kill');
      SR.Screens.toast('Eliminated ' + name + '! +' + CONFIG.game.killBonus);
      this.camera.addShake(0.25);
    }

    this.world.removeSnake(snake);

    if (wasPlayer) {
      this.camera.addShake(1.0);
      SR.Sfx.play('die');
      this._gameOver(cause, killer);
    } else {
      this._respawnQueue.push({ t: CONFIG.game.botRespawnDelay });
      if (killer && killer.isPlayer) this.camera.addShake(0.15);
      SR.Events.emit('bot:died', { name: name, cause: cause });
    }
  };

  Game.prototype._tickRespawns = function (dt) {
    for (var i = this._respawnQueue.length - 1; i >= 0; i--) {
      this._respawnQueue[i].t -= dt;
      if (this._respawnQueue[i].t <= 0) {
        this._respawnQueue.splice(i, 1);
        var alive = this.world.getAliveSnakes().length;
        var max = CONFIG.game.maxBots + 1;      // + the player
        if (alive < max) this.spawnBot();
      }
    }
  };

  /* ====================================================================== *
   * Game over / revive / interstitial
   * ====================================================================== */

  Game.prototype._gameOver = function (cause, killer) {
    this.state = STATE.GAMEOVER;

    var p = this.player;
    this.run.score = Math.floor(p.score);
    this.run.length = p.segments.length;
    this.run.coins = p.coins;

    if (this.input) this.input.setEnabled(false);
    SR.Hud.setVisible(false);

    /* persist progress */
    var result = SR.Storage.submitRun({
      score: this.run.score,
      length: this.run.length,
      coins: this.run.coins,
      kills: this.run.kills,
      foodEaten: this.run.foodEaten,
      revives: this.run.revives
    });

    /* fill the game-over panel */
    var causeText = 'You died';
    if (cause === 'wall') causeText = 'You hit the arena wall';
    else if (killer) causeText = 'You crashed into ' + killer.name;

    setText('go-cause', causeText);
    setText('go-score', Utils.formatNumber(this.run.score));
    setText('go-best', Utils.formatNumber(result.best));
    setText('go-length', Utils.formatNumber(this.run.length));
    setText('go-kills', Utils.formatNumber(this.run.kills));
    setText('go-coins', Utils.formatNumber(result.coinsEarned));
    var badge = document.getElementById('go-newbest');
    if (badge) badge.classList.toggle('is-hidden', !result.isNewBest);

    /* revive button: one per run, and only if ads are enabled */
    var reviveBtn = document.getElementById('btn-revive');
    if (reviveBtn) {
      var adsOff = !CONFIG.ads.enabled;
      var canRevive = !this.reviveUsed && SR.AdManager.isRewardedReady();
      // hide it entirely once used (or when ads are switched off)
      reviveBtn.classList.toggle('is-hidden', this.reviveUsed || adsOff);
      reviveBtn.classList.toggle('is-disabled', !canRevive);
      var sub = reviveBtn.querySelector('.btn__sub');
      if (sub) {
        sub.textContent = this.reviveUsed
          ? 'already used this run'
          : (canRevive ? '1 free continue per run' : 'ad not ready - try in a moment');
      }
    }

    var self = this;
    global.setTimeout(function () {
      SR.Screens.show('gameover', false);
      // preload the next interstitial while the player reads the results
      SR.AdManager.preload();
    }, 700);

    SR.Events.emit('game:over', { run: this.run, result: result });

    function setText(id, value) {
      var el = document.getElementById(id);
      if (el) el.textContent = value;
    }
  };

  /**
   * Called by the "Revive" button: show a rewarded ad and, if it completes,
   * put the player back exactly where they died.
   */
  Game.prototype.requestRevive = function () {
    var self = this;
    if (this.reviveUsed) {
      SR.Screens.toast('Revive already used this run');
      return;
    }
    if (!this._deathSnapshot) {
      SR.Screens.toast('Nothing to revive');
      return;
    }

    SR.Screens.hideAll();     // hide the game-over panel while the ad plays

    SR.AdManager.showRewarded({
      onReward: function () { self.revivePlayer(); },
      onClose: function (granted) {
        if (!granted) {
          // closed early: no reward, show the results again
          SR.Screens.show('gameover', false);
          SR.Screens.toast('Ad skipped - no revive');
        }
      },
      onFail: function (reason) {
        SR.Screens.show('gameover', false);
        SR.Screens.toast('Ad unavailable (' + reason + ')');
      }
    });
  };

  /** Restore the player from the death snapshot (score & coins preserved). */
  Game.prototype.revivePlayer = function () {
    var snap = this._deathSnapshot;
    if (!snap || !this.world) return false;

    var skin = SR.getSkin(SR.Storage.getSelectedSkin());
    var revived = new SR.Snake({
      world: this.world,
      x: snap.x, y: snap.y, angle: snap.angle,
      length: Math.max(CONFIG.game.startLength, snap.length),
      isPlayer: true, name: 'YOU', skin: skin
    });
    revived.restore(snap);

    /* move the whole body to the death spot (or the closest safe point) */
    var safe = this.world.findSafeSpawn(360, 30, { x: snap.x, y: snap.y });
    var dx = safe.x - revived.x;
    var dy = safe.y - revived.y;
    for (var i = 0; i < revived.segments.length; i++) {
      revived.segments[i].x += dx;
      revived.segments[i].y += dy;
      // keep the body inside the arena
      repaired(revived.segments[i], this.world, revived.radius);
    }
    revived.x += dx; revived.y += dy;
    repaired(revived, this.world, revived.radius);

    this.world.addSnake(revived);
    this.player = revived;

    this.reviveUsed = true;
    this.run.revives += 1;
    this.state = STATE.PLAYING;

    this.camera.snapTo(revived.x, revived.y);
    SR.Hud.reset();
    SR.Hud.setVisible(true);
    if (this.input) this.input.setEnabled(true);
    SR.Screens.hideAll();
    SR.Sfx.play('revive');
    SR.Screens.toast('Revived! 3s of shield');

    SR.Events.emit('game:revive', { score: revived.score });
    return true;

    function repaired(obj, world, r) {
      obj.x = Utils.clamp(obj.x, r, world.width - r);
      obj.y = Utils.clamp(obj.y, r, world.height - r);
    }
  };

  /** "Play again": interstitials slot in between rounds. */
  Game.prototype.playAgain = function () {
    var self = this;
    this.stop();
    SR.AdManager.showInterstitial({
      onClose: function () { self.startRun(); }
    });
  };

  /** Quit to the main menu (an interstitial may show first). */
  Game.prototype.quitToMenu = function () {
    var self = this;
    this.stop();
    this.state = STATE.IDLE;
    SR.Hud.setVisible(false);
    if (this.input) this.input.setEnabled(false);

    SR.AdManager.showInterstitial({
      onClose: function () {
        SR.Screens.show('menu', false);
        self.refreshMenu();
      }
    });
  };

  /** Refresh the main-menu counters (best score, coins). */
  Game.prototype.refreshMenu = function () {
    var best = document.getElementById('menu-best');
    var coins = document.getElementById('menu-coins');
    if (best) best.textContent = Utils.formatNumber(SR.Storage.getBestScore());
    if (coins) coins.textContent = Utils.formatNumber(SR.Storage.getCoins());
  };

  /* ====================================================================== *
   * Pause / resume
   * ====================================================================== */

  Game.prototype.pause = function () {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    if (this.input) this.input.setEnabled(false);
    SR.Screens.show('pause', false);
    SR.Events.emit('game:pause');
  };

  Game.prototype.resume = function () {
    if (this.state !== STATE.PAUSED) return;
    SR.Screens.hideAll();
    if (this.input) this.input.setEnabled(true);
    this.state = STATE.PLAYING;
    this._lastTs = 0;
    this._accum = 0;
    SR.Events.emit('game:resume');
  };

  /* ====================================================================== *
   * Rendering
   * ====================================================================== */

  Game.prototype.render = function (dt) {
    if (!this.world) return;

    var followTarget = (this.player && this.player.alive)
      ? this.player
      : this._lastCameraTarget || null;

    if (followTarget) this._lastCameraTarget = followTarget;
    if (followTarget) this.camera.follow(followTarget, dt);

    this.renderer.render(this.world, this, dt);

    if (this.state === STATE.PLAYING || this.state === STATE.PAUSED) {
      SR.Hud.update(this, dt);
    }
  };

  Game.prototype.resize = function () {
    this.renderer.resize();
  };

  Game.prototype.isPlaying = function () { return this.state === STATE.PLAYING; };

  SR.Game = Game;

})(typeof window !== 'undefined' ? window : globalThis);
