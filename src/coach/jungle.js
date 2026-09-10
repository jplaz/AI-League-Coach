// Where their jungler probably is.
//
// This is the single most valuable thing a coach can tell a laner, and it is
// never known - it is inferred, from the last time anyone saw them and from the
// fact that a jungle clear is a loop with a direction. Two sightings give you
// the direction; one sighting and a clock give you a decent guess; nothing at
// all gives you an honest shrug, which the UI is expected to draw as a wide
// circle rather than a confident dot.
//
// The prediction deliberately decays. A guess that keeps insisting after ninety
// seconds is worse than no guess, because a laner will trust it and walk into
// the lane brush on the strength of it.

import { CAMPS, forTeam, mirror, dist, P, NEUTRAL } from '../model/rift.js';

/** Seconds a camp costs, including the walk to the next one. */
export const CAMP_SECONDS = 33;

/** How long a sighting is worth anything at all. */
export const MEMORY = 75;

/** The enemy jungle, in the order a clear walks it, from `team`'s point of view. */
export function enemyCamps(team) {
  return CAMPS.map((c) => ({ ...c, pos: forTeam(mirror(c.pos), team) }));
}

/**
 * A guess at where their jungler is, from whatever sightings we have.
 *
 * `sightings` is oldest-first, each `{ pos, at }` in map space. `objective` is
 * the next epic monster and when it spawns, because a jungler within a minute
 * of a drake is walking to the drake whatever their clear says.
 */
export function predictJungler(team, gameTime, sightings = [], objective = null) {
  const camps = enemyCamps(team);
  const nearestCamp = (p) => {
    let best = 0;
    for (let i = 1; i < camps.length; i++) {
      if (dist(p, camps[i].pos) < dist(p, camps[best].pos)) best = i;
    }
    return best;
  };

  const seen = sightings.filter((s) => gameTime - s.at <= MEMORY * 3).slice(-4);
  const last = seen.at(-1) ?? null;

  if (!last) {
    /* Never seen, or seen so long ago it means nothing. Point at the thing
       they would be pathing to, and admit the guess is nearly worthless. */
    const anchor = objective && objective.in < 90
      ? objectivePoint(objective.key)
      : forTeam(mirror(P.blueBuff), team);
    return {
      pos: anchor, radius: 0.30, confidence: 0.1, sinceSeen: null,
      note: 'Unseen - treat the whole enemy half as theirs',
    };
  }

  const elapsed = Math.max(0, gameTime - last.at);
  const from = nearestCamp(last.pos);

  /* Direction round the loop: two sightings tell us, one leaves us to guess
     from which half of their jungle they were standing in. */
  let dir = 0;
  if (seen.length >= 2) dir = Math.sign(nearestCamp(last.pos) - nearestCamp(seen.at(-2).pos));
  if (dir === 0) dir = from <= 2 ? 1 : -1;

  const steps = Math.floor(elapsed / CAMP_SECONDS) * dir;
  const idx = from + steps;

  let pos;
  let note;
  if (idx < 0 || idx > camps.length - 1) {
    /* Off the end of the clear: the nearer scuttle, or whatever is spawning. */
    const river = dist(last.pos, P.scuttleTop) < dist(last.pos, P.scuttleBot)
      ? P.scuttleTop : P.scuttleBot;
    pos = objective && objective.in < 60 ? objectivePoint(objective.key) : river;
    note = 'Clear finished - river or an objective';
  } else {
    pos = camps[idx].pos;
    note = `${camps[idx].name} on their side, about ${Math.round(elapsed)}s after we saw them`;
  }

  /* A jungler within a minute of a spawning objective is at the objective. */
  if (objective && objective.in != null && objective.in < 45 && elapsed > CAMP_SECONDS) {
    pos = objectivePoint(objective.key);
    note = `Pathing to ${objective.key}`;
  }

  const confidence = Math.max(0.08, 1 - elapsed / MEMORY);
  return {
    pos,
    radius: Math.min(0.32, 0.05 + elapsed * 0.0022),
    confidence,
    sinceSeen: elapsed,
    note,
  };
}

/**
 * The pit an objective is fought over. Not team-relative and never was: the
 * baron pit is in the top half of the map for everybody in the game, and a
 * coach that mirrors it walks red side into the drake pit looking for baron.
 */
export function objectivePoint(key) {
  return NEUTRAL[key] ?? NEUTRAL.centre;
}

/**
 * How much a prediction should worry somebody standing at `point`. Falls off
 * with distance over the prediction's own uncertainty, and is scaled by how
 * much the prediction is worth in the first place.
 */
export function junglerThreat(prediction, point) {
  if (!prediction) return 0;
  const reach = prediction.radius + 0.14;
  const d = dist(prediction.pos, point);
  if (d > reach) return 0;
  return prediction.confidence * (1 - d / reach);
}
