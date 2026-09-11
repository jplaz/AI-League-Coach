// What actually cost you the game.
//
// The live coach is only half of climbing. The other half is finding out, after
// the game, which of the things it told you turned out to matter - and in
// particular how often it warned you and you walked in anyway. That number is
// the single most useful thing in this file, because it is the one leak that is
// entirely inside your own control and it is invisible while you play: nobody
// remembers the four times they got away with it, only the once they did not.
//
// Nothing here promises a rank. What it does is name the three habits costing
// you the most games, in the order they are costing them, and then say the same
// thing again next week so you can see whether it is still true.
//
// Pure, like the engine: a recorded game in, a report out.

/**
 * Rough creep score to be at, per role, at ten and twenty minutes. Rules of
 * thumb rather than measurements - they are here to be a line you can see
 * yourself under, not a rank requirement. Edit them to your own standard.
 */
export const BENCHMARKS = {
  TOP: { cs10: 70, cs20: 155, wardsPerMin: 0.5 },
  JUNGLE: { cs10: 60, cs20: 140, wardsPerMin: 0.8 },
  MIDDLE: { cs10: 75, cs20: 165, wardsPerMin: 0.6 },
  BOTTOM: { cs10: 80, cs20: 175, wardsPerMin: 0.5 },
  UTILITY: { cs10: 18, cs20: 40, wardsPerMin: 1.6 },
};

/** A warning counts as ignored if you died within this long of hearing it. */
const WARNING_WINDOW = 14;

const at = (moments, kind) => moments.filter((m) => m.kind === kind);
const clockOf = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * Read one recorded game.
 *
 * `game` is what the recorder wrote: some metadata and a list of moments in
 * time order. Everything below is counting, and the counting is deliberately
 * conservative - a death is only blamed on an ignored warning when there was a
 * warning, it was about danger, and it arrived before the death rather than
 * with it.
 */
export function review(game) {
  const moments = game.moments ?? [];
  const deaths = at(moments, 'death');
  const warnings = at(moments, 'warning');
  const samples = at(moments, 'sample');
  const objectives = at(moments, 'objective');
  const end = at(moments, 'end').at(-1) ?? null;
  const duration = game.duration ?? moments.at(-1)?.t ?? 0;
  const role = game.role ?? 'MIDDLE';
  const bench = BENCHMARKS[role] ?? BENCHMARKS.MIDDLE;

  /* Deaths, each with a cause we can defend. */
  const readDeaths = deaths.map((d) => {
    const warned = warnings
      .filter((w) => w.t <= d.t && d.t - w.t <= WARNING_WINDOW && w.danger >= 0.5)
      .at(-1) ?? null;
    return {
      t: d.t,
      clock: clockOf(d.t),
      unaccounted: d.unaccounted ?? 0,
      deep: !!d.deep,
      warned: !!warned,
      warnedAgo: warned ? Math.round(d.t - warned.t) : null,
      warning: warned?.title ?? null,
      why: causeOf(d, warned),
    };
  });

  const ignored = readDeaths.filter((d) => d.warned);
  const deepDeaths = readDeaths.filter((d) => d.deep && d.unaccounted >= 2);

  /* Farm, against the line for the role. */
  const csAt = (minute) => {
    const s = [...samples].reverse().find((m) => m.t <= minute * 60);
    return s ? s.cs : null;
  };
  const cs10 = csAt(10);
  const cs20 = csAt(20);
  const lastSample = samples.at(-1) ?? null;
  const csPerMin = lastSample && lastSample.t > 60
    ? lastSample.cs / (lastSample.t / 60) : null;

  /* Time spent standing somewhere the coach considered dangerous. Sampled, so
     it is a proportion of samples rather than a stopwatch, which is honest
     enough at one sample every fifteen seconds. */
  const risky = samples.filter((s) => (s.danger ?? 0) >= 0.5).length;
  const timeInDanger = samples.length ? risky / samples.length : 0;

  /* Objectives: were you near enough to have been part of it? */
  const contested = objectives.filter((o) => !o.mine);
  const absent = contested.filter((o) => o.dist == null || o.dist > 0.28);
  const taken = objectives.filter((o) => o.mine);

  const wards = lastSample?.wards ?? 0;
  const wardsPerMin = duration > 60 ? wards / (duration / 60) : 0;

  const leaks = rankLeaks({
    deaths: readDeaths, ignored, deepDeaths, duration, role, bench,
    cs10, cs20, timeInDanger, absent, contested, wardsPerMin,
  });

  return {
    id: game.id,
    champion: game.champion ?? '?',
    role,
    startedAt: game.startedAt ?? null,
    duration,
    clock: clockOf(duration),
    result: end?.result ?? game.result ?? null,
    kda: game.kda ?? null,
    deaths: readDeaths,
    counts: {
      deaths: readDeaths.length,
      warnings: warnings.length,
      ignoredWarnings: ignored.length,
      deepDeaths: deepDeaths.length,
      objectivesTaken: taken.length,
      objectivesLost: contested.length,
      objectivesAbsent: absent.length,
    },
    farm: { cs10, cs20, csPerMin, bench },
    vision: { wards, wardsPerMin, bench: bench.wardsPerMin },
    timeInDanger,
    leaks,
    grade: gradeOf(leaks, readDeaths.length, duration),
  };
}

/** Why this death happened, in the plainest terms the record supports. */
function causeOf(d, warned) {
  if (warned) return `Warned ${Math.round(d.t - warned.t)}s earlier and walked in anyway`;
  if (d.deep && (d.unaccounted ?? 0) >= 2) return `Caught in their half with ${d.unaccounted} unaccounted for`;
  if ((d.unaccounted ?? 0) >= 3) return `${d.unaccounted} of them unseen when it happened`;
  if (d.outnumbered) return 'Outnumbered where you were standing';
  return 'Died in a fight the coach had no warning about';
}

/**
 * The leaks, biggest first.
 *
 * `cost` is a rough count of games-worth of damage rather than a real
 * currency - it exists to order the list, and the list is the point. Three
 * things to work on beats eleven things to feel bad about.
 */
function rankLeaks(d) {
  const minutes = Math.max(1, d.duration / 60);
  const leaks = [];

  if (d.ignored.length > 0) {
    leaks.push({
      id: 'ignored-warnings',
      title: `${d.ignored.length} death${d.ignored.length > 1 ? 's' : ''} after a warning you had already been given`,
      detail: `The coach flagged the danger and you were dead inside ${WARNING_WINDOW} seconds: ${d.ignored.map((x) => x.clock).join(', ')}. This is the cheapest thing on this list to fix, because you already had the information.`,
      cost: d.ignored.length * 30,
      fix: 'When the card turns red, finish the animation you are in and walk. Nothing in a lane is worth the trade at that point.',
    });
  }

  if (d.deepDeaths.length > 0) {
    leaks.push({
      id: 'deaths-in-their-half',
      title: `${d.deepDeaths.length} death${d.deepDeaths.length > 1 ? 's' : ''} in their half with the map unaccounted for`,
      detail: `Crossing the river with two or more of them unseen is the single most common way a winning game turns into a losing one.`,
      cost: d.deepDeaths.length * 24,
      fix: 'Cross when somebody is dead or when you can see three of them, not when the wave happens to be shoved.',
    });
  }

  const deathsPerTenMin = (d.deaths.length / minutes) * 10;
  if (deathsPerTenMin > 1.6) {
    leaks.push({
      id: 'death-rate',
      title: `${d.deaths.length} deaths in ${Math.round(minutes)} minutes`,
      detail: `That is ${deathsPerTenMin.toFixed(1)} every ten minutes. Every one of them is roughly a wave and a half of farm plus whatever they took with the time.`,
      cost: Math.round((deathsPerTenMin - 1.6) * 18),
      fix: 'Pick the one lane state you keep dying in and play the next three games only for that.',
    });
  }

  if (d.cs10 != null && d.cs10 < d.bench.cs10 - 8) {
    leaks.push({
      id: 'early-farm',
      title: `${d.cs10} CS at ten minutes, against ${d.bench.cs10} for ${d.role.toLowerCase()}`,
      detail: `${d.bench.cs10 - d.cs10} creeps behind by the time the laning phase is deciding itself. That is most of an item by twenty minutes.`,
      cost: (d.bench.cs10 - d.cs10) * 1.2,
      fix: 'Last-hit under tower rather than trading when you cannot kill. The farm is the trade.',
    });
  }

  if (d.timeInDanger > 0.22) {
    leaks.push({
      id: 'standing-in-danger',
      title: `${Math.round(d.timeInDanger * 100)}% of the game spent standing somewhere dangerous`,
      detail: 'Not deaths - position. Time spent where an unaccounted enemy could reach you is time you are one flash from a death you have not had yet.',
      cost: Math.round((d.timeInDanger - 0.22) * 120),
      fix: 'Between objectives, stand behind your own wave rather than on top of it.',
    });
  }

  if (d.contested.length > 0 && d.absent.length / d.contested.length > 0.4) {
    leaks.push({
      id: 'absent-objectives',
      title: `Not there for ${d.absent.length} of ${d.contested.length} objectives they took`,
      detail: 'Objectives are the one thing on the map that cannot be farmed back. Being on the wrong side when one lands is a decision made forty seconds earlier.',
      cost: d.absent.length * 16,
      fix: 'When the timer under Drake or Baron reads under a minute, start walking. Arriving with it is arriving late.',
    });
  }

  if (d.wardsPerMin < d.bench.wardsPerMin * 0.6 && d.duration > 600) {
    leaks.push({
      id: 'vision',
      title: `${d.wardsPerMin.toFixed(1)} vision per minute, against ${d.bench.wardsPerMin} for ${d.role.toLowerCase()}`,
      detail: 'Most of the deaths above are downstream of this one. You cannot avoid what you cannot see.',
      cost: Math.round((d.bench.wardsPerMin - d.wardsPerMin) * 20),
      fix: 'Place the ward the coach marks before you recall, not after you have already been ganked.',
    });
  }

  return leaks.sort((a, b) => b.cost - a.cost);
}

/**
 * A single number, so a run of games can be a line rather than a pile.
 *
 * The curve saturates rather than subtracting: a bad game should land in the
 * forties, not at zero. A score that bottoms out stops distinguishing between
 * "rough" and "catastrophic", and the difference between those two is most of
 * what you would want to see moving week to week.
 */
function gradeOf(leaks, deaths, duration) {
  const cost = leaks.reduce((s, l) => s + l.cost, 0);
  const score = Math.round(100 - 100 * (cost / (cost + 110)));
  const label = score >= 85 ? 'clean'
    : score >= 70 ? 'solid'
      : score >= 50 ? 'leaking'
        : 'bleeding';
  return { score, label };
}

/**
 * The same reading across many games, which is the only version of it that can
 * tell you whether you are getting better. One game is noise; the trend of
 * "died after a warning" over twenty games is a habit.
 */
export function trend(reviews) {
  if (reviews.length === 0) return null;
  const sum = (f) => reviews.reduce((s, r) => s + f(r), 0);
  const minutes = Math.max(1, sum((r) => r.duration) / 60);
  const half = Math.ceil(reviews.length / 2);
  const mean = (list) => (list.length
    ? list.reduce((s, r) => s + r.grade.score, 0) / list.length : 0);
  /* Reviews arrive newest first, so the "older" half is the tail. */
  const recent = mean(reviews.slice(0, half));
  const older = mean(reviews.slice(half));

  const counted = {};
  for (const r of reviews) {
    for (const l of r.leaks) counted[l.id] = (counted[l.id] ?? 0) + 1;
  }
  const worst = Object.entries(counted).sort((a, b) => b[1] - a[1])[0] ?? null;

  return {
    games: reviews.length,
    wins: sum((r) => (r.result === 'Win' ? 1 : 0)),
    deathsPerTen: (sum((r) => r.counts.deaths) / minutes) * 10,
    ignoredPerGame: sum((r) => r.counts.ignoredWarnings) / reviews.length,
    grade: Math.round(mean(reviews)),
    moving: Math.round(recent - older),
    recurring: worst ? { id: worst[0], games: worst[1] } : null,
  };
}
