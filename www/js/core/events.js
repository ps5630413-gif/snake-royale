/* ==========================================================================
 * events.js - Tiny synchronous pub/sub used to keep modules decoupled.
 *
 * Example:
 *   SR.Events.on('player:died', fn);
 *   SR.Events.emit('player:died', { score: 120 });
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});

  function Emitter() {
    this._map = Object.create(null);
  }

  /** Subscribe. Returns an unsubscribe function. */
  Emitter.prototype.on = function (name, fn) {
    (this._map[name] || (this._map[name] = [])).push(fn);
    var self = this;
    return function off() { self.off(name, fn); };
  };

  Emitter.prototype.once = function (name, fn) {
    var off = this.on(name, function (payload) {
      off();
      fn(payload);
    });
    return off;
  };

  Emitter.prototype.off = function (name, fn) {
    var list = this._map[name];
    if (!list) return;
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };

  Emitter.prototype.emit = function (name, payload) {
    var list = this._map[name];
    if (!list) return;
    // copy so handlers can unsubscribe during dispatch
    var snapshot = list.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](payload);
      } catch (err) {
        if (global.console) console.error('[SR.Event] handler failed for "' + name + '"', err);
      }
    }
  };

  Emitter.prototype.clear = function (name) {
    if (name) delete this._map[name];
    else this._map = Object.create(null);
  };

  SR.Emitter = Emitter;
  SR.Events = new Emitter();

})(typeof window !== 'undefined' ? window : globalThis);
