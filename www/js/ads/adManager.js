/* ==========================================================================
 * adManager.js - Google AdMob integration + fully working placeholder.
 *
 * DESIGN GOAL
 * -----------
 * The game code only ever calls three functions:
 *
 *     SR.AdManager.showRewarded({ onReward, onClose, onFail })
 *     SR.AdManager.showInterstitial({ onClose })
 *     SR.AdManager.preload()
 *
 * At runtime the manager looks for a *real* AdMob bridge:
 *
 *   1. Capacitor  -> @capacitor-community/admob   (window.Capacitor.Plugins.AdMob)
 *   2. Cordova    -> cordova-plugin-admob-free    (window.admob)
 *
 * If (and only if) that bridge exists and works, real ads are requested.
 * Otherwise - in the browser, in the APK before you add the plugin, or if
 * the network fails - it transparently falls back to the built-in
 * SIMULATED ad player, which plays a 30 second "video", fires the very same
 * callbacks and revives the player. That means the whole monetization flow
 * is testable end-to-end without an AdMob account.
 *
 * ---------------------------------------------------------------------------
 * GOING LIVE: put your real ad unit ids in js/core/config.js -> ads.adUnits
 * and install the plugin (see README.md, section "Monetization").
 * ---------------------------------------------------------------------------
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var CONFIG = SR.CONFIG;

  var AdManager = {
    /* --- state --------------------------------------------------------- */
    bridge: null,            // { type, api } when a native plugin is present
    initialized: false,
    rewardedReady: false,
    interstitialReady: false,
    _showing: false,
    _lastInterstitialAt: 0,
    _els: null,
    _timer: null,

    /* =====================================================================
     * Setup
     * ===================================================================== */
    init: function () {
      this._els = {
        screen: document.getElementById('screen-ad'),
        timer: document.getElementById('ad-timer'),
        progress: document.getElementById('ad-progress-fill'),
        close: document.getElementById('ad-close'),
        title: document.getElementById('ad-title')
      };
      this._detectBridge();
      this.initialized = true;
      // never show an interstitial on the very first round: start the
      // frequency cap clock now.
      this._lastInterstitialAt = Date.now();

      // simulated ads "load in the background" like real ones
      var self = this;
      global.setTimeout(function () { self.rewardedReady = true; }, 900);
      global.setTimeout(function () { self.interstitialReady = true; }, 1400);

      if (this.bridge) {
        try { this._nativeInit(); } catch (e) {
          if (global.console) console.warn('[SR.Ads] native init failed, using simulator', e);
          this.bridge = null;
        }
      }

      if (global.console) {
        console.info('[SR.Ads] ready - backend: ' + (this.bridge ? this.bridge.type : 'simulator'));
      }
      return this;
    },

    /** Look for a Capacitor or Cordova AdMob plugin. */
    _detectBridge: function () {
      try {
        if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.AdMob) {
          this.bridge = { type: 'capacitor', api: global.Capacitor.Plugins.AdMob };
          return;
        }
        if (global.admob && global.admob.rewardvideo) {
          this.bridge = { type: 'cordova', api: global.admob };
          return;
        }
        if (global.plugins && global.plugins.AdMob) {
          this.bridge = { type: 'cordova', api: global.plugins.AdMob };
          return;
        }
      } catch (e) { /* ignore */ }
      this.bridge = null;
    },

    _adUnit: function (kind) {
      var isIOS = /iPad|iPhone|iPod/.test(global.navigator ? global.navigator.userAgent : '');
      var set = isIOS ? CONFIG.ads.adUnits.ios : CONFIG.ads.adUnits.android;
      return set[kind];
    },

    _nativeInit: function () {
      var b = this.bridge;
      if (b.type === 'capacitor') {
        b.api.initialize({
          requestTrackingAuthorization: true,
          initializeForTesting: !!CONFIG.ads.testMode
        });
      } else {
        // cordova-plugin-admob-free initialises itself from the plugin vars
        if (b.api.setOptions) {
          b.api.setOptions({ isTesting: !!CONFIG.ads.testMode, autoShowBanner: false, autoShowInterstitial: false });
        }
      }
    },

    /* =====================================================================
     * Public API
     * ===================================================================== */

    /** Warm up both formats (harmless in simulation). */
    preload: function () {
      if (!CONFIG.ads.enabled) return;
      if (!this.bridge) return;                 // simulator is always ready
      var self = this;
      try {
        if (this.bridge.type === 'capacitor') {
          this.bridge.api.prepareRewardVideoAd({ adId: this._adUnit('rewarded') })
            .then(function () { self.rewardedReady = true; })['catch'](function () {});
          this.bridge.api.prepareInterstitial({ adId: this._adUnit('interstitial') })
            .then(function () { self.interstitialReady = true; })['catch'](function () {});
        } else {
          this.rewardedReady = true;
          this.interstitialReady = true;
        }
      } catch (e) { /* fall back to the simulator at show time */ }
    },

    /**
     * Show a rewarded video.
     * @param {object} opts
     * @param {Function} opts.onReward  granted - revive the player
     * @param {Function} opts.onClose   always called last (granted:boolean)
     * @param {Function} opts.onFail    no fill / error
     */
    showRewarded: function (opts) {
      opts = opts || {};
      var self = this;

      if (!CONFIG.ads.enabled) { if (opts.onFail) opts.onFail('ads-disabled'); return; }
      if (this._showing) { if (opts.onFail) opts.onFail('already-showing'); return; }
      if (CONFIG.ads.simulateNoFill) {
        if (opts.onFail) opts.onFail('no-fill');
        return;
      }

      this._showing = true;
      var granted = false;

      var finish = function (reason) {
        self._showing = false;
        self._hideAdUI();
        SR.Events.emit('ad:closed', { kind: 'rewarded', granted: granted, reason: reason });
        if (opts.onClose) opts.onClose(granted);
      };

      var grant = function () {
        if (granted) return;
        granted = true;
        SR.Events.emit('ad:reward', { kind: 'rewarded' });
        if (opts.onReward) opts.onReward();
      };

      if (this.bridge) {
        try {
          this._showNativeRewarded(grant, function () { finish('native'); });
          return;
        } catch (e) {
          if (global.console) console.warn('[SR.Ads] native rewarded failed -> simulator', e);
          this.bridge = null;
        }
      }

      /* ---- simulated 30 second video ---------------------------------- */
      this._playSimulatedAd({
        seconds: CONFIG.debug ? 5 : CONFIG.ads.rewardedDurationSec,
        title: 'Rewarded video (simulated)',
        onComplete: function () { grant(); },
        onFinished: function () { finish('simulated'); }
      });
    },

    /**
     * Show an interstitial (called between rounds).
     * @param {object} opts
     * @param {Function} [opts.onClose]
     * @param {boolean} [opts.force] ignore the frequency cap
     */
    showInterstitial: function (opts) {
      opts = opts || {};
      var self = this;

      if (!CONFIG.ads.enabled || !CONFIG.ads.interstitialsEnabled) {
        if (opts.onClose) opts.onClose(false);
        return;
      }
      if (this._showing) { if (opts.onClose) opts.onClose(false); return; }

      // respect the frequency cap so players are not spammed
      var since = (Date.now() - this._lastInterstitialAt) / 1000;
      if (!opts.force && since < CONFIG.ads.interstitialCooldownSec) {
        if (opts.onClose) opts.onClose(false);
        return;
      }
      this._lastInterstitialAt = Date.now();
      this._showing = true;

      var finish = function (shown) {
        self._showing = false;
        self._hideAdUI();
        SR.Events.emit('ad:closed', { kind: 'interstitial', granted: false });
        if (opts.onClose) opts.onClose(shown !== false);
      };

      if (this.bridge) {
        try {
          this._showNativeInterstitial(function () { finish(true); });
          return;
        } catch (e) {
          if (global.console) console.warn('[SR.Ads] native interstitial failed -> simulator', e);
          this.bridge = null;
        }
      }

      this._playSimulatedAd({
        seconds: CONFIG.debug ? 3 : 5,
        title: 'Interstitial (simulated)',
        skippableAfter: 3,
        onFinished: function () { finish(true); }
      });
    },

    isRewardedReady: function () { return CONFIG.ads.enabled && this.rewardedReady; },

    /* =====================================================================
     * Native adapters
     * ===================================================================== */
    _showNativeRewarded: function (grant, done) {
      var b = this.bridge;
      var api = b.api;
      var self = this;

      if (b.type === 'capacitor') {
        var listener = api.addListener('onRewarded', function () {
          if (listener && listener.remove) listener.remove();
          grant();
        });
        api.prepareRewardVideoAd({ adId: this._adUnit('rewarded') })
          .then(function () { return api.showRewardVideoAd(); })
          .then(function () {
            if (listener && listener.remove) listener.remove();
            done();
          })['catch'](function (err) {
            if (global.console) console.warn('[SR.Ads] capacitor rewarded error', err);
            if (listener && listener.remove) listener.remove();
            done();
          });
        return;
      }

      /* cordova-plugin-admob-free */
      document.addEventListener('admob.rewardvideo.events.REWARD', function onReward() {
        document.removeEventListener('admob.rewardvideo.events.REWARD', onReward);
        grant();
      });
      document.addEventListener('admob.rewardvideo.events.CLOSE', function onClose() {
        document.removeEventListener('admob.rewardvideo.events.CLOSE', onClose);
        done();
      });
      api.rewardvideo.load({ id: this._adUnit('rewarded'), isTesting: CONFIG.ads.testMode });
      api.rewardvideo.show();
    },

    _showNativeInterstitial: function (done) {
      var b = this.bridge;
      var api = b.api;

      if (b.type === 'capacitor') {
        api.prepareInterstitial({ adId: this._adUnit('interstitial') })
          .then(function () { return api.showInterstitial(); })
          .then(done)['catch'](done);
        return;
      }

      document.addEventListener('admob.interstitial.events.CLOSE', function onClose() {
        document.removeEventListener('admob.interstitial.events.CLOSE', onClose);
        done();
      });
      api.interstitial.load({ id: this._adUnit('interstitial'), isTesting: CONFIG.ads.testMode });
      api.interstitial.show();
    },

    /* =====================================================================
     * Simulated ad player (the placeholder UI)
     * ===================================================================== */

    /**
     * @param {object} o
     * @param {number} o.seconds         video length
     * @param {string} o.title
     * @param {Function} [o.onComplete]  fired when the video finishes
     * @param {Function} o.onFinished    fired after the user closes
     * @param {number} [o.skippableAfter] seconds before the X appears
     */
    _playSimulatedAd: function (o) {
      var els = this._els;
      if (!els || !els.screen) {                       // headless (tests)
        if (o.onComplete) o.onComplete();
        if (o.onFinished) o.onFinished();
        return;
      }

      var self = this;
      var total = Math.max(1, o.seconds);
      var elapsed = 0;
      var skippableAfter = o.skippableAfter != null ? o.skippableAfter : total;
      var completed = false;

      els.screen.classList.add('is-active');
      els.close.classList.add('is-hidden');
      els.timer.classList.remove('is-hidden');
      if (els.title) els.title.textContent = o.title;
      els.timer.textContent = String(Math.ceil(total - elapsed));
      if (els.progress) els.progress.style.width = '0%';

      if (this._timer) global.clearInterval(this._timer);
      this._timer = global.setInterval(function () {
        elapsed += 0.1;
        var left = Math.max(0, total - elapsed);
        els.timer.textContent = String(Math.ceil(left));
        if (els.progress) els.progress.style.width = ((elapsed / total) * 100).toFixed(1) + '%';

        if (left <= 0 && !completed) {
          completed = true;
          els.timer.classList.add('is-hidden');
          els.close.classList.remove('is-hidden');
          if (o.onComplete) o.onComplete();
        } else if (elapsed >= skippableAfter && !completed) {
          els.close.classList.remove('is-hidden');
        }
      }, 100);

      /* close handler (added once per impression) */
      var onCloseClick = function () {
        global.clearInterval(self._timer);
        self._timer = null;
        els.close.removeEventListener('click', onCloseClick);
        // closing early forfeits the reward - exactly like a real ad
        if (o.onFinished) o.onFinished();
      };
      els.close.addEventListener('click', onCloseClick);
    },

    _hideAdUI: function () {
      if (this._timer) { global.clearInterval(this._timer); this._timer = null; }
      if (!this._els) return;
      if (this._els.screen) this._els.screen.classList.remove('is-active');
      if (this._els.close) this._els.close.classList.add('is-hidden');
    },

    /** True while any ad covers the screen (used to pause the game loop). */
    isShowing: function () { return this._showing; }
  };

  SR.AdManager = AdManager;

})(typeof window !== 'undefined' ? window : globalThis);
