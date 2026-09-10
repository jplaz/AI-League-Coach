// How dangerous a place is, as a number.
//
// The map has one honest source of fear and one dishonest one. The honest one
// is an enemy you can see: they are there, they are that far away, and if there
// is one of them and one of you that is not danger, it is lane. The dishonest
// one is an enemy you cannot see, which is more frightening and should be,
// because the ones that kill you are the ones you had not accounted for.
//
// So this file answers three separate questions and never blurs them. `at` is
// everything that could hurt you. `hiddenAt` is only what you cannot currently
// see - the number that should make you walk away. `odds` is a headcount of who
// is actually near enough to fight, which is what stops the coach shouting
// about the enemy mid laner standing where the enemy mid laner stands.

import { dist, halfDepth, forTeam, P } from '../model/rift.js';
import { junglerThreat } from './jungle.js';

/** After this long unseen, one enemy stops being a place and becomes a mood. */
const FADE = 70;

/** How near counts as "in this fight". */
export const NEAR = 0.16;

export function buildThreat({
  team, gameTime, contacts = [], allies = [], jungler = null,
  enemyCount = 5, deadEnemies = 0,
}) {
  const sources = [];

  for (const c of contacts) {
    const age = Math.max(0, gameTime - (c.lastSeen ?? gameTime));
    if (age > FADE * 1.5) continue;
    const fresh = Math.max(0, 1 - age / FADE);
    sources.push({
      pos: c.pos,
      radius: 0.055 + age * 0.0028,
      weight: c.visible ? 1 : 0.35 + 0.55 * fresh,
      visible: !!c.visible,
      label: c.visible ? (c.champion ?? 'Visible') : `Last seen ${Math.round(age)}s ago`,
      kind: 'contact',
    });
  }

  if (jungler && jungler.confidence > 0.12) {
    sources.push({
      pos: jungler.pos,
      radius: jungler.radius,
      weight: 0.55 + jungler.confidence * 0.45,
      visible: false,
      label: `Their jungler: ${jungler.note}`,
      kind: 'jungler',
    });
  }

  /* Whatever is left over: enemies alive, not visible, and not otherwise
     accounted for. They are somewhere, and "somewhere" means their half. */
  const accounted = contacts.filter((c) => c.visible).length + deadEnemies;
  const unaccounted = Math.max(0, enemyCount - accounted);

  /* Standing in their half is its own risk, proportional to how many of them
     could walk out of the fog to meet you there. */
  const fromDepth = (point) => {
    const depth = team === 'CHAOS' ? -halfDepth(point) : halfDepth(point);
    if (depth <= 0) return 0;
    return Math.min(0.75, depth * 1.6 * (unaccounted / 5));
  };

  const worstOf = (point, list) => {
    let worst = 0;
    for (const s of list) {
      const reach = s.radius + 0.13;
      const d = dist(s.pos, point);
      if (d >= reach) continue;
      worst = Math.max(worst, s.weight * (1 - d / reach));
    }
    return worst;
  };

  const hidden = sources.filter((s) => !s.visible);

  return {
    sources,
    unaccounted,
    /** Everything that could hurt you here, seen or not. */
    at: (p) => (p ? Math.min(1, Math.max(worstOf(p, sources), fromDepth(p))) : 0),
    /** Only what you cannot see. The number worth retreating from. */
    hiddenAt: (p) => (p ? Math.min(1, Math.max(worstOf(p, hidden), fromDepth(p))) : 0),
    /** Who is close enough to be in the fight, counting you. */
    odds: (p, radius = NEAR) => {
      if (!p) return { enemies: 0, allies: 1, outnumbered: false };
      const e = contacts.filter((c) => c.visible && dist(c.pos, p) <= radius).length;
      const a = 1 + allies.filter((c) => c.visible !== false && dist(c.pos, p) <= radius).length;
      return { enemies: e, allies: a, outnumbered: e > a };
    },
    threatFromJungler: (p) => junglerThreat(jungler, p),
  };
}

/**
 * Somewhere safer than here, without going all the way home. Walks back toward
 * your own fountain until the danger drops off, and stops at the first place
 * that is meaningfully better rather than the safest place on the map - the
 * advice has to be a step you would actually take.
 */
export function retreatFrom(point, team, threat) {
  const home = forTeam(P.fountain, team);
  const here = threat.at(point);
  let best = { pos: point, value: here };
  for (let t = 0.08; t <= 0.5; t += 0.06) {
    const p = { x: point.x + (home.x - point.x) * t, y: point.y + (home.y - point.y) * t };
    const v = threat.at(p);
    if (v < best.value - 0.12) return { pos: p, value: v, from: here };
    if (v < best.value) best = { pos: p, value: v };
  }
  return { ...best, from: here };
}
