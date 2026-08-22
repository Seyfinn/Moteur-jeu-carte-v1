import type { CharacterInstance, GameState, PlayerId } from './types.js';
import type { AbilityDef, ModifierDef, ModifierEvalContext, QueryName, Vote } from './cards/types.js';
import { getCharacterCard, getObjectCard, getTerrainCard } from './cards/registry.js';
import {
  getAtkBoostTotal,
  getAtkMultiplierTotal,
  getAtkReductionTotal,
  hasStatus,
  isDisarmed,
  isSilencedActive,
  isSilencedPassive,
  isStunned,
} from './statuses.js';

export function findCharacter(state: GameState, instanceId: string): CharacterInstance {
  for (const playerId of ['p1', 'p2'] as PlayerId[]) {
    const char = state.players[playerId].characters[instanceId];
    if (char) return char;
  }
  throw new Error(`Unknown character instance "${instanceId}"`);
}

interface ModifierSource {
  def: ModifierDef;
  sourceInstanceId: string;
  sourceOwnerId: PlayerId;
}

/**
 * Scans every card currently in play for modifiers matching this query.
 * There is no subscribe/unsubscribe lifecycle: a card's modifier is only
 * ever "seen" while the engine considers it in play, so nothing needs
 * cleaning up when a character dies or an object/terrain leaves the field.
 */
function getInPlaySources(state: GameState, queryName: QueryName): ModifierSource[] {
  const sources: ModifierSource[] = [];
  for (const playerId of ['p1', 'p2'] as PlayerId[]) {
    const player = state.players[playerId];
    const charIds = [player.activeCharacterInstanceId, ...player.benchCharacterInstanceIds].filter(
      (id): id is string => id !== null
    );
    for (const id of charIds) {
      const char = player.characters[id];
      if (!char) continue;
      const def = getCharacterCard(char.cardId);
      for (const mod of def.modifiers ?? []) {
        if (mod.query === queryName) sources.push({ def: mod, sourceInstanceId: id, sourceOwnerId: playerId });
      }
    }
    for (const objId of player.inPlayObjectInstanceIds) {
      const obj = player.objects[objId];
      if (!obj) continue;
      const def = getObjectCard(obj.cardId);
      for (const mod of def.modifiers ?? []) {
        if (mod.query === queryName) sources.push({ def: mod, sourceInstanceId: objId, sourceOwnerId: playerId });
      }
    }
    if (player.activeTerrainInstanceId) {
      const terrain = player.terrains[player.activeTerrainInstanceId];
      if (terrain) {
        const def = getTerrainCard(terrain.cardId);
        for (const mod of def.modifiers ?? []) {
          if (mod.query === queryName) sources.push({ def: mod, sourceInstanceId: terrain.instanceId, sourceOwnerId: playerId });
        }
      }
    }
  }
  return sources;
}

export interface PermissionResult {
  allow: boolean;
  votes: Vote[];
}

/**
 * Section 10: "ce qui empêche > ce qui permet" -- any single deny vote wins
 * over any number of allow votes, no matter their source or recency.
 */
export function evaluatePermission(
  state: GameState,
  queryName: QueryName,
  queryPayload: Record<string, unknown>,
  defaultAllow: boolean,
  extraVotes: Vote[] = []
): PermissionResult {
  const votes: Vote[] = [...extraVotes];
  for (const { def, sourceInstanceId, sourceOwnerId } of getInPlaySources(state, queryName)) {
    if (!def.vote) continue;
    const ctx: ModifierEvalContext = { state, sourceInstanceId, sourceOwnerId, query: queryPayload };
    if (def.isActive && !def.isActive(ctx)) continue;
    const vote = def.vote(ctx);
    if (vote) votes.push(vote);
  }
  if (votes.some((v) => !v.allow)) return { allow: false, votes };
  if (votes.some((v) => v.allow)) return { allow: true, votes };
  return { allow: defaultAllow, votes };
}

export function evaluateTransform<T>(
  state: GameState,
  queryName: QueryName,
  queryPayload: Record<string, unknown>,
  initialValue: T
): T {
  let current: unknown = initialValue;
  for (const { def, sourceInstanceId, sourceOwnerId } of getInPlaySources(state, queryName)) {
    if (!def.transform) continue;
    const ctx: ModifierEvalContext = { state, sourceInstanceId, sourceOwnerId, query: queryPayload };
    if (def.isActive && !def.isActive(ctx)) continue;
    current = def.transform(ctx, current);
  }
  return current as T;
}

// ---------------------------------------------------------------------------
// Typed convenience queries used by the action handlers
// ---------------------------------------------------------------------------

export function canAttack(state: GameState, characterInstanceId: string): PermissionResult {
  const char = findCharacter(state, characterInstanceId);
  const extra: Vote[] = [];
  if (isStunned(char)) extra.push({ allow: false, source: 'status:stun' });
  if (isDisarmed(char)) extra.push({ allow: false, source: 'status:disarmed' });
  return evaluatePermission(state, 'canAttack', { characterInstanceId }, true, extra);
}

/** Only gates the *standard* switch action. External/forced switches bypass this entirely (section 6). */
export function canSwitchStandard(state: GameState, characterInstanceId: string): PermissionResult {
  const char = findCharacter(state, characterInstanceId);
  const extra: Vote[] = [];
  if (isStunned(char)) extra.push({ allow: false, source: 'status:stun' });
  if (hasStatus(char, 'chained')) extra.push({ allow: false, source: 'status:chained' });
  return evaluatePermission(state, 'canSwitchStandard', { characterInstanceId }, true, extra);
}

export function getAbilityUsesPerTurn(
  state: GameState,
  characterInstanceId: string,
  abilityId: string,
  declared: number
): number {
  return evaluateTransform(state, 'getAbilityUsesPerTurn', { characterInstanceId, abilityId }, declared);
}

export function getAbilityUsesPerGame(
  state: GameState,
  characterInstanceId: string,
  abilityId: string,
  declared: number | undefined
): number | undefined {
  return evaluateTransform(state, 'getAbilityUsesPerGame', { characterInstanceId, abilityId }, declared);
}

export function canUseAbility(state: GameState, characterInstanceId: string, ability: AbilityDef): PermissionResult {
  const char = findCharacter(state, characterInstanceId);
  const player = state.players[char.ownerId];
  const extra: Vote[] = [];

  if (isStunned(char)) extra.push({ allow: false, source: 'status:stun' }); // stun blocks all ability use
  if (ability.kind === 'active' && isSilencedActive(char)) extra.push({ allow: false, source: 'status:silence-active' });
  if (ability.kind === 'passive' && isSilencedPassive(char)) extra.push({ allow: false, source: 'status:silence-passive' });

  const isActiveChar = player.activeCharacterInstanceId === characterInstanceId;
  if (!isActiveChar && !ability.usableFromBench) extra.push({ allow: false, source: 'default:active-only' });

  const perTurnLimit = getAbilityUsesPerTurn(state, characterInstanceId, ability.id, ability.usesPerTurn ?? 1);
  const usedThisTurn = char.abilityUsesThisTurn[ability.id] ?? 0;
  if (usedThisTurn >= perTurnLimit) extra.push({ allow: false, source: 'default:per-turn-limit' });

  const perGameLimit = getAbilityUsesPerGame(state, characterInstanceId, ability.id, ability.usesPerGame);
  if (perGameLimit !== undefined) {
    const usedThisGame = char.abilityUsesThisGame[ability.id] ?? 0;
    if (usedThisGame >= perGameLimit) extra.push({ allow: false, source: 'default:per-game-limit' });
  }

  return evaluatePermission(state, 'canUseAbility', { characterInstanceId, abilityId: ability.id }, true, extra);
}

export function getMaxAttachedObjects(state: GameState, characterInstanceId: string): number {
  return evaluateTransform(state, 'getMaxAttachedObjects', { characterInstanceId }, 2);
}

/** Default targeting (section 11): bench is only targetable when the acting card's own text says so. */
export function canTargetBench(
  state: GameState,
  sourceInstanceId: string,
  targetInstanceId: string,
  allowedBySource: boolean
): PermissionResult {
  return evaluatePermission(state, 'canTargetBench', { sourceInstanceId, targetInstanceId }, allowedBySource);
}

export function canPlayObject(state: GameState, playerId: PlayerId): PermissionResult {
  return evaluatePermission(state, 'canPlayObject', { playerId }, true);
}

export function getEffectiveATK(state: GameState, characterInstanceId: string, baseATK: number): number {
  const char = findCharacter(state, characterInstanceId);
  const transformed = evaluateTransform(state, 'getEffectiveATK', { characterInstanceId }, baseATK);
  const withBoosts = Math.max(0, transformed + getAtkBoostTotal(char) - getAtkReductionTotal(char));
  return Math.round(withBoosts * getAtkMultiplierTotal(char));
}

/** Defaults to the base x2 critical multiplier; a card (e.g. a terrain) can transform it for a specific attacker. */
export function getCriticalMultiplier(state: GameState, characterInstanceId: string): number {
  return evaluateTransform(state, 'getCriticalMultiplier', { characterInstanceId }, 2);
}
