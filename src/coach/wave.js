// The wave clock.
//
// Almost every early-game decision is really a question about minions. Can I
// recall and be back before the next wave? Is the cannon coming, and therefore
// is this the wave I want to fight over? Will the wave I am about to shove
// bounce back into me while their jungler is on this side of the map? None of
// that needs to see the minions - the spawn clock is fixed and the walk to lane
// takes as long as it takes - so all of it can be answered from the game time
// alone, which is the one number the live client always gives us.

import { PATCH, waveNumber, waveSpawnTime, isCannonWave } from '../model/patch.js';
import { laneAt, forTeam } from '../model/rift.js';

/** Seconds after spawn that a wave reaches the middle of a lane. */
const travel = (lane) => PATCH.waveTravel[lane] ?? PATCH.waveTravel.top;

/** Roughly how long it takes to recall and walk back to a lane. */
export const RETURN_COST = { mid: 21, top: 29, bot: 29 };

/**
 * Everything about minions at this instant, for one lane.
 *
 * `arrivesIn` counts down to the moment the next wave meets in the middle of
 * the lane - the moment that matters, rather than the spawn - and `cannonIn`
 * counts waves, not seconds, because that is how players think about it.
 */
export function waveInfo(gameTime, lane = 'mid') {
  const t = travel(lane);
  const current = waveNumber(gameTime);
  let next = Math.max(1, current);
  while (waveSpawnTime(next) + t <= gameTime) next++;

  const arrivesAt = waveSpawnTime(next) + t;
  let cannonWave = next;
  while (!isCannonWave(cannonWave, waveSpawnTime(cannonWave))) cannonWave++;

  return {
    lane,
    number: next,
    arrivesAt,
    arrivesIn: arrivesAt - gameTime,
    isCannon: isCannonWave(next, waveSpawnTime(next)),
    cannonWave,
    cannonIn: cannonWave - next,
    cannonAt: waveSpawnTime(cannonWave) + t,
    started: gameTime >= PATCH.minionsSpawn,
  };
}

/**
 * Whether there is time to go home. `spare` is how many seconds you would have
 * standing in lane after getting back, so a small positive number is a tight
 * but real window and a negative one means the wave beats you there.
 */
export function recallWindow(gameTime, lane = 'mid') {
  const wave = waveInfo(gameTime, lane);
  const cost = RETURN_COST[lane] ?? RETURN_COST.top;
  return {
    spare: wave.arrivesIn - cost,
    open: wave.arrivesIn - cost > 0,
    arrivesIn: wave.arrivesIn,
    cost,
  };
}

/**
 * Where the two waves are meeting, expressed as a point on the map.
 *
 * `push` is the only thing we cannot read from the clock: -1 is the wave
 * crashing into your own tower, 0 is the middle of the lane, +1 is it sitting
 * under theirs. The vision module can infer it roughly from where the player
 * has been standing; until then 0 is the honest answer and the marker sits
 * where the wave would meet if nobody had touched it.
 */
export function laneMeetPoint(lane, team, push = 0) {
  const t = 0.5 + Math.max(-1, Math.min(1, push)) * 0.28;
  return forTeam(laneAt(lane, team === 'CHAOS' ? 1 - t : t), 'ORDER');
}
