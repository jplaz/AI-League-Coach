// Games that never happened, so the coach can be checked without playing one.
//
// Each scenario is a whole instant: a clock, a scoreboard, an event log, and
// whatever the minimap reader would have seen. They serve two purposes - the
// test harness asserts against them, and the demo mode replays them in order so
// the interface can be built and looked at without League running at all.

const p = (x, y) => ({ x, y });

/** Five enemies, alive, with the roles they would have. */
function enemyTeam(overrides = {}) {
  const base = [
    { champion: 'Aatrox', team: 'CHAOS', lane: 'top', role: 'TOP' },
    { champion: 'Vi', team: 'CHAOS', lane: null, role: 'JUNGLE' },
    { champion: 'Ahri', team: 'CHAOS', lane: 'mid', role: 'MIDDLE' },
    { champion: 'Caitlyn', team: 'CHAOS', lane: 'bot', role: 'BOTTOM' },
    { champion: 'Thresh', team: 'CHAOS', lane: 'bot', role: 'UTILITY' },
  ];
  return base.map((e) => ({
    ...e, isDead: false, respawnIn: 0, level: 1, ...(overrides[e.champion] ?? {}),
  }));
}

export const SCENARIOS = [
  {
    id: 'early-lane',
    name: 'Three minutes, mid, nothing happening',
    input: {
      gameTime: 185, team: 'ORDER', role: 'MIDDLE',
      self: { champion: 'Orianna', level: 4, gold: 320, healthPct: 0.86, pos: p(0.5, 0.5) },
      enemies: enemyTeam(), events: [],
      contacts: [{ pos: p(0.52, 0.52), lastSeen: 185, visible: true }],
      junglerSightings: [{ pos: p(0.78, 0.36), at: 150 }],
    },
    expect: { primaryOneOf: ['lane', 'jungler'], hasMarker: true },
  },
  {
    id: 'deep-and-blind',
    name: 'Warding their jungle with four unaccounted for',
    input: {
      gameTime: 640, team: 'ORDER', role: 'MIDDLE',
      self: { champion: 'Orianna', level: 9, gold: 1400, healthPct: 0.55, pos: p(0.74, 0.62) },
      enemies: enemyTeam(), events: [],
      contacts: [{ pos: p(0.30, 0.31), lastSeen: 620, visible: false }],
      junglerSightings: [{ pos: p(0.70, 0.66), at: 610 }],
    },
    expect: { primary: 'danger', hasMarker: true },
  },
  {
    id: 'drake-spawning',
    name: 'Drake forty seconds out, everyone alive',
    input: {
      gameTime: 760, team: 'ORDER', role: 'BOTTOM',
      self: { champion: 'Jinx', level: 11, gold: 640, healthPct: 0.9, pos: p(0.62, 0.30) },
      enemies: enemyTeam(),
      events: [{ EventName: 'DragonKill', EventTime: 460, KillerName: 'Ahri', DragonType: 'Infernal' }],
      contacts: [], junglerSightings: [{ pos: p(0.62, 0.24), at: 840 }],
    },
    expect: { primaryOneOf: ['drake', 'jungler'], hasMarker: true },
  },
  {
    id: 'soul-point',
    name: 'Soul point drake, two of them dead',
    input: {
      gameTime: 1700, team: 'ORDER', role: 'TOP',
      self: { champion: 'Ornn', level: 14, gold: 900, healthPct: 0.7, pos: p(0.55, 0.42) },
      enemies: enemyTeam({ Caitlyn: { isDead: true, respawnIn: 34 }, Thresh: { isDead: true, respawnIn: 28 } }),
      events: [
        { EventName: 'DragonKill', EventTime: 320, KillerName: 'Jinx', DragonType: 'Ocean' },
        { EventName: 'DragonKill', EventTime: 700, KillerName: 'Jinx', DragonType: 'Cloud' },
        { EventName: 'DragonKill', EventTime: 1100, KillerName: 'Jinx', DragonType: 'Infernal' },
      ],
      allies: [{ champion: 'Jinx', team: 'ORDER' }],
      contacts: [], junglerSightings: [],
    },
    expect: { primaryOneOf: ['pick', 'soul-point', 'drake'], hasMarker: true },
  },
  {
    id: 'baron-fight',
    name: 'Baron up, four of them grouped on it',
    input: {
      gameTime: 1580, team: 'ORDER', role: 'BOTTOM',
      self: { champion: 'Jinx', level: 15, gold: 200, healthPct: 1, pos: p(0.42, 0.60) },
      enemies: enemyTeam(), events: [],
      contacts: [
        { pos: p(0.36, 0.64), lastSeen: 1580, visible: true },
        { pos: p(0.38, 0.66), lastSeen: 1580, visible: true },
        { pos: p(0.34, 0.62), lastSeen: 1580, visible: true },
        { pos: p(0.37, 0.61), lastSeen: 1580, visible: true },
      ],
      allyContacts: [
        { pos: p(0.43, 0.59), lastSeen: 1580, visible: true },
        { pos: p(0.44, 0.61), lastSeen: 1580, visible: true },
        { pos: p(0.41, 0.58), lastSeen: 1580, visible: true },
      ],
      junglerSightings: [{ pos: p(0.36, 0.64), at: 1578 }],
    },
    expect: { primary: 'fight', hasMarker: true },
  },
  {
    id: 'dead-before-baron',
    name: 'Dead with baron landing while you walk back',
    input: {
      gameTime: 1520, team: 'ORDER', role: 'JUNGLE',
      self: { champion: 'Sejuani', level: 14, gold: 1800, healthPct: 0, isDead: true, respawnIn: 38, pos: null },
      enemies: enemyTeam(), events: [], contacts: [], junglerSightings: [],
    },
    expect: { primary: 'dead', hasMarker: true },
  },
  {
    id: 'recall-window',
    name: 'Enough gold and a wave that has just been shoved',
    input: {
      gameTime: 400, team: 'ORDER', role: 'TOP',
      self: { champion: 'Ornn', level: 6, gold: 1350, healthPct: 0.42, pos: p(0.09, 0.63) },
      enemies: enemyTeam(), events: [], contacts: [], junglerSightings: [],
    },
    expect: { primaryOneOf: ['recall', 'lane'], hasMarker: true },
  },
];
