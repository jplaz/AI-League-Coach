// Summoner's Rift as coordinates, so advice can have a place on it.
//
// Everything the coach knows about the map lives here in one normalized space:
// x to the right, y upward, 0..1 on both, blue's nexus in the bottom-left
// corner and red's in the top-right. That is the minimap's own frame, which is
// the point - a position read off a captured minimap, a ward spot written down
// by hand, and a tower the game reported destroyed all land in the same units
// and can be compared without anybody converting anything.
//
// The Rift has two symmetries and this file leans on both. Rotating a point
// 180 degrees about the centre swaps the teams (`mirror`), so every landmark is
// written once for blue and read for either side. Reflecting it across the mid
// lane swaps top and bottom (`reflect`), which is why gromp and krugs, or the
// two tri-brushes, are one entry each rather than two.

export const BLUE = 'ORDER';
export const RED = 'CHAOS';

/* ------------------------------------------------------------------ maths */

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** The same place seen from the other team's side. */
export const mirror = (p) => ({ x: 1 - p.x, y: 1 - p.y });

/** The same place with top lane and bot lane swapped. */
export const reflect = (p) => ({ x: p.y, y: p.x });

/**
 * The other team's equivalent of a place *in the same lane*.
 *
 * This is the distinction that will bite anybody reading this file quickly, so
 * it is worth being slow about. The Rift has two symmetries. Rotating it by half
 * a turn swaps the teams and it is the right one for anything anchored to a
 * base - your fountain, your jungle camps, your inhibitors - but it also swaps
 * top lane for bot, because blue's top lane runs up the left edge and that edge
 * rotates onto the right one. So blue's *top* outer turret rotated is red's
 * *bot* outer turret. Reflecting across the other diagonal instead keeps the
 * lane and swaps the team, which is what "their tower in my lane" means.
 *
 * And a third of the map obeys neither, because it belongs to nobody: the baron
 * pit is the baron pit from both sides of the game. Those are written once and
 * never transformed at all.
 */
export const oppose = (p) => ({ x: 1 - p.y, y: 1 - p.x });

/** Author base-anchored geometry blue-side; read it for whichever team asks. */
export const forTeam = (p, team) => (team === RED ? mirror(p) : p);

/** Author lane geometry blue-side; read it for whichever team asks. */
export const laneForTeam = (p, team) => (team === RED ? oppose(p) : p);

/** Riot's world coordinates (roughly 0..14870 square) into map space. */
export const fromGameCoords = (x, y) => ({
  x: Math.max(0, Math.min(1, x / 14870)),
  y: Math.max(0, Math.min(1, y / 14980)),
});

/** How far along the anti-diagonal river a point sits: 0 baron end, 1 drake end. */
export const riverAxis = (p) => Math.max(0, Math.min(1, (p.x - p.y + 1) / 2));

/** Signed distance across the river. Positive is into red's half. */
export const halfDepth = (p) => (p.x + p.y - 1) / 2;

/** True when the point is in the half of the map that belongs to `team`'s enemy. */
export const inEnemyHalf = (p, team) =>
  (team === RED ? -halfDepth(p) : halfDepth(p)) > 0.02;

/* -------------------------------------------------------------- landmarks */

/** Named places, all blue-side. Read anything here through `forTeam`. */
export const P = {
  nexus:        { x: 0.075, y: 0.075 },
  fountain:     { x: 0.055, y: 0.055 },
  baseTop:      { x: 0.100, y: 0.150 },
  baseBot:      { x: 0.150, y: 0.100 },

  topT1:        { x: 0.083, y: 0.615 },
  topT2:        { x: 0.083, y: 0.435 },
  topT3:        { x: 0.100, y: 0.290 },
  topInhib:     { x: 0.090, y: 0.240 },
  midT1:        { x: 0.375, y: 0.375 },
  midT2:        { x: 0.290, y: 0.290 },
  midT3:        { x: 0.215, y: 0.215 },
  midInhib:     { x: 0.185, y: 0.185 },
  botT1:        { x: 0.615, y: 0.083 },
  botT2:        { x: 0.435, y: 0.083 },
  botT3:        { x: 0.290, y: 0.100 },
  botInhib:     { x: 0.240, y: 0.090 },
  nexusTopTurret: { x: 0.115, y: 0.175 },
  nexusBotTurret: { x: 0.175, y: 0.115 },

  baron:        { x: 0.365, y: 0.635 },
  drake:        { x: 0.635, y: 0.365 },
  atakhan:      { x: 0.500, y: 0.500 },
  scuttleTop:   { x: 0.310, y: 0.690 },
  scuttleBot:   { x: 0.690, y: 0.310 },
  riverTopMouth:{ x: 0.430, y: 0.570 },  // where top river meets mid lane
  riverBotMouth:{ x: 0.570, y: 0.430 },
  riverCentre:  { x: 0.500, y: 0.500 },

  gromp:        { x: 0.155, y: 0.600 },
  blueBuff:     { x: 0.215, y: 0.545 },
  wolves:       { x: 0.235, y: 0.400 },
  raptors:      { x: 0.400, y: 0.235 },
  redBuff:      { x: 0.545, y: 0.215 },
  krugs:        { x: 0.600, y: 0.155 },
};

/**
 * A team's turret in a named lane. Tier 1 is the outer one, 3 the one in front
 * of the inhibitor. Lane names are absolute: "top" is the same lane for both
 * teams, which is why this reflects rather than rotates.
 */
export function turret(lane, tier, team) {
  const rows = {
    top: [P.topT1, P.topT2, P.topT3],
    mid: [P.midT1, P.midT2, P.midT3],
    bot: [P.botT1, P.botT2, P.botT3],
  };
  return laneForTeam(rows[lane][tier - 1], team);
}

/** Places that belong to nobody and are never transformed. */
export const NEUTRAL = {
  baron: P.baron, drake: P.drake, elder: P.drake, atakhan: P.atakhan,
  herald: P.baron, grubs: P.baron,
  scuttleTop: P.scuttleTop, scuttleBot: P.scuttleBot, centre: P.riverCentre,
};

/** Lane paths, blue base outward. `laneAt` walks them. */
export const LANES = {
  top: [
    { x: 0.100, y: 0.150 }, { x: 0.080, y: 0.330 }, { x: 0.083, y: 0.615 },
    { x: 0.110, y: 0.790 }, { x: 0.210, y: 0.885 }, { x: 0.420, y: 0.918 },
    { x: 0.700, y: 0.925 }, { x: 0.850, y: 0.900 },
  ],
  mid: [
    { x: 0.150, y: 0.150 }, { x: 0.375, y: 0.375 }, { x: 0.500, y: 0.500 },
    { x: 0.625, y: 0.625 }, { x: 0.850, y: 0.850 },
  ],
  bot: null,   // filled in below: top lane reflected across mid
};
LANES.bot = LANES.top.map(reflect);

export const LANE_IDS = ['top', 'mid', 'bot'];

/** A point a fraction `t` of the way along a lane, from blue's base to red's. */
export function laneAt(lane, t) {
  const pts = LANES[lane];
  const spans = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    spans.push(d);
    total += d;
  }
  let want = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < spans.length; i++) {
    if (want <= spans[i] || i === spans.length - 1) {
      return lerp(pts[i], pts[i + 1], spans[i] ? want / spans[i] : 0);
    }
    want -= spans[i];
  }
  return pts[pts.length - 1];
}

/** Which lane a point is closest to, and how far off it stands. */
export function nearestLane(p) {
  let best = { lane: 'mid', d: Infinity, t: 0.5 };
  for (const lane of LANE_IDS) {
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const d = dist(p, laneAt(lane, t));
      if (d < best.d) best = { lane, d, t };
    }
  }
  return best;
}

/* ------------------------------------------------------------------ camps */

/** Blue side's six camps, in the order a standard clear takes them bot-first. */
export const CAMPS = [
  { id: 'gromp',    name: 'Gromp',     pos: P.gromp,    buff: null,   side: 'top' },
  { id: 'blue',     name: 'Blue buff', pos: P.blueBuff, buff: 'blue', side: 'top' },
  { id: 'wolves',   name: 'Wolves',    pos: P.wolves,   buff: null,   side: 'top' },
  { id: 'raptors',  name: 'Raptors',   pos: P.raptors,  buff: null,   side: 'bot' },
  { id: 'red',      name: 'Red buff',  pos: P.redBuff,  buff: 'red',  side: 'bot' },
  { id: 'krugs',    name: 'Krugs',     pos: P.krugs,    buff: null,   side: 'bot' },
];

/** Both jungles at once, tagged with whose they are, as seen by `team`. */
export function campsFor(team) {
  const own = CAMPS.map((c) => ({ ...c, owner: 'ally', pos: forTeam(c.pos, team) }));
  const foe = CAMPS.map((c) => ({
    ...c, id: `enemy-${c.id}`, owner: 'enemy', pos: forTeam(mirror(c.pos), team),
  }));
  return [...own, ...foe];
}

/* ------------------------------------------------------------------ wards */

/**
 * Ward spots worth naming, written blue-side.
 *
 * `depth` says whose ground it is: 'safe' is inside your own half, 'river' is
 * contested, 'deep' is a ward you only place when you know where they are.
 * `sym` says how the spot moves when red team asks for it - by the lane it
 * belongs to, by the base it is anchored to, or not at all for the pits.
 */
export const WARDS = [
  { id: 'tri-top',      name: 'Top tri-brush',        pos: { x: 0.145, y: 0.705 }, sym: 'lane',    depth: 'safe',  phase: 'early', why: 'Sees a top gank before it is one' },
  { id: 'tri-bot',      name: 'Bot tri-brush',        pos: { x: 0.705, y: 0.145 }, sym: 'lane',    depth: 'safe',  phase: 'early', why: 'Sees a bot gank before it is one' },
  { id: 'river-top',    name: 'Top river brush',      pos: { x: 0.330, y: 0.640 }, sym: 'neutral', depth: 'river', phase: 'early', why: 'Covers scuttle and the baron-side crossing' },
  { id: 'river-bot',    name: 'Bot river brush',      pos: { x: 0.640, y: 0.330 }, sym: 'neutral', depth: 'river', phase: 'early', why: 'Covers scuttle and the drake-side crossing' },
  { id: 'mid-top-bush', name: 'Mid top river mouth',  pos: { x: 0.430, y: 0.560 }, sym: 'lane',    depth: 'river', phase: 'early', why: 'The bush a mid gank walks out of' },
  { id: 'mid-bot-bush', name: 'Mid bot river mouth',  pos: { x: 0.560, y: 0.430 }, sym: 'lane',    depth: 'river', phase: 'early', why: 'The bush a mid gank walks out of' },
  { id: 'pit-baron',    name: 'Baron pit',            pos: { x: 0.372, y: 0.612 }, sym: 'neutral', depth: 'river', phase: 'mid',   why: 'Nobody starts baron unseen' },
  { id: 'pit-drake',    name: 'Drake pit',            pos: { x: 0.612, y: 0.372 }, sym: 'neutral', depth: 'river', phase: 'mid',   why: 'Nobody starts drake unseen' },
  { id: 'raptor-ally',  name: 'Own raptors',          pos: { x: 0.400, y: 0.265 }, sym: 'base',    depth: 'safe',  phase: 'mid',   why: 'Watches the seam into your own jungle' },
  { id: 'deep-blue',    name: 'Their blue entrance',  pos: mirror({ x: 0.250, y: 0.590 }), sym: 'base', depth: 'deep', phase: 'mid',  why: 'Where their jungler starts a top-side clear' },
  { id: 'deep-red',     name: 'Their red entrance',   pos: mirror({ x: 0.590, y: 0.250 }), sym: 'base', depth: 'deep', phase: 'mid',  why: 'Where their jungler starts a bot-side clear' },
  { id: 'baron-flank',  name: 'Baron flank',          pos: { x: 0.300, y: 0.760 }, sym: 'base',    depth: 'deep', phase: 'late', why: 'Sees the collapse before baron is worth starting' },
  { id: 'drake-flank',  name: 'Drake flank',          pos: { x: 0.760, y: 0.300 }, sym: 'base',    depth: 'deep', phase: 'late', why: 'Sees the collapse before drake is worth starting' },
];

/** Ward spots as `team` should read them, nearest-first to a point of interest. */
export function wardsFor(team, near = null, phase = null) {
  const move = { lane: laneForTeam, base: forTeam, neutral: (p) => p };
  let list = WARDS.map((w) => ({ ...w, pos: (move[w.sym] ?? forTeam)(w.pos, team) }));
  if (phase) list = list.filter((w) => w.phase === phase || w.phase === 'early');
  if (near) list.sort((a, b) => dist(a.pos, near) - dist(b.pos, near));
  return list;
}

/* -------------------------------------------------------------- positions */

/** Unit vector from a point towards `team`'s own fountain. */
export function towardBase(p, team) {
  const home = forTeam(P.fountain, team);
  const dx = home.x - p.x;
  const dy = home.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** Nudge a point along a vector, clamped to the map. */
export function offset(p, v, by) {
  return {
    x: Math.max(0.02, Math.min(0.98, p.x + v.x * by)),
    y: Math.max(0.02, Math.min(0.98, p.y + v.y * by)),
  };
}

/**
 * Where to stand around a contested thing, given what you play. A fight at the
 * baron pit is not one place: the tank wants to be in front of it, the carry
 * wants to be a screen's width behind that, and whoever flanks wants to come
 * from a side nobody is watching. `line` is the role's answer to that.
 */
export function fightSpot(anchor, team, line) {
  const home = towardBase(anchor, team);
  const side = { x: -home.y, y: home.x };
  if (line === 'front') return offset(anchor, home, -0.045);
  if (line === 'back') return offset(anchor, home, 0.075);
  if (line === 'flank') return offset(offset(anchor, side, 0.10), home, 0.02);
  return offset(anchor, home, 0.03);   // 'mid' - between the two
}
