/* ==========================================================================
 * storage.js - Persistence layer built on HTML5 Local Storage.
 *
 * Everything the player owns (high score, coins, unlocked skins, settings)
 * is stored under a single JSON blob, versioned with a prefix so a future
 * release can migrate it safely.
 *
 * Works in three environments:
 *   • browser / WebView  -> window.localStorage
 *   • Capacitor          -> window.localStorage (persisted by the WebView)
 *   • Node (unit tests)  -> in-memory fallback, never throws
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var CONFIG = SR.CONFIG;

  /* ---------------------------------------------------------------- helpers */
  function getBackend() {
    try {
      if (typeof global.localStorage !== 'undefined' && global.localStorage) {
        // Touch it: Safari private mode exposes localStorage but throws on write.
        var probe = '__sr_probe__';
        global.localStorage.setItem(probe, '1');
        global.localStorage.removeItem(probe);
        return global.localStorage;
      }
    } catch (e) { /* ignore: fall through to memory */ }
    if (!Storage._memory) {
      Storage._memory = {
        _d: Object.create(null),
        getItem: function (k) { return k in this._d ? this._d[k] : null; },
        setItem: function (k, v) { this._d[k] = String(v); },
        removeItem: function (k) { delete this._d[k]; }
      };
    }
    return Storage._memory;
  }

  /* ------------------------------------------------------------- defaults */
  function defaults() {
    return {
      version: 1,
      bestScore: 0,
      bestLength: 0,
      coins: 0,
      selectedSkin: 'neon-blue',
      unlockedSkins: ['neon-blue'],
      stats: { games: 0, kills: 0, foodEaten: 0, coinsCollected: 0, totalScore: 0, revives: 0 },
      settings: { controls: CONFIG.input.mode, sound: true, effects: true, grid: true }
    };
  }

  var Storage = {
    KEY: (CONFIG && CONFIG.storage ? CONFIG.storage.prefix : 'snakeRoyale.v1.') + 'profile',
    data: defaults(),
    available: true,

    /* ------------------------------------------------------------- lifecycle */
    /** Load (or create) the profile. Safe to call several times. */
    init: function () {
      var backend = getBackend();
      this.available = (backend !== Storage._memory);
      var raw = null;
      try { raw = backend.getItem(this.KEY); } catch (e) { raw = null; }

      if (raw) {
        try {
          var parsed = JSON.parse(raw);
          this.data = this._merge(defaults(), parsed);
        } catch (e) {
          if (global.console) console.warn('[SR.Storage] corrupted save, resetting', e);
          this.data = defaults();
        }
      } else {
        this.data = defaults();
      }

      // Keep the runtime config in sync with persisted settings.
      if (this.data.settings && this.data.settings.controls) {
        CONFIG.input.mode = this.data.settings.controls;
      }
      if (this.data.settings) {
        CONFIG.render.glow = !!this.data.settings.effects;
        CONFIG.render.particles = !!this.data.settings.effects;
        CONFIG.render.showGrid = !!this.data.settings.grid;
      }
      return this.data;
    },

    /** Deep merge `patch` into `base` (arrays are replaced, not merged). */
    _merge: function (base, patch) {
      if (patch === null || typeof patch !== 'object') return base;
      Object.keys(patch).forEach(function (key) {
        var pv = patch[key];
        if (pv && typeof pv === 'object' && !Array.isArray(pv) && typeof base[key] === 'object' && base[key] !== null) {
          base[key] = Storage._merge(base[key], pv);
        } else if (typeof pv !== 'undefined') {
          base[key] = pv;
        }
      });
      return base;
    },

    /** Persist the current profile. Never throws. */
    save: function () {
      try {
        getBackend().setItem(this.KEY, JSON.stringify(this.data));
        return true;
      } catch (e) {
        if (global.console) console.warn('[SR.Storage] could not persist', e);
        return false;
      }
    },

    /** Wipe everything and restore factory defaults. */
    reset: function () {
      this.data = defaults();
      try { getBackend().removeItem(this.KEY); } catch (e) { /* ignore */ }
      return this.data;
    },

    /* ---------------------------------------------------------------- score */
    getBestScore: function () { return this.data.bestScore | 0; },

    /**
     * Submit a finished run. Returns a summary the UI can display.
     * @returns {{isNewBest:boolean, coinsEarned:number, best:number}}
     */
    submitRun: function (run) {
      var score = Math.max(0, Math.floor(run.score || 0));
      var length = Math.max(0, Math.floor(run.length || 0));
      var coins = Math.max(0, Math.floor(run.coins || 0));
      var bonus = Math.floor(score * CONFIG.game.coinsPerScore);
      var total = coins + bonus;

      var isNewBest = score > this.data.bestScore;
      if (isNewBest) this.data.bestScore = score;
      if (length > this.data.bestLength) this.data.bestLength = length;

      this.data.coins += total;
      this.data.stats.games += 1;
      this.data.stats.kills += run.kills || 0;
      this.data.stats.foodEaten += run.foodEaten || 0;
      this.data.stats.coinsCollected += coins;
      this.data.stats.totalScore += score;
      this.data.stats.revives += run.revives || 0;

      this.save();
      return { isNewBest: isNewBest, coinsEarned: total, bonus: bonus, best: this.data.bestScore };
    },

    /* ---------------------------------------------------------------- coins */
    getCoins: function () { return this.data.coins | 0; },

    addCoins: function (n) {
      this.data.coins = Math.max(0, (this.data.coins | 0) + (n | 0));
      this.save();
      SR.Events && SR.Events.emit('coins:changed', this.data.coins);
      return this.data.coins;
    },

    spendCoins: function (n) {
      if (this.data.coins < n) return false;
      this.data.coins -= n;
      this.save();
      SR.Events && SR.Events.emit('coins:changed', this.data.coins);
      return true;
    },

    /* ---------------------------------------------------------------- skins */
    isSkinUnlocked: function (id) { return this.data.unlockedSkins.indexOf(id) >= 0; },

    unlockSkin: function (id) {
      if (this.isSkinUnlocked(id)) return true;
      this.data.unlockedSkins.push(id);
      this.save();
      SR.Events && SR.Events.emit('skin:unlocked', id);
      return true;
    },

    getSelectedSkin: function () { return this.data.selectedSkin; },

    selectSkin: function (id) {
      if (!this.isSkinUnlocked(id)) return false;
      this.data.selectedSkin = id;
      this.save();
      SR.Events && SR.Events.emit('skin:selected', id);
      return true;
    },

    /* ------------------------------------------------------------- settings */
    getSettings: function () { return this.data.settings; },

    setSetting: function (key, value) {
      this.data.settings[key] = value;
      // Mirror onto the live config so modules read one source of truth.
      if (key === 'controls') CONFIG.input.mode = value;
      if (key === 'effects') { CONFIG.render.glow = !!value; CONFIG.render.particles = !!value; }
      if (key === 'grid') CONFIG.render.showGrid = !!value;
      this.save();
      SR.Events && SR.Events.emit('settings:changed', this.data.settings);
    }
  };

  SR.Storage = Storage;

})(typeof window !== 'undefined' ? window : globalThis);
