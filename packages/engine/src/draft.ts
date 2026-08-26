import { DECK_LIMITS, listDeckPool, validateRoster, type RosterValidation } from './deck.js';
import { getCard } from './cards/registry.js';
import { randomInt, type RngState } from './rng.js';
import type { RosterConfig } from './match.js';

/**
 * Mode Aléatoire : chaque joueur reçoit une réserve tirée au sort, dans laquelle il compose
 * ensuite un deck aux quotas habituels (`DECK_LIMITS`). Le reste de la réserve n'est pas joué.
 */
export const RANDOM_POOL_SIZE = {
  character: 10,
  object: 10,
  terrain: 6,
} as const;

/**
 * Le mode choisi dans le lobby. 'normal' et 'random' débouchent tous deux sur une partie
 * `MatchMode: 'standard'` (on joue un deck fixé d'avance, construit ou drafté) ; 'draw' est
 * le Mode Pioche, qui suit ses propres règles (voir draw-mode.ts).
 */
export type GameMode = 'normal' | 'random' | 'draw';

/** La réserve tirée pour UN joueur. Même forme qu'un roster, mais ce n'est pas un deck jouable. */
export type DraftPool = RosterConfig;

/**
 * Tire `count` cartes DISTINCTES parmi `ids`, via le RNG seedé (jamais `Math.random`, pour
 * qu'un tirage soit reproductible en test). Si le jeu contient moins de cartes que demandé,
 * on rend tout ce qui existe plutôt que de boucler ou de dupliquer.
 */
function drawDistinct(rng: RngState, ids: readonly string[], count: number): string[] {
  const remaining = [...ids];
  const drawn: string[] = [];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    drawn.push(remaining.splice(randomInt(rng, remaining.length), 1)[0]!);
  }
  return drawn;
}

/**
 * La réserve aléatoire d'un joueur : 10 personnages / 10 objets / 6 terrains.
 *
 * Le tirage part de `listDeckPool()`, donc les **formes évoluées en sont exclues** d'office
 * (elles n'arrivent en jeu que par l'évolution de leur base, cf. CLAUDE.md).
 *
 * Les deux joueurs sont tirés **indépendamment** : une même carte peut sortir des deux côtés
 * si le hasard le veut. Ce qui compte, c'est que chacun pioche dans son propre tirage plutôt
 * que les deux dans une réserve commune.
 */
export function drawRandomPool(rng: RngState): DraftPool {
  const pool = listDeckPool();
  const idsOf = (type: 'character' | 'object' | 'terrain') =>
    pool.filter((entry) => entry.type === type).map((entry) => entry.id);

  return {
    characterCardIds: drawDistinct(rng, idsOf('character'), RANDOM_POOL_SIZE.character),
    objectCardIds: drawDistinct(rng, idsOf('object'), RANDOM_POOL_SIZE.object),
    terrainCardIds: drawDistinct(rng, idsOf('terrain'), RANDOM_POOL_SIZE.terrain),
  };
}

/** Deux réserves indépendantes, une par joueur, tirées sur le même RNG à la suite. */
export function drawRandomPools(rng: RngState): { p1: DraftPool; p2: DraftPool } {
  return { p1: drawRandomPool(rng), p2: drawRandomPool(rng) };
}

/**
 * Le deck soumis à la fin d'un draft est-il recevable ?
 *
 * Deux conditions, dans cet ordre :
 * 1. **chaque carte doit figurer dans la réserve du joueur** -- sinon on accepterait un deck
 *    fabriqué de toutes pièces par un client modifié ;
 * 2. **le deck reste un deck légal** (`validateRoster`) : quotas 6/8/3, unicité des
 *    personnages et des terrains, `maxCopies`, incompatibilités.
 *
 * Un objet peut être pris en **deux exemplaires** alors que la réserve n'en montre qu'un :
 * la réserve dit ce qui est *disponible*, pas combien d'exemplaires on peut en jouer -- c'est
 * `maxCopies` qui tranche, comme dans un deck construit normalement.
 */
export function validateDraftedRoster(roster: RosterConfig, pool: DraftPool): RosterValidation {
  const groups = [
    { key: 'characterCardIds', label: 'personnage' },
    { key: 'objectCardIds', label: 'objet' },
    { key: 'terrainCardIds', label: 'terrain' },
  ] as const;

  for (const group of groups) {
    const available = new Set(pool[group.key]);
    for (const id of roster[group.key]) {
      if (available.has(id)) continue;
      let name = id;
      try {
        name = getCard(id).name;
      } catch {
        /* carte inconnue : on garde l'id dans le message plutôt que de masquer le problème */
      }
      return { ok: false, error: `« ${name} » n'est pas dans votre tirage` };
    }
  }

  return validateRoster(roster);
}

/** Ce qu'il manque encore au deck en cours de draft, ou `null` s'il est prêt à être soumis. */
export function draftIssue(roster: RosterConfig, pool: DraftPool): string | null {
  const validation = validateDraftedRoster(roster, pool);
  if (!validation.ok) return validation.error;
  // Contrairement à un deck construit dans l'éditeur, un draft doit être COMPLET : les
  // quotas y sont un objectif à atteindre, pas seulement un plafond à ne pas dépasser.
  if (roster.characterCardIds.length < DECK_LIMITS.character) {
    return `Il manque ${DECK_LIMITS.character - roster.characterCardIds.length} personnage(s)`;
  }
  if (roster.objectCardIds.length < DECK_LIMITS.object) {
    return `Il manque ${DECK_LIMITS.object - roster.objectCardIds.length} objet(s)`;
  }
  if (roster.terrainCardIds.length < DECK_LIMITS.terrain) {
    return `Il manque ${DECK_LIMITS.terrain - roster.terrainCardIds.length} terrain(s)`;
  }
  return null;
}
