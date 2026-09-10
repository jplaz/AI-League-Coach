// What you are playing, and what that means about where you stand.
//
// The live client reports a position for each player, but it reports it from
// the lobby and it is often blank in normal games, so this is written to fall
// back gracefully: take what the client says, let the player correct it, and
// never let a missing role stop the coach from saying something useful.

export const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

export const ROLE_NAMES = {
  TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Support',
};

/** The lane a role lives in during laning phase. Jungle has none, by design. */
export const ROLE_LANE = {
  TOP: 'top', MIDDLE: 'mid', BOTTOM: 'bot', UTILITY: 'bot', JUNGLE: null,
};

/**
 * Where a role stands when the fight actually starts. This is the whole
 * "placement" question in one word per role: 'front' walks in first, 'back'
 * stands a screen behind that, 'flank' arrives from a side nobody warded.
 *
 * It is a default, not a law - an assassin top laner flanks and a tank support
 * fronts - so the UI lets it be overridden and the engine reads the override.
 */
export const ROLE_LINE = {
  TOP: 'front', JUNGLE: 'flank', MIDDLE: 'mid', BOTTOM: 'back', UTILITY: 'mid',
};

/** Roles that are expected to leave their lane early and often. */
export const ROAMERS = new Set(['JUNGLE', 'MIDDLE', 'UTILITY']);

/**
 * Best guess at what the player is playing. `reported` is whatever the live
 * client said, `chosen` is what the player picked in the UI. The player wins,
 * because they know and we are guessing.
 */
export function resolveRole(reported, chosen) {
  const clean = (r) => (typeof r === 'string' ? r.toUpperCase().trim() : '');
  const c = clean(chosen);
  if (ROLES.includes(c)) return c;
  const r = clean(reported);
  if (ROLES.includes(r)) return r;
  if (r === 'SUPPORT') return 'UTILITY';
  if (r === 'ADC' || r === 'BOT') return 'BOTTOM';
  if (r === 'MID') return 'MIDDLE';
  return 'MIDDLE';
}

/** Which line this player holds in a fight, honouring an override. */
export function fightLine(role, override) {
  if (['front', 'mid', 'back', 'flank'].includes(override)) return override;
  return ROLE_LINE[role] ?? 'mid';
}
