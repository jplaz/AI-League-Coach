// The advice itself.
//
// One function per thing worth saying, each handed the whole picture and each
// free to say nothing. A rule returns directives; a directive is a short
// imperative, a reason, a place on the map, and a score out of a hundred saying
// how much it wants to be the thing you read first.
//
// Two conventions keep the output usable rather than merely correct. Scores are
// absolute, not relative - "two of them are dead" is an 85 in every game, so
// rules never need to know about each other. And a directive with a `target`
// is making a claim about where your character should physically be, which the
// map draws as a marker; rules that only want to tell you something leave the
// target null rather than inventing a place to stand.

import {
  P, forTeam, dist, laneAt, inEnemyHalf, fightSpot, wardsFor, campsFor, nearestLane, turret,
} from '../model/rift.js';
import { PATCH } from '../model/patch.js';
import { ROAMERS } from '../model/roles.js';
import { waveInfo, recallWindow, laneMeetPoint } from './wave.js';
import { objectivePoint, junglerThreat } from './jungle.js';
import { retreatFrom } from './threat.js';

const OBJECTIVE_NAMES = {
  drake: 'Drake', elder: 'Elder', baron: 'Baron',
  herald: 'Herald', grubs: 'Void grubs', atakhan: 'Atakhan',
};

/** Void grubs are a they; everything else on this map is an it. */
const isAre = (key) => (key === 'grubs' ? 'are' : 'is');

/** Seconds as the clock in the corner of the screen would write them. */
export function clock(s) {
  const n = Math.max(0, Math.round(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

const directive = (id, kind, score, title, detail, target = null, extra = {}) =>
  ({ id, kind, score: Math.round(score), title, detail, target, ...extra });

/* --------------------------------------------------------------- survival */

/** Dead is not nothing: the next thirty seconds decide where you rejoin. */
function deathRule(ctx) {
  if (!ctx.self.isDead) return [];
  const back = ctx.objective && ctx.objective.in < ctx.self.respawnIn + 45
    ? objectivePoint(ctx.objective.key)
    : ctx.lane ? laneMeetPoint(ctx.lane, ctx.team, 0) : turret('mid', 1, ctx.team);
  const name = ctx.objective ? OBJECTIVE_NAMES[ctx.objective.key] : null;
  return [directive(
    'dead', 'danger', 92,
    `Dead - back in ${clock(ctx.self.respawnIn)}`,
    name && ctx.objective.in < ctx.self.respawnIn + 45
      ? `${name} lands at ${clock(ctx.objective.at)}, about ${clock(Math.abs(ctx.objective.in - ctx.self.respawnIn))} ${ctx.objective.in > ctx.self.respawnIn ? 'after you are up' : 'before you are up'}. Buy for the fight, then walk here.`
      : 'Buy on the way out and rejoin at the safest lane, not the nearest one.',
    back,
  )];
}

/** The one that keeps you alive: outnumbered here, or blind and too far in. */
function dangerRule(ctx) {
  if (ctx.self.isDead || !ctx.self.pos) return [];
  const hidden = ctx.threat.hiddenAt(ctx.self.pos);
  const odds = ctx.threat.odds(ctx.self.pos);
  const deep = inEnemyHalf(ctx.self.pos, ctx.team);
  const unaccounted = ctx.threat.unaccounted;

  /* An enemy laner standing in their lane is not danger, it is the game. What
     is danger: more of them than of you within reach, or a map you cannot see
     while you are standing on their side of it. */
  const collapse = odds.outnumbered && odds.enemies >= 2;
  const blind = hidden >= 0.4 && (deep || unaccounted >= 3);
  if (!collapse && !blind) return [];

  const away = retreatFrom(ctx.self.pos, ctx.team, ctx.threat);
  const score = collapse
    ? 74 + Math.min(18, (odds.enemies - odds.allies) * 9)
    : 60 + hidden * 30;

  return [directive(
    'danger', 'danger', score,
    collapse ? `${odds.enemies} of them, ${odds.allies} of you` : `${unaccounted} unaccounted for`,
    collapse
      ? `You are outnumbered where you are standing. Walk out along your own wave, not through the river.`
      : deep
        ? `Past the river with ${unaccounted} of them unseen. Nothing here is worth what it costs if two arrive.`
        : `${unaccounted} of them could be walking at you and you would not know. Stand where your team can reach you.`,
    away.pos,
  )];
}

/** Their jungler, specifically, and whether they are near enough to matter. */
function junglerRule(ctx) {
  if (ctx.self.isDead || !ctx.jungler) return [];
  const at = ctx.self.pos ?? (ctx.lane ? laneMeetPoint(ctx.lane, ctx.team, 0) : null);
  if (!at) return [];
  const t = junglerThreat(ctx.jungler, at);
  if (t < 0.28) return [];
  return [directive(
    'jungler', 'danger', 55 + t * 30,
    'Their jungler is on you',
    `${ctx.jungler.note}. Confidence ${Math.round(ctx.jungler.confidence * 100)}%${ctx.jungler.sinceSeen != null ? `, ${Math.round(ctx.jungler.sinceSeen)}s since anyone saw them` : ''}. Hold the near side of the wave until it is answered.`,
    null,
  )];
}

/* -------------------------------------------------------------- advantage */

/** Somebody died. That is a window, and windows close. */
function pickRule(ctx) {
  const down = ctx.enemies.filter((e) => e.isDead && e.respawnIn > 12);
  if (down.length === 0) return [];
  const longest = Math.max(...down.map((e) => e.respawnIn));
  const names = down.map((e) => e.champion).join(', ');
  const target = ctx.objective && ctx.objective.in < longest
    ? objectivePoint(ctx.objective.key)
    : turret('mid', 1, ctx.team === 'ORDER' ? 'CHAOS' : 'ORDER');
  const what = ctx.objective && ctx.objective.in < longest
    ? OBJECTIVE_NAMES[ctx.objective.key]
    : 'the nearest tower';
  return [directive(
    'pick', 'macro', down.length >= 2 ? 88 : 66,
    `${down.length} down - take ${what}`,
    `${names} out for ${clock(longest)}. Spend it on the map, not on farm you would have got anyway.`,
    target,
  )];
}

/* ------------------------------------------------------------- objectives */

/**
 * Which side of the map an objective belongs to, and therefore whether it is
 * yours. A top laner at seven minutes has no business walking to drake, and a
 * coach that keeps telling them to is a coach they turn off. Junglers own every
 * objective, mid can rotate to either, and a side laner owns the pit on their
 * own half and shoves a wave for the other.
 */
function objectiveRelevance(ctx, key) {
  if (ctx.phase !== 'laning' || ctx.role === 'JUNGLE') return 1;
  const side = ['baron', 'herald', 'grubs'].includes(key) ? 'top' : 'bot';
  if (ctx.role === 'MIDDLE') return 0.8;
  if (ctx.lane === side) return 1;
  return 0.25;
}

/** The pit, and being at it before it matters rather than after. */
function objectiveRule(ctx) {
  const o = ctx.objective;
  if (!o) return [];
  const name = OBJECTIVE_NAMES[o.key] ?? o.key;
  const pit = objectivePoint(o.key);
  const spot = fightSpot(pit, ctx.team, ctx.line);
  const soon = o.in > 0;
  const mine = objectiveRelevance(ctx, o.key);
  const base = soon ? 48 + (1 - o.in / 90) * 26 : 74;

  /* Not your side of the map, and still laning: the useful instruction is
     about your own wave, not about a pit you cannot reach in time. */
  if (mine < 0.5) {
    return [directive(
      o.key, 'macro', base * mine + 8,
      `${name} ${soon ? `in ${clock(o.in)}` : `${isAre(o.key)} up`} - shove and hold`,
      `That fight is not yours to walk to from ${ctx.lane}. Shove your wave into their tower so it is still crashing when the fight starts, and be worth more than the drake.`,
      ctx.lane ? laneMeetPoint(ctx.lane, ctx.team, 0.7) : spot,
    )];
  }

  const detail = soon
    ? `Spawns ${clock(o.at)}, in ${clock(o.in)}. Vision goes down now: a pit warded thirty seconds late is a pit you fight blind over.`
    : `Up now. You hold the ${ctx.line} of this fight - ${lineWords(ctx.line)}.`;

  const out = [directive(
    o.key, 'objective', base * mine,
    soon ? `${name} in ${clock(o.in)}` : `${name} ${isAre(o.key)} up`,
    detail, spot,
  )];

  if (o.key === 'drake' && ctx.timeline.drake?.soulPoint) {
    out.push(directive(
      'soul-point', 'objective', 80 * mine,
      'Soul point',
      'The next drake is a soul. Every other decision on the map is worth less than this one, including a tower you are two hits from.',
      spot,
    ));
  }
  return out;
}

function lineWords(line) {
  return {
    front: 'walk in first, and only when your carries are already following',
    back: 'stand a full screen behind the fight and never be the first one hit',
    flank: 'come from the side nobody has warded, after it starts',
    mid: 'close enough to use everything, far enough to not be picked',
  }[line] ?? 'hold the middle distance';
}

/* ------------------------------------------------------------- lane phase */

/** The default answer during laning: be where the wave is. */
function laneRule(ctx) {
  if (ctx.gameTime > PATCH.laningEnds || !ctx.lane || ctx.self.isDead) return [];
  const w = waveInfo(ctx.gameTime, ctx.lane);
  const meet = laneMeetPoint(ctx.lane, ctx.team, ctx.push);
  const cannon = w.isCannon ? 'This wave has the cannon - it is worth holding for.'
    : w.cannonIn === 1 ? 'Cannon is in the next wave.' : `Cannon in ${w.cannonIn} waves.`;
  return [directive(
    'lane', 'lane', 30,
    `Hold ${ctx.lane}`,
    `Wave ${w.number} meets in ${clock(Math.max(0, w.arrivesIn))}. ${cannon}`,
    meet,
  )];
}

/** Going home, which is a timing question and almost never a health question. */
function recallRule(ctx) {
  if (ctx.self.isDead || !ctx.lane || ctx.gameTime > PATCH.midGameEnds) return [];
  const r = recallWindow(ctx.gameTime, ctx.lane);
  const hp = ctx.self.healthPct;
  const rich = ctx.self.gold >= 1100;
  const hurt = hp != null && hp < 0.4;
  if (!r.open || (!rich && !hurt)) return [];
  return [directive(
    'recall', 'lane', 58 + (hurt ? 8 : 0),
    `Recall now - ${clock(r.spare)} spare`,
    `${rich ? `${ctx.self.gold}g` : `${Math.round(hp * 100)}% health`} and the next wave is ${clock(r.arrivesIn)} out. Shove first, then go: back in lane with ${clock(r.spare)} to stand around.`,
    forTeam(P.fountain, ctx.team),
  )];
}

/** Plates, while they are still there to take. */
function platesRule(ctx) {
  if (ctx.gameTime > PATCH.platesFall || !ctx.lane || ctx.self.isDead) return [];
  const left = PATCH.platesFall - ctx.gameTime;
  const opponentDown = ctx.enemies.some((e) => e.isDead && e.lane === ctx.lane);
  if (!opponentDown && left > 120) return [];
  const tower = turret(ctx.lane, 1, ctx.team === 'ORDER' ? 'CHAOS' : 'ORDER');
  return [directive(
    'plates', 'lane', opponentDown ? 72 : 44,
    opponentDown ? 'Their laner is dead - plates' : `Plates fall in ${clock(left)}`,
    opponentDown
      ? 'Crash the wave and hit the tower. Gold you take now is gold they cannot answer.'
      : 'Whatever plating is still standing at fourteen minutes is gold neither team gets. Spend the last two minutes shoving.',
    tower,
  )];
}

/** Leaving lane, for the three roles that are supposed to. */
function roamRule(ctx) {
  if (ctx.self.isDead || !ROAMERS.has(ctx.role) || ctx.gameTime < PATCH.minionsSpawn) return [];
  if (ctx.role === 'JUNGLE') return [];
  const w = waveInfo(ctx.gameTime, ctx.lane ?? 'mid');
  if (w.arrivesIn < 16) return [];
  const o = ctx.objective;
  const where = o && o.in < 60 ? objectivePoint(o.key) : null;
  if (!where) return [];
  return [directive(
    'roam', 'macro', 56,
    `Roam to ${OBJECTIVE_NAMES[o.key] ?? o.key}`,
    `Your wave is ${clock(w.arrivesIn)} out - that is enough to cross and be back. Arrive before the objective does, not with it.`,
    where,
  )];
}

/** The jungler's own route. */
function jungleRule(ctx) {
  if (ctx.role !== 'JUNGLE' || ctx.self.isDead) return [];
  const o = ctx.objective;
  if (o && o.in < 75) {
    const pit = objectivePoint(o.key);
    return [directive(
      'jungle-path', 'jungle', 62,
      `Clear toward ${OBJECTIVE_NAMES[o.key] ?? o.key}`,
      `Take the camps on that side of the map so you are already there at ${clock(o.at)} with a healthy clear behind you.`,
      fightSpot(pit, ctx.team, 'front'),
    )];
  }
  /* Nothing spawning: farm the half of the jungle nearest the lane that is
     winning, because that is the half you can defend. */
  const camps = campsFor(ctx.team).filter((c) => c.owner === 'ally');
  const anchor = ctx.self.pos ?? forTeam(P.blueBuff, ctx.team);
  camps.sort((a, b) => dist(a.pos, anchor) - dist(b.pos, anchor));
  const next = camps[1] ?? camps[0];
  return [directive(
    'jungle-farm', 'jungle', 38,
    `Clear ${next.name}`,
    'No objective inside a minute. Farm the side you can hold and keep the enemy jungler guessing.',
    next.pos,
  )];
}

/* --------------------------------------------------------- mid-late shape */

/** Where five people should be standing when there is no fight yet. */
function shapeRule(ctx) {
  if (ctx.gameTime < PATCH.laningEnds || ctx.self.isDead) return [];
  const o = ctx.objective;
  if (o && o.in < 60) return [];   // objectiveRule already owns this moment
  const strongSide = pickSideLane(ctx);
  const point = laneAt(strongSide, ctx.team === 'ORDER' ? 0.62 : 0.38);
  const grouped = ctx.line === 'back' || ctx.line === 'mid';
  if (grouped) {
    return [directive(
      'shape-group', 'macro', 44,
      'Group mid, hold the middle',
      'Nothing spawns inside a minute. Stand where you can walk to either pit and where a pick on you is not free - mid lane, behind your own wave.',
      forTeam(P.riverCentre, ctx.team),
    )];
  }
  return [directive(
    'shape-side', 'macro', 46,
    `Push ${strongSide} side`,
    'Nothing spawns inside a minute. A wave shoving into their tower is pressure that costs you nothing and buys the next objective.',
    point,
  )];
}

/** The side lane you can stand in without dying: the one away from the next pit. */
function pickSideLane(ctx) {
  const o = ctx.objective;
  if (!o) return 'top';
  return ['baron', 'herald', 'grubs'].includes(o.key) ? 'bot' : 'top';
}

/** When they are grouped and near, the fight is now and spacing is everything. */
function fightRule(ctx) {
  if (ctx.self.isDead || !ctx.self.pos) return [];
  const near = ctx.contacts.filter((c) => c.visible);
  if (near.length < 3) return [];
  const cx = near.reduce((s, c) => s + c.pos.x, 0) / near.length;
  const cy = near.reduce((s, c) => s + c.pos.y, 0) / near.length;
  const centre = { x: cx, y: cy };
  const spread = Math.max(...near.map((c) => dist(c.pos, centre)));
  if (spread > 0.16) return [];        // spread out is a rotation, not a fight
  if (dist(centre, ctx.self.pos) > 0.30) return [];
  return [directive(
    'fight', 'fight', 84,
    `${near.length} of them together - space now`,
    `They are grouped ${describeWhere(centre)}. You are the ${ctx.line}: ${lineWords(ctx.line)}.`,
    fightSpot(centre, ctx.team, ctx.line),
  )];
}

function describeWhere(p) {
  const l = nearestLane(p);
  if (l.d < 0.06) return `in ${l.lane} lane`;
  return dist(p, P.baron) < dist(p, P.drake) ? 'around the baron pit' : 'around the drake pit';
}

/* ----------------------------------------------------------------- vision */

/** Ward spots. Never the headline; always on the map. */
function visionRule(ctx) {
  const o = ctx.objective;
  /* A ward spot is only advice if you could walk to it. Nearest to where you
     actually are beats nearest to whatever is spawning, because the pit you
     cannot reach in forty seconds is not your vision to place. */
  const near = ctx.self.pos
    ?? (ctx.lane ? laneMeetPoint(ctx.lane, ctx.team, ctx.push) : null)
    ?? (o ? objectivePoint(o.key) : P.riverCentre);
  const phase = ctx.gameTime < PATCH.laningEnds ? 'early'
    : ctx.gameTime < PATCH.midGameEnds ? 'mid' : 'late';
  const spots = wardsFor(ctx.team, near, phase).slice(0, 3);
  return spots.map((w, i) => directive(
    `ward-${w.id}`, 'vision', 26 - i,
    `Ward: ${w.name}`, w.why, w.pos, { ward: true, depth: w.depth },
  ));
}

export const RULES = [
  deathRule, dangerRule, junglerRule, pickRule, objectiveRule,
  laneRule, recallRule, platesRule, roamRule, jungleRule,
  shapeRule, fightRule, visionRule,
];
