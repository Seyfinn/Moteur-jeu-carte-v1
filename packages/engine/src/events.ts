import type { AbilityDef, EffectContext } from './cards/types.js';
import { getCharacterCard, getTerrainCard } from './cards/registry.js';
import type { EngineApi } from './engine-api.js';
import { recordAbilityUse } from './abilities.js';
import { canUseAbility, evaluateTransform, findCharacter } from './queries.js';
import type { EngineEvent, GameState, PlayerId } from './types.js';

interface TriggeredSource {
  ability: AbilityDef;
  sourceInstanceId: string;
  sourceOwnerId: PlayerId;
  kind: 'character' | 'terrain';
}

/**
 * A passive can react to an event by dealing damage, which emits another event, which
 * another passive can react to... Two mirrored "reflect" or "retaliate" cards facing
 * each other would recurse forever. Depth is tracked per game state (a server hosts
 * many matches at once) and the chain is cut off with a log entry rather than blowing
 * the stack and killing the whole room.
 */
const MAX_EVENT_DEPTH = 24;
const eventDepth = new WeakMap<GameState, number>();

function getTriggeredSources(state: GameState, event: EngineEvent): TriggeredSource[] {
  const sources: TriggeredSource[] = [];
  for (const playerId of ['p1', 'p2'] as PlayerId[]) {
    const player = state.players[playerId];
    const charIds = [player.activeCharacterInstanceId, ...player.benchCharacterInstanceIds].filter(
      (id): id is string => id !== null
    );
    for (const id of charIds) {
      const char = player.characters[id];
      if (!char) continue;
      const def = getCharacterCard(char.cardId);
      for (const ability of def.abilities) {
        if (ability.trigger === event.name) {
          sources.push({ ability, sourceInstanceId: id, sourceOwnerId: playerId, kind: 'character' });
        }
      }
    }
    if (player.activeTerrainInstanceId) {
      const terrain = player.terrains[player.activeTerrainInstanceId];
      if (terrain) {
        const def = getTerrainCard(terrain.cardId);
        for (const ability of def.abilities ?? []) {
          if (ability.trigger === event.name) {
            sources.push({ ability, sourceInstanceId: terrain.instanceId, sourceOwnerId: playerId, kind: 'terrain' });
          }
        }
      }
    }
  }

  // Same idea as the KO case below: a terrain that just left play is no longer the
  // active one, so its own "when I leave" reaction has to be looked up explicitly.
  if (event.name === 'onTerrainRemoved') {
    const removedId = event.data['terrainInstanceId'] as string | undefined;
    if (removedId) {
      for (const playerId of ['p1', 'p2'] as PlayerId[]) {
        const terrain = state.players[playerId].terrains[removedId];
        if (!terrain || state.players[playerId].activeTerrainInstanceId === removedId) continue;
        for (const ability of getTerrainCard(terrain.cardId).abilities ?? []) {
          if (ability.trigger === 'onTerrainRemoved') {
            sources.push({ ability, sourceInstanceId: removedId, sourceOwnerId: playerId, kind: 'terrain' });
          }
        }
      }
    }
  }

  // A character that just got KO'd is, by definition, no longer active/benched
  // by the time this event fires -- but its own "on KO" reaction must still be
  // able to run, so it's looked up explicitly instead of via the in-play scan.
  if (event.name === 'onCharacterKO') {
    const diedId = event.data['characterInstanceId'] as string | undefined;
    if (diedId) {
      for (const playerId of ['p1', 'p2'] as PlayerId[]) {
        const player = state.players[playerId];
        if (!player.graveyardCharacterInstanceIds.includes(diedId)) continue;
        const char = player.characters[diedId];
        if (!char) continue;
        const def = getCharacterCard(char.cardId);
        for (const ability of def.abilities) {
          if (ability.trigger === 'onCharacterKO') {
            sources.push({ ability, sourceInstanceId: diedId, sourceOwnerId: playerId, kind: 'character' });
          }
        }
      }
    }
  }

  return sources;
}

/**
 * Still in play -- with the two documented exceptions where a card reacts to its own
 * departure: the character that just died, and the terrain that just left play.
 */
function isStillLive(state: GameState, source: TriggeredSource, event: EngineEvent): boolean {
  if (source.kind === 'terrain') {
    if (state.players[source.sourceOwnerId].activeTerrainInstanceId === source.sourceInstanceId) return true;
    return event.name === 'onTerrainRemoved' && event.data['terrainInstanceId'] === source.sourceInstanceId;
  }
  const player = state.players[source.sourceOwnerId];
  if (
    player.activeCharacterInstanceId === source.sourceInstanceId ||
    player.benchCharacterInstanceIds.includes(source.sourceInstanceId)
  ) {
    return true;
  }
  return event.name === 'onCharacterKO' && event.data['characterInstanceId'] === source.sourceInstanceId;
}

/**
 * Reorders `eligible` from a player's answer while guaranteeing the result stays a
 * permutation of it: unknown/duplicate keys are dropped and anything the answer left
 * out is appended in its original order. Without this, a malformed (or hostile) answer
 * could make one passive fire several times, or silently skip another's.
 */
function applyOrderAnswer<T>(eligible: T[], orderedKeys: string[]): T[] {
  const seen = new Set<number>();
  const ordered: T[] = [];
  for (const key of orderedKeys) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= eligible.length || seen.has(index)) continue;
    seen.add(index);
    ordered.push(eligible[index]!);
  }
  for (let i = 0; i < eligible.length; i++) {
    if (!seen.has(i)) ordered.push(eligible[i]!);
  }
  return ordered;
}

/**
 * Section 10: when several passives react to the same event, the active
 * player decides the resolution order.
 */
export async function emitEvent(state: GameState, event: EngineEvent, api: EngineApi): Promise<void> {
  // Read through a function so TypeScript never narrows it away: `state` is mutated
  // across every await in here (a reaction can end the game mid-chain).
  const isOver = () => state.phase === 'ended';
  if (isOver()) return;

  const depth = eventDepth.get(state) ?? 0;
  if (depth >= MAX_EVENT_DEPTH) {
    api.log(`Trigger chain too deep on ${event.name} -- further reactions are skipped`, {
      eventName: event.name,
      depth,
    });
    return;
  }

  const rawSources = getTriggeredSources(state, event);
  if (rawSources.length === 0) return;

  // Filter down to sources that would actually fire *before* asking anyone to
  // order them -- a card whose trigger matches but whose own condition/legality
  // doesn't hold this time (e.g. "only when it's this exact character that died")
  // has no business appearing in an ordering prompt.
  const eligible: { source: TriggeredSource; ctx: EffectContext }[] = [];
  for (const source of rawSources) {
    if (source.kind === 'character') {
      const permission = canUseAbility(state, source.sourceInstanceId, source.ability);
      if (!permission.allow) continue;
    }
    const ctx = api.buildEffectContext(source.sourceInstanceId, source.sourceOwnerId, event);
    if (source.ability.condition && !source.ability.condition(ctx)) continue;
    eligible.push({ source, ctx });
  }
  if (eligible.length === 0) return;

  let ordered = eligible;
  if (eligible.length > 1) {
    const answer = await api.chooseFor(state.activePlayerId, {
      kind: 'order',
      prompt: `Ordre de résolution : ${event.name}`,
      items: eligible.map((e, i) => ({ key: String(i), label: `${e.source.ability.name} (${e.source.sourceInstanceId})` })),
    });
    if (answer.kind === 'order') ordered = applyOrderAnswer(eligible, answer.orderedKeys);
  }

  eventDepth.set(state, depth + 1);
  try {
    for (const { source, ctx } of ordered) {
      // Eligibility was computed for the whole batch up-front; by the time this entry's
      // turn comes, an earlier reaction (or the ordering prompt itself) may have killed
      // its source, silenced it, or invalidated its condition. Re-check instead of
      // firing a passive from a card that is no longer there.
      if (isOver()) break;
      if (!isStillLive(state, source, event)) continue;
      if (source.kind === 'character') {
        if (!canUseAbility(state, source.sourceInstanceId, source.ability).allow) continue;
      }
      if (source.ability.condition && !source.ability.condition(ctx)) continue;

      if (source.kind === 'character') {
        recordAbilityUse(findCharacter(state, source.sourceInstanceId), source.ability.id);
      }

      // Lets a card override how many times another card's trigger fires this event
      // (e.g. "the terrain activates twice per turn while I'm active").
      const fireCount = evaluateTransform(
        state,
        'getTriggerFireCount',
        { sourceInstanceId: source.sourceInstanceId, sourceOwnerId: source.sourceOwnerId, sourceKind: source.kind, abilityId: source.ability.id, eventName: event.name },
        1
      );
      for (let i = 0; i < Math.max(0, Math.min(fireCount, 10)); i++) {
        await source.ability.execute(ctx);
        if (isOver()) break;
      }
    }
  } finally {
    const current = eventDepth.get(state) ?? 1;
    eventDepth.set(state, Math.max(0, current - 1));
  }
}
