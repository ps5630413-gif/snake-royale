/* ==========================================================================
 * sfx.js - Procedural sound effects (WebAudio, zero audio files).
 *
 * The Web Audio context can only start after a user gesture on mobile, so
 * unlock() is called from the first tap / click. Every sound is synthesised
 * on the fly which keeps the APK tiny and avoids loading hitches.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});

  var Sfx = {
    enabled: true,
    ctx: null,
    master: null,
    _ready: false,

    /** Create / resume the audio context (call from a user gesture). */
    unlock: function () {
      if (this._ready) {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        this._ready = true;
      } catch (e) {
        this._ready = false;
      }
    },

    setEnabled: function (on) {
      this.enabled = !!on;
      if (this.master) this.master.gain.value = on ? 0.5 : 0;
    },

    suspend: function () { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); },
    resume: function () { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },

    /* ------------------------------------------------------------ helpers */
    _tone: function (o) {
      if (!this.enabled || !this._ready) return;
      var ctx = this.ctx;
      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.freq, now);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), now + (o.dur || 0.15));

      var peak = (o.gain == null ? 0.25 : o.gain);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + (o.attack || 0.01));
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (o.dur || 0.15));

      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + (o.dur || 0.15) + 0.02);
    },

    _noise: function (o) {
      if (!this.enabled || !this._ready) return;
      var ctx = this.ctx;
      var dur = o.dur || 0.3;
      var frames = Math.floor(ctx.sampleRate * dur);
      var buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < frames; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
      }
      var src = ctx.createBufferSource();
      src.buffer = buffer;

      var filter = ctx.createBiquadFilter();
      filter.type = o.filterType || 'lowpass';
      filter.frequency.setValueAtTime(o.freq || 900, ctx.currentTime);
      if (o.freqTo) filter.frequency.exponentialRampToValueAtTime(o.freqTo, ctx.currentTime + dur);

      var gain = ctx.createGain();
      gain.gain.setValueAtTime(o.gain == null ? 0.3 : o.gain, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start();
    },

    /* --------------------------------------------------------------- bank */
    play: function (name) {
      if (!this.enabled || !this._ready) return;
      switch (name) {
        case 'eat':
          this._tone({ type: 'sine', freq: 520, to: 880, dur: 0.12, gain: 0.18 });
          break;
        case 'coin':
          this._tone({ type: 'square', freq: 988, dur: 0.08, gain: 0.12 });
          var self = this;
          setTimeout(function () { self._tone({ type: 'square', freq: 1319, dur: 0.12, gain: 0.12 }); }, 70);
          break;
        case 'kill':
          this._tone({ type: 'triangle', freq: 330, to: 660, dur: 0.18, gain: 0.2 });
          this._tone({ type: 'triangle', freq: 660, to: 990, dur: 0.22, gain: 0.14 });
          break;
        case 'die':
          this._noise({ dur: 0.55, freq: 1800, freqTo: 120, gain: 0.4 });
          this._tone({ type: 'sawtooth', freq: 220, to: 55, dur: 0.5, gain: 0.22 });
          break;
        case 'boost':
          this._noise({ dur: 0.22, freq: 400, freqTo: 2200, gain: 0.12, filterType: 'bandpass' });
          break;
        case 'click':
          this._tone({ type: 'square', freq: 660, to: 880, dur: 0.05, gain: 0.08 });
          break;
        case 'unlock':
          this._tone({ type: 'sine', freq: 523, dur: 0.14, gain: 0.18 });
          this._tone({ type: 'sine', freq: 659, dur: 0.14, gain: 0.16 });
          this._tone({ type: 'sine', freq: 784, dur: 0.24, gain: 0.16 });
          break;
        case 'revive':
          this._tone({ type: 'sine', freq: 392, to: 784, dur: 0.35, gain: 0.22 });
          break;
        case 'start':
          this._tone({ type: 'triangle', freq: 440, to: 880, dur: 0.25, gain: 0.18 });
          break;
        default:
          break;
      }
    }
  };

  SR.Sfx = Sfx;

})(typeof window !== 'undefined' ? window : globalThis);
