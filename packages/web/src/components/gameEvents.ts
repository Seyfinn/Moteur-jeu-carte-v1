import { useEffect, useRef, useState } from 'react';
import { getCharacterCard, getObjectCard, getTerrainCard, type GameState, type LogEntry, type PlayerId } from 'engine';

/** Base rates from packages/engine/src/statuses.ts -- duplicated here only for the cosmetic
 * "% chance" shown on crit/evasion badges, never used for any actual roll. */
const BASE_EVASION_PERCENT = 5;
const EVASIVE_STATUS_PERCENT = 33;
const BASE_CRITICAL_PERCENT = 2;
const CRITICAL_STATUS_PERCENT = 33;

export type CharacterBadge =
  | { kind: 'attack'; id: number; label: string }
  | { kind: 'ability'; id: number; label: string }
  | { kind: 'critical'; id: number; percent: number }
  | { kind: 'evasion'; id: number; percent: number };

export type TableEvent =
  | { kind: 'turn-transition'; id: number; endingPlayerId: PlayerId; endingName: string; startingPlayerId: PlayerId; startingName: string; turnNumber: number }
  | { kind: 'object'; id: number; playerName: string; label: string }
  | { kind: 'terrain'; id: number; playerName: string; label: string }
  | { kind: 'coin-flip'; id: number; label: string };

type Classified =
  | { anchor: 'character'; characterInstanceId: string; badge: Omit<CharacterBadge, 'id'> }
  | { anchor: 'table'; event: Omit<TableEvent, 'id'> };

function findCharacter(state: GameState, instanceId: string | undefined) {
  if (!instanceId) return undefined;
  return state.players.p1.characters[instanceId] ?? state.players.p2.characters[instanceId];
}

function findTerrain(state: GameState, instanceId: string | undefined) {
  if (!instanceId) return undefined;
  return state.players.p1.terrains[instanceId] ?? state.players.p2.terrains[instanceId];
}

function characterHasStatus(state: GameState, instanceId: string | undefined, statusId: string): boolean {
  return findCharacter(state, instanceId)?.statuses.some((s) => s.statusId === statusId) ?? false;
}

function playerName(state: GameState, playerId: PlayerId | undefined): string {
  return playerId ? state.players[playerId].displayName : '';
}

/** engine-api's log() never fills LogEntry.playerId (see match.ts) -- the acting player is only
 * ever embedded as a literal "p1 "/"p2 " prefix in the message text itself, so parse it from there. */
function messagePlayerId(message: string): PlayerId | undefined {
  if (message.startsWith('p1 ')) return 'p1';
  if (message.startsWith('p2 ')) return 'p2';
  return undefined;
}

function classifyLogEntry(entry: LogEntry, state: GameState): Classified | null {
  const d = entry.data ?? {};
  const msg = entry.message;

  if (msg.includes('attacks with')) {
    const characterInstanceId = d['characterInstanceId'] as string | undefined;
    const attackId = d['attackId'] as string | undefined;
    const char = findCharacter(state, characterInstanceId);
    if (!char || !characterInstanceId) return null;
    const attack = getCharacterCard(char.cardId).attacks.find((a) => a.id === attackId);
    return { anchor: 'character', characterInstanceId, badge: { kind: 'attack', label: attack?.name ?? 'Attaque' } };
  }

  if (msg.includes('uses ability')) {
    const characterInstanceId = d['characterInstanceId'] as string | undefined;
    const abilityId = d['abilityId'] as string | undefined;
    const char = findCharacter(state, characterInstanceId);
    if (!char || !characterInstanceId) return null;
    const ability = getCharacterCard(char.cardId).abilities.find((a) => a.id === abilityId);
    return { anchor: 'character', characterInstanceId, badge: { kind: 'ability', label: ability?.name ?? 'Capacité' } };
  }

  if (msg.includes('plays object')) {
    const cardId = d['cardId'] as string | undefined;
    let label = 'Objet';
    try {
      if (cardId) label = getObjectCard(cardId).name;
    } catch {
      /* unknown card id -- keep fallback label */
    }
    return { anchor: 'table', event: { kind: 'object', playerName: playerName(state, messagePlayerId(msg)), label } };
  }

  if (msg.includes('plays terrain')) {
    const terrainInstanceId = d['terrainInstanceId'] as string | undefined;
    const terrain = findTerrain(state, terrainInstanceId);
    let label = 'Terrain';
    try {
      if (terrain) label = getTerrainCard(terrain.cardId).name;
    } catch {
      /* unknown card id -- keep fallback label */
    }
    return { anchor: 'table', event: { kind: 'terrain', playerName: playerName(state, messagePlayerId(msg)), label } };
  }

  if (msg.startsWith('Coin flip for initiative')) {
    const startingPlayerId = d['startingPlayerId'] as PlayerId | undefined;
    return { anchor: 'table', event: { kind: 'coin-flip', label: `${playerName(state, startingPlayerId)} commence` } };
  }

  if (msg.startsWith('Coin flip:')) {
    const result = d['result'] as string | undefined;
    return { anchor: 'table', event: { kind: 'coin-flip', label: result === 'heads' ? 'Pile' : 'Face' } };
  }

  if (msg.includes('coup critique')) {
    const sourceInstanceId = d['sourceInstanceId'] as string | undefined;
    if (!sourceInstanceId) return null;
    const percent = characterHasStatus(state, sourceInstanceId, 'critical') ? CRITICAL_STATUS_PERCENT : BASE_CRITICAL_PERCENT;
    return { anchor: 'character', characterInstanceId: sourceInstanceId, badge: { kind: 'critical', percent } };
  }

  if (msg.includes('esquive')) {
    const targetInstanceId = d['targetInstanceId'] as string | undefined;
    if (!targetInstanceId) return null;
    const percent = characterHasStatus(state, targetInstanceId, 'evasive') ? EVASIVE_STATUS_PERCENT : BASE_EVASION_PERCENT;
    return { anchor: 'character', characterInstanceId: targetInstanceId, badge: { kind: 'evasion', percent } };
  }

  return null;
}

const CHARACTER_BADGE_DURATION_MS = 1300;
const TABLE_EVENT_DURATION_MS = 2000;

/** Watches state.log growth and turn/active-player changes, turning them into short-lived
 * animated badges. Character-anchored ones (attack/ability/crit/evasion) render on the
 * relevant CharacterCard; table-level ones (turn change, object/terrain played, coin flip)
 * render as a banner stack over the board. */
export function useGameEvents(state: GameState): { badgesByCharacter: Map<string, CharacterBadge[]>; tableEvents: TableEvent[] } {
  const [characterBadges, setCharacterBadges] = useState<Array<CharacterBadge & { characterInstanceId: string }>>([]);
  const [tableEvents, setTableEvents] = useState<TableEvent[]>([]);
  const seqRef = useRef(0);
  // Match.create() logs the initiative coin flip before the very first broadcast either player
  // receives, so that entry is already "history" by the time this hook mounts. Replay from 0 in
  // that one case (turnNumber still 0) so it still animates instead of being silently swallowed;
  // any later mount (reconnect mid-game) starts from the current length as usual.
  const prevLogLenRef = useRef(state.turnNumber === 0 ? 0 : state.log.length);
  const prevTurnRef = useRef({ turnNumber: state.turnNumber, activePlayerId: state.activePlayerId });

  useEffect(() => {
    const newCharacterBadges: Array<CharacterBadge & { characterInstanceId: string }> = [];
    const newTableEvents: TableEvent[] = [];

    if (state.turnNumber !== prevTurnRef.current.turnNumber) {
      const { activePlayerId: endingPlayerId } = prevTurnRef.current;
      newTableEvents.push({
        kind: 'turn-transition',
        id: ++seqRef.current,
        endingPlayerId,
        endingName: playerName(state, endingPlayerId),
        startingPlayerId: state.activePlayerId,
        startingName: playerName(state, state.activePlayerId),
        turnNumber: state.turnNumber,
      });
    }
    prevTurnRef.current = { turnNumber: state.turnNumber, activePlayerId: state.activePlayerId };

    if (state.log.length > prevLogLenRef.current) {
      for (const entry of state.log.slice(prevLogLenRef.current)) {
        const classified = classifyLogEntry(entry, state);
        if (!classified) continue;
        if (classified.anchor === 'character') {
          newCharacterBadges.push({ ...classified.badge, id: ++seqRef.current, characterInstanceId: classified.characterInstanceId });
        } else {
          newTableEvents.push({ ...classified.event, id: ++seqRef.current } as TableEvent);
        }
      }
    }
    prevLogLenRef.current = state.log.length;

    if (newCharacterBadges.length > 0) {
      setCharacterBadges((list) => [...list, ...newCharacterBadges]);
      for (const b of newCharacterBadges) {
        setTimeout(() => setCharacterBadges((list) => list.filter((x) => x.id !== b.id)), CHARACTER_BADGE_DURATION_MS);
      }
    }
    if (newTableEvents.length > 0) {
      setTableEvents((list) => [...list, ...newTableEvents]);
      for (const e of newTableEvents) {
        setTimeout(() => setTableEvents((list) => list.filter((x) => x.id !== e.id)), TABLE_EVENT_DURATION_MS);
      }
    }
  }, [state, state.log.length, state.turnNumber, state.activePlayerId]);

  const badgesByCharacter = new Map<string, CharacterBadge[]>();
  for (const b of characterBadges) {
    const list = badgesByCharacter.get(b.characterInstanceId) ?? [];
    list.push(b);
    badgesByCharacter.set(b.characterInstanceId, list);
  }
  return { badgesByCharacter, tableEvents };
}
