/* ==========================================================================
 * skins.js - Cosmetic snake skins sold in the shop.
 *
 * Adding a skin here is enough: the shop UI, the preview renderer and the
 * in-game renderer all read from this list.
 *
 * colour fields:
 *   core    - bright centre of the body
 *   edge    - darker outline / tail colour
 *   glow    - additive halo colour
 *   pattern - 'solid' | 'stripe' | 'pulse' | 'flame'
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});

  SR.SKINS = [
    {
      id: 'neon-blue',
      name: 'Neon Blue',
      desc: 'The classic ion-blue viper. Free for every rookie.',
      price: 0,
      core: '#7df9ff',
      edge: '#1f6fe0',
      glow: '#35e6ff',
      eye: '#04121f',
      pattern: 'solid'
    },
    {
      id: 'glowing-red',
      name: 'Glowing Red',
      desc: 'Molten plasma coils. Hunters respect the red.',
      price: 150,
      core: '#ff9a7a',
      edge: '#c01b3c',
      glow: '#ff4d6a',
      eye: '#2a0008',
      pattern: 'pulse'
    },
    {
      id: 'golden-viper',
      name: 'Golden Viper',
      desc: 'Solid gold scales. Wear your winnings.',
      price: 400,
      core: '#ffe89a',
      edge: '#c8891f',
      glow: '#ffd257',
      eye: '#2a1a00',
      pattern: 'stripe'
    },
    {
      id: 'plasma-purple',
      name: 'Plasma Purple',
      desc: 'Void energy coils around the body.',
      price: 800,
      core: '#d5a8ff',
      edge: '#6a24d8',
      glow: '#a25cff',
      eye: '#12002a',
      pattern: 'pulse'
    },
    {
      id: 'toxic-green',
      name: 'Toxic Green',
      desc: 'Radioactive and proud of it.',
      price: 1200,
      core: '#c6ff8a',
      edge: '#2f9e3d',
      glow: '#7dff4d',
      eye: '#06210a',
      pattern: 'flame'
    }
  ];

  /** Fast lookup by id (falls back to the first skin). */
  SR.getSkin = function (id) {
    for (var i = 0; i < SR.SKINS.length; i++) {
      if (SR.SKINS[i].id === id) return SR.SKINS[i];
    }
    return SR.SKINS[0];
  };

})(typeof window !== 'undefined' ? window : globalThis);
