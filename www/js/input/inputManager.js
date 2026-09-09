/* ==========================================================================
 * inputManager.js - All player input in one place.
 *
 * Supported sources (they can all be active at the same time):
 *   • Virtual joystick  - fixed pad (bottom-left) or floating under the thumb
 *   • Swipe / drag      - drag anywhere on the play field
 *   • Boost button      - on-screen button, SPACE or mouse hold
 *   • Keyboard          - arrows / WASD (handy for desktop testing)
 *
 * The manager only produces a normalised direction vector + a boost flag.
 * The game decides what to do with them, which keeps input testable.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var Utils = SR.Utils;
  var CONFIG = SR.CONFIG;

  /**
   * @param {object} opts
   * @param {HTMLElement} opts.surface    element that receives drag gestures
   * @param {HTMLElement} opts.joystick   #joystick container
   * @param {HTMLElement} opts.knob       #joystick-knob
   * @param {HTMLElement} opts.boostBtn   #boost-btn
   */
  function InputManager(opts) {
    opts = opts || {};
    this.surface = opts.surface || null;
    this.joystickEl = opts.joystick || null;
    this.knobEl = opts.knob || null;
    this.boostBtn = opts.boostBtn || null;

    this.mode = CONFIG.input.mode || 'joystick';
    this.enabled = false;

    /* public state read by the game loop */
    this.vector = { x: 0, y: 0, active: false, mag: 0 };
    this.boost = false;

    /* internals */
    this.keys = Object.create(null);
    this._touchId = null;
    this._base = { x: 0, y: 0 };     // in CSS pixels (client space)
    this._knob = { x: 0, y: 0 };
    this._radius = CONFIG.input.joystickRadius;
    this._home = { x: 0, y: 0 };     // rest position of the fixed pad
    this._mouseDown = false;
    this._bound = [];

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onResize = Utils.throttle(this._measure.bind(this), 250);
  }

  /* ====================================================================== *
   * Lifecycle
   * ====================================================================== */

  InputManager.prototype.attach = function () {
    var target = this.surface || global;
    this._listen(target, 'touchstart', this._onPointerDown, { passive: false });
    this._listen(target, 'touchmove', this._onPointerMove, { passive: false });
    this._listen(target, 'touchend', this._onPointerUp, { passive: false });
    this._listen(target, 'touchcancel', this._onPointerUp, { passive: false });

    // mouse only matters on desktop; touch events fire first on mobile and
    // we ignore the synthetic mouse events that follow.
    this._listen(target, 'mousedown', this._onPointerDown, { passive: false });
    this._listen(global, 'mousemove', this._onPointerMove, { passive: false });
    this._listen(global, 'mouseup', this._onPointerUp, { passive: false });

    this._listen(global, 'keydown', this._onKeyDown);
    this._listen(global, 'keyup', this._onKeyUp);
    this._listen(global, 'resize', this._onResize);
    this._listen(global, 'orientationchange', this._onResize);

    if (this.boostBtn) {
      this._listen(this.boostBtn, 'touchstart', this._boostDown, { passive: false });
      this._listen(this.boostBtn, 'touchend', this._boostUp, { passive: false });
      this._listen(this.boostBtn, 'touchcancel', this._boostUp, { passive: false });
      this._listen(this.boostBtn, 'mousedown', this._boostDown, { passive: false });
      this._listen(this.boostBtn, 'mouseup', this._boostUp, { passive: false });
      this._listen(this.boostBtn, 'mouseleave', this._boostUp, { passive: false });
    }

    this._measure();
    return this;
  };

  InputManager.prototype._listen = function (el, type, fn, opts) {
    if (!el) return;
    var self = this;
    var handler = function (e) { return fn.call(self, e); };
    el.addEventListener(type, handler, opts || false);
    this._bound.push({ el: el, type: type, handler: handler });
  };

  InputManager.prototype.detach = function () {
    this._bound.forEach(function (b) { b.el.removeEventListener(b.type, b.handler); });
    this._bound.length = 0;
  };

  /** Enable / disable gameplay input (menus, ads, pause...). */
  InputManager.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    if (!on) this.reset();
    if (this.joystickEl) {
      this.joystickEl.classList.toggle('is-hidden', !on || this.mode === 'touch');
    }
    if (this.boostBtn) this.boostBtn.classList.toggle('is-hidden', !on);
  };

  InputManager.prototype.setMode = function (mode) {
    this.mode = mode;
    CONFIG.input.mode = mode;
    if (this.joystickEl) {
      // 'touch' = floating stick, so the fixed pad is hidden until you drag
      this.joystickEl.classList.toggle('is-hidden', !this.enabled || mode === 'touch');
    }
    this.reset();
    this._measure();
  };

  /** Cache the resting centre of the fixed pad. */
  InputManager.prototype._measure = function () {
    if (!this.joystickEl) return;
    var base = this.joystickEl.querySelector('.joystick__base');
    if (!base) return;
    var r = base.getBoundingClientRect();
    // a hidden element has no box: keep the last good measurement
    if (!r.width || r.width < 4) return;
    this._home.x = r.left + r.width / 2;
    this._home.y = r.top + r.height / 2;
    this._radius = (r.width / 2) - (this.knobEl ? this.knobEl.offsetWidth / 2 : 26);
    if (this._radius < 20) this._radius = CONFIG.input.joystickRadius;
  };

  /* ====================================================================== *
   * Pointer handling
   * ====================================================================== */

  InputManager.prototype._pointFromEvent = function (e) {
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY, id: e.touches[0].identifier };
    if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY, id: e.changedTouches[0].identifier };
    return { x: e.clientX, y: e.clientY, id: 'mouse' };
  };

  InputManager.prototype._onPointerDown = function (e) {
    if (!this.enabled) return;

    // ignore the synthetic mouse event that follows a touch
    if (e.type === 'mousedown' && this._touchId !== null) return;
    if (e.type === 'mousedown') this._mouseDown = true;

    // never steal touches from UI buttons
    if (e.target && e.target.closest && e.target.closest('button, .screen, .panel')) {
      if (e.type !== 'mousedown') return;
      if (e.target.closest('button')) return;
    }

    var p = this._pointFromEvent(e);
    if (e.type.indexOf('touch') === 0 && this._touchId !== null) return; // one stick at a time
    this._touchId = p.id;

    // 'joystick' -> always the fixed pad; 'touch' -> pad under the finger;
    // 'both'     -> fixed pad when you grab it, floating pad anywhere else
    var onPad = (this.mode !== 'touch') && this.joystickEl && this.joystickEl.contains(e.target);

    if (onPad || this.mode === 'joystick') {
      this._base.x = this._home.x;
      this._base.y = this._home.y;
    } else {
      this._base.x = p.x;
      this._base.y = p.y;
      this._showFloatingPad(p.x, p.y);
    }

    this._updateKnob(p.x, p.y);
    if (e.cancelable) e.preventDefault();
  };

  InputManager.prototype._onPointerMove = function (e) {
    if (!this.enabled) return;
    if (e.type === 'mousemove' && !this._mouseDown && this._touchId === null) return;
    if (this._touchId === null && e.type.indexOf('touch') === 0) return;

    var p = this._pointFromEvent(e);
    if (this._touchId !== null && e.type.indexOf('touch') === 0 && p.id !== this._touchId) {
      // find our own touch inside the list
      var found = null;
      for (var i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === this._touchId) { found = e.touches[i]; break; }
      }
      if (!found) return;
      p = { x: found.clientX, y: found.clientY, id: found.identifier };
    }
    this._updateKnob(p.x, p.y);
    if (e.cancelable) e.preventDefault();
  };

  InputManager.prototype._onPointerUp = function (e) {
    if (e.type === 'mouseup') this._mouseDown = false;
    if (this._touchId === null) return;

    if (e.type.indexOf('touch') === 0) {
      var stillThere = false;
      for (var i = 0; i < (e.touches ? e.touches.length : 0); i++) {
        if (e.touches[i].identifier === this._touchId) stillThere = true;
      }
      if (stillThere) return;
    }
    this.reset();
  };

  /** Recompute the stick vector and move the knob element. */
  InputManager.prototype._updateKnob = function (px, py) {
    var dx = px - this._base.x;
    var dy = py - this._base.y;
    var len = Math.sqrt(dx * dx + dy * dy);

    // dynamic base: once the knob maxes out, drag the whole pad along so
    // the player can keep steering without lifting the thumb
    if (len > this._radius) {
      var excess = len - this._radius;
      this._base.x += (dx / len) * excess;
      this._base.y += (dy / len) * excess;
      if (this._isFloating) this._showFloatingPad(this._base.x, this._base.y);
      dx = (dx / len) * this._radius;
      dy = (dy / len) * this._radius;
      len = this._radius;
    }

    this._knob.x = dx;
    this._knob.y = dy;

    if (this.knobEl) {
      this.knobEl.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    }

    var mag = this._radius > 0 ? len / this._radius : 0;
    if (mag < CONFIG.input.deadZone || len === 0) {
      this.vector.x = this.vector.y = this.vector.mag = 0;
      this.vector.active = false;
    } else {
      this.vector.x = dx / len;
      this.vector.y = dy / len;
      this.vector.mag = Utils.clamp(mag, 0, 1);
      this.vector.active = true;
    }
  };

  InputManager.prototype._showFloatingPad = function (x, y) {
    if (!this.joystickEl) return;
    var base = this.joystickEl.querySelector('.joystick__base');
    if (!base) return;
    var size = base.offsetWidth || 132;
    this.joystickEl.classList.remove('is-hidden');
    this.joystickEl.style.left = '0px';
    this.joystickEl.style.bottom = 'auto';
    this.joystickEl.style.top = '0px';
    this.joystickEl.style.transform = 'translate(' + (x - size / 2) + 'px,' + (y - size / 2) + 'px)';
    this._isFloating = true;
  };

  InputManager.prototype._hideFloatingPad = function () {
    if (!this.joystickEl || !this._isFloating) return;
    this.joystickEl.style.transform = '';
    this.joystickEl.style.top = '';
    this.joystickEl.style.bottom = '';
    this.joystickEl.style.left = '';
    this._isFloating = false;
    if (this.mode === 'touch') this.joystickEl.classList.add('is-hidden');
  };

  /* ====================================================================== *
   * Keyboard
   * ====================================================================== */

  var KEY_VECTORS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0]
  };

  InputManager.prototype._onKeyDown = function (e) {
    if (KEY_VECTORS[e.code]) {
      this.keys[e.code] = true;
      this._applyKeys();
      if (e.cancelable) e.preventDefault();
      return;
    }
    if (e.code === 'Space') {
      this.boost = true;
      if (e.cancelable) e.preventDefault();
    }
  };

  InputManager.prototype._onKeyUp = function (e) {
    if (KEY_VECTORS[e.code]) {
      delete this.keys[e.code];
      this._applyKeys();
      return;
    }
    if (e.code === 'Space') this.boost = false;
  };

  InputManager.prototype._applyKeys = function () {
    var x = 0, y = 0;
    Object.keys(this.keys).forEach(function (code) {
      var v = KEY_VECTORS[code];
      if (!v) return;
      x += v[0]; y += v[1];
    });
    if (x === 0 && y === 0) {
      this.vector.active = false;
      this.vector.x = this.vector.y = this.vector.mag = 0;
      return;
    }
    var len = Math.sqrt(x * x + y * y);
    this.vector.x = x / len;
    this.vector.y = y / len;
    this.vector.mag = 1;
    this.vector.active = true;
  };

  /* ====================================================================== *
   * Boost button
   * ====================================================================== */
  InputManager.prototype._boostDown = function (e) {
    this.boost = true;
    if (this.boostBtn) this.boostBtn.classList.add('is-down');
    if (e.cancelable) e.preventDefault();
  };

  InputManager.prototype._boostUp = function (e) {
    this.boost = false;
    if (this.boostBtn) this.boostBtn.classList.remove('is-down');
  };

  /* ====================================================================== *
   * Public helpers
   * ====================================================================== */

  /** Forget everything (called on pause / game over). */
  InputManager.prototype.reset = function () {
    this.vector.x = this.vector.y = this.vector.mag = 0;
    this.vector.active = false;
    this.boost = false;
    this._touchId = null;
    this.keys = Object.create(null);
    if (this.knobEl) this.knobEl.style.transform = 'translate(0px,0px)';
    if (this.boostBtn) this.boostBtn.classList.remove('is-down');
    this._hideFloatingPad();
  };

  /** @returns {{x:number,y:number,active:boolean}} screen space direction */
  InputManager.prototype.getVector = function () { return this.vector; };

  InputManager.prototype.isBoosting = function () { return !!this.boost; };

  SR.InputManager = InputManager;

})(typeof window !== 'undefined' ? window : globalThis);
