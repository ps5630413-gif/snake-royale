/* ==========================================================================
 * renderer.js - Draws the arena, snakes, collectibles and effects.
 *
 * Performance notes (this has to hold 60fps on a cheap Android phone):
 *   • no shadowBlur anywhere - glows are pre-rendered sprites (js/render/sprites.js)
 *   • everything off screen is culled before a single path is built
 *   • the device pixel ratio is capped (CONFIG.render.maxDPR)
 *   • an adaptive quality monitor drops the glow pass if the frame rate dips
 *   • screen-space paths are built into pre-allocated Float32Arrays
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var Utils = SR.Utils;
  var CONFIG = SR.CONFIG;

  var CHUNK = 8;              // joints per stroke when tapering the body

  function Renderer(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext ? canvas.getContext('2d', { alpha: false }) : null;
    this.camera = camera;

    this.cssW = 1;
    this.cssH = 1;
    this.dpr = 1;

    this.fps = 60;
    this.quality = 1;            // 1 = full FX, 0 = reduced FX
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._qualityCooldown = 0;

    this._ptx = new Float32Array(1024);
    this._pty = new Float32Array(1024);

    this.resize();
  }

  /* ====================================================================== *
   * Sizing
   * ====================================================================== */
  Renderer.prototype.resize = function () {
    var canvas = this.canvas;
    var w = (global.innerWidth || 360);
    var h = (global.innerHeight || 640);
    if (canvas.getBoundingClientRect) {
      var r = canvas.getBoundingClientRect();
      if (r.width > 0) { w = r.width; h = r.height; }
    }

    var dpr = Math.min(global.devicePixelRatio || 1, CONFIG.render.maxDPR);
    // on very low-end devices fall back to 1x if the surface is huge
    if (w * h * dpr * dpr > 4.2e6) dpr = 1;

    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    if (this.ctx) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.camera) this.camera.resize(w, h);
  };

  /* ====================================================================== *
   * Adaptive quality
   * ====================================================================== */
  Renderer.prototype._trackPerf = function (dt) {
    this._fpsAccum += dt;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;

      if (this._qualityCooldown > 0) { this._qualityCooldown -= 0.5; return; }

      if (this.fps < CONFIG.render.lowFpsThreshold && this.quality === 1) {
        this.quality = 0;
        this._qualityCooldown = 3;
        SR.Events.emit('render:quality', 0);
      } else if (this.fps > CONFIG.render.highFpsThreshold && this.quality === 0) {
        this.quality = 1;
        this._qualityCooldown = 6;
        SR.Events.emit('render:quality', 1);
      }
    }
  };

  /* ====================================================================== *
   * Frame
   * ====================================================================== */
  Renderer.prototype.render = function (world, game, dt) {
    var ctx = this.ctx;
    if (!ctx) return;

    this._trackPerf(dt);

    var cam = this.camera;
    var z = cam.zoom;
    var W = this.cssW, H = this.cssH;
    var ox = W / 2 - cam.x * z + cam.shakeX;
    var oy = H / 2 - cam.y * z + cam.shakeY;

    /* ---- background: void outside, arena inside ----------------------- */
    ctx.fillStyle = '#07040d';
    ctx.fillRect(0, 0, W, H);

    var ax = ox, ay = oy;                      // arena top-left in screen space
    var aw = world.width * z, ah = world.height * z;

    var grad = ctx.createLinearGradient(ax, ay, ax, ay + ah);
    grad.addColorStop(0, '#0c1330');
    grad.addColorStop(0.5, '#080e22');
    grad.addColorStop(1, '#0a1128');
    ctx.fillStyle = grad;
    ctx.fillRect(ax, ay, aw, ah);

    /* ---- grid + border (clipped to the arena) ------------------------- */
    ctx.save();
    ctx.beginPath();
    ctx.rect(ax, ay, aw, ah);
    ctx.clip();
    if (CONFIG.render.showGrid) this._drawGrid(ctx, world, ox, oy, z, W, H);
    this._drawBorder(ctx, world, ax, ay, aw, ah, z);
    ctx.restore();

    /* ---- entities ------------------------------------------------------ */
    this._drawCollectibles(ctx, world, cam, ox, oy, z, W, H);
    this._drawSnakes(ctx, world, game, ox, oy, z, W, H);
    this._drawParticles(ctx, world, ox, oy, z);

    /* ---- wall proximity warning ---------------------------------------- */
    if (game && game.player && game.player.alive) {
      this._drawWallWarning(ctx, world, game.player, W, H);
    }
  };

  /* ---------------------------------------------------------------- grid */
  Renderer.prototype._drawGrid = function (ctx, world, ox, oy, z, W, H) {
    var step = CONFIG.world.gridSize * z;
    if (step < 8) return;                       // too dense to be useful

    var startX = ox % step;
    var startY = oy % step;

    ctx.strokeStyle = 'rgba(110, 170, 255, 0.075)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = startX; x <= W; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, H);
    }
    for (var y = startY; y <= H; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(W, Math.round(y) + 0.5);
    }
    ctx.stroke();

    // brighter lines every 4 cells for orientation
    var bigStep = step * 4;
    if (bigStep > 24) {
      ctx.strokeStyle = 'rgba(130, 200, 255, 0.11)';
      ctx.beginPath();
      for (var x2 = ox % bigStep; x2 <= W; x2 += bigStep) {
        ctx.moveTo(Math.round(x2) + 0.5, 0);
        ctx.lineTo(Math.round(x2) + 0.5, H);
      }
      for (var y2 = oy % bigStep; y2 <= H; y2 += bigStep) {
        ctx.moveTo(0, Math.round(y2) + 0.5);
        ctx.lineTo(W, Math.round(y2) + 0.5);
      }
      ctx.stroke();
    }
  };

  /* -------------------------------------------------------------- border */
  Renderer.prototype._drawBorder = function (ctx, world, ax, ay, aw, ah, z) {
    var band = CONFIG.world.borderWidth * z;

    // inner danger band
    var bandGrad = ctx.createLinearGradient(ax, ay, ax, ay + band);
    bandGrad.addColorStop(0, 'rgba(255, 70, 110, 0.30)');
    bandGrad.addColorStop(1, 'rgba(255, 70, 110, 0)');
    ctx.fillStyle = bandGrad;
    ctx.fillRect(ax, ay, aw, band);
    ctx.save();
    ctx.translate(ax, ay + ah);
    ctx.scale(1, -1);
    ctx.fillStyle = bandGrad;
    ctx.fillRect(0, 0, aw, band);
    ctx.restore();

    var bandGradY = ctx.createLinearGradient(ax, ay, ax + band, ay);
    bandGradY.addColorStop(0, 'rgba(255, 70, 110, 0.30)');
    bandGradY.addColorStop(1, 'rgba(255, 70, 110, 0)');
    ctx.fillStyle = bandGradY;
    ctx.fillRect(ax, ay, band, ah);
    ctx.save();
    ctx.translate(ax + aw, ay);
    ctx.scale(-1, 1);
    ctx.fillStyle = bandGradY;
    ctx.fillRect(0, 0, band, ah);
    ctx.restore();

    // neon edge
    ctx.strokeStyle = 'rgba(255, 90, 130, 0.85)';
    ctx.lineWidth = Math.max(1.5, 2.5 * z);
    ctx.strokeRect(ax, ay, aw, ah);

    if (this.quality === 1) {
      ctx.strokeStyle = 'rgba(255, 90, 130, 0.22)';
      ctx.lineWidth = Math.max(4, 12 * z);
      ctx.strokeRect(ax, ay, aw, ah);
    }
  };

  /* -------------------------------------------------------- collectibles */
  Renderer.prototype._drawCollectibles = function (ctx, world, cam, ox, oy, z, W, H) {
    var view = cam.visibleRect(80);
    var foods = world.foodHash.queryRect(view.x0, view.y0, view.x1, view.y1);
    var glowOn = this.quality === 1 && CONFIG.render.glow;
    var i, f, sx, sy, r, pulse;

    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < foods.length; i++) {
      f = foods[i];
      if (!f.alive) continue;
      sx = f.x * z + ox;
      sy = f.y * z + oy;
      if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) continue;

      r = f.radius * z * f.spawnScale();
      if (r < 0.6) continue;
      pulse = f.pulse();

      if (glowOn) {
        var gr = r * (2.7 + pulse * 0.7);
        var gSprite = SR.Sprites.glow(SR.Food.colorFor(f), Math.max(4, gr));
        ctx.globalAlpha = 0.5 + pulse * 0.22;
        ctx.drawImage(gSprite, sx - gr, sy - gr, gr * 2, gr * 2);
      }

      var dSprite = SR.Sprites.dot(SR.Food.colorFor(f), Math.max(2, r * 2));
      ctx.globalAlpha = 1;
      ctx.drawImage(dSprite, sx - r, sy - r, r * 2, r * 2);
    }

    /* coins (few, so no spatial index needed) */
    for (i = 0; i < world.coins.length; i++) {
      f = world.coins[i];
      if (!f.alive) continue;
      sx = f.x * z + ox;
      sy = f.y * z + oy;
      if (sx < -50 || sy < -50 || sx > W + 50 || sy > H + 50) continue;

      r = f.radius * z * f.spawnScale();
      pulse = f.pulse();

      if (glowOn) {
        var cgr = r * (3.0 + pulse * 0.9);
        var cgSprite = SR.Sprites.glow('#ffd257', Math.max(6, cgr));
        ctx.globalAlpha = 0.45 + pulse * 0.3;
        ctx.drawImage(cgSprite, sx - cgr, sy - cgr, cgr * 2, cgr * 2);
      }
      var cSprite = SR.Sprites.coin(Math.max(4, r * 2));
      ctx.globalAlpha = 1;
      // gentle spin: squash the coin horizontally
      var squash = 0.55 + 0.45 * Math.abs(Math.cos(f.phase * 0.6));
      ctx.drawImage(cSprite, sx - r * squash, sy - r, r * 2 * squash, r * 2);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  /* -------------------------------------------------------------- snakes */
  Renderer.prototype._drawSnakes = function (ctx, world, game, ox, oy, z, W, H) {
    var snakes = world.snakes;
    var order = [];
    for (var i = 0; i < snakes.length; i++) {
      if (snakes[i].alive) order.push(snakes[i]);
    }
    // draw the longest snakes first so small ones stay visible on top,
    // and always keep the player on the very top layer
    order.sort(function (a, b) {
      if (a.isPlayer) return 1;
      if (b.isPlayer) return -1;
      return b.segments.length - a.segments.length;
    });

    for (var s = 0; s < order.length; s++) {
      this._drawSnake(ctx, order[s], ox, oy, z, W, H, game);
    }
  };

  Renderer.prototype._drawSnake = function (ctx, snake, ox, oy, z, W, H, game) {
    var segs = snake.segments;
    if (!segs.length) return;

    /* --- project to screen space into reusable buffers ------------------ */
    if (segs.length > this._ptx.length) {
      this._ptx = new Float32Array(segs.length + 256);
      this._pty = new Float32Array(segs.length + 256);
    }
    var px = this._ptx, py = this._pty;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var margin = snake.radius * 3 * z + 60;

    for (var i = 0; i < segs.length; i++) {
      var x = segs[i].x * z + ox;
      var y = segs[i].y * z + oy;
      px[i] = x; py[i] = y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxX < -margin || minX > W + margin || maxY < -margin || minY > H + margin) return;

    var skin = snake.skin || SR.getSkin('neon-blue');
    var glowOn = this.quality === 1 && CONFIG.render.glow;
    var boosting = snake.boosting;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    /* --- 1. glow halo (single wide stroke) ------------------------------ */
    if (glowOn) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = boosting ? 0.42 : 0.26;
      ctx.strokeStyle = skin.glow;
      ctx.lineWidth = snake.radius * 2.6 * z;
      this._strokePath(ctx, px, py, 0, segs.length - 1, 3);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    /* --- 2. body outline ------------------------------------------------ */
    ctx.strokeStyle = skin.edge;
    this._strokeTapered(ctx, snake, px, py, z, 1.0);

    /* --- 3. body core (slightly narrower -> inner highlight) ------------ */
    ctx.strokeStyle = skin.core;
    this._strokeTapered(ctx, snake, px, py, z, 0.68);

    /* --- 4. pattern ----------------------------------------------------- */
    if (skin.pattern === 'stripe') {
      ctx.strokeStyle = 'rgba(255,255,255,0.30)';
      ctx.lineWidth = snake.radius * 0.45 * z;
      ctx.setLineDash([6 * z, 12 * z]);
      this._strokePath(ctx, px, py, 0, segs.length - 1, 2);
      ctx.setLineDash([]);
    } else if (skin.pattern === 'pulse') {
      var alpha = 0.18 + 0.16 * Math.sin(world_time() * 4 + snake.colorSeed);
      ctx.strokeStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
      ctx.lineWidth = snake.radius * 0.7 * z;
      ctx.setLineDash([3 * z, 16 * z]);
      this._strokePath(ctx, px, py, 0, segs.length - 1, 2);
      ctx.setLineDash([]);
    } else if (skin.pattern === 'flame') {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = snake.radius * 0.5 * z;
      ctx.setLineDash([2 * z, 9 * z]);
      this._strokePath(ctx, px, py, 0, segs.length - 1, 2);
      ctx.setLineDash([]);
    }

    /* --- 5. head -------------------------------------------------------- */
    var hx = px[0], hy = py[0];
    var hr = snake.radius * z;
    var ang = snake.angle;

    ctx.fillStyle = skin.core;
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Utils.TAU);
    ctx.fill();
    ctx.strokeStyle = skin.edge;
    ctx.lineWidth = Math.max(1, hr * 0.22);
    ctx.stroke();

    /* boost aura */
    if (boosting && glowOn) {
      var ar = hr * 3.4;
      var aura = SR.Sprites.glow(skin.glow, Math.max(6, ar));
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      ctx.drawImage(aura, hx - ar, hy - ar, ar * 2, ar * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    /* eyes */
    var er = Math.max(1.2, hr * 0.22);
    var ex = Math.cos(ang), ey = Math.sin(ang);
    var nx = -ey, ny = ex;
    for (var s = -1; s <= 1; s += 2) {
      var cxp = hx + ex * hr * 0.34 + nx * hr * 0.42 * s;
      var cyp = hy + ey * hr * 0.34 + ny * hr * 0.42 * s;
      ctx.fillStyle = '#f2fbff';
      ctx.beginPath();
      ctx.arc(cxp, cyp, er, 0, Utils.TAU);
      ctx.fill();
      ctx.fillStyle = skin.eye || '#04121f';
      ctx.beginPath();
      ctx.arc(cxp + ex * er * 0.32, cyp + ey * er * 0.32, er * 0.62, 0, Utils.TAU);
      ctx.fill();
    }

    /* --- 6. spawn / revive shield --------------------------------------- */
    if (snake.invulnerable > 0) {
      var t = snake.invulnerable;
      var shieldR = hr * (2.0 + 0.35 * Math.sin(world_time() * 12));
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.25 + 0.35 * Math.abs(Math.sin(world_time() * 8))).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1.5, hr * 0.3);
      ctx.beginPath();
      ctx.arc(hx, hy, shieldR, 0, Utils.TAU);
      ctx.stroke();
      if (t > 0 && snake.isPlayer && glowOn) {
        var sr = hr * 4;
        var sh = SR.Sprites.glow('#ffffff', Math.max(6, sr));
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.18;
        ctx.drawImage(sh, hx - sr, hy - sr, sr * 2, sr * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    /* --- 7. name tag ----------------------------------------------------- */
    if (z > 0.42) {
      var label = snake.isPlayer ? 'YOU' : snake.name;
      var fontSize = Math.max(9, Math.min(16, 11 * z + 3));
      ctx.font = '700 ' + fontSize.toFixed(0) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      var ty = hy - hr - 6 * z - 2;
      ctx.fillStyle = snake.isPlayer ? 'rgba(255,255,255,0.92)' : 'rgba(200,220,255,0.62)';
      ctx.fillText(label, hx, ty);
    }

    function world_time() { return game ? game.elapsed : (Date.now() / 1000); }
  };

  /** Stroke the whole path (used for glow / patterns). */
  Renderer.prototype._strokePath = function (ctx, px, py, from, to, stride) {
    stride = stride || 1;
    ctx.beginPath();
    ctx.moveTo(px[from], py[from]);
    for (var i = from + stride; i <= to; i += stride) ctx.lineTo(px[i], py[i]);
    if ((to - from) % stride !== 0) ctx.lineTo(px[to], py[to]);
    ctx.stroke();
  };

  /**
   * Stroke the body in chunks so the tail can taper.
   * @param {number} widthScale multiplier applied to the joint radius
   */
  Renderer.prototype._strokeTapered = function (ctx, snake, px, py, z, widthScale) {
    var n = snake.segments.length;
    if (n < 2) return;

    for (var start = 0; start < n - 1; start += CHUNK) {
      var end = Math.min(n - 1, start + CHUNK);
      var mid = (start + end) >> 1;
      var w = snake.radiusAt(mid) * 2 * widthScale * z;
      if (w < 0.6) w = 0.6;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(px[start], py[start]);
      for (var i = start + 1; i <= end; i++) ctx.lineTo(px[i], py[i]);
      ctx.stroke();
    }
  };

  /* ----------------------------------------------------------- particles */
  Renderer.prototype._drawParticles = function (ctx, world, ox, oy, z) {
    if (!CONFIG.render.particles) return;
    var system = world.particles;
    var glowOn = this.quality === 1;
    ctx.globalCompositeOperation = 'lighter';

    for (var i = 0; i < system.max; i++) {
      var p = system.pool[i];
      if (!p.active) continue;
      var sx = p.x * z + ox;
      var sy = p.y * z + oy;
      var life = p.life / p.maxLife;
      var r = Math.max(0.5, p.size * z * life);

      if (p.glow && glowOn) {
        var gr = r * 3;
        var sprite = SR.Sprites.glow(p.color, Math.max(3, gr));
        ctx.globalAlpha = life * 0.7;
        ctx.drawImage(sprite, sx - gr, sy - gr, gr * 2, gr * 2);
      } else {
        ctx.globalAlpha = life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Utils.TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  /* ------------------------------------------------------- wall warning */
  Renderer.prototype._drawWallWarning = function (ctx, world, player, W, H) {
    var m = 340;
    var d = Math.min(player.x, player.y, world.width - player.x, world.height - player.y);
    if (d > m) return;

    var strength = 1 - Utils.clamp(d / m, 0, 1);
    var thickness = 90 * strength;
    var g = ctx.createLinearGradient(0, 0, 0, thickness);
    g.addColorStop(0, 'rgba(255,60,100,' + (0.35 * strength).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,60,100,0)');

    // show the warning on the side we are closest to
    if (player.y < m) { ctx.fillStyle = g; ctx.fillRect(0, 0, W, thickness); }
    if (world.height - player.y < m) {
      ctx.save(); ctx.translate(0, H); ctx.scale(1, -1);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, thickness); ctx.restore();
    }
    var gx = ctx.createLinearGradient(0, 0, thickness, 0);
    gx.addColorStop(0, 'rgba(255,60,100,' + (0.35 * strength).toFixed(3) + ')');
    gx.addColorStop(1, 'rgba(255,60,100,0)');
    if (player.x < m) { ctx.fillStyle = gx; ctx.fillRect(0, 0, thickness, H); }
    if (world.width - player.x < m) {
      ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
      ctx.fillStyle = gx; ctx.fillRect(0, 0, thickness, H); ctx.restore();
    }
  };

  SR.Renderer = Renderer;

})(typeof window !== 'undefined' ? window : globalThis);
