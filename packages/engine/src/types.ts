import type { RngState } from './rng.js';

export type PlayerId = 'p1' | 'p2';

export function otherPlayer(id: PlayerId): PlayerId {
  return id === 'p1' ? 'p2' : 'p1';
}

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

/**
 * Recognized built-in status ids with fixed mechanics per the rules doc
 * (section 6). Cards remain free to apply any other custom statusId string —
 * those carry no built-in mechanical meaning, the defining card must hook
 * its own triggers/modifiers to give them an effect.
 */
export type BuiltinStatusId =
  | 'stun'
  | 'disarmed'
  | 'silence-active'
  | 'silence-passive'
  | 'silence-ultimate'
  | 'atk-reduction'
  | 'atk-boost'
  | 'burn'
  | 'poison'
  | 'bleed'
  | 'evasive'
  | 'critical'
  | 'chained';

export interface DealDamageOptions {
  /** Bypasses shield entirely: damage hits `damage` directly, ignoring any current `shield` value. */
  ignoreShield?: boolean;
  /**
   * Skips this call's own esquive roll -- for effects that already resolved a
   * single shared roll via `ctx.rollEvasion()` and are applying its outcome
   * across multiple calls (e.g. damage + a status from the same hit).
   */
  skipEvasionRoll?: boolean;
  /** Tags where this damage instance comes from (e.g. 'burn', 'poison') so a card can react to that specific source via getIncomingDamageAmount, without affecting unrelated damage. Absent for ordinary attack/ability damage. */
  source?: string;
  /**
   * Routes the final computed amount (after esquive/critique/"couteau dans le dos")
   * into applyValeurLock instead of ordinary damage -- e.g. Mahito's "Altération de
   * l'Âme". Esquive/critique still resolve normally beforehand; only the destination
   * of the resulting number changes.
   */
  asValeurLock?: boolean;
}

export interface StatusInstance {
  statusId: BuiltinStatusId | (string & {});
  label: string;
  sourcePlayerId?: PlayerId;
  sourceCardInstanceId?: string;
  /** Remaining turns of the AFFECTED player. undefined = indefinite until removed explicitly. */
  remainingTurns?: number;
  /**
   * Poison/Burn are the documented exception: they tick even while the
   * bearer is benched. Every other status's duration is suspended on the
   * bench (still applies mechanically, just doesn't count down).
   */
  ticksOnBench?: boolean;
  /**
   * Effect-specific payload, e.g. { amount: 20 } for atk-reduction/atk-boost.
   * Burn/poison damage is a fixed engine formula and ignores `data`.
   */
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Card instances (a "card def" is static data in the registry; an "instance"
// is the concrete, mutable, in-game copy of it).
// ---------------------------------------------------------------------------

export interface CharacterInstance {
  instanceId: string;
  cardId: string;
  ownerId: PlayerId;
  baseMaxHP: number;
  /** Max HP after "valeur lock" reductions. Never restored by healing. */
  currentMaxHP: number;
  /** Accumulated ordinary damage. Healable. Always <= currentMaxHP (excess KOs). */
  damage: number;
  /**
   * Shield: extra HP stacked on top of the normal pool. Absorbs ordinary
   * damage before it touches `damage`, persists while benched, and is never
   * restored by `heal`. Only `addShield`/`removeShield` (and damage
   * absorption) change it.
   */
  shield: number;
  statuses: StatusInstance[];
  attachedObjectInstanceIds: string[];
  abilityUsesThisTurn: Record<string, number>;
  abilityUsesThisGame: Record<string, number>;
}

export interface ObjectInstance {
  instanceId: string;
  cardId: string;
  ownerId: PlayerId;
  /** Set once the object attaches to a character; undefined for global-effect / one-shot objects. */
  attachedToCharacterInstanceId?: string;
  data?: Record<string, unknown>;
}

export interface TerrainInstance {
  instanceId: string;
  cardId: string;
  ownerId: PlayerId;
  /** undefined = indefinite, until replaced/removed. */
  remainingTurns?: number;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Player / game state
// ---------------------------------------------------------------------------

export interface PlayerState {
  id: PlayerId;
  displayName: string;

  characters: Record<string, CharacterInstance>;
  activeCharacterInstanceId: string | null;
  benchCharacterInstanceIds: string[];
  graveyardCharacterInstanceIds: string[];

  objects: Record<string, ObjectInstance>;
  /** Hidden from the opponent until played (section 1). */
  unplayedObjectInstanceIds: string[];
  inPlayObjectInstanceIds: string[];
  graveyardObjectInstanceIds: string[];

  terrains: Record<string, TerrainInstance>;
  unplayedTerrainInstanceIds: string[];
  activeTerrainInstanceId: string | null;
  graveyardTerrainInstanceIds: string[];

  objectsPlayedThisTurn: number;
  hasHadFirstTurn: boolean;
  /** Once true, getPlayerView (section 1) stops redacting the OPPONENT's unplayed object/terrain instances for this player -- e.g. Kirigiri's "Ultimate Détective". Never reset once set. */
  revealsOpponentUnplayedCards: boolean;
}

export type GamePhase = 'setup' | 'main' | 'ended';

export type GameResult = { kind: 'win'; winner: PlayerId } | { kind: 'draw' };

export interface LogEntry {
  id: string;
  turnNumber: number;
  playerId?: PlayerId;
  message: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Choices (interactive prompts a card's effect can request from a player)
// ---------------------------------------------------------------------------

export interface ChoiceOption {
  key: string;
  label: string;
}

export type ChoiceSpec =
  | { kind: 'select-characters'; prompt: string; options: string[]; min: number; max: number }
  | { kind: 'select-option'; prompt: string; options: ChoiceOption[] }
  | { kind: 'yes-no'; prompt: string }
  | { kind: 'order'; prompt: string; items: ChoiceOption[] };

export type ChoiceAnswer =
  | { kind: 'select-characters'; selected: string[] }
  | { kind: 'select-option'; key: string }
  | { kind: 'yes-no'; value: boolean }
  | { kind: 'order'; orderedKeys: string[] };

export interface PendingChoice {
  id: string;
  playerId: PlayerId;
  spec: ChoiceSpec;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventName =
  | 'onGameStart'
  | 'onTurnStart'
  | 'onTurnEnd'
  | 'onBecomeActive'
  | 'onAttackDeclared'
  | 'beforeDamage'
  | 'afterDamage'
  | 'onCharacterKO'
  | 'onCharacterRevived'
  | 'onCoinFlip'
  | 'onObjectPlayed'
  | 'onTerrainPlayed'
  | 'onTerrainRemoved'
  | 'onStatusApplied'
  | 'onStatusExpired'
  | 'onSwitch'
  | 'onAbilityUsed';

export interface EngineEvent {
  name: EventName;
  /** The player whose action/turn produced this event, when meaningful. */
  playerId?: PlayerId;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Top-level game state
// ---------------------------------------------------------------------------

export type FinalActionKind = 'attack' | 'switch' | 'pass' | 'play-second-object';
export type FreeActionKind = 'play-object' | 'play-terrain' | 'use-active-ability' | 'use-passive-ability';
export type ActionKind = FinalActionKind | FreeActionKind;

export interface GameState {
  id: string;
  players: Record<PlayerId, PlayerState>;
  /** Winner of the initiative coin flip (section 1). Needed to identify the "second player" for their first-turn exception. */
  startingPlayerId: PlayerId;
  activePlayerId: PlayerId;
  turnNumber: number;
  phase: GamePhase;
  rng: RngState;
  log: LogEntry[];
  result?: GameResult;
  pendingChoice?: PendingChoice;
}
