import type {
  ChoiceOption,
  CharacterInstance,
  DealDamageOptions,
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
  | 'canShieldAbsorb'
  | 'getEffectiveATK'
  | 'getCriticalMultiplier'
  /** Percent chance (0-100) that this character lands a critical hit. Base 2%, or the 'critical' status's rate. */
  | 'getCriticalPercent'
  /** Percent chance (0-100) that this character evades an incoming hostile attack/ability. Base 5%, or the 'evasive' status's rate. */
  | 'getEvasionPercent'
  | 'getAbilityUsesPerTurn'
  | 'getAbilityUsesPerGame'
  | 'getIncomingDamageAmount'
  | 'getIncomingValeurLockAmount'
  | 'getIncomingHealAmount'
  | 'getTriggerFireCount'
  | 'canPlayObject'
  | 'getMaxObjectsPerTurn'
  | 'canPlayTerrain'
  | 'getMaxTerrainsPerTurn'
  /** Percent chance (0-100) that an incoming attack/ability is redirected onto one of the target's own benched allies, chosen by the target's owner. */
  | 'getDamageRedirectPercent'
  | 'poisonTicksAsValeurLock';

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
  /**
   * Scratch space private to this one execution. An attack's `execute()` and its
   * `endsTurn()` receive the same context object, so this is where an attack records
   * something that happened mid-resolution and needs to read back afterwards (e.g.
   * "I killed my target, so I get to act again"). Never persisted into GameState.
   */
  scratch: Record<string, unknown>;

  log(message: string, data?: Record<string, unknown>): void;
  flipCoin(): CoinResult;

  /**
   * Jet à pourcentage porté par la carte (chance de désarmer, d'étourdir, d'empoisonner...).
   * Roule le dé **et** annonce le résultat : le client fait tourner une roue de pourcentage
   * à l'écran, pour les deux joueurs. Toujours préférer ça à `chancePercent(ctx.state.rng, x)`
   * appelé en direct, qui tire en silence et ne montre rien.
   *
   * `label` nomme le jet pour le joueur (« Désarmement », « Stun »...). `characterInstanceId`
   * désigne le personnage que la roue nomme -- par défaut la source de l'effet ; passer la
   * cible quand c'est elle qui subit le jet.
   */
  rollChance(percent: number, label: string, options?: { characterInstanceId?: string }): boolean;

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

  /**
   * Instantly KOs a character (graveyard, attached objects cleared,
   * onCharacterKO emitted) without going through the damage pipeline at all --
   * no crit/esquive roll, doesn't touch damage/currentMaxHP, and (like Valeur
   * Lock) is a kill vector separate from dealDamage, so it is NOT blocked by
   * a death-ward status unless the card explicitly checks for one first
   * (see "Perfect Execution" / Akali for that pattern).
   */
  koCharacter(characterInstanceId: string): Promise<void>;
  /** Pulls a character back out of its own graveyard at `hp` (clamped to its current ceiling), statuses/shield cleared, placed active or bench. */
  reviveCharacter(characterInstanceId: string, hp: number, placement: 'active' | 'bench'): Promise<void>;

  /**
   * Ordinary damage: consumes shield first, then reduces current HP (healable).
   * Pass `{ ignoreShield: true }` for effects that pierce straight through a shield.
   */
  dealDamage(targetInstanceId: string, amount: number, options?: DealDamageOptions): Promise<void>;
  /** "Valeur lock": permanently reduces max HP, never healable. */
  applyValeurLock(targetInstanceId: string, amount: number): Promise<void>;
  /** Restores lost (non-locked) HP, capped at currentMaxHP. Does not affect shield. */
  heal(targetInstanceId: string, amount: number): void;
  /** The positive counterpart to applyValeurLock: permanently raises the HP ceiling. */
  raiseMaxHP(targetInstanceId: string, amount: number): void;

  /** Adds shield points on top of current HP; absorbs ordinary damage first, persists on the bench. */
  addShield(targetInstanceId: string, amount: number): void;
  /** Strips shield points directly, bypassing damage entirely. Omit `amount` to remove it all (e.g. "removes the shield" effects). */
  removeShield(targetInstanceId: string, amount?: number): void;

  applyStatus(targetInstanceId: string, status: StatusInstance, options?: { skipEvasionRoll?: boolean }): void;
  removeStatus(targetInstanceId: string, statusId: string): void;

  /**
   * Rolls esquive once (same rate/rules as the automatic roll inside
   * dealDamage/applyStatus) without applying anything. For an effect that
   * deals damage AND applies a status from the same hit and needs both to
   * hit-or-miss together: roll here first, bail out entirely if it returns
   * true, otherwise pass `{ skipEvasionRoll: true }` to the subsequent
   * dealDamage/applyStatus calls so they don't each roll independently.
   * Returns false (never evaded) for object-card effects or self-targeting.
   */
  rollEvasion(targetInstanceId: string): boolean;

  getEffectiveATK(characterInstanceId: string, baseATK: number): number;

  /** Swap a bench character of `forPlayer` with an enemy bench character. */
  swapBenchCharacters(forPlayer: PlayerId, ownBenchInstanceId: string, enemyBenchInstanceId: string): void;

  /** Attach the source object instance to a character (keeps it in play instead of going to the graveyard). */
  attachSelfTo(targetCharacterInstanceId: string): void;

  /** Destroys any object currently in play (own or opponent's), detaching it from its character and sending it to the graveyard. */
  destroyObject(objectInstanceId: string): void;

  /** Adds `turns` to a currently-active terrain's remaining duration (own or opponent's). No-op on an indefinite terrain (no durationTurns declared). */
  extendTerrain(terrainInstanceId: string, turns: number): void;
  /** Removes `turns` from a currently-active terrain's remaining duration (own or opponent's); expires it immediately (graveyard + onTerrainRemoved) if this brings it to 0 or below. No-op on an indefinite terrain. */
  shortenTerrain(terrainInstanceId: string, turns: number): Promise<void>;
  /** Unconditionally destroys a currently-active terrain (own or opponent's), finite or indefinite duration alike: graveyard + onTerrainRemoved. No-op if it's not the active terrain for its owner anymore. */
  destroyTerrain(terrainInstanceId: string): Promise<void>;

  /** Switch triggered by an external source (object/terrain/bench ability) -- bypasses Stun's standard-switch block. */
  forceSwitch(playerId: PlayerId, newActiveInstanceId: string): Promise<void>;

  /** Creates a fresh character instance copying `sourceInstanceId`'s card at the given HP, placed active or on the bench. Returns the new instance id. */
  cloneCharacter(sourceInstanceId: string, hp: number, placement: 'active' | 'bench'): string;

  /** Creates a brand-new object instance of `cardId` for the effect's own owner, added straight to their unplayed pool. Returns the new instance id. */
  createObject(cardId: string): string;
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
  /** Overrides DECK_LIMITS.maxCopiesPerCard for this specific card. Absent = use the general limit. */
  maxCopies?: number;
}

export interface ObjectCardDef {
  type: 'object';
  id: string;
  name: string;
  description: string;
  /** Extra gating beyond the generic canPlayObject query -- e.g. requiring the owner active to be above an HP threshold. Checked before the action is allowed, not just inside execute(). */
  condition?(ctx: EffectContext): boolean;
  /**
   * Refus *lisible*, évalué sur le seul `GameState` (donc côté client aussi, qui n'a pas
   * d'EffectContext sous la main). Renvoyer une phrase quand la carte n'aurait aucune
   * cible et se consumerait dans le vide : le serveur refuse l'action avec ce message et
   * la main grise la carte avec la même raison, au lieu de laisser le joueur la gâcher.
   * `null`/absent = jouable. Complémentaire de `condition(ctx)`, qui reste pour les refus
   * ayant réellement besoin du contexte d'effet (et dont le message reste générique).
   */
  unplayableReason?(state: GameState, ownerId: PlayerId): string | null;
  execute(ctx: EffectContext): Promise<void>;
  modifiers?: ModifierDef[];
  /** Card family for cross-card synergies (e.g. "NEN"). Absent = basic card, no family. */
  family?: string;
  /** Overrides DECK_LIMITS.maxCopiesPerCard for this specific card. Absent = use the general limit. */
  maxCopies?: number;
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
  /** Overrides DECK_LIMITS.maxCopiesPerCard for this specific card. Absent = use the general limit. */
  maxCopies?: number;
}

export type CardDef = CharacterCardDef | ObjectCardDef | TerrainCardDef;
