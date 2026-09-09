/* ==========================================================================
 * utils.js - Small, dependency-free math / helper library.
 * Kept side-effect free so the simulation can be unit tested in Node.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});

  var TAU = Math.PI * 2;

  var Utils = {

    TAU: TAU,

    /* ------------------------------------------------------------- math */
    clamp: function (v, min, max) { return v < min ? min : (v > max ? max : v); },

    lerp: function (a, b, t) { return a + (b - a) * t; },

    /** Frame-rate independent exponential smoothing. */
    damp: function (a, b, lambda, dt) { return Utils.lerp(a, b, 1 - Math.exp(-lambda * dt)); },

    /** Shortest signed difference between two angles, in (-PI, PI]. */
    angleDelta: function (from, to) {
      var d = (to - from) % TAU;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      return d;
    },

    /** Rotate `from` towards `to`, at most `maxStep` radians. */
    angleApproach: function (from, to, maxStep) {
      var d = Utils.angleDelta(from, to);
      if (Math.abs(d) <= maxStep) return to;
      return from + Math.sign(d) * maxStep;
    },

    dist: function (ax, ay, bx, by) {
      var dx = bx - ax, dy = by - ay;
      return Math.sqrt(dx * dx + dy * dy);
    },

    dist2: function (ax, ay, bx, by) {
      var dx = bx - ax, dy = by - ay;
      return dx * dx + dy * dy;
    },

    /* ------------------------------------------------------------- random */
    rand: function (min, max) { return min + Math.random() * (max - min); },

    randInt: function (min, max) { return Math.floor(min + Math.random() * (max - min + 1)); },

    pick: function (arr) { return arr[(Math.random() * arr.length) | 0]; },

    /** Random angle in radians. */
    randAngle: function () { return Math.random() * TAU; },

    /** Random point inside a rectangle. */
    randPointIn: function (w, h, pad) {
      pad = pad || 0;
      return { x: Utils.rand(pad, w - pad), y: Utils.rand(pad, h - pad) };
    },

    chance: function (p) { return Math.random() < p; },

    /* ------------------------------------------------------------- misc */
    /** 32-bit hash -> stable pseudo random from an integer (used for names). */
    hash32: function (str) {
      var h = 2166136261 >>> 0;
      for (var i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return h >>> 0;
    },

    formatNumber: function (n) {
      n = Math.floor(n);
      if (n < 10000) return String(n);
      if (n < 1000000) return (n / 1000).toFixed(n < 100000 ? 1 : 0) + 'k';
      return (n / 1000000).toFixed(1) + 'M';
    },

    /** Deterministic-ish unique id generator (good enough for entity ids). */
    _id: 0,
    uid: function (prefix) { this._id += 1; return (prefix || 'id') + '_' + this._id; },

    /** Wrap `v` into [0, size) - used when the arena has no walls. */
    wrap: function (v, size) { return ((v % size) + size) % size; },

    /** Linear interpolation of colours given as [r,g,b] arrays. */
    mixRGB: function (a, b, t) {
      return [
        Math.round(Utils.lerp(a[0], b[0], t)),
        Math.round(Utils.lerp(a[1], b[1], t)),
        Math.round(Utils.lerp(a[2], b[2], t))
      ];
    },

    rgba: function (rgb, alpha) {
      return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')';
    },

    /** "#rrggbb" -> [r,g,b] */
    hexToRGB: function (hex) {
      hex = hex.replace('#', '');
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      var n = parseInt(hex, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },

    /** Throttle: returns a wrapper that runs `fn` at most every `ms`. */
    throttle: function (fn, ms) {
      var last = 0;
      return function () {
        var now = Date.now();
        if (now - last < ms) return;
        last = now;
        return fn.apply(this, arguments);
      };
    },

    /** requestAnimationFrame shim. */
    now: (typeof performance !== 'undefined' && performance.now)
      ? function () { return performance.now(); }
      : function () { return Date.now(); }
  };

  SR.Utils = Utils;

})(typeof window !== 'undefined' ? window : globalThis);
