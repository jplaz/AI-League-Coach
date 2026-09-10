// A game that is not being played, in the exact shape of one that is.
//
// Demo mode exists because the interesting half of this program - the map, the
// markers, the way advice changes when somebody dies - cannot be worked on
// while also playing League, and because anyone who clones this repository
// should be able to see what it does before they trust it with a ranked game.
//
// The payload is the real Live Client Data API shape, down to the nesting of
// `events.Events`, so demo mode exercises the same parser as a real game. The
// positions, which the real endpoint never provides, come back in a separate
// block the client only reads when no minimap capture is attached.

import { laneAt, CAMPS, mirror, P, forTeam } from '../src/model/rift.js';

const TEAM_BLUE = [
  { champion: 'Ornn', position: 'TOP', name: 'You' },
  { champion: 'Sejuani', position: 'JUNGLE', name: 'Kite' },
  { champion: 'Orianna', position: 'MIDDLE', name: 'Ballkeeper' },
  { champion: 'Jinx', position: 'BOTTOM', name: 'Powderkeg' },
  { champion: 'Nautilus', position: 'UTILITY', name: 'Anchor' },
];
const TEAM_RED = [
  { champion: 'Aatrox', position: 'TOP', name: 'Darkin' },
  { champion: 'Vi', position: 'JUNGLE', name: 'Piltover' },
  { champion: 'Ahri', position: 'MIDDLE', name: 'Ninetails' },
  { champion: 'Caitlyn', position: 'BOTTOM', name: 'Sheriff' },
  { champion: 'Thresh', position: 'UTILITY', name: 'Chains' },
];

/** Things that happen, in the order they happen. */
const SCRIPT = [
  { at: 0.05, EventName: 'GameStart' },
  { at: 65, EventName: 'MinionsSpawning' },
  { at: 246, EventName: 'FirstBrick', KillerName: 'Sheriff' },
  { at: 305, EventName: 'ChampionKill', KillerName: 'Piltover', VictimName: 'Ballkeeper' },
  { at: 372, EventName: 'HordeKill', KillerName: 'Kite' },
  { at: 379, EventName: 'HordeKill', KillerName: 'Kite' },
  { at: 386, EventName: 'HordeKill', KillerName: 'Kite' },
  { at: 448, EventName: 'DragonKill', KillerName: 'Ninetails', DragonType: 'Infernal', Stolen: 'False' },
  { at: 612, EventName: 'ChampionKill', KillerName: 'You', VictimName: 'Darkin' },
  { at: 640, EventName: 'TurretKilled', TurretKilled: 'Turret_T2_L_03_A', KillerName: 'You' },
  { at: 795, EventName: 'DragonKill', KillerName: 'Kite', DragonType: 'Ocean', Stolen: 'False' },
  { at: 861, EventName: 'HeraldKill', KillerName: 'Kite' },
  { at: 903, EventName: 'TurretKilled', TurretKilled: 'Turret_T2_C_05_A', KillerName: 'Ballkeeper' },
  { at: 1102, EventName: 'DragonKill', KillerName: 'Kite', DragonType: 'Mountain', Stolen: 'False' },
  { at: 1210, EventName: 'ChampionKill', KillerName: 'Piltover', VictimName: 'Powderkeg' },
  { at: 1214, EventName: 'ChampionKill', KillerName: 'Ninetails', VictimName: 'Anchor' },
  { at: 1402, EventName: 'ChampionKill', KillerName: 'You', VictimName: 'Sheriff' },
  { at: 1408, EventName: 'ChampionKill', KillerName: 'Kite', VictimName: 'Chains' },
  { at: 1520, EventName: 'TurretKilled', TurretKilled: 'Turret_T2_C_04_A', KillerName: 'Powderkeg' },
];

/** Deaths, so the scoreboard can say who is down and for how long. */
function deathsAt(t) {
  const out = new Map();
  for (const e of SCRIPT) {
    if (e.EventName !== 'ChampionKill' || e.at > t) continue;
    const timer = 12 + Math.min(38, e.at / 45);
    if (t - e.at < timer) out.set(e.VictimName, timer - (t - e.at));
  }
  return out;
}

/**
 * Somebody standing where their wave is. Both laners orbit the same meeting
 * point, a little apart, because two laners a third of a map from each other is
 * not a lane and makes the demo look like everybody is permanently missing.
 */
const LANE_PHASE = { top: 0, mid: 130, bot: 260 };
function laneWalk(lane, team, t) {
  const meet = 0.5 + 0.19 * Math.sin((t + LANE_PHASE[lane]) / 71);
  return laneAt(lane, meet + (team === 'ORDER' ? -0.04 : 0.04));
}

/** A jungler going round their camps. */
function campWalk(team, t) {
  const camps = CAMPS.map((c) => forTeam(team === 'ORDER' ? c.pos : mirror(c.pos), 'ORDER'));
  const i = Math.floor(t / 33) % camps.length;
  const j = (i + 1) % camps.length;
  const f = (t % 33) / 33;
  return { x: camps[i].x + (camps[j].x - camps[i].x) * f, y: camps[i].y + (camps[j].y - camps[i].y) * f };
}

/** Where everyone is, and which of them your team can currently see. */
function positionsAt(t) {
  const dead = deathsAt(t);
  const place = (p, team, i) => {
    if (dead.has(p.name)) return null;
    if (t > 1500) {
      /* Late game: both teams collect around whatever is contested. */
      const pit = t % 300 < 150 ? P.baron : P.drake;
      const wobble = ((i * 7919) % 100) / 100 - 0.5;
      return { x: pit.x + wobble * 0.10, y: pit.y + wobble * 0.09 + (team === 'ORDER' ? -0.03 : 0.03) };
    }
    if (p.position === 'JUNGLE') return campWalk(team, t);
    const lane = { TOP: 'top', MIDDLE: 'mid', BOTTOM: 'bot', UTILITY: 'bot' }[p.position];
    const pos = laneWalk(lane, team, t);
    /* The support stands a step off their carry rather than inside them. */
    return p.position === 'UTILITY' ? { x: pos.x - 0.018, y: pos.y + 0.018 } : pos;
  };

  const blue = TEAM_BLUE.map((p, i) => ({ ...p, pos: place(p, 'ORDER', i) }));
  const red = TEAM_RED.map((p, i) => ({ ...p, pos: place(p, 'CHAOS', i) }));

  /* Blue sees red where blue has vision: its own half, the river, and lanes
     it is standing in. Good enough to make fog behave the way fog behaves. */
  const seen = (pos) => {
    if (!pos) return false;
    const depth = pos.x + pos.y - 1;
    if (depth < 0.06) return true;
    return blue.some((b) => b.pos && Math.hypot(b.pos.x - pos.x, b.pos.y - pos.y) < 0.17);
  };

  return {
    self: blue[0].pos,
    allies: blue.slice(1).filter((p) => p.pos).map((p) => ({ pos: p.pos, champion: p.champion, visible: true })),
    enemies: red.filter((p) => p.pos).map((p) => ({
      pos: p.pos, champion: p.champion, visible: seen(p.pos),
    })),
    junglerPos: red[1].pos && seen(red[1].pos) ? red[1].pos : null,
  };
}

/** The Live Client Data API payload, as it would look `t` seconds into a game. */
export function demoPayload(t) {
  const dead = deathsAt(t);
  const level = (base) => Math.max(1, Math.min(18, Math.floor(base + t / 95)));

  const player = (p, team, i) => ({
    championName: p.champion,
    isBot: false,
    isDead: dead.has(p.name),
    items: [],
    level: level(1 + (i % 2)),
    position: p.position,
    rawChampionName: `game_character_displayname_${p.champion}`,
    respawnTimer: dead.get(p.name) ?? 0,
    riotId: `${p.name}#EUW`,
    riotIdGameName: p.name,
    scores: {
      assists: Math.floor(t / 260) + i,
      creepScore: p.position === 'UTILITY' ? Math.floor(t / 24) : Math.floor(t / 7.4),
      deaths: [...dead.keys()].includes(p.name) ? 1 : Math.floor(t / 700),
      kills: Math.floor(t / 420) + (i === 3 ? 1 : 0),
      wardScore: Math.round(t / 60 * 1.6 * 10) / 10,
    },
    skinID: 0,
    summonerName: p.name,
    team,
  });

  const all = [
    ...TEAM_BLUE.map((p, i) => player(p, 'ORDER', i)),
    ...TEAM_RED.map((p, i) => player(p, 'CHAOS', i)),
  ];

  return {
    payload: {
      activePlayer: {
        championStats: {
          currentHealth: Math.round(600 + 900 * (0.45 + 0.5 * Math.sin(t / 61))),
          maxHealth: 1500 + level(1) * 90,
        },
        currentGold: Math.round(200 + (t % 220) * 6),
        level: level(1),
        riotId: 'You#EUW',
        summonerName: 'You',
        teamRelativeColors: true,
      },
      allPlayers: all,
      events: {
        Events: SCRIPT.filter((e) => e.at <= t).map((e, i) => {
          const { at, ...rest } = e;
          return { EventID: i, EventTime: at, ...rest };
        }),
      },
      gameData: {
        gameMode: 'CLASSIC', gameTime: t, mapName: 'Map11', mapNumber: 11, mapTerrain: 'Default',
      },
    },
    vision: positionsAt(t),
  };
}
