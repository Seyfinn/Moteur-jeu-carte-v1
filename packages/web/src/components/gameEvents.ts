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
  | { kind: 'ko'; id: number; label: string };

/**
 * Jet à pourcentage porté par une carte (statut `evasive`/`critical`, modifier d'une
 * capacité ou d'un objet). Le moteur ne les annonce que dans ce cas : le taux de base
 * d'un personnage (1 % d'esquive, 1 % de critique) ne déclenche jamais de mini-roue.
 */
export type ProcRoll = {
  /** 'chance' = jet nommé par la carte elle-même (désarmement, stun, silence...). */
  kind: 'evasion' | 'critical' | 'chance';
  id: number;
  hit: boolean;
  percent: number;
  characterName: string;
  /** Libellé affiché sous la roue. Absent pour l'esquive et le critique, qui ont le leur. */
  label?: string;
};

export type TableEvent =
  | { kind: 'turn-transition'; id: number; endingPlayerId: PlayerId; endingName: string; startingPlayerId: PlayerId; startingName: string; turnNumber: number }
  | { kind: 'coin-flip'; id: number; label: string };

/**
 * Carte mise en avant plein écran au moment où elle est jouée -- objet, terrain, ou le
 * personnage dont on déclenche une capacité. Les deux joueurs la voient : elle est
 * construite à partir du journal, que le serveur diffuse aux deux camps.
 */
export type CardSpotlight = {
  id: number;
  cardId: string;
  cardKind: 'character' | 'object' | 'terrain';
  name: string;
  /** Ligne du dessus : qui fait quoi (« Enzo joue », « Capacité »). */
  action: string;
  /** Ligne du dessous, pour une capacité : son nom. */
  detail?: string;
};

/**
 * A plain `Omit<Union, K>` collapses a discriminated union down to its *common* keys,
 * which silently threw away every badge/event-specific field here. Distributing over the
 * union preserves each member's own shape.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type Classified =
  | { anchor: 'character'; characterInstanceId: string; badge: DistributiveOmit<CharacterBadge, 'id'> }
  | { anchor: 'table'; event: DistributiveOmit<TableEvent, 'id'> }
  | { anchor: 'proc'; proc: DistributiveOmit<ProcRoll, 'id'> }
  | { anchor: 'spotlight'; spotlight: Omit<CardSpotlight, 'id'> };

function characterName(state: GameState, instanceId: string | undefined): string {
  const char = findCharacter(state, instanceId);
  if (!char) return '';
  try {
    return getCharacterCard(char.cardId).name;
  } catch {
    return '';
  }
}

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

/**
 * Une entrée de journal peut produire plusieurs effets à l'écran : l'activation d'une
 * capacité pose un badge sur le personnage *et* met sa carte en avant au centre.
 */
function classifyLogEntry(entry: LogEntry, state: GameState): Classified[] {
  const d = entry.data ?? {};

  switch (entryKind(entry)) {
    case 'attack': {
      const characterInstanceId = d['characterInstanceId'] as string | undefined;
      const attackId = d['attackId'] as string | undefined;
      const char = findCharacter(state, characterInstanceId);
      if (!char || !characterInstanceId) return [];
      const attack = getCharacterCard(char.cardId).attacks.find((a) => a.id === attackId);
      return [{ anchor: 'character', characterInstanceId, badge: { kind: 'attack', label: attack?.name ?? 'Attaque' } }];
    }

    case 'use-ability': {
      const characterInstanceId = d['characterInstanceId'] as string | undefined;
      const abilityId = d['abilityId'] as string | undefined;
      const char = findCharacter(state, characterInstanceId);
      if (!char || !characterInstanceId) return [];
      const def = getCharacterCard(char.cardId);
      const ability = def.abilities.find((a) => a.id === abilityId);
      return [
        { anchor: 'character', characterInstanceId, badge: { kind: 'ability', label: ability?.name ?? 'Capacité' } },
        {
          anchor: 'spotlight',
          spotlight: {
            cardId: char.cardId,
            cardKind: 'character',
            name: def.name,
            action: `${playerName(state, entryPlayerId(entry))} · capacité`,
            detail: ability?.name,
          },
        },
      ];
    }

    // Une évolution mérite la même mise en avant qu'une capacité : c'est la carte elle-même
    // qui change, les deux joueurs doivent voir laquelle arrive.
    case 'evolve': {
      const characterInstanceId = d['characterInstanceId'] as string | undefined;
      const cardId = d['cardId'] as string | undefined;
      if (!characterInstanceId || !cardId) return [];
      let name = 'Évolution';
      try {
        name = getCharacterCard(cardId).name;
      } catch {
        /* unknown card id -- keep fallback label */
      }
      return [
        { anchor: 'character', characterInstanceId, badge: { kind: 'ability', label: 'Évolution' } },
        {
          anchor: 'spotlight',
          spotlight: {
            cardId,
            cardKind: 'character',
            name,
            action: `${playerName(state, entryPlayerId(entry))} · évolution`,
          },
        },
      ];
    }

    case 'play-object': {
      const cardId = d['cardId'] as string | undefined;
      if (!cardId) return [];
      let name = 'Objet';
      try {
        name = getObjectCard(cardId).name;
      } catch {
        /* unknown card id -- keep fallback label */
      }
      return [
        {
          anchor: 'spotlight',
          spotlight: { cardId, cardKind: 'object', name, action: `${playerName(state, entryPlayerId(entry))} joue` },
        },
      ];
    }

    case 'play-terrain': {
      const terrainInstanceId = d['terrainInstanceId'] as string | undefined;
      const terrain = findTerrain(state, terrainInstanceId);
      if (!terrain) return [];
      let name = 'Terrain';
      try {
        name = getTerrainCard(terrain.cardId).name;
      } catch {
        /* unknown card id -- keep fallback label */
      }
      return [
        {
          anchor: 'spotlight',
          spotlight: {
            cardId: terrain.cardId,
            cardKind: 'terrain',
            name,
            action: `${playerName(state, entryPlayerId(entry))} pose`,
          },
        },
      ];
    }

    case 'coin-flip': {
      const result = d['result'] as string | undefined;
      return [{ anchor: 'table', event: { kind: 'coin-flip', label: result === 'heads' ? 'Pile' : 'Face' } }];
    }

    // Un jet raté n'a pas d'autre trace que cette entrée : c'est elle qui fait tourner la
    // mini-roue sur un échec.
    case 'proc-miss': {
      const characterInstanceId = d['characterInstanceId'] as string | undefined;
      const roll = d['roll'] as 'evasion' | 'critical' | undefined;
      if (!characterInstanceId || !roll) return [];
      return [
        {
          anchor: 'proc',
          proc: { kind: roll, hit: false, percent: Math.round(Number(d['percent'] ?? 0)), characterName: characterName(state, characterInstanceId) },
        },
      ];
    }

    // Tout jet à pourcentage annoncé par une carte (désarmement, stun, silence, poison,
    // redirection...) : la roue tourne, que le jet passe ou non.
    case 'chance-roll': {
      const characterInstanceId = d['characterInstanceId'] as string | undefined;
      const percent = Math.round(Number(d['percent'] ?? 0));
      if (!percent) return [];
      return [
        {
          anchor: 'proc',
          proc: {
            kind: 'chance',
            hit: d['hit'] === true,
            percent,
            characterName: characterName(state, characterInstanceId),
            label: typeof d['label'] === 'string' ? (d['label'] as string) : 'Effet',
          },
        },
      ];
    }

    // La Concentration est un objet : son échec est toujours un jet porté par une carte.
    case 'concentration-missed': {
      const characterInstanceId = d['characterInstanceId'] as string | undefined;
      if (!characterInstanceId) return [];
      return [
        {
          anchor: 'proc',
          proc: { kind: 'critical', hit: false, percent: 0, characterName: characterName(state, characterInstanceId) },
        },
      ];
    }

    case 'critical': {
      const sourceInstanceId = d['sourceInstanceId'] as string | undefined;
      const char = findCharacter(state, sourceInstanceId);
      if (!sourceInstanceId || !char) return [];
      if (d['fromCard'] === true) {
        return [
          {
            anchor: 'proc',
            proc: { kind: 'critical', hit: true, percent: Math.round(Number(d['percent'] ?? 0)), characterName: characterName(state, sourceInstanceId) },
          },
        ];
      }
      // Asks the engine for the real rate (statuses *and* any card modifier in play)
      // rather than re-deriving it from the 'critical' status alone.
      return [
        {
          anchor: 'character',
          characterInstanceId: sourceInstanceId,
          badge: { kind: 'critical', percent: Math.round(getCriticalPercent(state, char)) },
        },
      ];
    }

    case 'evasion': {
      const targetInstanceId = d['targetInstanceId'] as string | undefined;
      const char = findCharacter(state, targetInstanceId);
      if (!targetInstanceId || !char) return [];
      if (d['fromCard'] === true) {
        return [
          {
            anchor: 'proc',
            proc: { kind: 'evasion', hit: true, percent: Math.round(Number(d['percent'] ?? 0)), characterName: characterName(state, targetInstanceId) },
          },
        ];
      }
      return [
        {
          anchor: 'character',
          characterInstanceId: targetInstanceId,
          badge: { kind: 'evasion', percent: Math.round(getEvasionPercent(state, char)) },
        },
      ];
    }

    case 'ko': {
      const characterInstanceId = d['characterInstanceId'] as string | undefined;
      const char = findCharacter(state, characterInstanceId);
      if (!characterInstanceId || !char) return [];
      return [{ anchor: 'character', characterInstanceId, badge: { kind: 'ko', label: 'KO' } }];
    }

    // Pas de badge pour un soin : le texte flottant vert de la carte (CharacterCard) le
    // dit déjà, et il le dit mieux -- il est calculé sur les PV réellement rendus, alors
    // que le journal annonce le montant demandé.

    default:
      return [];
  }
}

const CHARACTER_BADGE_DURATION_MS = 1300;
const TABLE_EVENT_DURATION_MS = 2000;
/**
 * Durée de vie d'une mini-roue à l'écran. Elle doit couvrir la rotation de l'aiguille
 * (`proc-needle-spin`, 0,8 s) ET laisser le temps de lire le verdict qu'elle désigne :
 * plus courte, la roue disparaissait avant même d'avoir fini de tourner.
 */
const PROC_ROLL_DURATION_MS = 1800;
/** Assez long pour lire la carte en grand, assez court pour ne pas freiner la partie. */
const SPOTLIGHT_DURATION_MS = 1700;

/** Watches state.log growth and turn/active-player changes, turning them into short-lived
 * animated badges. Character-anchored ones (attack/ability/crit/evasion) render on the
 * relevant CharacterCard; table-level ones (turn change, object/terrain played, coin flip)
 * render as a banner stack over the board. */
export function useGameEvents(state: GameState): {
  badgesByCharacter: Map<string, CharacterBadge[]>;
  tableEvents: TableEvent[];
  procRolls: ProcRoll[];
  spotlights: CardSpotlight[];
} {
  const [characterBadges, setCharacterBadges] = useState<Array<CharacterBadge & { characterInstanceId: string }>>([]);
  const [tableEvents, setTableEvents] = useState<TableEvent[]>([]);
  const [procRolls, setProcRolls] = useState<ProcRoll[]>([]);
  const [spotlights, setSpotlights] = useState<CardSpotlight[]>([]);
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
    const newProcRolls: ProcRoll[] = [];
    const newSpotlights: CardSpotlight[] = [];

    // La main qui passe d'un camp à l'autre, pas le numéro de manche : un tour de jeu
    // couvre désormais l'action des deux joueurs, donc `turnNumber` ne bouge qu'une fois
    // sur deux et la bannière « à qui de jouer » sautait un passage sur deux.
    if (state.activePlayerId !== prevTurnRef.current.activePlayerId) {
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
        for (const classified of classifyLogEntry(entry, state)) {
          if (classified.anchor === 'character') {
            newCharacterBadges.push({ ...classified.badge, id: ++seqRef.current, characterInstanceId: classified.characterInstanceId });
          } else if (classified.anchor === 'proc') {
            newProcRolls.push({ ...classified.proc, id: ++seqRef.current });
          } else if (classified.anchor === 'spotlight') {
            newSpotlights.push({ ...classified.spotlight, id: ++seqRef.current });
          } else {
            newTableEvents.push({ ...classified.event, id: ++seqRef.current } as TableEvent);
          }
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
    if (newProcRolls.length > 0) {
      setProcRolls((list) => [...list, ...newProcRolls]);
      for (const p of newProcRolls) {
        timersRef.current.push(
          setTimeout(() => setProcRolls((list) => list.filter((x) => x.id !== p.id)), PROC_ROLL_DURATION_MS)
        );
      }
    }
    if (newSpotlights.length > 0) {
      // Plusieurs cartes jouées dans le même lot (une carte qui en déclenche une autre) se
      // suivent au lieu de se superposer : chacune attend la fin de la précédente.
      setSpotlights((list) => [...list, ...newSpotlights]);
      newSpotlights.forEach((s, i) => {
        timersRef.current.push(
          setTimeout(
            () => setSpotlights((list) => list.filter((x) => x.id !== s.id)),
            SPOTLIGHT_DURATION_MS * (i + 1)
          )
        );
      });
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
  return { badgesByCharacter, tableEvents, procRolls, spotlights };
}
