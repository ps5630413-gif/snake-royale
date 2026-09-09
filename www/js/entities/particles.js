/* ==========================================================================
 * particles.js - Pooled particle system for eat / coin / death / boost FX.
 *
 * Allocation free after warm-up: particles live in a fixed size pool and
 * are recycled, which keeps the GC quiet on low-end Android devices.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var Utils = SR.Utils;
  var CONFIG = SR.CONFIG;

  function Particle() {
    this.active = false;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.life = 0; this.maxLife = 1;
    this.size = 2;
    this.color = '#ffffff';
    this.drag = 0.9;
    this.glow = false;
  }

  function ParticleSystem(max) {
    this.max = max || CONFIG.render.maxParticles;
    this.pool = new Array(this.max);
    for (var i = 0; i < this.max; i++) this.pool[i] = new Particle();
    this.cursor = 0;
    this.enabled = true;
  }

  /** Grab the next free particle (recycling the oldest when saturated). */
  ParticleSystem.prototype._acquire = function () {
    var p = null;
    for (var i = 0; i < this.max; i++) {
      var idx = (this.cursor + i) % this.max;
      if (!this.pool[idx].active) { p = this.pool[idx]; this.cursor = (idx + 1) % this.max; break; }
    }
    if (!p) { p = this.pool[this.cursor]; this.cursor = (this.cursor + 1) % this.max; }
    return p;
  };

  ParticleSystem.prototype.spawn = function (opts) {
    if (!this.enabled) return null;
    var p = this._acquire();
    p.active = true;
    p.x = opts.x; p.y = opts.y;
    p.vx = opts.vx || 0; p.vy = opts.vy || 0;
    p.maxLife = opts.life || 0.6;
    p.life = p.maxLife;
    p.size = opts.size || 3;
    p.color = opts.color || '#ffffff';
    p.drag = opts.drag != null ? opts.drag : 0.86;
    p.glow = !!opts.glow;
    return p;
  };

  /** Radial burst - used for eating and explosions. */
  ParticleSystem.prototype.burst = function (x, y, count, opts) {
    if (!this.enabled) return;
    opts = opts || {};
    var speed = opts.speed || 120;
    for (var i = 0; i < count; i++) {
      var a = (i / count) * Utils.TAU + Utils.rand(-0.2, 0.2);
      var s = speed * Utils.rand(0.4, 1.2);
      this.spawn({
        x: x, y: y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: Utils.rand(0.35, (opts.life || 0.8)),
        size: Utils.rand(1.5, (opts.size || 4)),
        color: opts.color || '#7df9ff',
        drag: opts.drag != null ? opts.drag : 0.88,
        glow: !!opts.glow
      });
    }
  };

  ParticleSystem.prototype.update = function (dt) {
    for (var i = 0; i < this.max; i++) {
      var p = this.pool[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      var d = Math.pow(p.drag, dt * 60);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  };

  ParticleSystem.prototype.clear = function () {
    for (var i = 0; i < this.max; i++) this.pool[i].active = false;
  };

  /* ------------------------------------------------------- effect presets */
  ParticleSystem.prototype.eatEffect = function (x, y, color) {
    this.burst(x, y, 8, { color: color || '#7df9ff', speed: 110, size: 3, life: 0.45, glow: true });
  };

  ParticleSystem.prototype.coinEffect = function (x, y) {
    this.burst(x, y, 12, { color: '#ffd257', speed: 150, size: 3.5, life: 0.7, glow: true });
  };

  ParticleSystem.prototype.explosion = function (x, y, color, power) {
    power = power || 1;
    this.burst(x, y, Math.min(34, 14 + Math.floor(power * 8)), {
      color: color || '#ff5a7a',
      speed: 180 * Math.min(2.4, power),
      size: 5,
      life: 1.1,
      glow: true
    });
    // a few slow embers for depth
    for (var i = 0; i < 6; i++) {
      this.spawn({
        x: x + Utils.rand(-14, 14), y: y + Utils.rand(-14, 14),
        vx: Utils.rand(-30, 30), vy: Utils.rand(-30, 30),
        life: Utils.rand(1.0, 1.8), size: Utils.rand(2, 6),
        color: '#ffffff', drag: 0.95, glow: true
      });
    }
  };

  ParticleSystem.prototype.boostPuff = function (x, y, color) {
    this.spawn({
      x: x + Utils.rand(-4, 4), y: y + Utils.rand(-4, 4),
      vx: Utils.rand(-22, 22), vy: Utils.rand(-22, 22),
      life: Utils.rand(0.25, 0.5), size: Utils.rand(2, 5),
      color: color || '#a25cff', drag: 0.9, glow: true
    });
  };

  SR.ParticleSystem = ParticleSystem;

})(typeof window !== 'undefined' ? window : globalThis);
