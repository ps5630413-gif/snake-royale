/* ==========================================================================
 * hud.js - In-game overlay: score, length, coins, boost bar, leaderboard
 *          and the minimap.
 *
 * DOM elements are updated at a low frequency (only when a value changes)
 * and the minimap is redrawn ~15 times per second, which keeps the layout
 * work off the critical path of the 60fps game loop.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var Utils = SR.Utils;

  var Hud = {
    els: null,
    visible: false,
    _last: { score: -1, length: -1, coins: -1, boost: -1 },
    _minimapAcc: 0,
    _boardAcc: 0,
    _ctx: null,

    init: function () {
      this.els = {
        root: document.getElementById('hud'),
        score: document.getElementById('hud-score'),
        length: document.getElementById('hud-length'),
        coins: document.getElementById('hud-coins'),
        coinsBox: document.querySelector('.hud__stat--coins'),
        boost: document.getElementById('boost-fill'),
        board: document.getElementById('leaderboard-list'),
        minimap: document.getElementById('minimap')
      };
      if (this.els.minimap) this._ctx = this.els.minimap.getContext('2d');
      return this;
    },

    setVisible: function (on) {
      this.visible = !!on;
      if (this.els && this.els.root) this.els.root.classList.toggle('is-hidden', !on);
    },

    /* ------------------------------------------------------------ update */
    update: function (game, dt) {
      if (!this.visible || !this.els) return;
      var p = game.player;
      if (!p) return;

      var score = Math.floor(p.score);
      if (score !== this._last.score) {
        this.els.score.textContent = Utils.formatNumber(score);
        this._last.score = score;
      }

      var len = p.segments.length;
      if (len !== this._last.length) {
        this.els.length.textContent = Utils.formatNumber(len);
        this._last.length = len;
      }

      if (p.coins !== this._last.coins) {
        this.els.coins.textContent = Utils.formatNumber(p.coins);
        this._last.coins = p.coins;
        if (this.els.coinsBox) {
          this.els.coinsBox.classList.remove('is-bump');
          // force a reflow so the animation restarts
          void this.els.coinsBox.offsetWidth;
          this.els.coinsBox.classList.add('is-bump');
        }
      }

      // boost / mass bar: how much body you can still burn
      var pct = Utils.clamp((p.segments.length - SR.CONFIG.snake.minBoostLength) / 60, 0, 1);
      if (Math.abs(pct - this._last.boost) > 0.01) {
        this.els.boost.style.width = (pct * 100).toFixed(0) + '%';
        this.els.boost.classList.toggle('is-low', pct < 0.25);
        this._last.boost = pct;
      }

      this._minimapAcc += dt;
      if (this._minimapAcc > 0.066) {              // ~15 fps is plenty
        this._minimapAcc = 0;
        this.drawMinimap(game.world, p, game.camera);
      }

      this._boardAcc += dt;
      if (this._boardAcc > 0.4) {
        this._boardAcc = 0;
        this.updateLeaderboard(game.world, p);
      }
    },

    /* ---------------------------------------------------------- minimap */
    drawMinimap: function (world, player, camera) {
      var ctx = this._ctx;
      if (!ctx) return;
      var size = this.els.minimap.width;
      var sx = size / world.width;
      var sy = size / world.height;

      ctx.clearRect(0, 0, size, size);

      // arena
      ctx.fillStyle = 'rgba(10,18,40,0.85)';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(255,90,130,0.85)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, size - 2, size - 2);

      // coins
      ctx.fillStyle = '#ffd257';
      for (var c = 0; c < world.coins.length; c++) {
        var coin = world.coins[c];
        ctx.fillRect(coin.x * sx - 1, coin.y * sy - 1, 2, 2);
      }

      // camera viewport
      if (camera) {
        var view = camera.visibleRect(0);
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1;
        ctx.strokeRect(view.x0 * sx, view.y0 * sy, (view.x1 - view.x0) * sx, (view.y1 - view.y0) * sy);
      }

      // snakes (bots first, player on top)
      var snakes = world.snakes;
      for (var i = 0; i < snakes.length; i++) {
        var s = snakes[i];
        if (!s.alive || s === player) continue;
        var skin = s.skin || SR.getSkin('neon-blue');
        ctx.fillStyle = skin.core;
        var r = 1.6 + Math.min(3.4, s.segments.length / 45);
        ctx.beginPath();
        ctx.arc(s.x * sx, s.y * sy, r, 0, Utils.TAU);
        ctx.fill();
      }

      if (player && player.alive) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(player.x * sx, player.y * sy, 3.6, 0, Utils.TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(53,230,255,0.9)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(player.x * sx, player.y * sy, 6, 0, Utils.TAU);
        ctx.stroke();
      }
    },

    /* ------------------------------------------------------ leaderboard */
    updateLeaderboard: function (world, player) {
      var el = this.els.board;
      if (!el) return;

      var list = world.snakes.filter(function (s) { return s.alive; });
      list.sort(function (a, b) { return b.segments.length - a.segments.length; });

      var top = list.slice(0, 5);
      var playerRank = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i] === player) { playerRank = i + 1; break; }
      }
      if (player && player.alive && playerRank > 5) top.push(player);

      var html = '';
      for (var k = 0; k < top.length; k++) {
        var s = top[k];
        var isPlayer = (s === player);
        var rank = (isPlayer && playerRank > 5) ? playerRank : (k + 1);
        var skin = s.skin || SR.getSkin('neon-blue');
        html += '<li class="' + (isPlayer ? 'is-player' : '') + '">' +
          '<span class="dot" style="color:' + skin.core + '"></span>' +
          '<span class="nm">' + (isPlayer ? 'YOU' : s.name) + '</span>' +
          '<span class="ln">' + s.segments.length + '</span>' +
          '</li>';
      }
      el.innerHTML = html;
    },

    /** Reset cached values so the next frame repaints everything. */
    reset: function () {
      this._last = { score: -1, length: -1, coins: -1, boost: -1 };
    }
  };

  SR.Hud = Hud;

})(typeof window !== 'undefined' ? window : globalThis);
