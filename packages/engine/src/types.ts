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
  /** Multiplies effective ATK. `data: { multiplier: number }`. Stacks multiplicatively. */
  | 'atk-multiplier'
  | 'burn'
  | 'poison'
  | 'bleed'
  | 'evasive'
  | 'critical'
  | 'chained'
  /** Ordinary damage can never bring the bearer below 1 HP while present. */
  | 'death-ward'
  /** Next attack crits at `data.percent`% or deals 0 and disarms the bearer. */
  | 'concentration'
  /** Reflects `data.percent`% of an incoming hit back at the attacker, once. Optional `data.objectInstanceId` is destroyed with it. */
  | 'damage-reflect'
  /** Bearer's damage against the enemy BENCH is multiplied by `data.multiplier` (default 2). */
  | 'bench-damage-bonus'
  /** The first attack that really lands on the bearer grants `data.bonusMaxHP` max HP to its attacker, then the status is consumed. */
  | 'hit-bounty'
  /**
   * "Coeur acier" : `data.remaining` of the bearer's own attacks left to grant it
   * `data.bonusMaxHP` max HP each (current HP rises along with the cap -- an ordinary
   * `raiseMaxHP`, not the HP-frozen "prime" pattern of `hit-bounty`). Consumed once per
   * attack DECLARED by the bearer, hit or not (match.ts::applyAction, mirroring how
   * `extra-attack` is spent). Optional `data.objectInstanceId` is destroyed once the
   * last charge is spent.
   */
  | 'attack-charges'
  /** Bearer takes VULNERABLE_DAMAGE_BONUS_PERCENT% more damage from every incoming damage instance (never consumed). */
  | 'vulnerable'
  /**
   * "Jacob et Essau": the bearer is bound to `data.partnerInstanceId` (the pairing is
   * symmetric -- each of the two carries the status pointing at the other). The engine
   * enforces all four halves of the bond: they attack together (match.ts::handleAttack),
   * every damage instance one takes is mirrored onto the other (match.ts::dealDamage),
   * a death takes both (zones.ts::koCharacter), and only whichever of the two currently
   * holds the active post may use abilities (queries.ts::canUseAbility).
   */
  | 'linked'
  /**
   * "Attaque cloné": `data.remaining` extra attacks this turn. Consumed in
   * match.ts::applyAction -- instead of ending the turn, an attack decrements the counter
   * and arms `data.armed`, which makes the follow-up land at `data.damagePercent`% of its
   * normal number (queries.ts::getEffectiveATK). Spent once the follow-up resolves.
   */
  | 'extra-attack'
  /**
   * "Crit +": counts the bearer's own successful critical hits in `data.count`, incremented
   * by the engine itself (effect-context.ts::dealDamage) every time one lands, regardless of
   * source. Once `data.count` reaches `data.threshold`, `getCriticalPercent` guarantees
   * `data.boostPercent`% (queries.ts), the same treatment as the 'critical' status. Never
   * consumed -- a permanent milestone once earned, independent of the granting object's
   * continued presence (no engine hook ties a status to its source object's lifecycle).
   */
  | 'crit-streak'
  /**
   * "Manipulation" de Makima : le porteur est l'actif adverse, manipulé pour frapper un
   * personnage de SON PROPRE banc, `data.targetInstanceId`. Résolu par le moteur au début
   * du tour du porteur (turn.ts::resolveForcedAttack), une seule fois : son attaque part
   * sur l'allié désigné au lieu de l'ennemi, puis son tour se termine aussitôt. Le statut
   * est consommé dans tous les cas, y compris quand la cible n'est plus là pour l'encaisser.
   */
  | 'forced-attack'
  /**
   * "Marque" de Mahito : plus aucun `heal()` n'a d'effet sur le porteur, définitivement
   * (jamais consommé -- seule une résurrection, qui vide tous les statuts, y met fin).
   * Générique et indépendant de la survie de la carte qui l'a posée : un modifier sur
   * Mahito elle-même cesserait d'être scanné si elle mourait (cf. getInPlaySources),
   * ce qui ne colle pas à un texte qui promet "plus jamais". Ne bloque que le soin
   * ordinaire -- `raiseMaxHP`/`addShield` ne sont pas des `heal()` et restent permis.
   */
  | 'unhealable'
  /**
   * Posé automatiquement par le moteur sur quiconque esquive avec succès (base ou statut
   * `evasive`) : ramène son esquive à 0% (avant tout modifier `getEvasionPercent` porté par
   * une carte -- un taux inné comme L'Infini de Gojo reste donc intact) pendant
   * `EVASION_LOCKOUT_TURNS` tour(s) de son propre tour. Jamais posé par une carte.
   */
  | 'evasion-locked'
  /**
   * "Absorption Vitale" : si le porteur est toujours vivant quand ce statut expire (au bout
   * de `remainingTurns`, convention `+1` des statuts bloquants), le moteur le tue puis
   * propose à son propriétaire de ranimer sur son banc, à la moitié de ses HP max, un AUTRE
   * personnage de son cimetière (le porteur qui vient de mourir est exclu du choix). Sans
   * effet si le cimetière est vide. Résolu dans statuses.ts (le seul endroit qui peut à la
   * fois attendre un choix et enchaîner KO + résurrection) plutôt que via `onExpire`, qui ne
   * sait que poser un AUTRE statut, pas exécuter une action. Générique et réutilisable par
   * n'importe quelle future carte au même principe ("tiens N tours, puis sacrifie-toi pour
   * en ranimer un autre").
   */
  | 'sacrifice-revive'
  /**
   * "Livre de Chrollo" : le porteur emprunte l'attaque `data.attackId` de la carte
   * `data.cardId` -- une attaque qui n'est PAS sur sa propre carte. Tant que le statut
   * tient, c'est la SEULE attaque qu'il puisse porter : `canAttack` refuse toutes les
   * siennes (queries.ts), et `attacksAvailableTo` ajoute l'empruntée à sa liste, ce qui
   * la rend visible et jouable partout où le moteur et le client énumèrent les attaques
   * d'un personnage. L'attaque s'exécute avec le contexte du PORTEUR : son ATK effectif,
   * ses buffs, sa cible en face.
   */
  | 'borrowed-attack';

export interface RaiseMaxHPOptions {
  /**
   * Monte le plafond sans rendre un seul PV : les PV actuels restent où ils sont, l'écart
   * au plafond grandit d'autant. C'est la lecture littérale d'une carte qui donne des
   * « HP max (pas de soin) » -- sans ça, la même carte rendrait aussi les PV déjà perdus.
   */
  keepCurrentHP?: boolean;
}

export interface DealDamageOptions {
  /** Bypasses shield entirely: damage hits `damage` directly, ignoring any current `shield` value. */
  ignoreShield?: boolean;
  /** Skips the getIncomingDamageAmount transform entirely -- bypasses every card's damage-reduction modifier (flat/percent reductions, custom shield-like statuses such as Blitzcrank's, full immunities like Bouclier Ultime's), not just the native `shield` field. Death ward and esquive/critique are unaffected. */
  ignoreDamageReduction?: boolean;
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
  /**
   * Engine-internal: the character credited with this damage instance. Filled in by
   * `EffectContext.dealDamage` so `beforeDamage`/`afterDamage`/`onCharacterKO` can name
   * the attacker; cards never need to pass it themselves.
   */
  attackerInstanceId?: string;
  /**
   * Engine-internal: the player whose effect is dealing this damage -- set even for
   * self-inflicted damage and for object/terrain effects, where `attackerInstanceId` is
   * absent. Lets a card tell hostile damage from a cost its own side is paying.
   * For status ticks (poison/burn/bleed), only `attackerInstanceId` is set (from the
   * status's `sourceCardInstanceId`, when known) -- this one stays undefined there.
   */
  attackerOwnerId?: PlayerId;
  /**
   * Engine-internal: set on the mirrored copy a 'linked' pair sends to its partner, so
   * that copy doesn't mirror straight back and ping-pong forever. Cards never pass it.
   */
  skipLinkMirror?: boolean;
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
  /**
   * Pure bookkeeping: a status a card uses as its own private storage (a counter, a
   * "last move used" memory, a lock tracker) with no meaning to the player. Hidden ones
   * are skipped by the event log and by the on-card status badges -- they carry no
   * mechanical difference, only presentation.
   */
  hidden?: boolean;
  /**
   * Status handed to the bearer when THIS one runs out -- a delayed effect ("Attaque
   * cloné" only silences its user once the extra-attack window has closed, so the turn it
   * was played on stays untouched).
   *
   * Applied in `tickStatusesAtTurnStart`, after that turn's decrement pass, so the
   * newcomer is not itself ticked on arrival: its own `remainingTurns` starts counting at
   * the bearer's NEXT turn, and therefore needs no `+1` correction. Skipped if the bearer
   * left the board. Deliberately not recursive -- a hand-off cannot itself hand off.
   */
  onExpire?: Omit<StatusInstance, 'onExpire'>;
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

/**
 * A revive scheduled for a character that is currently in the graveyard ("Pheonix").
 *
 * It deliberately does NOT live as a status on the character: `applyStatus` refuses any
 * target already in the graveyard, and `tickStatusesAtTurnStart` only walks the active
 * slot and the bench -- a status on a corpse would never tick. So the countdown is held
 * by the player instead, and ticked in `startTurn` (see zones.ts::tickPendingRevives).
 */
export interface PendingRevive {
  characterInstanceId: string;
  /** Turns of the OWNER still to elapse before the revive fires. */
  turnsRemaining: number;
  /** Permanent max-HP gain granted on the way back (the character returns at full HP). */
  bonusMaxHP: number;
  /** Permanent ATK gain granted on the way back, as an indefinite 'atk-boost' status. */
  bonusATK: number;
  /** Card that scheduled it, so the log can name it every turn. */
  sourceCardId: string;
}

/**
 * Les règles que suit une partie. 'standard' couvre le jeu de base (deck construit ou
 * tirage du Mode Aléatoire : dans les deux cas on joue un deck fixé d'avance). 'draw' est
 * le **Mode Pioche**, qui change la mise en place, la boucle de tour et la victoire.
 */
export type MatchMode = 'standard' | 'draw';

/** Mode Pioche : les piles personnelles d'un joueur, en ids de carte, sommet en fin de liste. */
export interface DrawPiles {
  characterCardIds: string[];
  objectCardIds: string[];
}

/** Mode Pioche : ce que le joueur pioche à la fin de son tour, dans cet ordre. */
export const DRAW_CYCLE = ['object', 'terrain', 'character'] as const;
export type DrawKind = (typeof DRAW_CYCLE)[number];

export interface PlayerState {
  id: PlayerId;
  displayName: string;

  characters: Record<string, CharacterInstance>;
  activeCharacterInstanceId: string | null;
  benchCharacterInstanceIds: string[];
  graveyardCharacterInstanceIds: string[];
  /**
   * Mode Pioche : les personnages piochés alors que le banc était déjà plein. Secrète,
   * comme la main d'objets. Dès qu'une place se libère au banc, une de ces cartes la prend.
   */
  handCharacterInstanceIds: string[];

  objects: Record<string, ObjectInstance>;
  /** Hidden from the opponent until played (section 1). */
  unplayedObjectInstanceIds: string[];
  inPlayObjectInstanceIds: string[];
  graveyardObjectInstanceIds: string[];

  terrains: Record<string, TerrainInstance>;
  unplayedTerrainInstanceIds: string[];
  activeTerrainInstanceId: string | null;
  graveyardTerrainInstanceIds: string[];

  /**
   * Mode Pioche : combien de personnages de ce camp sont morts depuis le début de la
   * partie. Compteur **monotone** -- une résurrection ne le fait pas redescendre, sans
   * quoi la course aux 7 éliminations pourrait reculer. L'adversaire gagne à 7.
   */
  charactersLost: number;
  /** Mode Pioche : les piles personnelles (personnages et objets). Les terrains sont communs. */
  drawPiles: DrawPiles;
  /** Mode Pioche : où en est ce joueur dans le cycle objet -> terrain -> personnage. */
  drawCycleIndex: number;

  objectsPlayedThisTurn: number;
  terrainsPlayedThisTurn: number;
  hasHadFirstTurn: boolean;
  /** Delayed revives waiting on their countdown ("Pheonix"). Ticked at the owner's turn start. */
  pendingRevives: PendingRevive[];
  /** Once true, getPlayerView (section 1) stops redacting the OPPONENT's unplayed object/terrain instances for this player -- e.g. Kirigiri's "Ultimate Détective". Never reset once set. */
  revealsOpponentUnplayedCards: boolean;
}

export type GamePhase = 'setup' | 'main' | 'ended';

export type GameResult =
  /** `reason` distingue une victoire gagnée sur le plateau d'un abandon adverse. */
  | { kind: 'win'; winner: PlayerId; reason?: 'forfeit' }
  | { kind: 'draw' };

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
  /**
   * Carte réelle derrière cette option. Quand elle est renseignée, le client affiche
   * l'illustration de la carte à la place d'un simple bouton de texte -- c'est ce qu'on
   * veut dès qu'on fait choisir une carte (cimetière, réserve, deck) plutôt qu'une
   * option abstraite (« oui/non », « vers l'actif / vers le banc »).
   */
  card?: { cardId: string; kind: 'character' | 'object' | 'terrain' };
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
  /**
   * Whether `Match.cancelPendingChoice` can currently abort this prompt and roll back
   * whatever player action triggered it (an accidental ability/attack click). False for a
   * choice that isn't the direct result of an `applyAction` call the player just made --
   * e.g. picking a starting active character during setup, or an opponent's own prompt.
   */
  cancellable: boolean;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Every name here is emitted by the engine except `onStatusApplied` and `onCoinFlip`:
 * both would have to be awaited from `applyStatus`/`flipCoin`, which are deliberately
 * synchronous on `EffectContext` (nearly every card calls them without `await`). They
 * stay declared for a future async status pipeline -- a `trigger` on either simply
 * never fires today, so don't build a card on one.
 */
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
  | 'onCharacterEvolved'
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

/**
 * Payload shapes emitted by the engine, for cards reading `ctx.event.data`.
 * Documented as an interface rather than enforced in `EngineEvent` so a card
 * remains free to emit/observe extra keys.
 */
export interface EventPayloads {
  onGameStart: Record<string, never>;
  onTurnStart: Record<string, never>;
  onTurnEnd: Record<string, never>;
  onBecomeActive: { characterInstanceId: string; reason: 'switch' | 'ko-replacement' | 'setup' };
  onAttackDeclared: { characterInstanceId: string; attackId: string };
  beforeDamage: DamageEventData;
  afterDamage: DamageEventData & { shieldAbsorbed: number };
  onCharacterKO: {
    characterInstanceId: string;
    /** The character that dealt the killing blow, when the engine could attribute it. */
    killerInstanceId?: string;
    killerOwnerId?: PlayerId;
  };
  onCharacterRevived: { characterInstanceId: string };
  /** `fromCardId` est la carte quittée, `characterInstanceId` reste le même (évolution en place). */
  onCharacterEvolved: { characterInstanceId: string; fromCardId: string; toCardId: string };
  onObjectPlayed: { objectInstanceId: string };
  onTerrainPlayed: { terrainInstanceId: string };
  onTerrainRemoved: { terrainInstanceId: string; reason: 'expired' | 'replaced' | 'destroyed' };
  onStatusApplied: { characterInstanceId: string; statusId: string };
  onStatusExpired: { characterInstanceId: string; statusId: string };
  /**
   * `reason` distingue le switch que le JOUEUR a demandé lui-même ('action') de celui
   * qu'une carte lui impose ('forced' : Dieu du Tonnerre Volant, Hook, Manipulation...).
   * Sans lui, une carte qui compte les changements volontaires ("Faille dimensionnelle")
   * facturerait aussi ceux que son porteur subit.
   */
  onSwitch: { newActiveInstanceId: string; previousActiveInstanceId?: string; reason: 'action' | 'forced' };
  onAbilityUsed: { characterInstanceId: string; abilityId: string };
  onCoinFlip: { result: 'heads' | 'tails' };
}

export interface DamageEventData {
  targetInstanceId: string;
  amount: number;
  /** The character that caused this damage, when there is one (absent for status ticks and object effects). */
  sourceInstanceId?: string;
  sourceOwnerId?: PlayerId;
  /** Mirrors DealDamageOptions.source: 'burn' / 'poison' / 'bleed' for status ticks, absent otherwise. */
  damageSource?: string;
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
  /**
   * Numéro de **manche** : un tour de jeu couvre l'action des deux joueurs (comme aux
   * échecs), donc ce compteur n'avance qu'au retour à `startingPlayerId`. Une durée de
   * carte (`remainingTurns`) se compte, elle, en tours de son porteur -- une fois par
   * manche, ce qui revient au même rythme que ce compteur.
   */
  turnNumber: number;
  phase: GamePhase;
  /** Les règles suivies par cette partie. Absent = 'standard' (parties d'avant le Mode Pioche). */
  mode: MatchMode;
  /**
   * Mode Pioche : la pile de terrains, **commune aux deux joueurs** (un terrain tiré par
   * l'un ne pourra plus l'être par l'autre). Sommet en fin de liste.
   */
  sharedTerrainPile: string[];
  rng: RngState;
  log: LogEntry[];
  result?: GameResult;
  pendingChoice?: PendingChoice;
  /**
   * "Za Warudo !" de Dio Brando : ce joueur rouvre un tour complet au lieu de passer la
   * main. Consommé par `endTurn` avant de relancer `startTurn`, donc jamais deux tours
   * bonus d'affilée sur une seule pose.
   */
  pendingExtraTurnFor?: PlayerId;
}
