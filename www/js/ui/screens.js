/* ==========================================================================
 * screens.js - Full screen UI state machine (menu / shop / pause / game over).
 *
 * A screen is any <section class="screen" id="screen-NAME"> in index.html.
 * Only one is visible at a time (except the ad overlay, which stacks).
 * The manager also owns the little toast notifications.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});

  var Screens = {
    els: Object.create(null),
    current: null,
    _stack: [],
    _toastTimer: null,

    init: function () {
      var nodes = document.querySelectorAll('.screen');
      for (var i = 0; i < nodes.length; i++) {
        var id = nodes[i].id.replace(/^screen-/, '');
        this.els[id] = nodes[i];
      }
      this.toastEl = document.getElementById('toast');

      // every [data-back] button returns to the previous screen
      var backs = document.querySelectorAll('[data-back]');
      for (var b = 0; b < backs.length; b++) {
        backs[b].addEventListener('click', function () { Screens.back(); });
      }
      return this;
    },

    /** Hide every screen (used when gameplay starts). */
    hideAll: function () {
      Object.keys(this.els).forEach(function (key) {
        if (key === 'ad') return;              // ad overlay is managed separately
        Screens.els[key].classList.remove('is-active');
      });
      this.current = null;
    },

    /**
     * @param {string} name screen id without the "screen-" prefix
     * @param {boolean} [stack] remember the previous screen for back()
     */
    show: function (name, stack) {
      var el = this.els[name];
      if (!el) return;
      if (stack !== false && this.current && this.current !== name) this._stack.push(this.current);
      this.hideAll();
      el.classList.add('is-active');
      this.current = name;
      SR.Events.emit('screen:changed', name);
    },

    hide: function (name) {
      var el = this.els[name];
      if (el) el.classList.remove('is-active');
      if (this.current === name) this.current = null;
    },

    isOpen: function (name) {
      var el = this.els[name];
      return !!(el && el.classList.contains('is-active'));
    },

    /** True when any UI screen covers the game (ads excluded). */
    isAnyOpen: function () {
      var keys = Object.keys(this.els);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i] === 'ad') continue;
        if (this.els[keys[i]].classList.contains('is-active')) return true;
      }
      return false;
    },

    /** Pop the navigation stack (Android back button / back arrow). */
    back: function () {
      var prev = this._stack.pop() || 'menu';
      this.show(prev, false);
      return prev;
    },

    clearStack: function () { this._stack.length = 0; },

    /* ------------------------------------------------------------- toast */
    toast: function (message, ms) {
      var el = this.toastEl;
      if (!el) return;
      el.textContent = message;
      el.classList.add('is-visible');
      if (this._toastTimer) global.clearTimeout(this._toastTimer);
      this._toastTimer = global.setTimeout(function () {
        el.classList.remove('is-visible');
      }, ms || 1800);
    }
  };

  SR.Screens = Screens;

})(typeof window !== 'undefined' ? window : globalThis);
