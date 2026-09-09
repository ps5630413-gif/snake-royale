/* ==========================================================================
 * camera.js - Smooth follow camera with size aware zoom.
 *
 * The world is much bigger than the screen, so the camera keeps the player
 * roughly centred (slightly offset towards where they are heading) and zooms
 * out as the snake grows so you always see enough of the battlefield.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var Utils = SR.Utils;
  var CONFIG = SR.CONFIG;

  function Camera() {
    this.x = 0;
    this.y = 0;
    this.zoom = CONFIG.camera.baseZoom;
    this.targetZoom = this.zoom;

    this.viewW = 1;      // CSS pixels
    this.viewH = 1;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  Camera.prototype.resize = function (w, h) {
    this.viewW = w;
    this.viewH = h;
  };

  /** Snap instantly (level start, revive...). */
  Camera.prototype.snapTo = function (x, y) {
    this.x = x;
    this.y = y;
  };

  /**
   * Follow a snake.
   * @param {Snake} snake
   * @param {number} dt
   */
  Camera.prototype.follow = function (snake, dt) {
    if (!snake) return;
    var C = CONFIG.camera;

    // look ahead: shift the view towards the heading so you see more of
    // what is in front of you than behind
    var speed = snake.currentSpeed || snake.baseSpeed;
    var aheadDist = snake.radius * 6 * C.lookAhead + speed * 0.22;
    var tx = snake.x + Math.cos(snake.angle) * aheadDist;
    var ty = snake.y + Math.sin(snake.angle) * aheadDist;

    this.x = Utils.damp(this.x, tx, C.followLerp, dt);
    this.y = Utils.damp(this.y, ty, C.followLerp, dt);

    // zoom out for big snakes
    var desired = C.baseZoom * Math.pow(C.referenceRadius / snake.radius, 0.6);
    this.targetZoom = Utils.clamp(desired, C.minZoom, C.maxZoom);
    this.zoom = Utils.damp(this.zoom, this.targetZoom, C.zoomLerp, dt);

    // screen shake decay
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.4);
      var amp = this.shake * 14;
      this.shakeX = (Math.random() * 2 - 1) * amp;
      this.shakeY = (Math.random() * 2 - 1) * amp;
    } else {
      this.shakeX = this.shakeY = 0;
    }
  };

  Camera.prototype.addShake = function (amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  };

  /* --------------------------------------------------------- transforms */

  Camera.prototype.worldToScreenX = function (wx) {
    return (wx - this.x) * this.zoom + this.viewW / 2 + this.shakeX;
  };

  Camera.prototype.worldToScreenY = function (wy) {
    return (wy - this.y) * this.zoom + this.viewH / 2 + this.shakeY;
  };

  Camera.prototype.screenToWorldX = function (sx) {
    return (sx - this.viewW / 2) / this.zoom + this.x;
  };

  Camera.prototype.screenToWorldY = function (sy) {
    return (sy - this.viewH / 2) / this.zoom + this.y;
  };

  /** Visible world rectangle (plus optional padding in world units). */
  Camera.prototype.visibleRect = function (pad) {
    pad = pad || 0;
    var halfW = this.viewW / (2 * this.zoom) + pad;
    var halfH = this.viewH / (2 * this.zoom) + pad;
    return { x0: this.x - halfW, y0: this.y - halfH, x1: this.x + halfW, y1: this.y + halfH };
  };

  SR.Camera = Camera;

})(typeof window !== 'undefined' ? window : globalThis);
