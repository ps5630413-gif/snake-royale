/* ==========================================================================
 * world.js - The arena: bounds, collectibles, spatial indexes and spawns.
 *
 * The World owns *data* only. Rules about who dies and who scores live in
 * js/game/game.js, rendering lives in js/render/*, so this module can run
 * head-less (see tools/smoke-test.js).
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var Utils = SR.Utils;
  var CONFIG = SR.CONFIG;

  function World(opts) {
    opts = opts || {};
    var W = CONFIG.world;

    this.width = opts.width || W.width;
    this.height = opts.height || W.height;
    this.wrap = !!W.wrap;

    /* --- entities ------------------------------------------------------ */
    this.snakes = [];                 // live + recently dead snakes
    this.foods = [];                  // energy dots
    this.coins = [];                  // golden coins
    this.particles = new SR.ParticleSystem(CONFIG.render.maxParticles);

    /* --- broad phase indexes ------------------------------------------- */
    // food index uses bigger cells (dots are sparse and queried in bulk)
    this.foodHash = new SR.SpatialHash(W.gridSize * 2, this.width, this.height);
    // body index is rebuilt every frame and queried per snake head
    this.snakeHash = new SR.SpatialHash(W.gridSize, this.width, this.height);

    /* --- bookkeeping --------------------------------------------------- */
    this.time = 0;
    this._pendingCoins = [];          // [{ t: seconds }] delayed coin respawns
    this._foodAccum = 0;
    this.onFoodSpawned = null;        // optional hook (fx / tutorial)
  }

  /* ====================================================================== *
   * Bounds
   * ====================================================================== */

  World.prototype.isInside = function (x, y, radius) {
    radius = radius || 0;
    return x >= radius && y >= radius && x <= this.width - radius && y <= this.height - radius;
  };

  World.prototype.clampPoint = function (p, pad) {
    pad = pad || 0;
    p.x = Utils.clamp(p.x, pad, this.width - pad);
    p.y = Utils.clamp(p.y, pad, this.height - pad);
    return p;
  };

  World.prototype.randomPoint = function (pad) {
    pad = pad == null ? 120 : pad;
    return {
      x: Utils.rand(pad, this.width - pad),
      y: Utils.rand(pad, this.height - pad)
    };
  };

  /**
   * Find a spawn position that is not sitting on top of another snake.
   * Falls back to the best candidate found if the arena is crowded.
   */
  World.prototype.findSafeSpawn = function (clearRadius, tries, prefer) {
    clearRadius = clearRadius || CONFIG.game.spawnClearRadius;
    tries = tries || CONFIG.game.safeSpawnTries;

    var clear2 = clearRadius * clearRadius;
    var best = null, bestDist = -1;
    var i, p, nearest;

    /* 1. the preferred point itself, then rings around it.
          This is what lets a rewarded revive happen "in the same spot"
          (or as close to it as the bodies around allow). */
    if (prefer) {
      var rings = [0, 70, 150, 280, 460, 700];
      for (var r = 0; r < rings.length; r++) {
        var spokes = rings[r] === 0 ? 1 : 8;
        for (var k = 0; k < spokes; k++) {
          var a = (k / spokes) * Utils.TAU + r * 0.45;
          p = this.clampPoint({
            x: prefer.x + Math.cos(a) * rings[r],
            y: prefer.y + Math.sin(a) * rings[r]
          }, 120);
          nearest = this._nearestSnakeDist2(p);
          if (nearest > bestDist) { bestDist = nearest; best = p; }
          if (nearest > clear2) return p;
        }
      }
    }

    /* 2. random positions anywhere in the arena */
    for (i = 0; i < tries; i++) {
      p = this.randomPoint(140);
      nearest = this._nearestSnakeDist2(p);
      if (nearest > bestDist) { bestDist = nearest; best = p; }
      if (nearest > clear2) return p;
    }

    return best || this.randomPoint(140);
  };

  /** Squared distance from a point to the closest snake body joint. */
  World.prototype._nearestSnakeDist2 = function (p) {
    var nearest = Infinity;
    for (var s = 0; s < this.snakes.length; s++) {
      var snake = this.snakes[s];
      if (!snake.alive) continue;
      // sample every 3rd joint: plenty accurate and much cheaper
      for (var k = 0; k < snake.segments.length; k += 3) {
        var d = Utils.dist2(p.x, p.y, snake.segments[k].x, snake.segments[k].y);
        if (d < nearest) nearest = d;
      }
    }
    return nearest;
  };

  /* ====================================================================== *
   * Collectibles
   * ====================================================================== */

  World.prototype.addFood = function (food) {
    this.foods.push(food);
    this.foodHash.insert(food);
    return food;
  };

  World.prototype.removeFood = function (food) {
    var i = this.foods.indexOf(food);
    if (i >= 0) this.foods.splice(i, 1);
    this.foodHash.remove(food);
    food.alive = false;
  };

  World.prototype.addCoin = function (coin) {
    this.coins.push(coin);
    return coin;
  };

  World.prototype.removeCoin = function (coin) {
    var i = this.coins.indexOf(coin);
    if (i >= 0) this.coins.splice(i, 1);
    coin.alive = false;
    // schedule a replacement somewhere else on the map
    this._pendingCoins.push({ t: CONFIG.world.coinRespawn });
  };

  /** Scatter `n` energy dots at random free positions. */
  World.prototype.spawnFood = function (n) {
    for (var i = 0; i < n; i++) {
      if (this.foods.length >= CONFIG.world.foodMax) return;
      var p = this.randomPoint(60);
      this.addFood(SR.Food.createEnergy(p.x, p.y));
    }
  };

  World.prototype.spawnCoins = function (n) {
    for (var i = 0; i < n; i++) {
      if (this.coins.length >= CONFIG.world.coinMax) return;
      var p = this.randomPoint(160);
      this.addCoin(SR.Food.createCoin(p.x, p.y));
    }
  };

  /** Fill the arena before the first frame (avoids a slow trickle-in). */
  World.prototype.prefill = function () {
    this.spawnFood(CONFIG.world.foodTarget);
    this.spawnCoins(CONFIG.world.coinTarget);
  };

  /**
   * When a snake dies its body becomes food: this is what makes kills
   * rewarding and creates the "feeding frenzy" moments.
   * @returns {number} number of dots dropped
   */
  World.prototype.explodeSnake = function (snake) {
    var segs = snake.segments;
    var step = Math.max(2, Math.round(3 / Math.max(1, snake.spacing / 8)));
    var dropped = 0;
    var maxDots = CONFIG.game.maxDeathFood || 140;
    var perDot = CONFIG.economy.deathDropValue;

    for (var i = 0; i < segs.length && dropped < maxDots; i += step) {
      var seg = segs[i];
      var x = Utils.clamp(seg.x + Utils.rand(-10, 10), 20, this.width - 20);
      var y = Utils.clamp(seg.y + Utils.rand(-10, 10), 20, this.height - 20);
      var value = perDot + (i === 0 ? 3 : 0);       // the head is the juiciest bit
      this.addFood(SR.Food.createEnergy(x, y, value));
      dropped++;
    }
    return dropped;
  };

  /* ====================================================================== *
   * Snakes
   * ====================================================================== */

  World.prototype.addSnake = function (snake) {
    snake.world = this;
    this.snakes.push(snake);
    return snake;
  };

  World.prototype.removeSnake = function (snake) {
    var i = this.snakes.indexOf(snake);
    if (i >= 0) this.snakes.splice(i, 1);
  };

  World.prototype.getAliveSnakes = function () {
    return this.snakes.filter(function (s) { return s.alive; });
  };

  /**
   * Rebuild the body index. Called once per simulation step before
   * collision tests are run.
   */
  World.prototype.rebuildSnakeHash = function () {
    var hash = this.snakeHash;
    hash.clear();
    for (var s = 0; s < this.snakes.length; s++) {
      var snake = this.snakes[s];
      if (!snake.alive) continue;
      var segs = snake.segments;
      // index 0 is the head: head-to-head collisions are resolved separately
      for (var i = 1; i < segs.length; i++) {
        var seg = segs[i];
        seg.owner = snake;
        seg.index = i;
        hash.insert(seg);
      }
    }
  };

  /**
   * Nearest body joint to a point (excluding `ignore` snake).
   * @returns {{dist:number, snake:Snake, index:number}|null}
   */
  World.prototype.nearestBody = function (x, y, radius, ignore) {
    var found = this.snakeHash.queryCircle(x, y, radius);
    var best = null, bestD2 = Infinity;
    for (var i = 0; i < found.length; i++) {
      var seg = found[i];
      if (!seg.owner || seg.owner === ignore) continue;
      var d2 = Utils.dist2(x, y, seg.x, seg.y);
      if (d2 < bestD2) { bestD2 = d2; best = seg; }
    }
    return best ? { dist: Math.sqrt(bestD2), snake: best.owner, index: best.index } : null;
  };

  /* ====================================================================== *
   * Update
   * ====================================================================== */

  World.prototype.update = function (dt) {
    this.time += dt;

    /* collectible idle animation */
    for (var i = 0; i < this.foods.length; i++) this.foods[i].update(dt);
    for (var c = 0; c < this.coins.length; c++) this.coins[c].update(dt);

    /* particles */
    this.particles.update(dt);

    /* keep the map populated */
    this._maintainFood(dt);
    this._maintainCoins(dt);
  };

  World.prototype._maintainFood = function (dt) {
    var target = CONFIG.world.foodTarget;
    var deficit = target - this.foods.length;
    if (deficit <= 0) return;
    // trickle new dots in (never more than ~20/second) so it stays smooth
    this._foodAccum += dt * Math.min(20, Math.max(4, deficit * 0.5));
    while (this._foodAccum >= 1 && this.foods.length < target) {
      this._foodAccum -= 1;
      var p = this.randomPoint(60);
      this.addFood(SR.Food.createEnergy(p.x, p.y));
      if (this.onFoodSpawned) this.onFoodSpawned();
    }
  };

  World.prototype._maintainCoins = function (dt) {
    for (var i = this._pendingCoins.length - 1; i >= 0; i--) {
      this._pendingCoins[i].t -= dt;
      if (this._pendingCoins[i].t <= 0) {
        this._pendingCoins.splice(i, 1);
        if (this.coins.length < CONFIG.world.coinTarget) {
          var p = this.randomPoint(160);
          this.addCoin(SR.Food.createCoin(p.x, p.y));
        }
      }
    }
  };

  /** Remove every entity (used when starting a fresh round). */
  World.prototype.clear = function () {
    this.snakes.length = 0;
    this.foods.length = 0;
    this.coins.length = 0;
    this._pendingCoins.length = 0;
    this.foodHash.clear();
    this.snakeHash.clear();
    this.particles.clear();
    this.time = 0;
  };

  SR.World = World;

})(typeof window !== 'undefined' ? window : globalThis);
