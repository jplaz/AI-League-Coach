// Reading the game that is actually running.
//
// League ships a local HTTP endpoint - the Live Client Data API - that any
// program on the machine may ask about the game in progress. It is the
// sanctioned way to do this: no memory reading, no injection, nothing that
// touches the client. It gives us the clock, the scoreboard, every player's
// champion and level and whether they are dead, and the full event log.
//
// It does not give positions. Nobody's, including yours. That is the whole
// reason the vision module exists, and the split runs all the way through this
// project: facts come from here, places come from the minimap.
//
// The endpoint speaks https with a self-signed certificate, which a browser
// will refuse, so the request goes through this project's own server (see
// server.mjs) and arrives here already unwrapped.

/** Turn one entry of `allPlayers` into the shape the engine wants. */
function readPlayer(p) {
  return {
    name: p.riotIdGameName || p.summonerName || p.riotId || '',
    summoner: p.summonerName || '',
    riotId: p.riotId || '',
    champion: p.championName || p.rawChampionName || '?',
    team: p.team === 'CHAOS' ? 'CHAOS' : 'ORDER',
    level: p.level ?? 1,
    isDead: !!p.isDead,
    respawnIn: Math.max(0, p.respawnTimer ?? 0),
    lane: laneOf(p.position),
    role: (p.position || '').toUpperCase() || null,
    kills: p.scores?.kills ?? 0,
    deaths: p.scores?.deaths ?? 0,
    assists: p.scores?.assists ?? 0,
    cs: p.scores?.creepScore ?? 0,
    wards: p.scores?.wardScore ?? 0,
  };
}

function laneOf(position) {
  return {
    TOP: 'top', MIDDLE: 'mid', BOTTOM: 'bot', UTILITY: 'bot', JUNGLE: null,
  }[(position || '').toUpperCase()] ?? null;
}

/**
 * Normalise a raw `allgamedata` payload into engine input.
 *
 * Everything here is defensive. The live endpoint changes shape between
 * seasons, returns half a payload during the loading screen, and reports an
 * empty `position` in every game that did not come out of ranked queue - none
 * of which is a reason to show the player a stack trace instead of a coach.
 */
export function normalise(raw) {
  if (!raw || !raw.gameData) return { connected: false, reason: 'No game data' };

  const gameTime = Number(raw.gameData.gameTime ?? 0);
  const players = (raw.allPlayers ?? []).map(readPlayer);
  const active = raw.activePlayer ?? {};
  const activeName = active.riotId || active.summonerName || '';

  const me = players.find((p) => p.riotId === activeName)
    ?? players.find((p) => p.name && activeName.startsWith(p.name))
    ?? players.find((p) => p.summoner === activeName)
    ?? null;

  const team = me?.team ?? 'ORDER';
  const stats = active.championStats ?? {};
  const maxHealth = Number(stats.maxHealth ?? 0);

  return {
    connected: true,
    gameTime,
    gameMode: raw.gameData.gameMode ?? 'CLASSIC',
    onRift: (raw.gameData.mapNumber ?? 11) === 11,
    team,
    reportedRole: me?.role ?? null,
    self: {
      champion: me?.champion ?? active.championName ?? '?',
      name: me?.name ?? activeName,
      level: active.level ?? me?.level ?? 1,
      gold: Math.floor(active.currentGold ?? 0),
      healthPct: maxHealth > 0 ? Math.max(0, Number(stats.currentHealth ?? 0) / maxHealth) : null,
      isDead: me?.isDead ?? false,
      respawnIn: me?.respawnIn ?? 0,
      kills: me?.kills ?? 0, deaths: me?.deaths ?? 0, assists: me?.assists ?? 0,
      cs: me?.cs ?? 0,
      pos: null,                       // only the minimap can answer this
    },
    allies: players.filter((p) => p.team === team && p !== me),
    enemies: players.filter((p) => p.team !== team),
    events: raw.events?.Events ?? raw.events ?? [],
  };
}

/**
 * Ask the local server for the current game. Returns a disconnected result
 * rather than throwing: "League is not running" is an ordinary state for this
 * program to be in, not an error, and the interface has something to say about
 * it either way.
 */
export async function pollLive(endpoint = '/api/live') {
  try {
    const res = await fetch(endpoint, { cache: 'no-store' });
    if (!res.ok) return { connected: false, reason: `Server said ${res.status}` };
    const body = await res.json();
    if (!body.connected) return { connected: false, reason: body.reason ?? 'No game in progress' };
    const state = normalise(body.data);
    if (body.demo) state.demo = true;
    if (body.vision) state.demoVision = body.vision;
    return state;
  } catch (err) {
    return { connected: false, reason: `Cannot reach the coach server (${err.message})` };
  }
}
