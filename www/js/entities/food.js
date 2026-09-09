/* ==========================================================================
 * food.js - Collectibles scattered around the arena.
 *
 * Two flavours share one class:
 *   • energy dots  -> grow your snake and raise your score
 *   • golden coins -> permanent currency spent in the Skins Shop
 *
 * Both are plain data objects (no methods) so they can live inside the
 * spatial hash and be iterated thousands of times per frame cheaply.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var Utils = SR.Utils;

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} value mass (1..n) - also drives size and brightness
   * @param {boolean} isCoin
   */
  function Food(x, y, value, isCoin) {
    this.id = Utils.uid('f');
    this.x = x;
    this.y = y;
    this.value = value;
    this.isCoin = !!isCoin;

    // coins are worth currency, dots are worth mass
    this.radius = isCoin
      ? 9 + value * 1.4
      : 4.5 + Math.min(value, 6) * 1.5;

    this.alive = true;
    this.born = 0;                       // age in seconds (pop-in animation)
    this.phase = Math.random() * Utils.TAU; // desynchronised pulsing
    this.spin = Utils.rand(-1.6, 1.6);
    this._cell = -1;
  }

  /** Advance the idle animation. */
  Food.prototype.update = function (dt) {
    this.born += dt;
    this.phase += dt * (this.isCoin ? 3.2 : 2.0);
  };

  /** 0 -> 1 spawn-in scale (eased). */
  Food.prototype.spawnScale = function () {
    if (this.born >= 0.35) return 1;
    var t = this.born / 0.35;
    return t * t * (3 - 2 * t);          // smoothstep
  };

  /** Pulsing factor used by the renderer for the glow size. */
  Food.prototype.pulse = function () {
    return 0.5 + 0.5 * Math.sin(this.phase);
  };

  /* ------------------------------------------------------------- factories */
  Food.createEnergy = function (x, y, value) {
    return new Food(x, y, value == null ? Utils.pick(SR.CONFIG.economy.foodValues) : value, false);
  };

  Food.createCoin = function (x, y, value) {
    return new Food(x, y, value == null ? Utils.pick(SR.CONFIG.economy.coinValues) : value, true);
  };

  /* Colour palettes (renderer + minimap read these) */
  Food.ENERGY_COLORS = ['#5cf0ff', '#7dff9b', '#a98bff', '#ffd257', '#ff7ad1'];
  Food.COIN_COLOR = '#ffd257';

  Food.colorFor = function (food) {
    if (food.isCoin) return Food.COIN_COLOR;
    return Food.ENERGY_COLORS[(food.value - 1) % Food.ENERGY_COLORS.length] || Food.ENERGY_COLORS[0];
  };

  SR.Food = Food;

})(typeof window !== 'undefined' ? window : globalThis);
