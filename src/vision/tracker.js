// Remembering what the minimap showed a moment ago.
//
// A single frame is nearly useless. It says four red dots, and four red dots
// are not four enemies - they are four enemies if the fifth was somewhere a
// second ago and is now in the fog, or three enemies and a ping if a frame
// dropped. What turns dots into knowledge is continuity: a dot that appears
// where a dot was is the same champion, a dot that stops appearing is not gone
// but hidden, and hidden is the thing worth telling the player about.
//
// So this holds tracks rather than detections, and a track's most valuable
// field is the one that says when anybody last actually saw it.

import { nearestLane, dist } from '../model/rift.js';

/** How far a champion can move between frames and still be the same champion. */
const MATCH = 0.09;

/** A track nobody has seen for this long is dropped rather than trusted. */
const FORGET = 90;

/** Off any lane by this much, on their side of the map: probably the jungler. */
const OFF_LANE = 0.075;

export class ContactTracker {
  constructor(team = 'ORDER') {
    this.team = team;
    this.enemies = [];
    this.allies = [];
    this.self = null;
    this.junglerSightings = [];
    this.lastFrame = 0;
  }

  setTeam(team) { this.team = team; }

  /** Fold one frame's detections into what we already believed. */
  update(gameTime, detection) {
    if (!detection) return;
    this.lastFrame = gameTime;
    this.enemies = matchTracks(this.enemies, detection.enemies, gameTime);
    this.allies = matchTracks(this.allies, detection.allies, gameTime, 5);
    this.self = pickSelf(detection, this.self);
    this.noteJungler(gameTime);
  }

  /**
   * Which of those red dots is their jungler.
   *
   * Nothing on the minimap says. What says it, near enough, is standing in the
   * jungle: a laner in the enemy jungle at eight minutes is a rare event and a
   * jungler there is every twenty seconds. A wrong guess here degrades into a
   * wider circle on the map rather than a wrong instruction, which is why the
   * heuristic is allowed to be this rough.
   */
  noteJungler(gameTime) {
    for (const t of this.enemies) {
      if (!t.visible) continue;
      if (nearestLane(t.pos).d < OFF_LANE) continue;
      const last = this.junglerSightings.at(-1);
      if (last && gameTime - last.at < 4 && dist(last.pos, t.pos) < 0.05) {
        last.at = gameTime;
        last.pos = t.pos;
        return;
      }
      this.junglerSightings.push({ pos: { ...t.pos }, at: gameTime });
      if (this.junglerSightings.length > 12) this.junglerSightings.shift();
      return;
    }
  }

  /** Enemy contacts as the engine wants them, freshest first. */
  contacts(gameTime) {
    return this.enemies
      .filter((t) => gameTime - t.lastSeen < FORGET)
      .map((t) => ({ pos: t.pos, lastSeen: t.lastSeen, visible: t.visible }))
      .sort((a, b) => b.lastSeen - a.lastSeen);
  }

  allyContacts(gameTime) {
    return this.allies
      .filter((t) => gameTime - t.lastSeen < 12)
      .map((t) => ({ pos: t.pos, lastSeen: t.lastSeen, visible: t.visible }));
  }

  /**
   * How hard your lane is pushed, guessed from where you have been standing.
   * You are not the wave, but over a few seconds you are close enough to it,
   * and a marker that follows the lane you are actually in beats one pinned to
   * the middle of a lane you left two minutes ago.
   */
  push(lane) {
    if (!this.self || !lane) return 0;
    const near = nearestLane(this.self);
    if (near.lane !== lane || near.d > 0.08) return 0;
    const t = this.team === 'CHAOS' ? 1 - near.t : near.t;
    return Math.max(-1, Math.min(1, (t - 0.5) / 0.28));
  }

  forget() {
    this.enemies = [];
    this.allies = [];
    this.self = null;
    this.junglerSightings = [];
  }
}

/** Greedy nearest-neighbour matching of detections onto existing tracks. */
function matchTracks(tracks, detections = [], gameTime, cap = 5) {
  const free = detections.map((d) => ({ ...d, used: false }));
  for (const t of tracks) t.visible = false;

  for (const t of tracks) {
    let best = null;
    let bestD = MATCH;
    for (const d of free) {
      if (d.used) continue;
      const dd = dist(t.pos, d);
      if (dd < bestD) { bestD = dd; best = d; }
    }
    if (best) {
      best.used = true;
      t.pos = { x: best.x, y: best.y };
      t.lastSeen = gameTime;
      t.visible = true;
    }
  }

  const out = [...tracks];
  for (const d of free) {
    if (d.used) continue;
    out.push({ pos: { x: d.x, y: d.y }, lastSeen: gameTime, visible: true });
  }

  /* More tracks than there are champions on that team means something was
     double-counted; the stalest one is the one to let go of. */
  out.sort((a, b) => b.lastSeen - a.lastSeen);
  return out.slice(0, cap).filter((t) => gameTime - t.lastSeen < FORGET);
}

/**
 * Where you are. The white ring is you, and when a ping or a recall animation
 * eats it for a few frames, the nearest ally dot to where you just were is a
 * better answer than none - one of those dots is you by definition.
 */
function pickSelf(detection, previous) {
  const white = detection.self ?? [];
  if (white.length === 1) return smooth(previous, white[0]);
  if (white.length > 1 && previous) {
    const near = [...white].sort((a, b) => dist(a, previous) - dist(b, previous))[0];
    return smooth(previous, near);
  }
  if (previous) {
    const allies = detection.allies ?? [];
    const near = allies.filter((a) => dist(a, previous) < MATCH)
      .sort((a, b) => dist(a, previous) - dist(b, previous))[0];
    if (near) return smooth(previous, near);
  }
  return previous;
}

/** A little smoothing, so the marker does not shiver between frames. */
function smooth(previous, next, weight = 0.55) {
  if (!previous) return { x: next.x, y: next.y };
  return {
    x: previous.x + (next.x - previous.x) * weight,
    y: previous.y + (next.y - previous.y) * weight,
  };
}
