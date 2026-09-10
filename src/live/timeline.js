// Turning the event log into things that are about to happen.
//
// The live client hands over a flat list of things that already happened - a
// dragon died at 8:12, a turret fell at 11:40 - and the coach needs the
// opposite: what is coming and when. That conversion is all this file does.
//
// It is written to be pure. Events and a clock in, a plain description of the
// board out, no fetching and no clock of its own, so the same function runs
// against a live game, a recorded one, or a scenario in the test harness.

import { PATCH } from '../model/patch.js';

const BLUE = 'ORDER';
const RED = 'CHAOS';

/** Which team a player name belongs to, or null if we have never seen them. */
function teamOf(players, name) {
  const p = players.find((q) => q.name === name || q.summoner === name);
  return p ? p.team : null;
}

/** A countdown that knows it might not be running yet. */
function upcoming(at, gameTime, extra = {}) {
  if (at == null) return { at: null, in: null, up: false, ...extra };
  return { at, in: at - gameTime, up: at <= gameTime, ...extra };
}

/**
 * The state of every epic monster, both team's turrets, and the plate clock.
 *
 * Respawns are counted from the last kill rather than from a fixed schedule,
 * which is the only way to be right after a fight - a baron taken at 31:10 is
 * back at 37:10 and no table can know that in advance.
 */
export function readTimeline(gameTime, events = [], players = []) {
  const of = (name) => events.filter((e) => e.EventName === name);
  const last = (name) => of(name).at(-1) ?? null;

  /* Dragons: stacks per team decide whether the next one is a soul, and the
     soul decides whether dragons stop and Elder starts. */
  const drakes = of('DragonKill');
  const stacks = { [BLUE]: 0, [RED]: 0 };
  const types = { [BLUE]: [], [RED]: [] };
  for (const e of drakes) {
    if (e.DragonType === 'Elder') continue;
    const team = teamOf(players, e.KillerName);
    if (team) {
      stacks[team] += 1;
      types[team].push(e.DragonType ?? 'Unknown');
    }
  }
  const soulTeam = stacks[BLUE] >= PATCH.soulAt ? BLUE
    : stacks[RED] >= PATCH.soulAt ? RED : null;
  const lastDrake = drakes.at(-1);
  const elders = drakes.filter((e) => e.DragonType === 'Elder');
  const lastElder = elders.at(-1);

  const nextDrakeAt = soulTeam
    ? null
    : lastDrake
      ? lastDrake.EventTime + PATCH.dragonRespawn
      : PATCH.dragonFirst;
  const nextElderAt = soulTeam
    ? (lastElder ? lastElder.EventTime + PATCH.elderRespawn
      : Math.max(gameTime, (lastDrake?.EventTime ?? 0) + PATCH.dragonRespawn))
    : null;

  /* Baron, grubs, herald. Grubs and herald share a window: grubs until they
     despawn, then the herald in the same pit. */
  const lastBaron = last('BaronKill');
  const nextBaronAt = lastBaron ? lastBaron.EventTime + PATCH.baronRespawn : PATCH.baronFirst;

  /* Grubs come in two sets of three. Take the first set and the second is a
     few minutes behind it; leave them and they sit there until they despawn. */
  const hordeKills = of('HordeKill');
  const grubsTaken = hordeKills.length;
  const lastHorde = hordeKills.at(-1);
  const grubsGone = grubsTaken >= 6 || gameTime > PATCH.grubsDespawn;
  const nextGrubsAt = grubsGone ? null
    : grubsTaken >= 3 ? Math.min(PATCH.grubsDespawn, lastHorde.EventTime + PATCH.grubsSecondSet)
      : PATCH.grubsSpawn;

  const heraldTaken = of('HeraldKill').length > 0;
  const nextHeraldAt = heraldTaken || gameTime > PATCH.heraldDespawn ? null : PATCH.heraldSpawn;

  const atakhanTaken = of('AtakhanKill').length > 0;
  const nextAtakhanAt = PATCH.atakhanSpawn == null || atakhanTaken ? null : PATCH.atakhanSpawn;

  return {
    drake: upcoming(nextDrakeAt, gameTime, {
      stacks, types, soulTeam,
      soulPoint: !soulTeam && Math.max(stacks[BLUE], stacks[RED]) === PATCH.soulAt - 1,
    }),
    elder: upcoming(nextElderAt, gameTime, { active: !!soulTeam }),
    baron: upcoming(nextBaronAt, gameTime, { taken: of('BaronKill').length }),
    grubs: upcoming(nextGrubsAt, gameTime, { taken: grubsTaken }),
    herald: upcoming(nextHeraldAt, gameTime, { taken: heraldTaken }),
    atakhan: upcoming(nextAtakhanAt, gameTime, { taken: atakhanTaken }),
    plates: upcoming(PATCH.platesFall, gameTime, { standing: gameTime < PATCH.platesFall }),
    turrets: readTurrets(events),
    kills: of('ChampionKill').length,
  };
}

/**
 * Which turrets are down, by team and lane.
 *
 * The event carries an internal turret name whose numbering has changed
 * between seasons, so rather than decode it we count: turrets in a lane can
 * only fall from the outside in, so the third turret lost in a lane is the
 * inhibitor turret whatever the string says. The lane letter is stable.
 */
export function readTurrets(events) {
  const down = {
    [BLUE]: { top: 0, mid: 0, bot: 0 },
    [RED]: { top: 0, mid: 0, bot: 0 },
  };
  for (const e of events) {
    if (e.EventName !== 'TurretKilled') continue;
    const id = e.TurretKilled ?? '';
    const team = id.includes('_T1_') ? BLUE : id.includes('_T2_') ? RED : null;
    const lane = /_L_/.test(id) ? 'top' : /_R_/.test(id) ? 'bot' : /_C_/.test(id) ? 'mid' : null;
    if (team && lane) down[team][lane] = Math.min(3, down[team][lane] + 1);
  }
  return down;
}

/**
 * The single most contested thing on the map right now, or null in the quiet
 * stretches. "Most contested" is not the same as "soonest": a baron ninety
 * seconds out outranks a drake that is already up but uncontested at 6:00,
 * because the coach's job is to have you standing somewhere before it matters.
 */
export function primaryObjective(timeline, gameTime) {
  const weigh = (key, base) => {
    const o = timeline[key];
    if (!o || o.at == null) return null;
    const away = o.in;
    if (away > 90) return null;
    /* Full weight once it is up; ramping in over the ninety seconds before. */
    const nearness = away <= 0 ? 1 : 1 - away / 90;
    return { key, at: o.at, in: away, weight: base * (0.35 + 0.65 * nearness) };
  };

  const options = [
    weigh('elder', 100),
    weigh('baron', 95),
    weigh('drake', timeline.drake?.soulPoint ? 92 : 70),
    weigh('atakhan', 78),
    weigh('herald', 62),
    weigh('grubs', 58),
  ].filter(Boolean);

  options.sort((a, b) => b.weight - a.weight);
  return options[0] ?? null;
}
