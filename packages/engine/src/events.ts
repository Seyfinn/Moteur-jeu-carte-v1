import type { AbilityDef } from './cards/types.js';
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
 * Section 10: when several passives react to the same event, the active
 * player decides the resolution order.
 */
export async function emitEvent(state: GameState, event: EngineEvent, api: EngineApi): Promise<void> {
  const rawSources = getTriggeredSources(state, event);
  if (rawSources.length === 0) return;

  // Filter down to sources that would actually fire *before* asking anyone to
  // order them -- a card whose trigger matches but whose own condition/legality
  // doesn't hold this time (e.g. "only when it's this exact character that died")
  // has no business appearing in an ordering prompt.
  const eligible: { source: TriggeredSource; ctx: ReturnType<EngineApi['buildEffectContext']> }[] = [];
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
    if (answer.kind === 'order') {
      ordered = answer.orderedKeys
        .map((k) => eligible[Number(k)])
        .filter((e): e is (typeof eligible)[number] => e !== undefined);
    }
  }

  for (const { source, ctx } of ordered) {
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
    for (let i = 0; i < fireCount; i++) {
      await source.ability.execute(ctx);
    }
  }
}
