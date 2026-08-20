import type {
  ChoiceAnswer,
  ChoiceOption,
  CharacterInstance,
  EngineEvent,
  EventName,
  GameState,
  ObjectInstance,
  PlayerId,
  StatusInstance,
  TerrainInstance,
} from '../types.js';
import type { CoinResult } from '../rng.js';

// ---------------------------------------------------------------------------
// Query / modifier system: this is how a card overrides a default rule.
// A modifier is declared statically on a card and is only "live" for as long
// as the engine considers that card in-play (character on board, object
// attached & in play, terrain active) -- there is no manual
// register/unregister lifecycle to get wrong, the engine re-scans in-play
// cards fresh every time a query runs.
// ---------------------------------------------------------------------------

export type QueryName =
  | 'canAttack'
  | 'canSwitchStandard'
  | 'canUseAbility'
  | 'doesActionEndTurn'
  | 'getMaxAttachedObjects'
  | 'canTargetBench'
  | 'getEffectiveATK'
  | 'getAbilityUsesPerTurn'
  | 'getAbilityUsesPerGame'
  | 'getIncomingDamageAmount'
  | 'getIncomingValeurLockAmount'
  | 'getTriggerFireCount';

export interface ModifierEvalContext {
  state: GameState;
  /** The card instance (character/object/terrain) that declared this modifier. */
  sourceInstanceId: string;
  sourceOwnerId: PlayerId;
  /** Query-specific payload, e.g. { characterInstanceId } for canAttack. */
  query: Record<string, unknown>;
}

export interface Vote {
  allow: boolean;
  source: string;
  reason?: string;
}

export interface ModifierDef {
  query: QueryName;
  /**
   * Whether this modifier is currently "live". Defaults to true whenever the
   * declaring card is in play (character on board, object attached & in
   * play, or terrain active) -- override for narrower conditions, e.g. "only
   * while I am the active character".
   */
  isActive?(ctx: ModifierEvalContext): boolean;
  /** For permission-style queries (boolean). */
  vote?(ctx: ModifierEvalContext): Vote | undefined;
  /** For value-style queries (numbers, target lists, ...). */
  transform?(ctx: ModifierEvalContext, current: unknown): unknown;
}

// ---------------------------------------------------------------------------
// Effect context: the API surface a card's attack/ability/effect body uses.
// ---------------------------------------------------------------------------

export interface EffectContext {
  state: GameState;
  ownerId: PlayerId;
  opponentId: PlayerId;
  /** The character/object/terrain instance that owns this effect. */
  sourceInstanceId: string;
  /** Present when this execution was triggered by an engine event. */
  event?: EngineEvent;

  log(message: string, data?: Record<string, unknown>): void;
  flipCoin(): CoinResult;

  choose(spec: { kind: 'select-characters'; prompt: string; options: string[]; min: number; max: number }): Promise<string[]>;
  chooseOption(prompt: string, options: ChoiceOption[]): Promise<string>;
  chooseYesNo(prompt: string): Promise<boolean>;
  chooseOrder(prompt: string, items: ChoiceOption[]): Promise<string[]>;

  getCharacter(instanceId: string): CharacterInstance;
  getObject(instanceId: string): ObjectInstance;
  getTerrain(instanceId: string): TerrainInstance;
  getActive(playerId: PlayerId): CharacterInstance | undefined;
  getBench(playerId: PlayerId): CharacterInstance[];
  getAllOnBoard(playerId: PlayerId): CharacterInstance[];
  isKO(characterInstanceId: string): boolean;

  /** Ordinary damage: reduces current HP only, healable. */
  dealDamage(targetInstanceId: string, amount: number): Promise<void>;
  /** "Valeur lock": permanently reduces max HP, never healable. */
  applyValeurLock(targetInstanceId: string, amount: number): Promise<void>;
  /** Restores lost (non-locked) HP, capped at currentMaxHP. */
  heal(targetInstanceId: string, amount: number): void;
  /** The positive counterpart to applyValeurLock: permanently raises the HP ceiling. */
  raiseMaxHP(targetInstanceId: string, amount: number): void;

  applyStatus(targetInstanceId: string, status: StatusInstance): void;
  removeStatus(targetInstanceId: string, statusId: string): void;

  getEffectiveATK(characterInstanceId: string, baseATK: number): number;

  /** Swap a bench character of `forPlayer` with an enemy bench character. */
  swapBenchCharacters(forPlayer: PlayerId, ownBenchInstanceId: string, enemyBenchInstanceId: string): void;

  /** Attach the source object instance to a character (keeps it in play instead of going to the graveyard). */
  attachSelfTo(targetCharacterInstanceId: string): void;

  /** Switch triggered by an external source (object/terrain/bench ability) -- bypasses Stun's standard-switch block. */
  forceSwitch(playerId: PlayerId, newActiveInstanceId: string): Promise<void>;

  /** Creates a fresh character instance copying `sourceInstanceId`'s card at the given HP, placed active or on the bench. Returns the new instance id. */
  cloneCharacter(sourceInstanceId: string, hp: number, placement: 'active' | 'bench'): string;
}

// ---------------------------------------------------------------------------
// Card definitions
// ---------------------------------------------------------------------------

export interface AttackDef {
  id: string;
  name: string;
  baseATK: number;
  description: string;
  /** Defaults to true; set false, or a function, for attacks that don't end the turn. */
  endsTurn?: boolean | ((ctx: EffectContext) => boolean);
  /** Extra gating beyond the generic canAttack query -- e.g. requiring a discard pile threshold. */
  condition?(ctx: EffectContext): boolean;
  execute(ctx: EffectContext): Promise<void>;
}

export interface AbilityDef {
  id: string;
  name: string;
  kind: 'active' | 'passive';
  description: string;
  /** Passive abilities are normally triggered by an engine event. */
  trigger?: EventName;
  /** Extra gating beyond the generic canUseAbility query. */
  condition?(ctx: EffectContext): boolean;
  /** Defaults to false (usable only by the active character). */
  usableFromBench?: boolean;
  /** Defaults to 1. */
  usesPerTurn?: number;
  /** Defaults to unlimited. */
  usesPerGame?: number;
  execute(ctx: EffectContext): Promise<void>;
}

export interface CharacterCardDef {
  type: 'character';
  id: string;
  name: string;
  baseMaxHP: number;
  attacks: AttackDef[];
  abilities: AbilityDef[];
  modifiers?: ModifierDef[];
  /** Card family for cross-card synergies (e.g. "NEN"). Absent = basic card, no family. */
  family?: string;
}

export interface ObjectCardDef {
  type: 'object';
  id: string;
  name: string;
  description: string;
  execute(ctx: EffectContext): Promise<void>;
  modifiers?: ModifierDef[];
  /** Card family for cross-card synergies (e.g. "NEN"). Absent = basic card, no family. */
  family?: string;
}

export interface TerrainCardDef {
  type: 'terrain';
  id: string;
  name: string;
  description: string;
  /** undefined = indefinite until replaced/removed. */
  durationTurns?: number;
  abilities?: AbilityDef[];
  modifiers?: ModifierDef[];
  /** Card family for cross-card synergies (e.g. "NEN"). Absent = basic card, no family. */
  family?: string;
}

export type CardDef = CharacterCardDef | ObjectCardDef | TerrainCardDef;
