/* ==========================================================================
 * main.js - Application bootstrap.
 *
 * Creates every module, wires the DOM buttons, installs the lifecycle
 * listeners (resize, visibility, Android back button) and starts the menu.
 *
 * Everything is created here so the other modules stay free of DOM lookups
 * at load time, which also makes them usable in a head-less test harness.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = global.SR;
  var CONFIG = SR.CONFIG;

  var App = {
    game: null,
    input: null,
    booted: false,

    /* =================================================================== */
    init: function () {
      if (this.booted) return;
      this.booted = true;

      /* --- 1. persistence --------------------------------------------- */
      SR.Storage.init();

      /* --- 2. UI modules ----------------------------------------------- */
      SR.Screens.init();
      SR.Hud.init();
      SR.Shop.init();

      /* --- 3. monetization (real plugin or simulator) ------------------- */
      SR.AdManager.init();
      SR.AdManager.preload();

      /* --- 4. input + game --------------------------------------------- */
      var canvas = document.getElementById('game-canvas');
      this.input = new SR.InputManager({
        // listen on #app, not on the canvas: the joystick and the boost
        // button are siblings of the canvas, and their touches must count
        surface: document.getElementById('app') || canvas,
        joystick: document.getElementById('joystick'),
        knob: document.getElementById('joystick-knob'),
        boostBtn: document.getElementById('boost-btn')
      }).attach();

      this.game = new SR.Game({ canvas: canvas, input: this.input });

      /* --- 5. wiring ---------------------------------------------------- */
      this.bindUI();
      this.bindLifecycle();
      this.syncSettingsUI();

      /* --- 6. go to the menu ------------------------------------------- */
      var self = this;
      global.setTimeout(function () {
        SR.Screens.show('loading', false);
        global.setTimeout(function () {
          SR.Screens.show('menu', false);
          self.game.refreshMenu();
        }, 350);
      }, 450);

      var versionEl = document.getElementById('menu-version');
      if (versionEl) versionEl.textContent = CONFIG.version;

      if (global.console) {
        console.info('%cSnake Royale ' + CONFIG.version + ' ready',
          'color:#35e6ff;font-weight:bold');
      }
    },

    /* =================================================================== *
     * DOM events
     * =================================================================== */
    bindUI: function () {
      var self = this;
      var game = this.game;

      var on = function (id, fn, evt) {
        var el = document.getElementById(id);
        if (!el) return null;
        el.addEventListener(evt || 'click', function (e) {
          SR.Sfx.unlock();
          SR.Sfx.play('click');
          fn(e);
        });
        return el;
      };

      /* --- menu --------------------------------------------------------- */
      on('btn-play', function () { game.startRun(); });
      on('btn-shop', function () { SR.Shop.open(); });
      on('btn-howto', function () { SR.Screens.show('howto', true); });
      on('btn-settings', function () { self.syncSettingsUI(); SR.Screens.show('settings', true); });

      /* --- in-game ------------------------------------------------------ */
      on('btn-pause', function () { game.pause(); });
      on('btn-resume', function () { game.resume(); });
      on('btn-quit', function () { game.quitToMenu(); });

      /* --- game over ---------------------------------------------------- */
      on('btn-revive', function () { game.requestRevive(); });
      on('btn-again', function () { game.playAgain(); });
      on('btn-home', function () { game.quitToMenu(); });

      /* --- settings ------------------------------------------------------ */
      var controls = document.getElementById('set-controls');
      if (controls) {
        controls.addEventListener('click', function (e) {
          var btn = e.target.closest ? e.target.closest('button') : null;
          if (!btn || !btn.dataset.value) return;
          SR.Sfx.play('click');
          SR.Storage.setSetting('controls', btn.dataset.value);
          self.input.setMode(btn.dataset.value);
          self.syncSettingsUI();
        });
      }

      var bindToggle = function (id, key) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', function () {
          var next = el.getAttribute('aria-checked') !== 'true';
          el.setAttribute('aria-checked', next ? 'true' : 'false');
          SR.Storage.setSetting(key, next);
          if (key === 'sound') { SR.Sfx.unlock(); SR.Sfx.setEnabled(next); SR.Sfx.play('click'); }
          SR.Events.emit('settings:applied', key);
        });
      };
      bindToggle('set-sound', 'sound');
      bindToggle('set-fx', 'effects');
      bindToggle('set-grid', 'grid');

      on('btn-reset', function () {
        if (!global.confirm('Reset all progress (score, coins and skins)?')) return;
        SR.Storage.reset();
        self.syncSettingsUI();
        self.input.setMode(SR.Storage.getSettings().controls);
        game.refreshMenu();
        SR.Screens.toast('Progress reset');
      });

      /* keep the menu numbers fresh whenever we return to it */
      SR.Events.on('screen:changed', function (name) {
        if (name === 'menu') game.refreshMenu();
      });

      /* reflect coin changes in the HUD/menu instantly */
      SR.Events.on('coins:changed', function () {
        var menuCoins = document.getElementById('menu-coins');
        if (menuCoins) menuCoins.textContent = SR.Utils.formatNumber(SR.Storage.getCoins());
      });
    },

    /** Keep the settings screen in sync with the saved profile. */
    syncSettingsUI: function () {
      var s = SR.Storage.getSettings();

      var seg = document.getElementById('set-controls');
      if (seg) {
        var buttons = seg.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
          buttons[i].classList.toggle('is-active', buttons[i].dataset.value === s.controls);
        }
      }
      var sound = document.getElementById('set-sound');
      if (sound) sound.setAttribute('aria-checked', s.sound ? 'true' : 'false');
      var fx = document.getElementById('set-fx');
      if (fx) fx.setAttribute('aria-checked', s.effects ? 'true' : 'false');
      var grid = document.getElementById('set-grid');
      if (grid) grid.setAttribute('aria-checked', s.grid ? 'true' : 'false');

      SR.Sfx.setEnabled(!!s.sound);
      CONFIG.render.glow = !!s.effects;
      CONFIG.render.particles = !!s.effects;
      CONFIG.render.showGrid = !!s.grid;
    },

    /* =================================================================== *
     * App lifecycle
     * =================================================================== */
    bindLifecycle: function () {
      var self = this;
      var game = this.game;

      /* --- resize -------------------------------------------------------- */
      var resizeHandler = SR.Utils.throttle(function () { game.resize(); }, 120);
      global.addEventListener('resize', resizeHandler);
      global.addEventListener('orientationchange', function () {
        global.setTimeout(function () { game.resize(); }, 300);
      });

      /* --- tab / app background ------------------------------------------ */
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          if (game.state === SR.Game.STATE.PLAYING) game.pause();
          SR.Sfx.suspend();
        } else {
          SR.Sfx.resume();
        }
      });

      /* --- Android hardware / system back button ------------------------- */
      var backHandler = function (e) {
        if (SR.AdManager.isShowing()) return;            // ads own the back key

        if (game.state === SR.Game.STATE.PLAYING) { game.pause(); return; }
        if (game.state === SR.Game.STATE.PAUSED) { game.resume(); return; }

        var current = SR.Screens.current;
        if (current === 'shop' || current === 'howto' || current === 'settings') {
          SR.Screens.back();
          return;
        }
        if (current === 'gameover') {
          game.quitToMenu();
          return;
        }
        if (current === 'menu') {
          // Cordova / Capacitor can close the app for us
          if (global.navigator && global.navigator.app && global.navigator.app.exitApp) {
            global.navigator.app.exitApp();
          }
        }
      };
      document.addEventListener('backbutton', backHandler, false);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' || e.key === 'Backspace') backHandler(e);
      });

      /* --- unlock audio on the first gesture ----------------------------- */
      var unlock = function () {
        SR.Sfx.unlock();
        SR.Sfx.setEnabled(SR.Storage.getSettings().sound !== false);
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('mousedown', unlock);
        document.removeEventListener('keydown', unlock);
      };
      document.addEventListener('touchstart', unlock, { passive: true });
      document.addEventListener('mousedown', unlock, { passive: true });
      document.addEventListener('keydown', unlock, { passive: true });

      /* --- stop the browser doing anything clever ------------------------ */
      document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
      document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });

      /* --- Capacitor/Cordova are ready ----------------------------------- */
      if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.SplashScreen) {
        global.setTimeout(function () {
          global.Capacitor.Plugins.SplashScreen.hide();
        }, 600);
      }
    }
  };

  SR.App = App;

  /* ====================================================================== *
   * Entry point
   * ====================================================================== */
  function boot() {
    try {
      App.init();
    } catch (err) {
      if (global.console) console.error('[SR] boot failed', err);
      var t = document.getElementById('loading-text');
      if (t) t.textContent = 'Boot error - see console';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    // on Cordova/Capacitor `deviceready` may fire before or after this point;
    // the game does not need any plugin to run, so start immediately.
    boot();
  }

})(typeof window !== 'undefined' ? window : globalThis);
