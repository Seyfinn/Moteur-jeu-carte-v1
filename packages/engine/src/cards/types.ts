import type {
  ChoiceOption,
  CharacterInstance,
  DealDamageOptions,
  EngineEvent,
  EventName,
  GameState,
  ObjectInstance,
  PlayerId,
  RaiseMaxHPOptions,
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
  /** Payload: { characterInstanceId, attackId? }. `attackId` is present whenever the
   * engine is gating ONE named attack, which is what lets a card seal a single attack
   * rather than disarming the whole character ("Sacrifice" de Makima). */
  | 'canAttack'
  /** Permission-style, defaults to DENY: may this character attack while on the bench?
   * Payload: { characterInstanceId }. Only a card that says so may open it ("Bonus" de Yumeko). */
  | 'canAttackFromBench'
  | 'canSwitchStandard'
  /**
   * Permission-style: may this switch happen AT ALL? Payload:
   * `{ playerId, outgoingInstanceId, incomingInstanceId }`. Unlike `canSwitchStandard`,
   * which only gates the player's own switch action, this one is consulted inside
   * `zones.switchActive` -- the single choke point every switch goes through, forced ones
   * included ("Arène", le scellement de Chrollo). Le remplacement d'un personnage KO ne
   * passe PAS par là : ce n'est pas un switch (voir zones.koCharacter).
   */
  | 'canSwitchAny'
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
  | 'poisonTicksAsValeurLock'
  /** Permission-style: can `statusId` be applied to `targetInstanceId` at all? Payload: { targetInstanceId, statusId }. Used for innate status immunities (e.g. Toji vs stun/silence/disarmed). */
  | 'canApplyStatus';

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
  /**
   * Marque ce modifier comme l'implémentation d'une **capacité passive imprimée** de la
   * carte (L'Infini de Gojo, Sharingan de Kakashi : une passive dont le texte promet un
   * effet permanent, codée en modifier plutôt qu'en `execute`). Le moteur le coupe alors
   * dès que le porteur est réduit au silence passif (`silence-passive` ou
   * `silence-ultimate`) -- ce qu'un modifier ignore autrement, puisqu'il vit tant que la
   * carte est en jeu et ne passe jamais par `canUseAbility`.
   *
   * N'a de sens que sur une `CharacterCardDef` : un objet ou un terrain ne peut pas être
   * silencé, le champ y est ignoré. À ne PAS mettre sur un modifier qui implémente le
   * texte d'une **attaque** (le critique de Blackflash) : le silence passif ne ferme pas
   * les attaques.
   */
  silencedByPassive?: boolean;
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
  /**
   * `chooseOption` addressed to a specific player instead of this effect's owner -- for a
   * card that makes the OPPONENT decide something ("Offrande du Dieu de la Mort"). Like
   * every other prompt it must be awaited on its own: the engine allows one open question
   * at a time, whoever it is addressed to.
   */
  chooseOptionFor(playerId: PlayerId, prompt: string, options: ChoiceOption[]): Promise<string>;
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
   * Schedules a revive for a character that is ALREADY in the graveyard ("Pheonix"):
   * after `turns` more turns of its owner, it comes back at the active post (bench if
   * that slot is taken) at full HP, permanently richer by `bonusMaxHP` max HP and
   * `bonusATK` ATK. No-op if the character isn't in a graveyard, or already has a revive
   * pending.
   *
   * Held on the owner (`PlayerState.pendingRevives`) rather than as a status on the
   * character, because nothing ticks in the graveyard -- see PendingRevive in types.ts.
   * The countdown needs no `+1` correction: it fires exactly when it reaches zero rather
   * than being filtered out first, unlike a blocking status.
   */
  scheduleRevive(characterInstanceId: string, options: { turns: number; bonusMaxHP?: number; bonusATK?: number }): void;

  /**
   * Ordinary damage: consumes shield first, then reduces current HP (healable).
   * Pass `{ ignoreShield: true }` for effects that pierce straight through a shield.
   */
  dealDamage(targetInstanceId: string, amount: number, options?: DealDamageOptions): Promise<void>;
  /** "Valeur lock": permanently reduces max HP, never healable. */
  applyValeurLock(targetInstanceId: string, amount: number): Promise<void>;
  /** Restores lost (non-locked) HP, capped at currentMaxHP. Does not affect shield. */
  heal(targetInstanceId: string, amount: number): void;
  /**
   * The positive counterpart to applyValeurLock: permanently raises the HP ceiling. Les PV
   * actuels montent d'autant, sauf avec `{ keepCurrentHP: true }` -- pour une carte qui
   * donne des « HP max sans soin » (la prime de Coeur Acier).
   */
  raiseMaxHP(targetInstanceId: string, amount: number, options?: RaiseMaxHPOptions): void;

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

  /** Creates a brand-new object instance of `cardId`, added straight to that player's unplayed pool. `forPlayerId` defaults to the effect's own owner -- pass the opponent for a card that hands THEM something. Returns the new instance id. */
  createObject(cardId: string, forPlayerId?: PlayerId): string;
  /**
   * Joue gratuitement une carte objet (créée à la volée) : effet résolu tout de suite,
   * puis cimetière -- ou accrochée au personnage si l'objet est un équipement. Ne consomme
   * pas le budget d'objets du tour. Ex : "Spectre" d'Aki, qui rejoue l'objet adverse.
   */
  playObjectImmediately(cardId: string, forPlayerId?: PlayerId): Promise<string>;
  /**
   * "Za Warudo !" : à la fin du tour en cours, ce camp en rouvre un second au lieu de
   * passer la main. Un seul tour bonus par pose (la marque est consommée par `endTurn`).
   * La rotation des tours appartient au moteur : une carte ne peut que la demander.
   */
  grantExtraTurn(forPlayerId?: PlayerId): void;
  /**
   * Fait évoluer un personnage EN PLACE (Gon -> Gon Adulte). La carte évoluée prend la
   * place de la base là où elle est, poste actif comme banc.
   *
   * `toCardId` est obligatoire dès que la base déclare plusieurs formes ; il doit faire
   * partie de son `evolvesTo`. Ce qui est conservé, sans rien à faire côté carte : les
   * dégâts déjà subis, les statuts (buffs comme malus), les objets équipés, la position.
   * Les compteurs d'usage des capacités sont remis à zéro. Le plafond de PV suit la
   * nouvelle carte **en gardant les modifications accumulées** (un +100 PV max encaissé
   * avant l'évolution n'est pas perdu).
   *
   * Renvoie false si l'évolution n'a pas eu lieu (cible absente, forme non déclarée).
   */
  evolveCharacter(characterInstanceId: string, toCardId?: string): Promise<boolean>;

  /**
   * Builds a fresh context sourced from a DIFFERENT character than this effect's own
   * `sourceInstanceId` -- same owner, but `getEffectiveATK`/crit/esquive and any status
   * labels the executed effect applies to itself now resolve against `sourceInstanceId`
   * instead. For an object/terrain effect that makes an ally character genuinely act
   * (e.g. a benched character making a real attack), NOT for "borrow and relabel as me"
   * cards (Zoé's Spell Thief, Kakashi's Copie de Technique already just reuse their own
   * `ctx` for that -- see cards/demo/zoe.ts, kakashi.ts). `damageSource` controls esquive/
   * critique the same way match.ts's own action handlers do: `'attack'`/`'ability'` roll
   * them, `'other'` doesn't. Defaults to `'ability'` if omitted -- pass `'attack'`
   * explicitly for a genuine attack (e.g. one of the character's own `AttackDef`s).
   */
  buildEffectContext(sourceInstanceId: string, damageSource?: 'attack' | 'ability' | 'other'): EffectContext;
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
  /**
    * Passive abilities are normally triggered by an engine event. A list means "any of
    * these", for a single printed passive that watches several kinds of enemy action
    * ("Vision du Futur" d'Aki) -- splitting it into one ability per event would print the
    * same line three times on the card.
    */
  trigger?: EventName | EventName[];
  /** Extra gating beyond the generic canUseAbility query. */
  condition?(ctx: EffectContext): boolean;
  /** Defaults to false (usable only by the active character). */
  usableFromBench?: boolean;
  /** Defaults to 1. */
  usesPerTurn?: number;
  /** Defaults to unlimited. */
  usesPerGame?: number;
  /**
   * Defaults to false: using an ability is normally a free action. Set it (or a function)
   * for an ability whose own text closes the turn -- "Manipulation" de Makima. Evaluated
   * AFTER `execute()`, on the same context, exactly like `AttackDef.endsTurn`.
   */
  endsTurn?: boolean | ((ctx: EffectContext) => boolean);
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
  /**
   * Forme(s) évoluée(s) de cette carte (Gon -> Gon Adulte ; Kayn -> Kayn Assassin OU
   * Rhaast). Purement déclaratif : c'est ce lien qui sort les formes évoluées du
   * deck-builder et du quota de deck, et qui autorise `ctx.evolveCharacter`.
   *
   * La **condition** d'évolution, elle, n'est pas ici : elle vit dans une passive de la
   * carte de base, qui appelle `ctx.evolveCharacter()` le moment venu. Idem pour le choix
   * de la branche quand il y en a plusieurs.
   *
   * Une carte citée ici devient « forme évoluée » et n'est plus sélectionnable en deck.
   * Une forme évoluée qui ne déclare rien est terminale ; déclarer à son tour un
   * `evolvesTo` fait une chaîne (forme 1 -> 2 -> 3).
   */
  evolvesTo?: string | string[];
  /** Card family for cross-card synergies (e.g. "NEN"). Absent = basic card, no family. */
  family?: string;
  /** Overrides the general per-card copy limit of DECK_LIMITS for this specific card. Absent = use the general limit. */
  maxCopies?: number;
  /**
   * Cartes qui ne peuvent pas cohabiter avec celle-ci dans un même deck (ids). La relation
   * est **symétrique** : la déclarer d'un seul côté suffit, `listDeckPool()` en renvoie la
   * clôture pour que le deck-builder grise l'autre carte sans avoir à connaître le sens.
   */
  incompatibleWith?: string[];
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
  /** Overrides the general per-card copy limit of DECK_LIMITS for this specific card. Absent = use the general limit. */
  maxCopies?: number;
  /**
   * Cartes qui ne peuvent pas cohabiter avec celle-ci dans un même deck (ids). La relation
   * est **symétrique** : la déclarer d'un seul côté suffit, `listDeckPool()` en renvoie la
   * clôture pour que le deck-builder grise l'autre carte sans avoir à connaître le sens.
   */
  incompatibleWith?: string[];
  /**
   * Objet « à lier » : au lieu de partir au cimetière une fois son effet résolu, il reste
   * en jeu accroché à un personnage (et le suit au cimetière quand celui-ci meurt).
   *
   * Purement **déclaratif** : c'est `ctx.attachSelfTo()` dans `execute` qui réalise
   * l'attache. Ce champ est ce que lit le client pour marquer la carte d'un logo
   * « équipement » partout où elle est affichée, et pour la classer dans la sous-catégorie
   * Équipements du deck-builder. Les deux vont ensemble : une carte qui s'attache sans ce
   * champ n'aurait pas de logo, une carte qui le porte sans s'attacher mentirait au joueur.
   */
  equipment?: boolean;
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
  /** Overrides the general per-card copy limit of DECK_LIMITS for this specific card. Absent = use the general limit. */
  maxCopies?: number;
  /**
   * Cartes qui ne peuvent pas cohabiter avec celle-ci dans un même deck (ids). La relation
   * est **symétrique** : la déclarer d'un seul côté suffit, `listDeckPool()` en renvoie la
   * clôture pour que le deck-builder grise l'autre carte sans avoir à connaître le sens.
   */
  incompatibleWith?: string[];
}

export type CardDef = CharacterCardDef | ObjectCardDef | TerrainCardDef;
