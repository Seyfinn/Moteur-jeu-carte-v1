import { useEffect, useRef, useState } from 'react';
import {
  getCharacterCard,
  getCriticalPercent,
  getEvasionPercent,
  getObjectCard,
  getTerrainCard,
  type GameState,
  type LogEntry,
  type PlayerId,
} from 'engine';

export type CharacterBadge =
  | { kind: 'attack'; id: number; label: string }
  | { kind: 'ability'; id: number; label: string }
  | { kind: 'critical'; id: number; percent: number }
  | { kind: 'evasion'; id: number; percent: number }
  | { kind: 'heal'; id: number; amount: number }
  | { kind: 'ko'; id: number; label: string };

export type TableEvent =
  | { kind: 'turn-transition'; id: number; endingPlayerId: PlayerId; endingName: string; startingPlayerId: PlayerId; startingName: string; turnNumber: number }
  | { kind: 'object'; id: number; playerName: string; label: string }
  | { kind: 'terrain'; id: number; playerName: string; label: string }
  | { kind: 'coin-flip'; id: number; label: string };

/**
 * A plain `Omit<Union, K>` collapses a discriminated union down to its *common* keys,
 * which silently threw away every badge/event-specific field here. Distributing over the
 * union preserves each member's own shape.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type Classified =
  | { anchor: 'character'; characterInstanceId: string; badge: DistributiveOmit<CharacterBadge, 'id'> }
  | { anchor: 'table'; event: DistributiveOmit<TableEvent, 'id'> };

function findCharacter(state: GameState, instanceId: string | undefined) {
  if (!instanceId) return undefined;
  return state.players.p1.characters[instanceId] ?? state.players.p2.characters[instanceId];
}

function findTerrain(state: GameState, instanceId: string | undefined) {
  if (!instanceId) return undefined;
  return state.players.p1.terrains[instanceId] ?? state.players.p2.terrains[instanceId];
}

function playerName(state: GameState, playerId: PlayerId | undefined): string {
  return playerId ? state.players[playerId].displayName : '';
}

/** The engine fills LogEntry.playerId for every player-attributed entry. */
function entryPlayerId(entry: LogEntry): PlayerId | undefined {
  return entry.playerId;
}

/**
 * The engine tags every log entry it considers "interesting" with a stable
 * `data.kind`. Classifying on that rather than on the message text means the wording
 * (and its language) can change freely without silently killing the board animations.
 */
function entryKind(entry: LogEntry): string | undefined {
  const kind = entry.data?.['kind'];
  return typeof kind === 'string' ? kind : undefined;
}

function classifyLogEntry(entry: LogEntry, state: GameState): Classified | null {
  const d = entry.data ?? {};

  switch (entryKind(entry)) {
    case 'attack': {
      const characterInstanceId = d['characterInstanceId'] as string | undefined;
      const attackId = d['attackId'] as string | undefined;
      const char = findCharacter(state, characterInstanceId);
      if (!char || !characterInstanceId) return null;
      const attack = getCharacterCard(char.cardId).attacks.find((a) => a.id === attackId);
      return { anchor: 'character', characterInstanceId, badge: { kind: 'attack', label: attack?.name ?? 'Attaque' } };
    }

    case 'use-ability': {
      const characterInstanceId = d['characterInstanceId'] as string | undefined;
      const abilityId = d['abilityId'] as string | undefined;
      const char = findCharacter(state, characterInstanceId);
      if (!char || !characterInstanceId) return null;
      const ability = getCharacterCard(char.cardId).abilities.find((a) => a.id === abilityId);
      return { anchor: 'character', characterInstanceId, badge: { kind: 'ability', label: ability?.name ?? 'Capacité' } };
    }

    case 'play-object': {
      const cardId = d['cardId'] as string | undefined;
      let label = 'Objet';
      try {
        if (cardId) label = getObjectCard(cardId).name;
      } catch {
        /* unknown card id -- keep fallback label */
      }
      return { anchor: 'table', event: { kind: 'object', playerName: playerName(state, entryPlayerId(entry)), label } };
    }

    case 'play-terrain': {
      const terrainInstanceId = d['terrainInstanceId'] as string | undefined;
      const terrain = findTerrain(state, terrainInstanceId);
      let label = 'Terrain';
      try {
        if (terrain) label = getTerrainCard(terrain.cardId).name;
      } catch {
        /* unknown card id -- keep fallback label */
      }
      return { anchor: 'table', event: { kind: 'terrain', playerName: playerName(state, entryPlayerId(entry)), label } };
    }

    case 'initiative': {
      const startingPlayerId = d['startingPlayerId'] as PlayerId | undefined;
      return { anchor: 'table', event: { kind: 'coin-flip', label: `${playerName(state, startingPlayerId)} commence` } };
    }

    case 'coin-flip': {
      const result = d['result'] as string | undefined;
      return { anchor: 'table', event: { kind: 'coin-flip', label: result === 'heads' ? 'Pile' : 'Face' } };
    }

    case 'critical': {
      const sourceInstanceId = d['sourceInstanceId'] as string | undefined;
      const char = findCharacter(state, sourceInstanceId);
      if (!sourceInstanceId || !char) return null;
      // Asks the engine for the real rate (statuses *and* any card modifier in play)
      // rather than re-deriving it from the 'critical' status alone.
      return {
        anchor: 'character',
        characterInstanceId: sourceInstanceId,
        badge: { kind: 'critical', percent: Math.round(getCriticalPercent(state, char)) },
      };
    }

    case 'evasion': {
      const targetInstanceId = d['targetInstanceId'] as string | undefined;
      const char = findCharacter(state, targetInstanceId);
      if (!targetInstanceId || !char) return null;
      return {
        anchor: 'character',
        characterInstanceId: targetInstanceId,
        badge: { kind: 'evasion', percent: Math.round(getEvasionPercent(state, char)) },
      };
    }

    case 'ko': {
      const characterInstanceId = d['characterInstanceId'] as string | undefined;
      const char = findCharacter(state, characterInstanceId);
      if (!characterInstanceId || !char) return null;
      return { anchor: 'character', characterInstanceId, badge: { kind: 'ko', label: 'KO' } };
    }

    case 'heal': {
      const targetInstanceId = d['targetInstanceId'] as string | undefined;
      const amount = Number(d['amount'] ?? 0);
      const char = findCharacter(state, targetInstanceId);
      if (!targetInstanceId || !char || !(amount > 0)) return null;
      return { anchor: 'character', characterInstanceId: targetInstanceId, badge: { kind: 'heal', amount } };
    }

    default:
      return null;
  }
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
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
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
        timersRef.current.push(
          setTimeout(() => setCharacterBadges((list) => list.filter((x) => x.id !== b.id)), CHARACTER_BADGE_DURATION_MS)
        );
      }
    }
    if (newTableEvents.length > 0) {
      setTableEvents((list) => [...list, ...newTableEvents]);
      for (const e of newTableEvents) {
        timersRef.current.push(
          setTimeout(() => setTableEvents((list) => list.filter((x) => x.id !== e.id)), TABLE_EVENT_DURATION_MS)
        );
      }
    }
  }, [state, state.log.length, state.turnNumber, state.activePlayerId]);

  // Every badge schedules its own removal; leaving those timers behind on unmount would
  // fire setState on a dead component (and pile up over a long session).
  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  const badgesByCharacter = new Map<string, CharacterBadge[]>();
  for (const b of characterBadges) {
    const list = badgesByCharacter.get(b.characterInstanceId) ?? [];
    list.push(b);
    badgesByCharacter.set(b.characterInstanceId, list);
  }
  return { badgesByCharacter, tableEvents };
}
