/* ==========================================================================
 * snake.js - The snake entity (used by BOTH the player and the AI bots).
 *
 * Movement model: "follow the leader".
 *   The head is a free point steered by an angle; every body joint is
 *   pulled towards the joint in front of it, keeping a fixed distance.
 *   This gives the smooth, continuous slither of modern .io snake games
 *   instead of the chunky grid stepping of the 1990s classic.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var Utils = SR.Utils;
  var CONFIG = SR.CONFIG;

  /**
   * @param {object} opts
   * @param {number} opts.x          spawn position
   * @param {number} opts.y
   * @param {number} [opts.length]   number of body joints
   * @param {number} [opts.angle]    initial heading (radians)
   * @param {boolean}[opts.isPlayer]
   * @param {boolean}[opts.isBot]
   * @param {string} [opts.name]
   * @param {object} [opts.skin]     entry from SR.SKINS
   * @param {object} [opts.world]    World instance (for wrapping & spawning)
   */
  function Snake(opts) {
    opts = opts || {};

    this.id = opts.id || Utils.uid('snake');
    this.world = opts.world || null;
    this.isPlayer = !!opts.isPlayer;
    this.isBot = !!opts.isBot;

    this.name = opts.name || (this.isPlayer ? 'YOU' : 'Bot');
    this.skin = opts.skin || SR.getSkin('neon-blue');
    this.personality = opts.personality || null;
    this.colorSeed = Math.random() * 1000;

    /* --- transform ---------------------------------------------------- */
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.angle = opts.angle != null ? opts.angle : Utils.randAngle();
    this.targetAngle = this.angle;

    /* --- body --------------------------------------------------------- */
    this.length = Math.max(4, Math.floor(opts.length || CONFIG.game.startLength));
    this.segments = [];
    this._syncMetrics();
    this._buildBody();

    /* --- state -------------------------------------------------------- */
    this.alive = true;
    this.boosting = false;
    // real speed of the last update - the camera, the AI whisker and the
    // boost FX read it, so it must NEVER be undefined (NaN city otherwise)
    this.currentSpeed = this.baseSpeed;
    this.invulnerable = CONFIG.snake.startInvuln;
    this.shieldFlash = 0;

    this.score = 0;          // only meaningful for the player
    this.coins = 0;
    this.kills = 0;
    this.foodEaten = 0;
    this.distance = 0;

    this.deathCause = null;  // 'wall' | 'snake' | 'head'
    this.killedBy = null;    // Snake reference
    this.brain = null;       // BotBrain (bots only)

    /* --- cosmetics ---------------------------------------------------- */
    this.boostTrail = 0;     // timer used to emit boost particles
    this.hurtFlash = 0;
  }

  /* ------------------------------------------------------------------ metrics */

  /** Recompute radius / spacing / speed from the current length. */
  Snake.prototype._syncMetrics = function () {
    var S = CONFIG.snake;
    this.radius = Utils.clamp(
      S.baseRadius + S.radiusGrowth * Math.sqrt(this.length),
      S.baseRadius,
      S.maxRadius
    );
    this.spacing = this.radius * S.spacingFactor;

    // Big snakes are a touch slower so small ones can escape.
    var t = (this.radius - S.baseRadius) / Math.max(1, S.maxRadius - S.baseRadius);
    this.sizeFactor = Utils.clamp(t, 0, 1);
    this.baseSpeed = S.baseSpeed * Utils.lerp(1, 0.87, this.sizeFactor);

    // ...and they turn wider.
    this.turnRate = S.turnRate * Math.pow(S.baseRadius / this.radius, S.turnRateFalloff);
  };

  /** Lay the body out in a straight line behind the head. */
  Snake.prototype._buildBody = function () {
    this.segments.length = 0;
    var cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    for (var i = 0; i < this.length; i++) {
      this.segments.push({
        x: this.x - cos * this.spacing * i,
        y: this.y - sin * this.spacing * i
      });
    }
  };

  /* ------------------------------------------------------------------ control */

  /** Steer towards a direction vector (player input). */
  Snake.prototype.setDirection = function (dx, dy) {
    if (dx === 0 && dy === 0) return;
    this.targetAngle = Math.atan2(dy, dx);
  };

  Snake.prototype.setTargetAngle = function (a) { this.targetAngle = a; };

  Snake.prototype.head = function () { return this.segments[0]; };

  Snake.prototype.tail = function () { return this.segments[this.segments.length - 1]; };

  /** Interpolated radius along the body (head is thickest). */
  Snake.prototype.radiusAt = function (index) {
    var n = this.segments.length;
    if (n <= 1) return this.radius;
    var t = index / (n - 1);
    var taper = 1 - 0.55 * Math.pow(t, 1.35);
    return this.radius * taper;
  };

  /* ------------------------------------------------------------------ growth */

  /** Add joints (called when eating). */
  Snake.prototype.grow = function (n) {
    n = n | 0;
    if (n <= 0) return;
    var tail = this.segments[this.segments.length - 1];
    for (var i = 0; i < n; i++) {
      this.segments.push({ x: tail.x, y: tail.y });
    }
    this.length = this.segments.length;
    this._syncMetrics();
  };

  /**
   * Burn joints (boosting). Returns how many were actually removed so the
   * caller can drop food dots in their place.
   */
  Snake.prototype.shrink = function (n) {
    n = Math.floor(n);
    var removed = 0;
    var min = 6;
    while (removed < n && this.segments.length > min) {
      this.segments.pop();
      removed++;
    }
    this.length = this.segments.length;
    this._syncMetrics();
    return removed;
  };

  /* ------------------------------------------------------------------ update */

  /**
   * Advance the snake by `dt` seconds.
   * Order matters: steer -> move head -> resolve world bounds -> pull body.
   */
  Snake.prototype.update = function (dt) {
    if (!this.alive) return;

    var S = CONFIG.snake;
    var W = this.world;

    /* 1. steering ------------------------------------------------------ */
    var maxTurn = this.turnRate * dt;
    this.angle = Utils.angleApproach(this.angle, this.targetAngle, maxTurn);

    /* 2. speed --------------------------------------------------------- */
    var canBoost = this.boosting && this.segments.length > S.minBoostLength;
    var speed = this.baseSpeed * (canBoost ? S.boostMultiplier : 1);
    this.currentSpeed = speed;

    var dx = Math.cos(this.angle) * speed * dt;
    var dy = Math.sin(this.angle) * speed * dt;
    this.x += dx;
    this.y += dy;
    this.distance += speed * dt;

    /* 3. world bounds: wrap or die ------------------------------------- */
    if (W) {
      if (W.wrap) {
        var shifted = this._wrapSelf();
        if (shifted) { dx = shifted.x; dy = shifted.y; }
      }
    }

    /* 4. head joint ---------------------------------------------------- */
    var head = this.segments[0];
    head.x = this.x;
    head.y = this.y;

    /* 5. body follows -------------------------------------------------- */
    this._followChain();

    /* 6. timers -------------------------------------------------------- */
    if (this.invulnerable > 0) this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.boostTrail += dt;
  };

  /** Keep every joint `spacing` behind its predecessor. */
  Snake.prototype._followChain = function () {
    var segs = this.segments;
    var sp = this.spacing;
    for (var i = 1; i < segs.length; i++) {
      var prev = segs[i - 1];
      var cur = segs[i];
      var dx = prev.x - cur.x;
      var dy = prev.y - cur.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > sp && d > 0.0001) {
        var t = (d - sp) / d;          // move exactly the excess distance
        cur.x += dx * t;
        cur.y += dy * t;
      }
    }
  };

  /**
   * Wrapping (only used when CONFIG.world.wrap is true):
   * the whole snake is translated by one world size so the body never
   * stretches across the seam.
   */
  Snake.prototype._wrapSelf = function () {
    var W = this.world;
    var offX = 0, offY = 0;
    if (this.x < 0) offX = W.width; else if (this.x > W.width) offX = -W.width;
    if (this.y < 0) offY = W.height; else if (this.y > W.height) offY = -W.height;
    if (!offX && !offY) return null;

    for (var i = 0; i < this.segments.length; i++) {
      this.segments[i].x += offX;
      this.segments[i].y += offY;
    }
    this.x += offX;
    this.y += offY;
    return { x: offX, y: offY };
  };

  /* ------------------------------------------------------------------ death */

  /**
   * @param {string} cause 'wall' | 'snake' | 'head'
   * @param {Snake|null} killer
   */
  Snake.prototype.die = function (cause, killer) {
    if (!this.alive) return false;
    this.alive = false;
    this.boosting = false;
    this.deathCause = cause || 'snake';
    this.killedBy = killer || null;
    if (killer && killer !== this) killer.kills += 1;
    return true;
  };

  /* ------------------------------------------------------------------ misc */

  /** Serialise enough state to resurrect the snake exactly where it died. */
  Snake.prototype.snapshot = function () {
    var pts = new Array(this.segments.length);
    for (var i = 0; i < this.segments.length; i++) {
      pts[i] = { x: this.segments[i].x, y: this.segments[i].y };
    }
    return {
      x: this.x, y: this.y, angle: this.angle,
      length: this.segments.length,
      score: this.score, coins: this.coins, kills: this.kills,
      foodEaten: this.foodEaten,
      segments: pts
    };
  };

  /** Restore a snapshot created by snapshot(). */
  Snake.prototype.restore = function (snap) {
    this.x = snap.x; this.y = snap.y; this.angle = snap.angle;
    this.targetAngle = snap.angle;
    this.segments = snap.segments.map(function (p) { return { x: p.x, y: p.y }; });
    this.length = this.segments.length;
    this.score = snap.score; this.coins = snap.coins;
    this.kills = snap.kills; this.foodEaten = snap.foodEaten;
    this.alive = true;
    this.boosting = false;
    this.deathCause = null;
    this.killedBy = null;
    this.invulnerable = CONFIG.snake.reviveInvuln;
    this._syncMetrics();
  };

  Snake.prototype.setSkin = function (skin) { this.skin = skin || this.skin; };

  Snake.prototype.totalBodyLength = function () { return this.segments.length * this.spacing; };

  SR.Snake = Snake;

})(typeof window !== 'undefined' ? window : globalThis);
