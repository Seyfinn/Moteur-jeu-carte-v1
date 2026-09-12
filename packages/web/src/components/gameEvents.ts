import { useEffect, useRef, useState } from 'react';
import {
  attacksAvailableTo,
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
  /**
   * Carte du personnage que le jet concerne. La roue en fait son moyeu : un jet sans visage
   * oblige à lire un nom pour savoir de qui on parle, au moment précis où l'écran demande
   * qu'on regarde ailleurs. Absente si l'instance n'est plus résoluble (carte déjà partie).
   */
  cardId?: string;
  /** Libellé affiché sous la roue. Absent pour l'esquive et le critique, qui ont le leur. */
  label?: string;
};

/**
 * Puissance d'un coup, qui décide de toute la mise en scène de l'impact (amplitude du dash
 * de l'attaquant, secousse de la cible, secousse du plateau entier). Les seuils sont ici et
 * nulle part ailleurs -- la CSS ne lit que le palier.
 */
export type ImpactTier = 'light' | 'heavy' | 'brutal' | 'devastating' | 'cataclysm';

/**
 * Seuils de dégâts, du coup d'épingle au cataclysme. Ils vivent ici et nulle part ailleurs :
 * la CSS ne connaît que le nom du palier, jamais un nombre de PV.
 */
const TIER_THRESHOLDS: Array<[number, ImpactTier]> = [
  [150, 'cataclysm'],
  [100, 'devastating'],
  [70, 'brutal'],
  [50, 'heavy'],
];

/** À partir de ce palier, c'est tout l'écran qui encaisse. */
export const QUAKE_TIERS: ReadonlySet<ImpactTier> = new Set<ImpactTier>(['heavy', 'brutal', 'devastating', 'cataclysm']);

function tierFor(amount: number, critical: boolean): ImpactTier {
  const found = TIER_THRESHOLDS.find(([min]) => amount >= min)?.[1];
  if (found) return found;
  // Un critique sous les 50 PV mérite quand même mieux qu'une pichenette, sans pour autant
  // secouer l'écran comme un coup à 150.
  return critical ? 'heavy' : 'light';
}

/** Rôle d'une carte dans un échange de coups : elle porte, ou elle encaisse. */
export type CharacterImpact = { id: number; role: 'attacker' | 'target'; tier: ImpactTier; critical: boolean };

/**
 * Une carte qui vient de mourir, gardée en vie le temps de son animation alors que le
 * moteur l'a déjà rangée au cimetière. Elle est rejouée en calque au-dessus du plateau,
 * à la dernière position connue de sa vraie carte (cf. `cardRects.ts`).
 */
export type KoFlight = { id: number; instanceId: string; cardId: string; ownerId: PlayerId };

/**
 * Trait de frappe tiré d'un personnage vers celui qui encaisse. C'est ce qui RELIE les deux
 * cartes d'un échange : sans lui, le bond de l'attaquant et la secousse de la cible sont
 * deux animations sans rapport visible, aux deux bouts d'un plateau large. Rejoué en calque
 * fixe à partir des positions relevées (cf. `cardRects.ts`), comme le vol d'une carte morte.
 */
export type StrikeBolt = {
  id: number;
  fromInstanceId: string;
  toInstanceId: string;
  tier: ImpactTier;
  critical: boolean;
};

/**
 * Éclat ponctuel joué SUR une carte, mais dessiné par-dessus le plateau plutôt que dans le
 * calque d'effets de la carte : un anneau de souffle ou une colonne de lumière doit pouvoir
 * déborder du cadre, que l'`overflow: hidden` de `.tcg-card` rognerait net.
 */
export type CardFlourishKind = 'crit' | 'evolve' | 'revive' | 'shield-hit';
export type CardFlourish = { id: number; characterInstanceId: string; kind: CardFlourishKind };

/** Secousse de la table entière : son palier décide de l'amplitude et de la durée. */
export type BoardQuake = { id: number; tier: ImpactTier; critical: boolean };

export type TableEvent =
  | { kind: 'turn-transition'; id: number; endingPlayerId: PlayerId; endingName: string; startingPlayerId: PlayerId; startingName: string; turnNumber: number }
  | { kind: 'coin-flip'; id: number; label: string };

/**
 * L'objet réellement tiré par le Recycleur, connu uniquement du joueur qui l'a activé (le
 * moteur pose cette entrée avec `privateTo`, donc `getPlayerView` la retire déjà pour
 * l'adversaire -- ce qu'on reçoit ici est forcément le nôtre). Sert à jouer le Card-Flip de
 * révélation avec la vraie carte plutôt qu'un dos générique.
 */
export type RecycleReveal = { id: number; cardId: string };

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
  | { anchor: 'spotlight'; spotlight: Omit<CardSpotlight, 'id'> }
  | { anchor: 'impact'; targetInstanceId: string; attackerInstanceId?: string; tier: ImpactTier; critical: boolean }
  | { anchor: 'strike'; strike: Omit<StrikeBolt, 'id'> }
  | { anchor: 'flourish'; flourish: Omit<CardFlourish, 'id'> }
  | { anchor: 'ko-flight'; flight: Omit<KoFlight, 'id'> }
  | { anchor: 'recycle-reveal'; reveal: Omit<RecycleReveal, 'id'> };

/**
 * Mémoire de lecture d'un lot d'entrées de journal. L'entrée `damage` ne nomme que sa
 * cible : c'est l'entrée `attack` / `use-ability` qui la précède dans le même lot qui dit
 * d'où le coup vient, et l'entrée `critical` qui dit s'il faut tout faire trembler.
 */
interface BatchContext {
  lastActorInstanceId?: string;
  criticalPending: boolean;
}

/**
 * Le personnage que la roue nomme : son nom pour la ligne de texte, sa carte pour le moyeu.
 * Les deux sortent de la même instance, d'où un seul lecteur -- et un id de carte inconnu du
 * registre reste exploitable pour l'illustration même si le nom, lui, se dérobe.
 */
function procSubject(state: GameState, instanceId: string | undefined): { characterName: string; cardId?: string } {
  const char = findCharacter(state, instanceId);
  if (!char) return { characterName: '' };
  try {
    return { characterName: getCharacterCard(char.cardId).name, cardId: char.cardId };
  } catch {
    return { characterName: '', cardId: char.cardId };
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
function classifyLogEntry(entry: LogEntry, state: GameState, ctx: BatchContext): Classified[] {
  const d = entry.data ?? {};

  switch (entryKind(entry)) {
    case 'attack': {
      const characterInstanceId = d['characterInstanceId'] as string | undefined;
      const attackId = d['attackId'] as string | undefined;
      const char = findCharacter(state, characterInstanceId);
      if (!char || !characterInstanceId) return [];
      ctx.lastActorInstanceId = characterInstanceId;
      // `attacksAvailableTo` et pas `getCharacterCard(...).attacks` : une attaque empruntée
      // ("Livre de Chrollo") n'est pas sur la carte du porteur, et le badge retombait alors
      // sur un « Attaque » générique au lieu de la nommer.
      const attack = attacksAvailableTo(state, characterInstanceId).find((a) => a.id === attackId);
      return [{ anchor: 'character', characterInstanceId, badge: { kind: 'attack', label: attack?.name ?? 'Attaque' } }];
    }

    // Les dégâts ne nomment pas leur source : elle vient de l'entrée d'action qui précède
    // dans le même lot. Sans elle (tic de poison, effet de terrain), la cible encaisse
    // seule -- il n'y a personne à faire bondir.
    case 'damage': {
      const targetInstanceId = d['targetInstanceId'] as string | undefined;
      const amount = Number(d['amount'] ?? 0);
      if (!targetInstanceId || amount <= 0) return [];
      const rawAttackerId = ctx.lastActorInstanceId;
      // Un personnage ne bondit pas sur lui-même (coût en PV que son camp se paie), et ne
      // se tire pas non plus un trait de frappe dessus.
      const attackerInstanceId = rawAttackerId && rawAttackerId !== targetInstanceId ? rawAttackerId : undefined;
      const critical = ctx.criticalPending;
      const tier = tierFor(amount, critical);
      ctx.criticalPending = false;
      return [
        {
          anchor: 'impact',
          targetInstanceId,
          ...(attackerInstanceId ? { attackerInstanceId } : {}),
          tier,
          critical,
        },
        ...(attackerInstanceId
          ? [
              {
                anchor: 'strike' as const,
                strike: { fromInstanceId: attackerInstanceId, toInstanceId: targetInstanceId, tier, critical },
              },
            ]
          : []),
        // Le critique a sa propre déflagration sur la cible, quel que soit le montant :
        // c'est ce qui le distingue d'un gros coup ordinaire au même palier.
        ...(critical
          ? [{ anchor: 'flourish' as const, flourish: { characterInstanceId: targetInstanceId, kind: 'crit' as const } }]
          : []),
      ];
    }

    case 'use-ability': {
      const characterInstanceId = d['characterInstanceId'] as string | undefined;
      const abilityId = d['abilityId'] as string | undefined;
      const char = findCharacter(state, characterInstanceId);
      if (!char || !characterInstanceId) return [];
      ctx.lastActorInstanceId = characterInstanceId;
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
        { anchor: 'flourish', flourish: { characterInstanceId, kind: 'evolve' } },
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

    // L'entrée publique (compte seulement) ne porte pas de `cardId` -- seule l'entrée
    // privée, réservée au joueur qui a activé le Recycleur, en porte un.
    case 'recycle': {
      const cardId = d['cardId'] as string | undefined;
      if (!cardId) return [];
      return [{ anchor: 'recycle-reveal', reveal: { cardId } }];
    }

    // Retour en jeu : la carte se rallume sur place. Le pendant exact du vol de mort, qui
    // est la seule autre fois où une carte apparaît ou disparaît du plateau toute seule.
    case 'revive': {
      const characterInstanceId = d['characterInstanceId'] as string | undefined;
      if (!characterInstanceId) return [];
      return [{ anchor: 'flourish', flourish: { characterInstanceId, kind: 'revive' } }];
    }

    // Le bouclier qui encaisse : rien ne bouge côté PV, donc sans cet éclat le joueur ne
    // voyait tout simplement pas que son bouclier venait de faire son travail.
    case 'shield-absorb': {
      const targetInstanceId = d['targetInstanceId'] as string | undefined;
      if (!targetInstanceId) return [];
      return [{ anchor: 'flourish', flourish: { characterInstanceId: targetInstanceId, kind: 'shield-hit' } }];
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
          proc: { kind: roll, hit: false, percent: Math.round(Number(d['percent'] ?? 0)), ...procSubject(state, characterInstanceId) },
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
            ...procSubject(state, characterInstanceId),
            label: typeof d['label'] === 'string' ? (d['label'] as string) : 'Effet',
          },
        },
      ];
    }

    // La Concentration est un objet : son échec est toujours un jet porté par une carte.
    // Le taux vient du moteur (le statut est consommé avant ce journal, donc l'état reçu ne
    // le porte plus) : sans lui, la roue dessinait un pile ou face pour un jet à 70 %.
    case 'concentration-missed': {
      const characterInstanceId = d['characterInstanceId'] as string | undefined;
      if (!characterInstanceId) return [];
      return [
        {
          anchor: 'proc',
          proc: {
            kind: 'critical',
            hit: false,
            percent: Math.round(Number(d['percent'] ?? 0)),
            ...procSubject(state, characterInstanceId),
          },
        },
      ];
    }

    case 'critical': {
      const sourceInstanceId = d['sourceInstanceId'] as string | undefined;
      const char = findCharacter(state, sourceInstanceId);
      if (!sourceInstanceId || !char) return [];
      // Un critique fait passer le coup qui suit au palier maximal, quel que soit son montant.
      ctx.criticalPending = true;
      if (d['fromCard'] === true) {
        return [
          {
            anchor: 'proc',
            proc: { kind: 'critical', hit: true, percent: Math.round(Number(d['percent'] ?? 0)), ...procSubject(state, sourceInstanceId) },
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
            proc: { kind: 'evasion', hit: true, percent: Math.round(Number(d['percent'] ?? 0)), ...procSubject(state, targetInstanceId) },
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
      const ownerId = d['ownerId'] as PlayerId | undefined;
      const char = findCharacter(state, characterInstanceId);
      if (!characterInstanceId || !char) return [];
      return [
        { anchor: 'character', characterInstanceId, badge: { kind: 'ko', label: 'KO' } },
        // Le moteur a déjà rangé la carte au cimetière dans cet état-là : le vol est rejoué
        // en calque, à la dernière position connue de la vraie carte.
        ...(ownerId
          ? [{ anchor: 'ko-flight' as const, flight: { instanceId: characterInstanceId, cardId: char.cardId, ownerId } }]
          : []),
      ];
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
 * Les deux temps d'une roue : la rotation de l'aiguille, puis la lecture du verdict.
 *
 * Ces deux nombres sont la SEULE source de vérité. `ProcWheel` les repasse au CSS en
 * variables (`--proc-spin`, `--proc-hold`), qui ne recopie plus aucune durée en dur : la
 * feuille de style écrivait « 2s » à six endroits, plus deux voisins calés à la main, et le
 * commentaire qui prévenait d'en changer se trompait déjà sur leur nombre.
 *
 * 3 s au total, c'était long pour un événement qui revient plusieurs fois par tour et qui
 * occupe le centre de l'écran. Le suspense tient dans la décélération, pas dans la durée.
 */
export const PROC_SPIN_MS = 1400;
export const PROC_HOLD_MS = 850;
const PROC_ROLL_DURATION_MS = PROC_SPIN_MS + PROC_HOLD_MS;
/** Assez long pour lire la carte en grand, assez court pour ne pas freiner la partie. */
const SPOTLIGHT_DURATION_MS = 1700;
/**
 * Couvre le dash de l'attaquant, la secousse de la cible ET la course du chiffre flottant
 * qu'elle fait naître (1,05 s) : c'est la classe d'impact qui teinte ce chiffre en critique,
 * et plus courte, elle le laissait virer au rouge ordinaire en plein vol.
 */
const IMPACT_DURATION_MS = 1150;
/** Course du trait de frappe d'un bout à l'autre du plateau, plus sa dissipation. */
const STRIKE_DURATION_MS = 620;
/** Anneau de critique, éclosion d'évolution, colonne de résurrection : la plus longue des trois. */
const FLOURISH_DURATION_MS = 1200;
/** Fenêtre pendant laquelle le Recycleur peut lire la révélation : le Card-Flip lui-même
 *  dure moins longtemps, mais la carte doit rester disponible le temps que l'animation de
 *  sacrifice (jouée AVANT que ce log n'arrive) ait fini de tourner. */
const RECYCLE_REVEAL_DURATION_MS = 2200;
/** Secousse du plateau. Assez longue pour couvrir le plus lourd des paliers (cataclysme),
 *  les paliers plus légers s'arrêtant d'eux-mêmes -- leur animation CSS est plus courte. */
const BOARD_QUAKE_MS = 900;
/** Tremblement de mort + désintégration + vol jusqu'au cimetière, bout à bout. */
const KO_FLIGHT_DURATION_MS = 1500;

/** Watches state.log growth and turn/active-player changes, turning them into short-lived
 * animated badges. Character-anchored ones (attack/ability/crit/evasion) render on the
 * relevant CharacterCard; table-level ones (turn change, object/terrain played, coin flip)
 * render as a banner stack over the board. */
export function useGameEvents(state: GameState): {
  badgesByCharacter: Map<string, CharacterBadge[]>;
  tableEvents: TableEvent[];
  procRolls: ProcRoll[];
  spotlights: CardSpotlight[];
  /** Une entrée par personnage en train de porter ou d'encaisser un coup. */
  impactsByCharacter: Map<string, CharacterImpact>;
  /** Traits de frappe en cours, d'un attaquant vers sa cible. */
  strikes: StrikeBolt[];
  /** Éclats posés sur une carte mais dessinés par-dessus le plateau (critique, évolution...). */
  flourishes: CardFlourish[];
  /** Non nul pendant qu'un gros coup fait trembler la table entière, avec sa violence. */
  boardQuake: BoardQuake | null;
  koFlights: KoFlight[];
  recycleReveals: RecycleReveal[];
} {
  const [characterBadges, setCharacterBadges] = useState<Array<CharacterBadge & { characterInstanceId: string }>>([]);
  const [tableEvents, setTableEvents] = useState<TableEvent[]>([]);
  const [procRolls, setProcRolls] = useState<ProcRoll[]>([]);
  const [spotlights, setSpotlights] = useState<CardSpotlight[]>([]);
  const [impacts, setImpacts] = useState<Array<CharacterImpact & { characterInstanceId: string }>>([]);
  const [strikes, setStrikes] = useState<StrikeBolt[]>([]);
  const [flourishes, setFlourishes] = useState<CardFlourish[]>([]);
  const [boardQuake, setBoardQuake] = useState<BoardQuake | null>(null);
  const [koFlights, setKoFlights] = useState<KoFlight[]>([]);
  const [recycleReveals, setRecycleReveals] = useState<RecycleReveal[]>([]);
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
    const newImpacts: Array<CharacterImpact & { characterInstanceId: string }> = [];
    const newStrikes: StrikeBolt[] = [];
    const newFlourishes: CardFlourish[] = [];
    const newKoFlights: KoFlight[] = [];
    const newRecycleReveals: RecycleReveal[] = [];
    let quakeTier: ImpactTier | null = null;
    let quakeCritical = false;

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
      const batch: BatchContext = { criticalPending: false };
      for (const entry of state.log.slice(prevLogLenRef.current)) {
        for (const classified of classifyLogEntry(entry, state, batch)) {
          if (classified.anchor === 'character') {
            newCharacterBadges.push({ ...classified.badge, id: ++seqRef.current, characterInstanceId: classified.characterInstanceId });
          } else if (classified.anchor === 'proc') {
            newProcRolls.push({ ...classified.proc, id: ++seqRef.current });
          } else if (classified.anchor === 'spotlight') {
            newSpotlights.push({ ...classified.spotlight, id: ++seqRef.current });
          } else if (classified.anchor === 'impact') {
            newImpacts.push({
              id: ++seqRef.current,
              characterInstanceId: classified.targetInstanceId,
              role: 'target',
              tier: classified.tier,
              critical: classified.critical,
            });
            if (classified.attackerInstanceId) {
              newImpacts.push({
                id: ++seqRef.current,
                characterInstanceId: classified.attackerInstanceId,
                role: 'attacker',
                tier: classified.tier,
                critical: classified.critical,
              });
            }
            // Le plus violent du lot l'emporte : deux coups simultanés ne doivent pas
            // faire jouer la petite secousse par-dessus la grande.
            if (QUAKE_TIERS.has(classified.tier)) {
              const order: ImpactTier[] = ['light', 'heavy', 'brutal', 'devastating', 'cataclysm'];
              if (!quakeTier || order.indexOf(classified.tier) > order.indexOf(quakeTier)) {
                quakeTier = classified.tier;
              }
            }
            // Un critique fait flasher l'écran même sous le seuil de secousse : c'est le
            // seul événement du jeu qui double les dégâts, il doit s'entendre de loin.
            if (classified.critical) quakeCritical = true;
          } else if (classified.anchor === 'strike') {
            newStrikes.push({ ...classified.strike, id: ++seqRef.current });
          } else if (classified.anchor === 'flourish') {
            newFlourishes.push({ ...classified.flourish, id: ++seqRef.current });
          } else if (classified.anchor === 'ko-flight') {
            newKoFlights.push({ ...classified.flight, id: ++seqRef.current });
          } else if (classified.anchor === 'recycle-reveal') {
            newRecycleReveals.push({ ...classified.reveal, id: ++seqRef.current });
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
      // Les roues se SUIVENT au lieu de s'empiler : deux jets dans le même lot donnaient
      // deux roues qui tournaient côte à côte au centre de l'écran, sans qu'on puisse dire
      // laquelle allait avec quoi. Même traitement que les cartes mises en avant plus bas,
      // qui avaient exactement ce problème. Le décalage part de la file DÉJÀ à l'écran,
      // sinon un nouveau lot ferait expirer sa première roue en même temps qu'une ancienne.
      const queued = procRolls.length;
      setProcRolls((list) => [...list, ...newProcRolls]);
      newProcRolls.forEach((p, i) => {
        timersRef.current.push(
          setTimeout(() => setProcRolls((list) => list.filter((x) => x.id !== p.id)), PROC_ROLL_DURATION_MS * (queued + i + 1))
        );
      });
    }
    if (newImpacts.length > 0) {
      setImpacts((list) => [...list, ...newImpacts]);
      for (const i of newImpacts) {
        timersRef.current.push(
          setTimeout(() => setImpacts((list) => list.filter((x) => x.id !== i.id)), IMPACT_DURATION_MS)
        );
      }
    }
    if (newStrikes.length > 0) {
      setStrikes((list) => [...list, ...newStrikes]);
      for (const s of newStrikes) {
        timersRef.current.push(setTimeout(() => setStrikes((list) => list.filter((x) => x.id !== s.id)), STRIKE_DURATION_MS));
      }
    }
    if (newFlourishes.length > 0) {
      setFlourishes((list) => [...list, ...newFlourishes]);
      for (const f of newFlourishes) {
        timersRef.current.push(
          setTimeout(() => setFlourishes((list) => list.filter((x) => x.id !== f.id)), FLOURISH_DURATION_MS)
        );
      }
    }
    if (quakeTier || quakeCritical) {
      // Un critique sans palier de secousse fait quand même flasher l'écran, mais à
      // l'amplitude la plus basse : c'est la lumière qui porte l'information, pas la table.
      const quake = { id: ++seqRef.current, tier: quakeTier ?? ('light' as ImpactTier), critical: quakeCritical };
      setBoardQuake(quake);
      timersRef.current.push(
        // Comparaison sur l'id : une deuxième secousse arrivée entre-temps ne doit pas être
        // coupée par la minuterie de la première.
        setTimeout(() => setBoardQuake((current) => (current?.id === quake.id ? null : current)), BOARD_QUAKE_MS)
      );
    }
    if (newKoFlights.length > 0) {
      setKoFlights((list) => [...list, ...newKoFlights]);
      for (const f of newKoFlights) {
        timersRef.current.push(
          setTimeout(() => setKoFlights((list) => list.filter((x) => x.id !== f.id)), KO_FLIGHT_DURATION_MS)
        );
      }
    }
    if (newRecycleReveals.length > 0) {
      setRecycleReveals((list) => [...list, ...newRecycleReveals]);
      for (const r of newRecycleReveals) {
        timersRef.current.push(
          setTimeout(() => setRecycleReveals((list) => list.filter((x) => x.id !== r.id)), RECYCLE_REVEAL_DURATION_MS)
        );
      }
    }
    if (newSpotlights.length > 0) {
      // Plusieurs cartes jouées dans le même lot (une carte qui en déclenche une autre) se
      // suivent au lieu de se superposer : chacune attend la fin de la précédente. Le
      // décalage part de la file DÉJÀ à l'écran, comme pour les roues : un lot arrivé
      // pendant qu'une carte est encore projetée voyait sa propre carte expirer avant
      // même d'avoir été montrée (ou coupée après quelques dixièmes de seconde).
      const queued = spotlights.length;
      setSpotlights((list) => [...list, ...newSpotlights]);
      newSpotlights.forEach((s, i) => {
        timersRef.current.push(
          setTimeout(
            () => setSpotlights((list) => list.filter((x) => x.id !== s.id)),
            SPOTLIGHT_DURATION_MS * (queued + i + 1)
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
  // Un seul impact par carte : deux coups simultanés (AoE, riposte) donneraient deux
  // animations concurrentes sur la même carte. Le plus récent gagne, et le plus violent
  // avec lui -- c'est celui-là qu'on veut voir.
  const impactsByCharacter = new Map<string, CharacterImpact>();
  for (const i of impacts) impactsByCharacter.set(i.characterInstanceId, i);

  return {
    badgesByCharacter,
    tableEvents,
    procRolls,
    spotlights,
    impactsByCharacter,
    boardQuake,
    koFlights,
    recycleReveals,
    strikes,
    flourishes,
  };
}
