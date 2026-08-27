import type { CharacterInstance, GameState, PlayerId } from './types.js';
import type { AbilityDef, AttackDef, ModifierDef, ModifierEvalContext, QueryName, Vote } from './cards/types.js';
import { getCard, getCharacterCard, getObjectCard, getTerrainCard } from './cards/registry.js';
import {
  BASE_CRITICAL_CHANCE_PERCENT,
  BASE_EVASION_CHANCE_PERCENT,
  CRITICAL_STATUS_CHANCE_PERCENT,
  EVASIVE_STATUS_CHANCE_PERCENT,
  getAtkBoostTotal,
  getAtkMultiplierTotal,
  getAtkReductionTotal,
  getExtraAttackDamageMultiplier,
  getStatus,
  hasStatus,
  isDisarmed,
  isEvasive,
  isEvasionLocked,
  isSilencedActive,
  isSilencedPassive,
  isStunned,
} from './statuses.js';
import { chancePercent } from './rng.js';

export function findCharacter(state: GameState, instanceId: string): CharacterInstance {
  for (const playerId of ['p1', 'p2'] as PlayerId[]) {
    const char = state.players[playerId].characters[instanceId];
    if (char) return char;
  }
  throw new Error(`Unknown character instance "${instanceId}"`);
}

interface ModifierSource {
  def: ModifierDef;
  sourceInstanceId: string;
  sourceOwnerId: PlayerId;
}

/**
 * Scans every card currently in play for modifiers matching this query.
 * There is no subscribe/unsubscribe lifecycle: a card's modifier is only
 * ever "seen" while the engine considers it in play, so nothing needs
 * cleaning up when a character dies or an object/terrain leaves the field.
 */
function getInPlaySources(state: GameState, queryName: QueryName): ModifierSource[] {
  const sources: ModifierSource[] = [];
  for (const playerId of ['p1', 'p2'] as PlayerId[]) {
    const player = state.players[playerId];
    const charIds = [player.activeCharacterInstanceId, ...player.benchCharacterInstanceIds].filter(
      (id): id is string => id !== null
    );
    for (const id of charIds) {
      const char = player.characters[id];
      if (!char) continue;
      const def = getCharacterCard(char.cardId);
      // Un modifier qui porte le texte d'une passive imprimée (L'Infini, Sharingan) doit
      // tomber avec elle quand le porteur est réduit au silence passif : sans ce garde, la
      // passive restait active sous Silence Ultime, puisqu'un modifier ne passe jamais par
      // `canUseAbility`.
      const silencedPassive = isSilencedPassive(char);
      for (const mod of def.modifiers ?? []) {
        if (mod.query !== queryName) continue;
        if (mod.silencedByPassive && silencedPassive) continue;
        sources.push({ def: mod, sourceInstanceId: id, sourceOwnerId: playerId });
      }
    }
    for (const objId of player.inPlayObjectInstanceIds) {
      const obj = player.objects[objId];
      if (!obj) continue;
      const def = getObjectCard(obj.cardId);
      for (const mod of def.modifiers ?? []) {
        if (mod.query === queryName) sources.push({ def: mod, sourceInstanceId: objId, sourceOwnerId: playerId });
      }
    }
    if (player.activeTerrainInstanceId) {
      const terrain = player.terrains[player.activeTerrainInstanceId];
      if (terrain) {
        const def = getTerrainCard(terrain.cardId);
        for (const mod of def.modifiers ?? []) {
          if (mod.query === queryName) sources.push({ def: mod, sourceInstanceId: terrain.instanceId, sourceOwnerId: playerId });
        }
      }
    }
  }
  return sources;
}

export interface PermissionResult {
  allow: boolean;
  votes: Vote[];
}

/**
 * Human-readable French labels for the engine's own denial sources. Cards vote with a
 * `"<kind>:<cardId>"` source instead, which is resolved to the card's display name.
 * Shared by the server's rejection messages and by the client's "why is this greyed
 * out?" tooltips, so both always say the same thing.
 */
const VOTE_LABELS: Record<string, string> = {
  'status:stun': 'étourdi',
  'status:disarmed': 'désarmé',
  'status:chained': 'enchaîné',
  'status:borrowed-attack': "limité à l'attaque empruntée",
  'status:silence-active': 'capacités actives réduites au silence',
  'status:silence-passive': 'capacités passives réduites au silence',
  'default:active-only': 'réservé au personnage actif',
  'default:per-turn-limit': 'déjà utilisée ce tour',
  'default:per-game-limit': 'quota de la partie épuisé',
  'default:objects-per-turn-limit': "plus d'objet jouable ce tour",
  'default:terrains-per-turn-limit': 'un seul terrain par tour',
};

function labelForSource(source: string): string {
  const known = VOTE_LABELS[source];
  if (known) return known;
  const [, cardId] = source.split(':');
  if (cardId) {
    try {
      return getCard(cardId).name;
    } catch {
      /* not a card id -- fall through to the raw source */
    }
  }
  return source;
}

/** Comma-separated reasons a permission was denied, ready to show to a player. */
export function describeDenials(votes: Vote[]): string {
  const reasons = votes.filter((v) => !v.allow).map((v) => v.reason ?? labelForSource(v.source));
  return [...new Set(reasons)].join(', ');
}

/**
 * Section 10: "ce qui empêche > ce qui permet" -- any single deny vote wins
 * over any number of allow votes, no matter their source or recency.
 */
export function evaluatePermission(
  state: GameState,
  queryName: QueryName,
  queryPayload: Record<string, unknown>,
  defaultAllow: boolean,
  extraVotes: Vote[] = []
): PermissionResult {
  const votes: Vote[] = [...extraVotes];
  for (const { def, sourceInstanceId, sourceOwnerId } of getInPlaySources(state, queryName)) {
    if (!def.vote) continue;
    const ctx: ModifierEvalContext = { state, sourceInstanceId, sourceOwnerId, query: queryPayload };
    if (def.isActive && !def.isActive(ctx)) continue;
    const vote = def.vote(ctx);
    if (vote) votes.push(vote);
  }
  if (votes.some((v) => !v.allow)) return { allow: false, votes };
  if (votes.some((v) => v.allow)) return { allow: true, votes };
  return { allow: defaultAllow, votes };
}

export function evaluateTransform<T>(
  state: GameState,
  queryName: QueryName,
  queryPayload: Record<string, unknown>,
  initialValue: T
): T {
  let current: unknown = initialValue;
  for (const { def, sourceInstanceId, sourceOwnerId } of getInPlaySources(state, queryName)) {
    if (!def.transform) continue;
    const ctx: ModifierEvalContext = { state, sourceInstanceId, sourceOwnerId, query: queryPayload };
    if (def.isActive && !def.isActive(ctx)) continue;
    current = def.transform(ctx, current);
  }
  return current as T;
}

// ---------------------------------------------------------------------------
// Typed convenience queries used by the action handlers
// ---------------------------------------------------------------------------

/**
 * `attackId` nomme l'attaque que le moteur est en train d'autoriser, quand il y en a une.
 * C'est ce qui permet à une carte de sceller UNE attaque précise ("Sacrifice" de Makima)
 * au lieu de désarmer tout le personnage -- un `disarmed` reste, lui, un refus global.
 */
export function canAttack(state: GameState, characterInstanceId: string, attackId?: string): PermissionResult {
  const char = findCharacter(state, characterInstanceId);
  const extra: Vote[] = [];
  if (isStunned(char)) extra.push({ allow: false, source: 'status:stun' });
  if (isDisarmed(char)) extra.push({ allow: false, source: 'status:disarmed' });
  // 'borrowed-attack' ("Livre de Chrollo") : l'attaque empruntée devient la seule que le
  // porteur puisse porter ce tour-ci. On ne refuse rien quand `attackId` est absent -- la
  // requête jauge alors le personnage en général, et il a bien une attaque disponible.
  const borrowed = getStatus(char, 'borrowed-attack');
  if (borrowed && attackId !== undefined && attackId !== borrowed.data?.['attackId']) {
    extra.push({ allow: false, source: 'status:borrowed-attack' });
  }
  return evaluatePermission(state, 'canAttack', { characterInstanceId, attackId }, true, extra);
}

/**
 * L'attaque empruntée par ce personnage ("Livre de Chrollo"), si le statut
 * 'borrowed-attack' est là et pointe toujours sur une attaque qui existe. Renvoyée telle
 * quelle : elle s'exécutera avec le contexte du PORTEUR, pas celui de la carte d'origine.
 */
function borrowedAttackOf(char: CharacterInstance): AttackDef | undefined {
  const borrowed = getStatus(char, 'borrowed-attack');
  if (!borrowed) return undefined;
  const cardId = borrowed.data?.['cardId'];
  const attackId = borrowed.data?.['attackId'];
  if (typeof cardId !== 'string' || typeof attackId !== 'string') return undefined;
  try {
    return getCharacterCard(cardId).attacks.find((a) => a.id === attackId);
  } catch {
    return undefined; // carte inconnue (registre vidé entre deux parties) : rien à emprunter
  }
}

/**
 * Toutes les attaques que ce personnage peut déclarer maintenant : les siennes, plus celle
 * qu'il a empruntée. **Le seul point d'entrée** pour énumérer les attaques d'un personnage
 * en jeu -- `getCharacterCard(...).attacks` lu en direct raterait l'empruntée, et le moteur
 * comme le client s'en servent (panneau de commandes, fiche, manipulation de Makima).
 *
 * Sur une collision d'`attackId` (deux cartes qui nommeraient pareil leur attaque),
 * l'empruntée gagne : c'est elle que `canAttack` autorise, elle ne doit donc jamais se
 * faire recouvrir par une homonyme.
 */
export function attacksAvailableTo(state: GameState, characterInstanceId: string): AttackDef[] {
  const char = findCharacter(state, characterInstanceId);
  let own: AttackDef[];
  try {
    own = getCharacterCard(char.cardId).attacks;
  } catch {
    own = [];
  }
  const borrowed = borrowedAttackOf(char);
  if (!borrowed) return own;
  return [...own.filter((a) => a.id !== borrowed.id), borrowed];
}

/** L'attaque `attackId` telle que ce personnage la porterait, empruntée comprise. */
export function findAttackFor(
  state: GameState,
  characterInstanceId: string,
  attackId: string
): AttackDef | undefined {
  return attacksAvailableTo(state, characterInstanceId).find((a) => a.id === attackId);
}

/**
 * Attaquer depuis le banc : refusé par défaut pour tout le monde, et ouvert seulement par
 * la carte qui le dit elle-même ("Bonus" de Yumeko). Séparé de `canAttack` pour qu'un
 * personnage autorisé à frapper du banc reste soumis aux mêmes refus que les autres
 * (stun, désarmé, sceau...).
 */
export function canAttackFromBench(state: GameState, characterInstanceId: string): PermissionResult {
  return evaluatePermission(state, 'canAttackFromBench', { characterInstanceId }, false);
}

/**
 * Gates the *standard* switch action. External/forced switches bypass this entirely
 * (section 6) -- except the 'chained' status, which zones.switchActive enforces on every
 * switch, forced ones included (Chaînes bloque le switch « TOTALEMENT »).
 */
export function canSwitchStandard(state: GameState, characterInstanceId: string): PermissionResult {
  const char = findCharacter(state, characterInstanceId);
  const extra: Vote[] = [];
  if (isStunned(char)) extra.push({ allow: false, source: 'status:stun' });
  if (hasStatus(char, 'chained')) extra.push({ allow: false, source: 'status:chained' });
  return evaluatePermission(state, 'canSwitchStandard', { characterInstanceId }, true, extra);
}

/**
 * Le garde commun à TOUS les switchs, y compris ceux qu'une carte force
 * (`zones.switchActive` est leur unique point de passage). `canSwitchStandard`, lui, ne
 * ferme que l'action de switch du joueur.
 *
 * ⚠️ Le remplacement d'un personnage KO n'est pas un switch et ne passe jamais par ici :
 * un camp dont l'actif meurt doit toujours pouvoir remettre quelqu'un au poste, sans quoi
 * la partie se bloquerait.
 */
export function canSwitchAny(
  state: GameState,
  playerId: PlayerId,
  outgoingInstanceId: string | null,
  incomingInstanceId: string
): PermissionResult {
  return evaluatePermission(
    state,
    'canSwitchAny',
    { playerId, outgoingInstanceId, incomingInstanceId },
    true
  );
}

export function getAbilityUsesPerTurn(
  state: GameState,
  characterInstanceId: string,
  abilityId: string,
  declared: number
): number {
  return evaluateTransform(state, 'getAbilityUsesPerTurn', { characterInstanceId, abilityId }, declared);
}

export function getAbilityUsesPerGame(
  state: GameState,
  characterInstanceId: string,
  abilityId: string,
  declared: number | undefined
): number | undefined {
  return evaluateTransform(state, 'getAbilityUsesPerGame', { characterInstanceId, abilityId }, declared);
}

export function canUseAbility(state: GameState, characterInstanceId: string, ability: AbilityDef): PermissionResult {
  const char = findCharacter(state, characterInstanceId);
  const player = state.players[char.ownerId];
  const extra: Vote[] = [];

  if (isStunned(char)) extra.push({ allow: false, source: 'status:stun' }); // stun blocks all ability use
  if (ability.kind === 'active' && isSilencedActive(char)) extra.push({ allow: false, source: 'status:silence-active' });
  if (ability.kind === 'passive' && isSilencedPassive(char)) extra.push({ allow: false, source: 'status:silence-passive' });

  const isActiveChar = player.activeCharacterInstanceId === characterInstanceId;
  if (!isActiveChar && !ability.usableFromBench) extra.push({ allow: false, source: 'default:active-only' });
  // 'linked' (Jacob et Essau): "seul le personnage du poste actif peut utiliser son
  // actif/passif". Stronger than the default rule above -- it denies even an ability
  // that declares usableFromBench, which is the whole point of the clause.
  if (!isActiveChar && hasStatus(char, 'linked')) extra.push({ allow: false, source: 'status:linked' });

  const perTurnLimit = getAbilityUsesPerTurn(state, characterInstanceId, ability.id, ability.usesPerTurn ?? 1);
  const usedThisTurn = char.abilityUsesThisTurn[ability.id] ?? 0;
  if (usedThisTurn >= perTurnLimit) extra.push({ allow: false, source: 'default:per-turn-limit' });

  const perGameLimit = getAbilityUsesPerGame(state, characterInstanceId, ability.id, ability.usesPerGame);
  if (perGameLimit !== undefined) {
    const usedThisGame = char.abilityUsesThisGame[ability.id] ?? 0;
    if (usedThisGame >= perGameLimit) extra.push({ allow: false, source: 'default:per-game-limit' });
  }

  return evaluatePermission(state, 'canUseAbility', { characterInstanceId, abilityId: ability.id }, true, extra);
}

export function getMaxAttachedObjects(state: GameState, characterInstanceId: string): number {
  return evaluateTransform(state, 'getMaxAttachedObjects', { characterInstanceId }, 2);
}

/**
 * Le camp auquel appartient une instance, quelle qu'elle soit (personnage, objet, terrain).
 * `zones.safeFindCharacterOwner` ne sait répondre que pour un personnage, or la source d'un
 * effet est très souvent un objet ou un terrain.
 */
export function findInstanceOwner(state: GameState, instanceId: string): PlayerId | undefined {
  for (const playerId of ['p1', 'p2'] as PlayerId[]) {
    const p = state.players[playerId];
    if (p.characters[instanceId] || p.objects[instanceId] || p.terrains[instanceId]) return playerId;
  }
  return undefined;
}

/** Default targeting (section 11): bench is only targetable when the acting card's own text says so. */
export function canTargetBench(
  state: GameState,
  sourceInstanceId: string,
  targetInstanceId: string,
  allowedBySource: boolean
): PermissionResult {
  return evaluatePermission(state, 'canTargetBench', { sourceInstanceId, targetInstanceId }, allowedBySource);
}

/** Innate status immunity (e.g. Toji vs stun/silence/disarmed): any modifier can veto a specific statusId. */
export function canApplyStatus(state: GameState, targetInstanceId: string, statusId: string): PermissionResult {
  return evaluatePermission(state, 'canApplyStatus', { targetInstanceId, statusId }, true);
}

/**
 * Section 3: two object cards per turn (the second one being a final action). Cards
 * are free to raise or lower it -- e.g. a terrain granting a third object per turn.
 */
export const DEFAULT_MAX_OBJECTS_PER_TURN = 2;

export function getMaxObjectsPerTurn(state: GameState, playerId: PlayerId): number {
  return evaluateTransform(state, 'getMaxObjectsPerTurn', { playerId }, DEFAULT_MAX_OBJECTS_PER_TURN);
}

export function canPlayObject(state: GameState, playerId: PlayerId): PermissionResult {
  const extra: Vote[] = [];
  const player = state.players[playerId];
  if (player.objectsPlayedThisTurn >= getMaxObjectsPerTurn(state, playerId)) {
    extra.push({ allow: false, source: 'default:objects-per-turn-limit' });
  }
  return evaluatePermission(state, 'canPlayObject', { playerId }, true, extra);
}

/**
 * Refus propre à UNE carte objet (son `unplayableReason`), par opposition à `canPlayObject`
 * qui décide si le joueur peut jouer un objet *tout court*. Sert à ne pas laisser gaspiller
 * une carte qui n'a rien à cibler (annuler un terrain quand il n'y a pas de terrain...).
 * Partagé par le refus du serveur et par la grisaille de la main, pour que les deux disent
 * exactement la même phrase. `null` = rien à signaler.
 */
export function describeObjectUnplayable(state: GameState, playerId: PlayerId, objectInstanceId: string): string | null {
  const obj = state.players[playerId].objects[objectInstanceId];
  if (!obj) return null;
  try {
    return getObjectCard(obj.cardId).unplayableReason?.(state, playerId) ?? null;
  } catch {
    return null; // carte inconnue du registre : le serveur reste l'autorité
  }
}

/**
 * Section 8: one terrain per turn. Without a cap, a player could chain-play terrains in
 * a single turn purely to re-fire their "on play" effects (Autel Démoniaque's damage,
 * Protection Divine's shield...) while each one immediately buries the previous.
 */
export const DEFAULT_MAX_TERRAINS_PER_TURN = 1;

export function getMaxTerrainsPerTurn(state: GameState, playerId: PlayerId): number {
  return evaluateTransform(state, 'getMaxTerrainsPerTurn', { playerId }, DEFAULT_MAX_TERRAINS_PER_TURN);
}

export function canPlayTerrain(state: GameState, playerId: PlayerId): PermissionResult {
  const extra: Vote[] = [];
  const player = state.players[playerId];
  if (player.terrainsPlayedThisTurn >= getMaxTerrainsPerTurn(state, playerId)) {
    extra.push({ allow: false, source: 'default:terrains-per-turn-limit' });
  }
  return evaluatePermission(state, 'canPlayTerrain', { playerId }, true, extra);
}

export function getEffectiveATK(state: GameState, characterInstanceId: string, baseATK: number): number {
  const char = findCharacter(state, characterInstanceId);
  const transformed = evaluateTransform(state, 'getEffectiveATK', { characterInstanceId }, baseATK);
  const withBoosts = Math.max(0, transformed + getAtkBoostTotal(char) - getAtkReductionTotal(char));
  // getExtraAttackDamageMultiplier is the "Attaque cloné" discount on the granted
  // follow-up swing; it is 1 for everyone else, and 1 for the first attack too.
  return Math.round(withBoosts * getAtkMultiplierTotal(char) * getExtraAttackDamageMultiplier(char));
}

/** Damage multiplier of a critical hit, before any card transforms it (Point Faible's x3). */
export const BASE_CRITICAL_MULTIPLIER = 2;

/** Defaults to the base x2 critical multiplier; a card (e.g. a terrain) can transform it for a specific attacker. */
export function getCriticalMultiplier(state: GameState, characterInstanceId: string): number {
  return evaluateTransform(state, 'getCriticalMultiplier', { characterInstanceId }, BASE_CRITICAL_MULTIPLIER);
}

/**
 * Esquive: every character has a base chance to fully negate an incoming
 * attack/ability (damage or status application), no status required. The
 * 'evasive' status raises that while it's present (it replaces the base rate
 * rather than stacking with it), and any card in play can push it further
 * with a `getEvasionPercent` modifier -- which is how a permanent innate
 * esquive (Gojo's "L'Infini", Kakashi's Sharingan) is declared, so it holds from
 * the very first hit of the game and survives a revive, with no status to
 * (re-)apply. Never consumed on a successful roll -- but a successful dodge now
 * poses 'evasion-locked' on the bearer (effect-context.ts), which zeroes this
 * BASE (still overridable by a card's own modifier, same as Gojo/Kakashi above)
 * for their next turn.
 */
export function getEvasionPercent(state: GameState, char: CharacterInstance): number {
  const base = isEvasionLocked(char) ? 0 : isEvasive(char) ? EVASIVE_STATUS_CHANCE_PERCENT : BASE_EVASION_CHANCE_PERCENT;
  const percent = Number(
    evaluateTransform(state, 'getEvasionPercent', { characterInstanceId: char.instanceId }, base)
  );
  return Math.max(0, Math.min(100, percent));
}

export function rollEvasion(state: GameState, char: CharacterInstance): boolean {
  return chancePercent(state.rng, getEvasionPercent(state, char));
}

/**
 * Critique: every character has a base 2% chance for an attack/ability they
 * deal damage with to double. The 'critical' status raises that to 33% while
 * it's present (replaces the base rate, doesn't stack with it) -- unless the
 * status carries its own `data.percent` (e.g. Killua's Godspeed arming a
 * guaranteed 100% for a single hit). A `getCriticalPercent` modifier is the
 * static counterpart, for a character whose kit simply crits more often.
 */
export function getCriticalPercent(state: GameState, char: CharacterInstance): number {
  const status = char.statuses.find((s) => s.statusId === 'critical');
  let base = status ? Number(status.data?.['percent'] ?? CRITICAL_STATUS_CHANCE_PERCENT) : BASE_CRITICAL_CHANCE_PERCENT;
  // 'crit-streak' (e.g. "Crit +"): once the bearer has landed `data.threshold` crits, its
  // rate is guaranteed `data.boostPercent`% -- same treatment as the 'critical' status above.
  const streak = char.statuses.find((s) => s.statusId === 'crit-streak');
  if (streak && Number(streak.data?.['count'] ?? 0) >= Number(streak.data?.['threshold'] ?? 2)) {
    base = Math.max(base, Number(streak.data?.['boostPercent'] ?? 70));
  }
  const percent = Number(
    evaluateTransform(state, 'getCriticalPercent', { characterInstanceId: char.instanceId }, base)
  );
  return Math.max(0, Math.min(100, percent));
}

export function rollCritical(state: GameState, char: CharacterInstance): boolean {
  return chancePercent(state.rng, getCriticalPercent(state, char));
}
