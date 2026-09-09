/* ==========================================================================
 * botBrain.js - Artificial intelligence for the enemy snakes.
 *
 * HOW IT WORKS
 * ------------
 * Every brain runs a small sense -> think -> act cycle:
 *
 *   1. SENSE   (every frame)  - a short "whisker" ray in front of the head.
 *                               If it is about to hit a body or a wall the
 *                               bot performs an emergency evasive turn, so
 *                               it reacts instantly instead of waiting for
 *                               the next think tick.
 *   2. THINK   (5 - 20 Hz)    - pick a behaviour (GRAZE / HUNT / TRAP / FLEE)
 *                               and score ~11 candidate headings by casting
 *                               sample points forward:
 *                                 cost = wallDanger + bodyDanger
 *                                        + misalignment
 *                                        - foodValue - preyValue
 *                               The cheapest candidate wins.
 *   3. ACT                    - steer towards the winning heading and decide
 *                               whether to spend mass on a boost.
 *
 * The scoring approach (instead of hand written if/else steering) makes the
 * bots behave believably in crowded situations without any path finding.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var Utils = SR.Utils;
  var CONFIG = SR.CONFIG;

  /* Candidate headings, from "hard left" to "hard right". */
  var FAN = [-1.30, -0.95, -0.65, -0.40, -0.20, -0.08, 0, 0.08, 0.20, 0.40, 0.65, 0.95, 1.30];
  /* Panic fan used when the whisker hits something. */
  var FAN_PANIC = [-2.2, -1.55, -1.0, -0.5, 0.5, 1.0, 1.55, 2.2];

  var MODES = { GRAZE: 'graze', HUNT: 'hunt', TRAP: 'trap', FLEE: 'flee' };

  /**
   * @param {Snake} snake
   * @param {object} personality see js/data/botNames.js
   */
  function BotBrain(snake, personality) {
    this.snake = snake;
    this.p = personality || SR.pickPersonality();
    this.mode = MODES.GRAZE;

    var skill = Utils.clamp(this.p.skill, 0, 1);
    this.thinkInterval = Utils.lerp(0.20, 0.055, skill);   // better bots think faster
    this.senseRange = Utils.lerp(420, 900, skill);         // food detection radius
    this.lookAhead = Utils.lerp(1.9, 3.4, skill);          // how far ahead they plan
    this.noise = Utils.lerp(0.28, 0.04, skill);            // steering sloppiness

    this.thinkTimer = Math.random() * this.thinkInterval;  // desynchronise bots
    this.wander = snake.angle;
    this.wanderTimer = 0;
    this.targetFood = null;
    this.panic = 0;
    this.boostCooldown = 0;
    this.jitter = Utils.rand(0, 100);
  }

  BotBrain.MODES = MODES;

  /* ====================================================================== *
   * Main entry point - called once per simulation step
   * ====================================================================== */
  BotBrain.prototype.update = function (dt, world, ctx) {
    var snake = this.snake;
    if (!snake.alive) return;

    this.thinkTimer -= dt;
    this.wanderTimer -= dt;
    this.boostCooldown -= dt;
    if (this.panic > 0) this.panic -= dt;

    /* ---- 1. reflex: whisker check (cheap, every frame) ---------------- */
    var danger = this._whisker(world);
    if (danger) {
      this.panic = 0.25;
      this._emergencyTurn(world, danger);
    }

    /* ---- 2. deliberate decision --------------------------------------- */
    if (this.thinkTimer <= 0) {
      this.thinkTimer = this.thinkInterval * Utils.rand(0.85, 1.15);
      this._think(world, ctx);
    }

    /* ---- 3. smooth the heading ---------------------------------------- */
    // tiny sinusoidal wobble so bots never look like robots on rails
    this.jitter += dt;
    var wobble = Math.sin(this.jitter * 1.7) * this.noise * 0.35;
    snake.setTargetAngle(snake.targetAngle + wobble * dt * 6);

    /* ---- 4. boost management ------------------------------------------ */
    this._updateBoost(dt, world, ctx, danger);
  };

  /* ====================================================================== *
   * Reflexes
   * ====================================================================== */

  /**
   * Cast a short ray in front of the head.
   * @returns {null|{type:string, dist:number}} danger info
   */
  BotBrain.prototype._whisker = function (world) {
    var snake = this.snake;
    var reach = snake.radius * 2.2 + (snake.currentSpeed || snake.baseSpeed) * 0.42;
    var steps = 3;
    var margin = snake.radius * 1.35;

    for (var i = 1; i <= steps; i++) {
      var d = (reach / steps) * i;
      var px = snake.x + Math.cos(snake.angle) * d;
      var py = snake.y + Math.sin(snake.angle) * d;

      /* wall */
      if (!world.wrap && !world.isInside(px, py, snake.radius * 1.6)) {
        return { type: 'wall', dist: d };
      }
      /* bodies */
      var near = world.nearestBody(px, py, snake.radius + CONFIG.snake.maxRadius + 10, snake);
      if (near && near.dist < margin) {
        return { type: 'body', dist: d };
      }
    }
    return null;
  };

  /** Immediate evasive manoeuvre: try every panic heading, take the safest. */
  BotBrain.prototype._emergencyTurn = function (world, danger) {
    var snake = this.snake;
    var bestAngle = snake.angle + (danger.type === 'wall' ? 1.2 : Math.PI * 0.5);
    var bestCost = Infinity;

    for (var i = 0; i < FAN_PANIC.length; i++) {
      var a = snake.angle + FAN_PANIC[i];
      var cost = this._scoreHeading(world, a, null, 0.55);
      if (cost < bestCost) { bestCost = cost; bestAngle = a; }
    }
    snake.setTargetAngle(bestAngle);
  };

  /* ====================================================================== *
   * Deliberate thinking
   * ====================================================================== */
  BotBrain.prototype._think = function (world, ctx) {
    var snake = this.snake;
    var player = ctx && ctx.player ? ctx.player : null;

    /* ---- choose a behaviour ------------------------------------------- */
    var newMode = MODES.GRAZE;
    if (player && player.alive && player !== snake) {
      var dist = Utils.dist(snake.x, snake.y, player.x, player.y);
      var myLen = snake.segments.length;
      var theirLen = player.segments.length;
      var aggroRange = 700 + snake.radius * 26 * this.p.aggression;

      if (dist < aggroRange) {
        if (myLen > theirLen * 1.08) {
          newMode = (dist < 430 && this.p.aggression > 0.5) ? MODES.TRAP : MODES.HUNT;
        } else if (theirLen > myLen * 1.15) {
          newMode = MODES.FLEE;
        }
      }
    }
    this.mode = newMode;

    /* ---- desired heading for that behaviour --------------------------- */
    var desired = null;
    if (this.mode === MODES.HUNT || this.mode === MODES.TRAP) {
      desired = this._interceptAngle(player, this.mode === MODES.TRAP);
    } else if (this.mode === MODES.FLEE) {
      desired = Math.atan2(snake.y - player.y, snake.x - player.x);
    } else {
      desired = this._forageAngle(world);
    }

    /* ---- pick the safest heading close to `desired` ------------------- */
    var bestAngle = desired != null ? desired : snake.angle;
    var bestCost = Infinity;
    for (var i = 0; i < FAN.length; i++) {
      var a = (desired != null ? desired : snake.angle) + FAN[i] + Utils.rand(-this.noise, this.noise) * 0.35;
      var cost = this._scoreHeading(world, a, player, this.lookAhead);
      if (cost < bestCost) { bestCost = cost; bestAngle = a; }
    }
    snake.setTargetAngle(bestAngle);
  };

  /** Heading towards the most valuable reachable food. */
  BotBrain.prototype._forageAngle = function (world) {
    var snake = this.snake;

    // keep a target for a moment so the bot does not oscillate between dots
    if (this.targetFood && (!this.targetFood.alive || this._targetEaten(world))) this.targetFood = null;

    if (!this.targetFood) {
      var best = null, bestScore = -Infinity;
      var found = world.foodHash.queryCircle(snake.x, snake.y, this.senseRange);
      for (var i = 0; i < found.length; i++) {
        var f = found[i];
        if (!f.alive) continue;
        var d = Utils.dist(snake.x, snake.y, f.x, f.y);
        if (d > this.senseRange) continue;
        var score = (f.value * 14) / (30 + d);
        if (score > bestScore) { bestScore = score; best = f; }
      }
      this.targetFood = best;
    }

    if (this.targetFood) {
      return Math.atan2(this.targetFood.y - snake.y, this.targetFood.x - snake.x);
    }

    // nothing in sight: meander
    if (this.wanderTimer <= 0) {
      this.wanderTimer = Utils.rand(0.8, 2.4);
      this.wander = snake.angle + Utils.rand(-1.1, 1.1);
    }
    return this.wander;
  };

  BotBrain.prototype._targetEaten = function (world) {
    return world.foods.indexOf(this.targetFood) < 0;
  };

  /**
   * Where the player *will be* by the time we get there.
   * @param {boolean} cutOff when true aim across their path (trapping)
   */
  BotBrain.prototype._interceptAngle = function (player, cutOff) {
    var snake = this.snake;
    var dist = Utils.dist(snake.x, snake.y, player.x, player.y);
    var speed = Math.max(60, snake.currentSpeed || snake.baseSpeed);
    var lead = Utils.clamp(dist / speed, 0, 1.6) * (0.6 + this.p.skill * 0.8);

    var pSpeed = player.currentSpeed || player.baseSpeed;
    var tx = player.x + Math.cos(player.angle) * pSpeed * lead;
    var ty = player.y + Math.sin(player.angle) * pSpeed * lead;

    if (cutOff) {
      // swing to a point perpendicular to their heading: classic body-block
      var side = (this.jitter % 2 < 1) ? 1 : -1;
      tx += Math.cos(player.angle + Math.PI / 2) * 130 * side;
      ty += Math.sin(player.angle + Math.PI / 2) * 130 * side;
    }

    // keep the prediction inside the arena
    tx = Utils.clamp(tx, 40, snake.world.width - 40);
    ty = Utils.clamp(ty, 40, snake.world.height - 40);

    return Math.atan2(ty - snake.y, tx - snake.x);
  };

  /* ====================================================================== *
   * Heading scoring - the core of the AI
   * ====================================================================== */
  /**
   * Lower is better.
   * @param {World} world
   * @param {number} angle     candidate heading
   * @param {Snake|null} player
   * @param {number} lookAhead multiplier for the sample distance
   */
  BotBrain.prototype._scoreHeading = function (world, angle, player, lookAhead) {
    var snake = this.snake;
    var cost = 0;
    var caution = this.p.caution;

    var base = snake.radius * 2.2;
    var samples = [base, base * 2.1, base * 3.6, base * 5.6 * lookAhead, base * 8 * lookAhead];
    var weights = [1.9, 1.5, 1.1, 0.75, 0.45];

    for (var i = 0; i < samples.length; i++) {
      var d = samples[i];
      var px = snake.x + Math.cos(angle) * d;
      var py = snake.y + Math.sin(angle) * d;
      var w = weights[i];

      /* --- walls ------------------------------------------------------- */
      if (!world.wrap) {
        var margin = snake.radius * 3.2;
        var outX = Math.max(0, margin - px, px - (world.width - margin));
        var outY = Math.max(0, margin - py, py - (world.height - margin));
        var out = Math.max(outX, outY);
        if (out > 0) cost += (140 + out * 3) * w * (0.6 + caution * 0.9);
      }

      /* --- other bodies ------------------------------------------------ */
      var near = world.nearestBody(px, py, snake.radius + CONFIG.snake.maxRadius + 16, snake);
      if (near) {
        var safe = snake.radius + near.snake.radius + 26 * caution;
        if (near.dist < safe) {
          var overlap = (safe - near.dist) / safe;       // 0..1
          cost += (260 * overlap + 40) * w * (0.7 + caution);
          // bigger snakes are scarier: ramming them is suicide
          if (near.snake.segments.length > snake.segments.length * 1.1) cost += 60 * w * overlap;
        }
      }

      /* --- food attraction --------------------------------------------- */
      if (this.mode === MODES.GRAZE) {
        var foods = world.foodHash.queryCircle(px, py, 90);
        for (var f = 0; f < foods.length; f++) {
          var food = foods[f];
          if (!food.alive) continue;
          var fd = Utils.dist(px, py, food.x, food.y);
          if (fd < 90) cost -= (food.value * 5.5) * w * (1 - fd / 90) * (0.5 + this.p.greed);
        }
      }

      /* --- prey / predator --------------------------------------------- */
      if (player && player.alive && player !== snake) {
        var pd = Utils.dist(px, py, player.x, player.y);
        var myLen = snake.segments.length;
        var theirLen = player.segments.length;

        if (this.mode === MODES.HUNT || this.mode === MODES.TRAP) {
          // reward closing in on the prey
          if (pd < 620) cost -= (1 - pd / 620) * 70 * w * this.p.aggression;
          // never ram into an equal or bigger head
          if (pd < (snake.radius + player.radius + 26) && theirLen >= myLen * 0.95) cost += 200 * w;
        } else if (this.mode === MODES.FLEE) {
          if (pd < 420) cost += (1 - pd / 420) * 130 * w * (1.2 - this.p.aggression * 0.4);
        } else if (theirLen > myLen * 1.2 && pd < 260) {
          cost += (1 - pd / 260) * 90 * w * caution;     // give big snakes room
        }
      }
    }

    /* --- alignment penalty --------------------------------------------- */
    // discards headings that are technically safe but pointless
    var turnCost = Math.abs(Utils.angleDelta(snake.angle, angle));
    cost += turnCost * 26 * (1 - this.p.skill * 0.35);

    return cost;
  };

  /* ====================================================================== *
   * Boost
   * ====================================================================== */
  BotBrain.prototype._updateBoost = function (dt, world, ctx, danger) {
    var snake = this.snake;
    var S = CONFIG.snake;
    var player = ctx && ctx.player ? ctx.player : null;

    if (snake.segments.length <= S.minBoostLength) { snake.boosting = false; return; }

    var want = false;

    if (danger && this.panic > 0) want = true;                       // escape!
    if (this.mode === MODES.FLEE && player) {
      want = Utils.dist(snake.x, snake.y, player.x, player.y) < 340;
    }
    if (this.mode === MODES.HUNT || this.mode === MODES.TRAP) {
      if (player && Utils.dist(snake.x, snake.y, player.x, player.y) < 430) want = true;
    }
    if (this.mode === MODES.GRAZE && this.targetFood) {
      want = Utils.dist(snake.x, snake.y, this.targetFood.x, this.targetFood.y) > 420
        && this.p.greed > 0.7
        && snake.segments.length > S.minBoostLength + 22;
    }

    // hysteresis: never flap the boost on/off every frame
    if (want && this.boostCooldown <= 0 && !snake.boosting) {
      snake.boosting = true;
      this.boostCooldown = Utils.rand(0.8, 2.2);
    } else if (!want && snake.boosting) {
      snake.boosting = false;
      this.boostCooldown = Utils.rand(0.4, 1.1);
    }
  };

  SR.BotBrain = BotBrain;

})(typeof window !== 'undefined' ? window : globalThis);
