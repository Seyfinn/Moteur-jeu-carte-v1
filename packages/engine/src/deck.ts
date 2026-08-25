import { getCard, listCards } from './cards/registry.js';
import type { CardDef } from './cards/types.js';
import type { RosterConfig } from './match.js';

/**
 * Target deck shape from the rules document. Treated as caps, not required
 * minimums: the current demo card pool doesn't have enough object/terrain
 * cards yet to fill a deck up to these numbers (see CLAUDE.md), so a deck
 * with fewer cards than the cap is still valid.
 */
export const DECK_LIMITS = {
  character: 6,
  object: 8,
  terrain: 3,
  maxCopiesPerCard: 2,
  /** Les terrains sont uniques : un deck ne peut jamais contenir deux fois le même. */
  maxCopiesPerTerrain: 1,
} as const;

/**
 * Nombre d'exemplaires autorisés pour UNE carte : son `maxCopies` s'il en déclare un,
 * sinon la limite générale de son type. Point de passage unique de `validateRoster` et de
 * `listDeckPool()`, pour que le deck-builder plafonne exactement là où le serveur refuse.
 */
function maxCopiesOf(def: CardDef): number {
  if (def.maxCopies !== undefined) return def.maxCopies;
  return def.type === 'terrain' ? DECK_LIMITS.maxCopiesPerTerrain : DECK_LIMITS.maxCopiesPerCard;
}

/**
 * Incompatibilités de deck, dans les deux sens. Une carte n'en déclare qu'un côté
 * (`incompatibleWith`) ; c'est ici qu'on en fait une relation symétrique, pour que le
 * deck-builder puisse griser l'autre carte sans savoir laquelle des deux porte la
 * déclaration.
 */
function incompatibilityIndex(): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const set = index.get(a) ?? new Set<string>();
    set.add(b);
    index.set(a, set);
  };
  for (const def of listCards()) {
    for (const otherId of def.incompatibleWith ?? []) {
      link(def.id, otherId);
      link(otherId, def.id);
    }
  }
  return index;
}

export interface DeckPoolEntry {
  id: string;
  type: 'character' | 'object' | 'terrain';
  name: string;
  /** Characters only. */
  baseMaxHP?: number;
  /** Terrains only. `undefined` = indefinite duration. */
  durationTurns?: number;
  /** Effective max copies allowed in a deck for this card (see `maxCopiesOf`). */
  maxCopies: number;
  /** Cartes qui ne peuvent pas être dans le même deck que celle-ci (relation déjà symétrisée). */
  incompatibleWith: string[];
  /** Objects only. `true` = équipement (se lie à un personnage) plutôt qu'effet immédiat. */
  equipment?: boolean;
}

/** Every card available to put in a deck, for deck-builder UIs. */
export function listDeckPool(): DeckPoolEntry[] {
  const incompatibilities = incompatibilityIndex();
  return listCards().map((def) => ({
    id: def.id,
    type: def.type,
    name: def.name,
    baseMaxHP: def.type === 'character' ? def.baseMaxHP : undefined,
    durationTurns: def.type === 'terrain' ? def.durationTurns : undefined,
    maxCopies: maxCopiesOf(def),
    incompatibleWith: [...(incompatibilities.get(def.id) ?? [])],
    equipment: def.type === 'object' ? def.equipment : undefined,
  }));
}

export type RosterValidation = { ok: true } | { ok: false; error: string };

/** Nom affichable d'une carte, ou son id si le registre ne la connaît pas (message d'erreur). */
function cardName(id: string): string {
  try {
    return getCard(id).name;
  } catch {
    return id;
  }
}

const GROUPS: Array<{ key: keyof RosterConfig; type: DeckPoolEntry['type']; max: number; label: string }> = [
  { key: 'characterCardIds', type: 'character', max: DECK_LIMITS.character, label: 'personnage' },
  { key: 'objectCardIds', type: 'object', max: DECK_LIMITS.object, label: 'objet' },
  { key: 'terrainCardIds', type: 'terrain', max: DECK_LIMITS.terrain, label: 'terrain' },
];

/** Validates a roster against the deck-building rules (caps + max copies per card). */
export function validateRoster(roster: RosterConfig): RosterValidation {
  for (const group of GROUPS) {
    const ids = roster[group.key];
    if (ids.length > group.max) {
      return { ok: false, error: `Trop de cartes ${group.label} (max ${group.max})` };
    }

    const copies = new Map<string, number>();
    const maxCopiesById = new Map<string, number>();
    for (const id of ids) {
      let def;
      try {
        def = getCard(id);
      } catch {
        return { ok: false, error: `Carte inconnue : "${id}"` };
      }
      if (def.type !== group.type) {
        return { ok: false, error: `"${id}" n'est pas une carte ${group.label}` };
      }
      copies.set(id, (copies.get(id) ?? 0) + 1);
      maxCopiesById.set(id, maxCopiesOf(def));
    }
    for (const [id, count] of copies) {
      const maxCopies = maxCopiesById.get(id)!;
      if (count > maxCopies) {
        // Nommée, pas identifiée : ce message est lu par le joueur dans le deck-builder,
        // et « hopital » n'est pas ce qui est écrit sur la carte.
        return { ok: false, error: `Trop d'exemplaires de « ${cardName(id)} » (max ${maxCopies})` };
      }
    }
  }

  if (roster.characterCardIds.length === 0) {
    return { ok: false, error: 'Le deck doit contenir au moins une carte personnage' };
  }

  // Incompatibilités : croisées sur tout le deck, pas seulement dans un groupe -- rien
  // n'empêche a priori un objet d'être incompatible avec un personnage.
  const incompatibilities = incompatibilityIndex();
  const present = new Set([...roster.characterCardIds, ...roster.objectCardIds, ...roster.terrainCardIds]);
  for (const id of present) {
    for (const otherId of incompatibilities.get(id) ?? []) {
      if (!present.has(otherId)) continue;
      const [a, b] = [id, otherId].sort(); // message stable quel que soit l'ordre de parcours
      return { ok: false, error: `« ${cardName(a!)} » et « ${cardName(b!)} » ne peuvent pas être dans le même deck` };
    }
  }

  return { ok: true };
}
