// Every number the coach reasons with about time.
//
// The engine never hardcodes a timing anywhere else. A jungler asking "when is
// the next drake" and a mid laner asking "can I recall before the wave" are
// both, underneath, reading this table. That matters because these numbers are
// the first thing a patch breaks: Baron moved from twenty minutes to twenty
// five, grubs arrived and took Herald's old slot, plates have been at fourteen
// minutes for years and will not be forever. When the coach starts giving
// advice that is a minute out, the fix is here and nowhere else.
//
// Values below are for the live game as of writing. Check them against the
// patch notes you are actually playing on and edit in place.

export const PATCH = {
  /* Minions. The wave clock is the laning phase's metronome - recalls, roams
     and dives are all timed off it. */
  minionsSpawn: 65,        // first wave leaves the nexus
  waveInterval: 30,        // and every thirty seconds after
  waveTravel: {            // spawn -> the two waves meet, per lane
    mid: 28,
    top: 40,
    bot: 40,
  },
  cannonEvery: 3,          // one siege minion every third wave...
  cannonEveryLate: 2,      // ...every second wave after cannonSwitch
  cannonSwitch: 15 * 60,
  cannonEveryEndgame: 1,   // and in every wave once the game is this old
  cannonEndgame: 25 * 60,

  /* Jungle. */
  campsSpawn: 90,
  campRespawn: 135,
  scuttleFirst: 210,
  scuttleRespawn: 150,

  /* Epic monsters. */
  dragonFirst: 5 * 60,
  dragonRespawn: 5 * 60,
  soulAt: 4,               // drakes one team needs before the soul drake
  elderRespawn: 6 * 60,
  grubsSpawn: 6 * 60,
  grubsSecondSet: 4 * 60,  // after the first set is cleared
  grubsDespawn: 14 * 60,
  heraldSpawn: 14 * 60,
  heraldDespawn: 19 * 60 + 45,
  baronFirst: 25 * 60,
  baronRespawn: 6 * 60,
  atakhanSpawn: 20 * 60,   // set to null on a patch that has no Atakhan

  /* Towers. */
  platesFall: 14 * 60,

  /* Phases the rules switch behaviour on. Deliberately coarse; a game does not
     stop laning at a whistle, but rules have to choose somewhere. */
  laningEnds: 14 * 60,
  midGameEnds: 25 * 60,
};

/**
 * Base respawn wait by champion level, in seconds. Levels 1-18, index 0 unused.
 * The live game hands us the real countdown for anyone already dead, so this
 * table is only used to answer "if I trade my life for this, how long am I
 * out" - which is the question worth asking before the trade, not after.
 */
const BRW = [0, 10, 10, 12, 12, 14, 16, 20, 21, 22, 24, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45];

/**
 * How much longer death costs as the game goes on. Community-documented
 * approximation of the live formula: nothing before fifteen minutes, then a
 * per-half-minute increase that steepens twice.
 */
function timeIncrease(gameTime) {
  const half = (from, to, rate) =>
    Math.max(0, Math.min(gameTime, to) - from) / 30 * rate;
  return half(15 * 60, 30 * 60, 0.00425)
       + half(30 * 60, 45 * 60, 0.0030)
       + half(45 * 60, Infinity, 0.0145);
}

/** Seconds you would be dead for, dying right now at this level. */
export function deathTimer(level, gameTime) {
  const base = BRW[Math.max(1, Math.min(18, Math.round(level || 1)))];
  return base * (1 + timeIncrease(gameTime));
}

/** Which wave (1-indexed) is on its way at this point in the game. */
export function waveNumber(gameTime) {
  if (gameTime < PATCH.minionsSpawn) return 0;
  return Math.floor((gameTime - PATCH.minionsSpawn) / PATCH.waveInterval) + 1;
}

/** When wave `n` leaves the nexus. */
export function waveSpawnTime(n) {
  return PATCH.minionsSpawn + (n - 1) * PATCH.waveInterval;
}

/** Whether wave `n` carries a siege minion. */
export function isCannonWave(n, gameTime = waveSpawnTime(n)) {
  if (n < 1) return false;
  if (gameTime >= PATCH.cannonEndgame) return true;
  const every = gameTime >= PATCH.cannonSwitch ? PATCH.cannonEveryLate : PATCH.cannonEvery;
  return n % every === 0;
}
