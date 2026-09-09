/* ==========================================================================
 * sprites.js - Off-screen sprite cache.
 *
 * Radial glows are the most expensive thing to draw with Canvas2D (big
 * gradients + shadowBlur). Instead we pre-render each glow once into a small
 * off-screen canvas and then blit it with drawImage(), which the GPU can do
 * very cheaply. Sizes are quantised so the cache stays small.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});

  var Sprites = {
    cache: Object.create(null),
    _limit: 220,
    _count: 0,

    _key: function (kind, color, size) {
      // quantise to 2px steps -> far fewer canvases, no visible difference
      return kind + '|' + color + '|' + (Math.max(2, Math.round(size / 2) * 2));
    },

    get: function (kind, color, size, builder) {
      var key = this._key(kind, color, size);
      var sprite = this.cache[key];
      if (sprite) return sprite;

      if (this._count > this._limit) this.clear();

      var sizePx = Math.max(2, Math.round(size / 2) * 2);
      sprite = this._make(sizePx, builder, color, sizePx);
      this.cache[key] = sprite;
      this._count++;
      return sprite;
    },

    _make: function (size, builder, color, sizePx) {
      var c = (typeof document !== 'undefined' && document.createElement)
        ? document.createElement('canvas')
        : { width: 0, height: 0, getContext: function () { return null; } };
      c.width = c.height = size;
      var ctx = c.getContext ? c.getContext('2d') : null;
      if (ctx) builder(ctx, size, color);
      return c;
    },

    /** Soft radial glow: bright core -> transparent edge. */
    glow: function (color, radius) {
      return this.get('glow', color, radius, function (ctx, size, col) {
        var r = size / 2;
        var g = ctx.createRadialGradient(r, r, 0, r, r, r);
        g.addColorStop(0, SR.Utils.rgba(SR.Utils.hexToRGB(col), 0.95));
        g.addColorStop(0.35, SR.Utils.rgba(SR.Utils.hexToRGB(col), 0.45));
        g.addColorStop(0.7, SR.Utils.rgba(SR.Utils.hexToRGB(col), 0.12));
        g.addColorStop(1, SR.Utils.rgba(SR.Utils.hexToRGB(col), 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(r, r, r, 0, Math.PI * 2);
        ctx.fill();
      });
    },

    /** Solid disc with a bright rim (energy dots). */
    dot: function (color, radius) {
      return this.get('dot', color, radius, function (ctx, size, col) {
        var r = size / 2;
        var g = ctx.createRadialGradient(r * 0.75, r * 0.75, 0, r, r, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.45, col);
        g.addColorStop(1, col);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(r, r, r * 0.95, 0, Math.PI * 2);
        ctx.fill();
      });
    },

    /** Coin: gold disc with an inner ring. */
    coin: function (radius) {
      return this.get('coin', '#ffd257', radius, function (ctx, size) {
        var r = size / 2;
        var g = ctx.createRadialGradient(r * 0.7, r * 0.65, 0, r, r, r);
        g.addColorStop(0, '#fff6d0');
        g.addColorStop(0.5, '#ffd257');
        g.addColorStop(1, '#c8891f');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(r, r, r * 0.92, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = Math.max(1, r * 0.12);
        ctx.beginPath();
        ctx.arc(r, r, r * 0.6, 0, Math.PI * 2);
        ctx.stroke();
      });
    },

    clear: function () {
      this.cache = Object.create(null);
      this._count = 0;
    }
  };

  SR.Sprites = Sprites;

  /* ======================================================================
   * Skin preview - draws a coiled snake onto a small canvas.
   * Used by the Skins Shop cards and by the menu.
   * ====================================================================== */
  SR.drawSkinPreview = function (canvas, skin, opts) {
    if (!canvas || !canvas.getContext) return;
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    if (!ctx) return;                     // head-less environment (jsdom, tests)
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // background
    var bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    bg.addColorStop(0, 'rgba(30,45,95,0.75)');
    bg.addColorStop(1, 'rgba(6,10,22,0.9)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // body path (an S curve that fits the card)
    var pad = Math.min(w, h) * 0.22;
    var pts = [
      { x: pad, y: h - pad * 0.9 },
      { x: w * 0.32, y: h * 0.62 },
      { x: w * 0.18, y: h * 0.34 },
      { x: w * 0.5, y: pad * 0.7 },
      { x: w * 0.82, y: h * 0.36 },
      { x: w * 0.66, y: h * 0.72 },
      { x: w - pad, y: h * 0.55 }
    ];

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // glow
    if (CONFIG_OK()) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = skin.glow;
      ctx.lineWidth = Math.min(w, h) * 0.3;
      strokeCurve(ctx, pts);
      ctx.globalAlpha = 1;
    }

    // outline
    ctx.strokeStyle = skin.edge;
    ctx.lineWidth = Math.min(w, h) * 0.19;
    strokeCurve(ctx, pts);

    // core
    ctx.strokeStyle = skin.core;
    ctx.lineWidth = Math.min(w, h) * 0.11;
    strokeCurve(ctx, pts);

    // pattern highlight
    if (skin.pattern === 'stripe') {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.min(w, h) * 0.05;
      ctx.setLineDash([4, 9]);
      strokeCurve(ctx, pts);
      ctx.setLineDash([]);
    } else if (skin.pattern === 'pulse') {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = Math.min(w, h) * 0.04;
      ctx.setLineDash([2, 12]);
      strokeCurve(ctx, pts);
      ctx.setLineDash([]);
    }

    // head + eyes
    var head = pts[pts.length - 1];
    var prev = pts[pts.length - 2];
    var ang = Math.atan2(head.y - prev.y, head.x - prev.x);
    var hr = Math.min(w, h) * 0.115;
    ctx.fillStyle = skin.core;
    ctx.beginPath();
    ctx.arc(head.x, head.y, hr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = skin.edge;
    ctx.lineWidth = Math.max(1, hr * 0.22);
    ctx.stroke();

    var er = hr * 0.26;
    var px = Math.cos(ang + Math.PI / 2), py = Math.sin(ang + Math.PI / 2);
    for (var s = -1; s <= 1; s += 2) {
      ctx.fillStyle = skin.eye || '#04121f';
      ctx.beginPath();
      ctx.arc(head.x + Math.cos(ang) * hr * 0.35 + px * er * 1.5 * s,
              head.y + Math.sin(ang) * hr * 0.35 + py * er * 1.5 * s, er, 0, Math.PI * 2);
      ctx.fill();
    }

    if (opts.locked) {
      ctx.fillStyle = 'rgba(4,8,20,0.55)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = 'bold ' + Math.round(Math.min(w, h) * 0.32) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔒', w / 2, h / 2);
    }

    function strokeCurve(c, p) {
      c.beginPath();
      c.moveTo(p[0].x, p[0].y);
      for (var i = 1; i < p.length - 1; i++) {
        var xc = (p[i].x + p[i + 1].x) / 2;
        var yc = (p[i].y + p[i + 1].y) / 2;
        c.quadraticCurveTo(p[i].x, p[i].y, xc, yc);
      }
      c.lineTo(p[p.length - 1].x, p[p.length - 1].y);
      c.stroke();
    }

    function CONFIG_OK() { return !(SR.CONFIG && SR.CONFIG.render && SR.CONFIG.render.glow === false); }
  };

})(typeof window !== 'undefined' ? window : globalThis);
