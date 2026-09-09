/* ==========================================================================
 * config.js - Single source of truth for every tunable number in the game.
 *
 * Everything the designer may want to tweak (world size, speeds, bot count,
 * ad timings, prices...) lives here so no magic numbers are spread around.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});

  SR.CONFIG = {
    /* --- meta ------------------------------------------------------------ */
    version: '1.0.0',
    debug: false,              // verbose logging + faster simulated ads

    /* --- arena ----------------------------------------------------------- */
    world: {
      width: 3800,             // world units (not pixels)
      height: 3800,
      gridSize: 110,           // background grid + spatial hash cell size
      wrap: false,             // false => bounded arena: walls are deadly
      borderWidth: 60,         // visual danger band inside the wall
      foodTarget: 420,         // energy dots kept alive on the map
      foodMax: 900,            // hard cap (after a big snake explodes)
      coinTarget: 22,          // golden coins kept alive on the map
      coinMax: 60,
      coinRespawn: 5           // seconds before a coin respawns elsewhere
    },

    /* --- simulation ------------------------------------------------------ */
    game: {
      fixedStep: 1 / 60,       // deterministic logic step
      maxFrameTime: 0.25,      // clamp after tab-out / long GC pauses
      botCount: 7,             // AI snakes (spec: 5 - 10)
      minBots: 5,
      maxBots: 10,
      botRespawnDelay: 3.5,    // seconds before a dead bot re-enters
      maxDeathFood: 140,       // cap of dots dropped when a snake explodes
      startLength: 16,         // player & bot starting segment count
      botStartLengthMin: 12,
      botStartLengthMax: 60,   // "various sizes"
      scorePerMass: 10,        // score gained per unit of food mass
      coinsPerScore: 1 / 25,   // end-of-run coin bonus
      killBonus: 50,           // score for eliminating another snake
      safeSpawnTries: 40,      // attempts to find a collision-free spawn
      spawnClearRadius: 240    // min distance between a spawn and other snakes
    },

    /* --- snakes ---------------------------------------------------------- */
    snake: {
      baseRadius: 11,          // head radius at length 0
      radiusGrowth: 1.25,      // radius = base + growth * sqrt(length)
      maxRadius: 30,
      spacingFactor: 0.52,     // distance between body joints = radius * this
      baseSpeed: 178,          // world units / second
      boostMultiplier: 1.85,
      turnRate: 3.9,           // radians / second at base radius
      turnRateFalloff: 0.4,    // bigger snakes turn slower
      boostDrain: 2.4,         // segments burned per second while boosting
      minBoostLength: 22,      // below this you cannot boost
      growthPerMass: 2,        // segments added per unit of food mass
      startInvuln: 1.6,        // spawn protection (seconds)
      reviveInvuln: 3          // protection after a rewarded revive
    },

    /* --- camera ---------------------------------------------------------- */
    camera: {
      baseZoom: 1,
      minZoom: 0.45,
      maxZoom: 1.1,
      referenceRadius: 18,     // zoom is relative to this head radius
      followLerp: 9,           // higher = snappier (per second, exponential)
      zoomLerp: 1.6,
      lookAhead: 0.42          // camera shifts towards where you are heading
    },

    /* --- rendering ------------------------------------------------------- */
    render: {
      maxDPR: 2,               // cap device pixel ratio (perf vs. sharpness)
      showGrid: true,
      glow: true,
      particles: true,
      maxParticles: 240,
      lowFpsThreshold: 45,     // adaptive quality kicks in below this
      highFpsThreshold: 55
    },

    /* --- input ----------------------------------------------------------- */
    input: {
      mode: 'joystick',        // 'joystick' | 'touch' | 'both'  (persisted)
      joystickRadius: 54,      // knob travel in CSS pixels
      deadZone: 0.16,          // ignore tiny stick deflections
      swipeThreshold: 16,      // px before a drag counts as steering
      keyTurnRate: 3.2
    },

    /* --- AdMob (placeholder friendly) ----------------------------------- */
    ads: {
      enabled: true,
      testMode: true,          // use Google's official sample ad units
      rewardedDurationSec: 30, // simulated video length (spec: 30s)
      interstitialsEnabled: true,
      interstitialCooldownSec: 90,
      simulateNoFill: false,   // simulate "no ad available"
      /* Replace with your own IDs before publishing (AdMob dashboard). */
      adUnits: {
        android: {
          appId: 'ca-app-pub-3940256099942544~3347511713',
          rewarded: 'ca-app-pub-3940256099942544/5224354917',
          interstitial: 'ca-app-pub-3940256099942544/1033173712'
        },
        ios: {
          appId: 'ca-app-pub-3940256099942544~1458002511',
          rewarded: 'ca-app-pub-3940256099942544/1712485313',
          interstitial: 'ca-app-pub-3940256099942544/4411468910'
        }
      }
    },

    /* --- storage --------------------------------------------------------- */
    storage: {
      prefix: 'snakeRoyale.v1.'
    },

    /* --- economy --------------------------------------------------------- */
    economy: {
      coinValues: [1, 1, 1, 2, 3],   // random coin worth when it spawns
      foodValues: [1, 1, 1, 2],      // random energy dot worth
      deathDropValue: 2              // mass of each dot dropped on death
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
