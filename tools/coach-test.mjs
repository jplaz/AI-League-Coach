#!/usr/bin/env node
// Does the coach say the right thing?
//
// Not "does it run" - it is a pure function over plain objects, it will always
// run. The question is whether the ranking survives contact with a real board:
// a scenario where two of them are dead and a soul drake is up had better not
// come back with "hold mid". Every scenario asserts on which rule wins, because
// the rule that wins is the only thing the player actually reads.
//
//   node tools/coach-test.mjs

import { coach } from '../src/coach/engine.js';
import { SCENARIOS } from './scenarios.mjs';
import { waveInfo, recallWindow } from '../src/coach/wave.js';
import { readTimeline } from '../src/live/timeline.js';
import { predictJungler } from '../src/coach/jungle.js';
import { deathTimer, isCannonWave, waveNumber } from '../src/model/patch.js';
import { laneAt, nearestLane, mirror, forTeam, oppose, turret, P } from '../src/model/rift.js';
import { objectivePoint } from '../src/coach/jungle.js';
import { wardsFor } from '../src/model/rift.js';
import { findChampions } from '../src/vision/detect.js';
import { ContactTracker } from '../src/vision/tracker.js';

let failures = 0;
let checks = 0;

function ok(cond, what, extra = '') {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  FAIL  ${what}${extra ? `\n        ${extra}` : ''}`);
  }
  return cond;
}

console.log('\nScenarios\n');
for (const s of SCENARIOS) {
  const out = coach(s.input);
  const id = out.primary?.id ?? '(none)';
  const line = `${s.id.padEnd(20)} -> ${id.padEnd(14)} ${out.primary?.title ?? ''}`;
  console.log(`  ${line}`);

  if (s.expect.primary) {
    ok(id === s.expect.primary, `${s.id}: expected primary "${s.expect.primary}"`, `got "${id}"`);
  }
  if (s.expect.primaryOneOf) {
    ok(s.expect.primaryOneOf.includes(id),
      `${s.id}: expected one of ${s.expect.primaryOneOf.join(', ')}`, `got "${id}"`);
  }
  if (s.expect.hasMarker) {
    ok(out.marker && Number.isFinite(out.marker.x) && Number.isFinite(out.marker.y),
      `${s.id}: primary directive names a place to stand`);
  }
  ok(out.directives.length > 0, `${s.id}: says something`);
  ok(out.wards.length > 0, `${s.id}: suggests vision`);
  for (const d of out.directives) {
    ok(d.kind !== 'error', `${s.id}: no rule threw`, d.detail);
    ok(!d.target || (d.target.x >= 0 && d.target.x <= 1 && d.target.y >= 0 && d.target.y <= 1),
      `${s.id}: "${d.id}" points somewhere on the map`, JSON.stringify(d.target));
  }
}

console.log('\nClock\n');
ok(waveNumber(64) === 0 && waveNumber(65) === 1, 'first wave spawns at 1:05');
ok(isCannonWave(3, 125) && !isCannonWave(4, 155), 'cannon rides every third wave early');
ok(isCannonWave(2, 16 * 60), 'cannon rides every second wave after fifteen minutes');
ok(waveInfo(60, 'mid').arrivesIn > 0, 'the first wave is still on its way at a minute');
ok(recallWindow(70, 'mid').open, 'there is time to go home right after a wave arrives');
ok(!recallWindow(115, 'mid').open, 'there is not, twenty seconds before the next one');
ok(deathTimer(6, 300) < deathTimer(6, 2400), 'dying costs more later');
ok(Math.abs(deathTimer(1, 0) - 10) < 0.01, 'a level one death is ten seconds');

console.log('\nMap\n');
ok(Math.abs(laneAt('mid', 0.5).x - 0.5) < 0.001, 'mid lane halfway is the centre of the map');
ok(nearestLane({ x: 0.09, y: 0.5 }).lane === 'top', 'the left edge is top lane');
ok(nearestLane({ x: 0.5, y: 0.09 }).lane === 'bot', 'the bottom edge is bot lane');
ok(Math.abs(mirror(P.drake).x - P.baron.x) < 0.001, 'the pits are each other mirrored');
ok(forTeam(P.fountain, 'CHAOS').x > 0.9, 'red fountain is in the far corner');

console.log('\nBoth sides of the same map\n');
{
  /* The bug this section exists for: the baron pit is not a team-relative
     place, and mirroring it walks red side into the drake pit. */
  ok(objectivePoint('baron') === P.baron, 'baron is baron from both sides');
  ok(objectivePoint('drake').y < objectivePoint('baron').y, 'and drake is the other one');
  ok(objectivePoint('herald') === P.baron, 'herald is fought in the baron pit');

  /* Blue's top turrets stand on the left edge; red's stand along the top. */
  ok(turret('top', 1, 'ORDER').x < 0.15, "blue's top turret is on the left edge");
  ok(turret('top', 1, 'CHAOS').y > 0.85, "red's top turret is along the top edge");
  ok(turret('bot', 1, 'ORDER').y < 0.15, "blue's bot turret is along the bottom");
  ok(turret('bot', 1, 'CHAOS').x > 0.85, "red's bot turret is on the right edge");
  ok(Math.abs(turret('mid', 1, 'CHAOS').x - 0.625) < 0.001, 'mid is the diagonal for both');
  ok(Math.abs(oppose(P.topT1).x - (1 - P.topT1.y)) < 1e-9, 'opposing reflects the other diagonal');

  /* A red-side top laner is told about the turret in *their* lane. */
  const redTop = coach({
    gameTime: 700, team: 'CHAOS', role: 'TOP',
    self: { champion: 'Ornn', level: 8, gold: 300, healthPct: 0.9, pos: oppose({ x: 0.09, y: 0.63 }) },
    enemies: [{ champion: 'Aatrox', team: 'ORDER', lane: 'top', isDead: true, respawnIn: 30 }],
    events: [], contacts: [], junglerSightings: [],
  });
  const plates = redTop.directives.find((d) => d.id === 'plates');
  ok(plates && plates.target.x < 0.15,
    "a red top laner is sent at blue's top turret, on the left edge",
    JSON.stringify(plates?.target));

  /* And a red-side player told to set up baron walks to the baron pit. */
  const redBaron = coach({
    gameTime: 1560, team: 'CHAOS', role: 'JUNGLE',
    self: { champion: 'Vi', level: 15, gold: 900, healthPct: 0.9, pos: { x: 0.5, y: 0.5 } },
    enemies: [], events: [], contacts: [], junglerSightings: [],
  });
  ok(redBaron.marker && redBaron.marker.y > redBaron.marker.x,
    'red side sets up baron in the top half of the map', JSON.stringify(redBaron.marker));

  /* Ward spots are the same set of places for both teams. */
  const blueWards = wardsFor('ORDER').map((w) => `${w.pos.x.toFixed(3)},${w.pos.y.toFixed(3)}`).sort();
  const redWards = wardsFor('CHAOS').map((w) => `${w.pos.x.toFixed(3)},${w.pos.y.toFixed(3)}`).sort();
  ok(blueWards.length === redWards.length, 'both teams get the same number of ward spots');
  const pitWard = wardsFor('CHAOS').find((w) => w.id === 'pit-baron');
  ok(pitWard.pos.y > pitWard.pos.x, 'the baron pit ward is at the baron pit for red too');
}

console.log('\nObjectives\n');
{
  const players = [{ name: 'Ally', team: 'ORDER' }, { name: 'Foe', team: 'CHAOS' }];
  const tl = readTimeline(1000, [
    { EventName: 'DragonKill', EventTime: 300, KillerName: 'Ally', DragonType: 'Ocean' },
    { EventName: 'DragonKill', EventTime: 620, KillerName: 'Ally', DragonType: 'Cloud' },
    { EventName: 'DragonKill', EventTime: 930, KillerName: 'Ally', DragonType: 'Mountain' },
  ], players);
  ok(tl.drake.stacks.ORDER === 3, 'three drakes counted for blue');
  ok(tl.drake.soulPoint === true, 'three drakes is soul point');
  ok(Math.abs(tl.drake.at - 1230) < 0.01, 'the next drake is five minutes after the last');

  const soul = readTimeline(1400, [
    ...[300, 620, 930, 1240].map((t) => ({ EventName: 'DragonKill', EventTime: t, KillerName: 'Ally', DragonType: 'Ocean' })),
  ], players);
  ok(soul.drake.soulTeam === 'ORDER', 'four drakes is a soul');
  ok(soul.drake.at === null && soul.elder.at !== null, 'after a soul it is elder, not drake');

  const baron = readTimeline(2000, [{ EventName: 'BaronKill', EventTime: 1700, KillerName: 'Foe' }], players);
  ok(Math.abs(baron.baron.at - 2060) < 0.01, 'baron is back six minutes after it dies');

  const towers = readTimeline(1000, [
    { EventName: 'TurretKilled', TurretKilled: 'Turret_T2_L_03_A', EventTime: 500 },
    { EventName: 'TurretKilled', TurretKilled: 'Turret_T2_L_02_A', EventTime: 900 },
  ], players);
  ok(towers.turrets.CHAOS.top === 2, 'two of their top turrets are down');
}

console.log('\nTheir jungler\n');
{
  const seen = { pos: forTeam(mirror(P.gromp), 'ORDER'), at: 120 };
  const soon = predictJungler('ORDER', 125, [seen]);
  const later = predictJungler('ORDER', 240, [seen]);
  ok(soon.confidence > later.confidence, 'the guess decays');
  ok(later.radius > soon.radius, 'and spreads out');
  ok(predictJungler('ORDER', 400, []).confidence < 0.2, 'never having seen them is worth nothing');
  const toObjective = predictJungler('ORDER', 300, [seen], { key: 'drake', in: 20, at: 320 });
  ok(Math.abs(toObjective.pos.x - P.drake.x) < 0.01, 'a spawning objective pulls the guess to the pit');
}

console.log('\nMinimap reading\n');
{
  /* A frame the way the game draws one: a dark square with coloured rings on
     it. If the detector cannot find icons here it will not find them there. */
  const SIZE = 160;
  const frame = { width: SIZE, height: SIZE, data: new Uint8ClampedArray(SIZE * SIZE * 4) };
  for (let i = 0; i < frame.data.length; i += 4) {
    frame.data[i] = 18; frame.data[i + 1] = 26; frame.data[i + 2] = 22; frame.data[i + 3] = 255;
  }
  const ring = (cx, cy, rgb, radius = 4) => {
    for (let a = 0; a < 360; a += 4) {
      for (const r of [radius, radius - 1]) {
        const x = Math.round(cx + Math.cos(a * Math.PI / 180) * r);
        const y = Math.round(cy + Math.sin(a * Math.PI / 180) * r);
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
        const i = (y * SIZE + x) * 4;
        frame.data[i] = rgb[0]; frame.data[i + 1] = rgb[1]; frame.data[i + 2] = rgb[2];
      }
    }
  };
  const RED = [214, 58, 56]; const BLUE = [64, 168, 232]; const WHITE = [242, 246, 250];
  ring(120, 40, RED);           // an enemy, top right of the image
  ring(40, 120, RED);           // another, bottom left
  ring(80, 80, BLUE);           // an ally in the middle
  ring(60, 100, WHITE);         // you
  const toMap = (px, py, size) => ({ x: px / size, y: 1 - py / size });
  const seen = findChampions(frame, toMap, { sensitivity: 0.5 });

  ok(seen.enemies.length === 2, 'both enemy icons found', `found ${seen.enemies.length}`);
  ok(seen.allies.length === 1, 'the ally icon found', `found ${seen.allies.length}`);
  ok(seen.self.length === 1, 'your own icon found', `found ${seen.self.length}`);
  const e = seen.enemies.find((q) => q.x > 0.5);
  ok(e && Math.abs(e.x - 0.75) < 0.02 && Math.abs(e.y - 0.75) < 0.02,
    'an icon lands where it was drawn', JSON.stringify(e));

  /* A long red bar is a health bar, not a champion. */
  const bar = { width: SIZE, height: SIZE, data: new Uint8ClampedArray(frame.data) };
  for (let x = 20; x < 60; x++) {
    const i = ((20 * SIZE) + x) * 4;
    bar.data[i] = 214; bar.data[i + 1] = 58; bar.data[i + 2] = 56;
  }
  ok(findChampions(bar, toMap, {}).enemies.length === 2, 'a health bar is not a champion');

  const tracker = new ContactTracker('ORDER');
  tracker.update(600, seen);
  ok(tracker.contacts(600).length === 2, 'the tracker holds both of them');
  ok(tracker.self !== null, 'and knows where you are');

  /* They walk into the fog: still known, no longer visible. */
  tracker.update(604, { enemies: [], allies: seen.allies, self: seen.self });
  const stale = tracker.contacts(604);
  ok(stale.length === 2 && stale.every((c) => !c.visible), 'unseen is remembered, not forgotten');
  ok(stale[0].lastSeen === 600, 'and remembers when it stopped being seen');
  tracker.update(700, { enemies: [], allies: [], self: [] });
  ok(tracker.contacts(700).length === 0, 'a minute and a half later it lets go');

  /* A red dot deep in the jungle is taken for their jungler. */
  const jungle = new ContactTracker('ORDER');
  jungle.update(300, { enemies: [{ x: 0.79, y: 0.46 }], allies: [], self: [] });
  ok(jungle.junglerSightings.length === 1, 'an off-lane enemy is logged as their jungler');
  jungle.update(305, { enemies: [{ x: 0.5, y: 0.5 }], allies: [], self: [] });
  ok(jungle.junglerSightings.length === 1, 'but somebody standing in mid lane is not');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.log(`${failures} FAILED\n`);
  process.exit(1);
}
console.log('');
