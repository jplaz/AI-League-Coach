// The thing that decides.
//
// One pure function. Everything the coach knows goes in - the clock, the
// scoreboard, whatever the minimap reader saw a moment ago - and out comes a
// ranked list of things to do and exactly one place to stand. No fetching, no
// canvas, no timers of its own, which is what makes it testable: the scenarios
// in tools/ are the same call the browser makes sixty times a minute.
//
// The ranking is deliberately plain. Rules score themselves out of a hundred on
// an absolute scale, the engine sorts, and the highest one that names a place
// becomes the marker. No weights to tune and no model to retrain - when the
// coach says something you disagree with, exactly one rule said it and you can
// go and read it.

import { readTimeline, primaryObjective } from '../live/timeline.js';
import { predictJungler } from './jungle.js';
import { buildThreat } from './threat.js';
import { waveInfo } from './wave.js';
import { RULES } from './rules.js';
import { resolveRole, fightLine, ROLE_LANE } from '../model/roles.js';
import { PATCH } from '../model/patch.js';

/** Coarse names for the three shapes a game takes. */
export function phaseOf(gameTime) {
  if (gameTime < PATCH.laningEnds) return 'laning';
  if (gameTime < PATCH.midGameEnds) return 'mid';
  return 'late';
}

const EMPTY_SELF = {
  champion: '', level: 1, gold: 0, healthPct: null,
  isDead: false, respawnIn: 0, pos: null,
};

/**
 * Run the coach over one instant of a game.
 *
 * Everything is optional except the clock and the team. A game with no minimap
 * reader attached still gets timers, objective calls and lane advice; it simply
 * cannot say "you personally are standing somewhere dangerous", so the rules
 * that need a position quietly do not fire.
 */
export function coach(input = {}) {
  const gameTime = Number(input.gameTime ?? 0);
  const team = input.team === 'CHAOS' ? 'CHAOS' : 'ORDER';
  const role = resolveRole(input.reportedRole, input.role);
  const line = fightLine(role, input.lineOverride);
  const self = { ...EMPTY_SELF, ...(input.self ?? {}) };
  const enemies = input.enemies ?? [];
  const allies = input.allies ?? [];
  const contacts = input.contacts ?? [];
  const allyContacts = input.allyContacts ?? [];

  const timeline = readTimeline(gameTime, input.events ?? [], [...allies, ...enemies]);
  const objective = primaryObjective(timeline, gameTime);
  const jungler = predictJungler(team, gameTime, input.junglerSightings ?? [], objective);
  const threat = buildThreat({
    team,
    gameTime,
    contacts,
    allies: allyContacts,
    jungler,
    enemyCount: Math.max(1, enemies.length || 5),
    deadEnemies: enemies.filter((e) => e.isDead).length,
  });

  const lane = ROLE_LANE[role];
  const ctx = {
    gameTime, team, role, line, lane, self, allies, enemies, contacts, allyContacts,
    timeline, objective, jungler, threat,
    phase: phaseOf(gameTime),
    push: Number(input.push ?? 0),
  };

  const directives = [];
  for (const rule of RULES) {
    let produced = [];
    try {
      produced = rule(ctx) ?? [];
    } catch (err) {
      /* One broken rule must not take the coach off the screen mid-game. */
      directives.push({
        id: `error-${rule.name}`, kind: 'error', score: 0,
        title: 'A rule failed', detail: String(err && err.message), target: null,
      });
    }
    directives.push(...produced);
  }
  directives.sort((a, b) => b.score - a.score);

  const spoken = directives.filter((d) => d.kind !== 'vision' && d.kind !== 'error');
  const primary = spoken.find((d) => d.target) ?? spoken[0] ?? null;

  return {
    gameTime, team, role, line, lane,
    phase: ctx.phase,
    /* Echoed so that whatever draws this does not need the input as well. */
    self, allies, enemies, contacts, allyContacts,
    timeline,
    objective,
    jungler,
    threat,
    wave: waveInfo(gameTime, lane ?? 'mid'),
    directives: spoken,
    wards: directives.filter((d) => d.kind === 'vision'),
    primary,
    marker: primary?.target ?? null,
    danger: self.pos ? threat.at(self.pos) : null,
  };
}
