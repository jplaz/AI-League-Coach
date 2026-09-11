// Keeping the receipts.
//
// The live coach is gone the moment the game ends, and with it the only record
// of what it told you. That is a shame, because the interesting question is not
// what it said - it is what you did about it. Being warned about a gank and
// dying to it eight seconds later is a completely different mistake from dying
// to a gank nobody saw coming, and only one of them is fixable by trying
// harder. You cannot tell them apart from memory. You can from a log.
//
// So this writes one down: a sample every fifteen seconds, every warning worth
// hearing, every death with the state of the map at the moment it happened, and
// every objective with how far away you were when it fell. It goes to a file on
// your own machine and nowhere else.

import { inEnemyHalf, dist } from '../model/rift.js';
import { objectivePoint } from '../coach/jungle.js';

/** How often to write a routine sample, in game seconds. */
const SAMPLE_EVERY = 15;

/** Warnings worth recording, and how often at most. */
const WARNING_SCORE = 70;
const WARNING_EVERY = 6;

/** Objective kills that count as an objective rather than a kill feed entry. */
const OBJECTIVE_EVENTS = {
  DragonKill: 'drake', BaronKill: 'baron', HeraldKill: 'herald',
  HordeKill: 'grubs', AtakhanKill: 'atakhan',
};

export class Recorder {
  constructor(send) {
    this.send = send;
    /* Counted as they happen so the HUD can show them during the game, which
       is the point at which the number is still actionable. */
    this.counts = { warnings: 0, deaths: 0, ignored: 0 };
    this.game = null;
    this.pending = [];
    this.lastSample = -Infinity;
    this.lastWarning = -Infinity;
    this.wasDead = false;
    this.seenEvents = 0;
    this.trail = [];          // recent positions, so a death has a place
    this.warned = [];         // recent warnings, so a death knows if it was told
    this.lastFlush = 0;
  }

  /** A fresh game, or the same one continuing. */
  reset(live) {
    const stamp = new Date();
    this.game = {
      id: `${stamp.toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${live.self.champion}`,
      startedAt: stamp.toISOString(),
      champion: live.self.champion,
      role: null,
      duration: 0,
    };
    this.pending = [];
    this.lastSample = -Infinity;
    this.lastWarning = -Infinity;
    this.wasDead = false;
    this.seenEvents = 0;
    this.trail = [];
    this.counts = { warnings: 0, deaths: 0, ignored: 0 };
    this.warned = [];
  }

  /**
   * Called on every think tick. Everything it records is derived from what the
   * coach already worked out, so recording costs one comparison per tick and
   * never re-derives anything.
   */
  observe(view, live) {
    if (!live?.connected || live.demo) return;
    if (!this.game || view.gameTime + 5 < this.game.duration) this.reset(live);

    const t = view.gameTime;
    this.game.duration = t;
    this.game.role = view.role;
    this.game.kda = `${live.self.kills}/${live.self.deaths}/${live.self.assists}`;

    if (view.self.pos) {
      this.trail.push({ t, pos: view.self.pos });
      if (this.trail.length > 40) this.trail.shift();
    }

    this.sample(view, live, t);
    this.warning(view, t);
    this.death(view, live, t);
    this.objectives(view, live, t);
    this.flush(t);
  }

  sample(view, live, t) {
    if (t - this.lastSample < SAMPLE_EVERY) return;
    this.lastSample = t;
    this.pending.push({
      kind: 'sample',
      t: Math.round(t),
      cs: live.self.cs,
      gold: live.self.gold,
      lvl: live.self.level,
      wards: live.self.wards ?? 0,
      danger: round2(view.danger ?? 0),
      unaccounted: view.threat.unaccounted,
    });
  }

  warning(view, t) {
    const d = view.primary;
    if (!d || (d.kind !== 'danger' && d.kind !== 'fight')) return;
    if (d.score < WARNING_SCORE || t - this.lastWarning < WARNING_EVERY) return;
    this.lastWarning = t;
    this.counts.warnings += 1;
    this.warned.push({ t, danger: view.danger ?? 0 });
    if (this.warned.length > 12) this.warned.shift();
    this.pending.push({
      kind: 'warning',
      t: Math.round(t),
      id: d.id,
      title: d.title,
      score: d.score,
      danger: round2(view.danger ?? 0),
      unaccounted: view.threat.unaccounted,
    });
  }

  /**
   * A death, with the board as it was a moment before rather than as it is now:
   * by the time you are dead your own icon has gone from the minimap and half
   * the enemy team has walked away from the place that killed you.
   */
  death(view, live, t) {
    const dead = !!live.self.isDead;
    if (dead === this.wasDead) return;
    this.wasDead = dead;
    if (!dead) return;

    const before = [...this.trail].reverse().find((p) => t - p.t > 1.2) ?? this.trail.at(-1);
    this.counts.deaths += 1;
    if (this.warned.some((w) => t - w.t <= 14 && w.danger >= 0.5)) this.counts.ignored += 1;
    this.pending.push({
      kind: 'death',
      t: Math.round(t),
      unaccounted: view.threat.unaccounted,
      deep: before ? inEnemyHalf(before.pos, view.team) : false,
      danger: round2(view.danger ?? 0),
      x: before ? round2(before.pos.x) : null,
      y: before ? round2(before.pos.y) : null,
    });
  }

  /** Every epic monster, and how far away you were when it died. */
  objectives(view, live, t) {
    const events = live.events ?? [];
    if (events.length <= this.seenEvents) return;
    const fresh = events.slice(this.seenEvents);
    this.seenEvents = events.length;

    const mine = new Set([live.self.name, ...(live.allies ?? []).map((a) => a.name)]);
    for (const e of fresh) {
      if (e.EventName === 'GameEnd') {
        this.pending.push({ kind: 'end', t: Math.round(t), result: e.Result ?? null });
        continue;
      }
      const name = OBJECTIVE_EVENTS[e.EventName];
      if (!name) continue;
      const pit = objectivePoint(name);
      this.pending.push({
        kind: 'objective',
        t: Math.round(e.EventTime ?? t),
        name,
        mine: mine.has(e.KillerName),
        dist: view.self.pos ? round2(dist(view.self.pos, pit)) : null,
        alive: !live.self.isDead,
      });
    }
  }

  /** Batches to disk, because a write per tick is a write every 150ms. */
  flush(t, force = false) {
    if (!this.game || this.pending.length === 0) return;
    if (!force && t - this.lastFlush < 5) return;
    this.lastFlush = t;
    const body = { ...this.game, moments: this.pending };
    this.pending = [];
    this.send(body).catch(() => {
      /* The coach matters more than the diary: put them back and try later. */
      this.pending = [...body.moments, ...this.pending];
    });
  }
}

const round2 = (n) => Math.round(n * 100) / 100;
