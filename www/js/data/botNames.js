/* ==========================================================================
 * botNames.js - Flavour names + personality archetypes for the AI snakes.
 *
 * A "personality" is just a bundle of weights the BotBrain consumes:
 *   aggression : how eager it is to hunt & trap smaller snakes
 *   greed      : how strongly food pulls it
 *   caution    : how much space it keeps from other bodies
 *   skill      : reaction speed + look-ahead quality (0..1)
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});

  SR.BOT_NAMES = [
    'Viper', 'Rattler', 'Cobra', 'Mamba', 'Python', 'Boa', 'Krait', 'Adder',
    'Hydra', 'Basilisk', 'Anaconda', 'Sidewinder', 'Serpent', 'Viperion',
    'Noodle', 'Slither', 'Fang', 'Venom', 'Coil', 'Scale'
  ];

  /** Archetypes are picked at random when a bot spawns. */
  SR.BOT_PERSONALITIES = [
    { id: 'hunter',   aggression: 0.95, greed: 0.45, caution: 0.55, skill: 0.85 },
    { id: 'grazer',   aggression: 0.25, greed: 1.00, caution: 0.70, skill: 0.55 },
    { id: 'brawler',  aggression: 0.80, greed: 0.65, caution: 0.40, skill: 0.70 },
    { id: 'trickster',aggression: 0.70, greed: 0.60, caution: 0.80, skill: 0.95 },
    { id: 'rookie',   aggression: 0.35, greed: 0.85, caution: 0.45, skill: 0.35 },
    { id: 'titan',    aggression: 0.90, greed: 0.50, caution: 0.85, skill: 0.75 }
  ];

  /** Deterministic-ish name pick that avoids duplicates in a live roster. */
  SR.pickBotName = function (usedNames) {
    var free = SR.BOT_NAMES.filter(function (n) { return usedNames.indexOf(n) < 0; });
    var pool = free.length ? free : SR.BOT_NAMES;
    return pool[(Math.random() * pool.length) | 0];
  };

  SR.pickPersonality = function () {
    return SR.BOT_PERSONALITIES[(Math.random() * SR.BOT_PERSONALITIES.length) | 0];
  };

})(typeof window !== 'undefined' ? window : globalThis);
