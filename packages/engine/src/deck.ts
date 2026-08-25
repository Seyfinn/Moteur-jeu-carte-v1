import { getCard, listCards } from './cards/registry.js';
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
} as const;

export interface DeckPoolEntry {
  id: string;
  type: 'character' | 'object' | 'terrain';
  name: string;
  /** Characters only. */
  baseMaxHP?: number;
  /** Terrains only. `undefined` = indefinite duration. */
  durationTurns?: number;
  /** Effective max copies allowed in a deck for this card (own `maxCopies` override, or the general `DECK_LIMITS.maxCopiesPerCard`). */
  maxCopies: number;
  /** Objects only. `true` = équipement (se lie à un personnage) plutôt qu'effet immédiat. */
  equipment?: boolean;
}

/** Every card available to put in a deck, for deck-builder UIs. */
export function listDeckPool(): DeckPoolEntry[] {
  return listCards().map((def) => ({
    id: def.id,
    type: def.type,
    name: def.name,
    baseMaxHP: def.type === 'character' ? def.baseMaxHP : undefined,
    durationTurns: def.type === 'terrain' ? def.durationTurns : undefined,
    maxCopies: def.maxCopies ?? DECK_LIMITS.maxCopiesPerCard,
    equipment: def.type === 'object' ? def.equipment : undefined,
  }));
}

export type RosterValidation = { ok: true } | { ok: false; error: string };

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
      maxCopiesById.set(id, def.maxCopies ?? DECK_LIMITS.maxCopiesPerCard);
    }
    for (const [id, count] of copies) {
      const maxCopies = maxCopiesById.get(id)!;
      if (count > maxCopies) {
        return { ok: false, error: `Trop d'exemplaires de "${id}" (max ${maxCopies})` };
      }
    }
  }

  if (roster.characterCardIds.length === 0) {
    return { ok: false, error: 'Le deck doit contenir au moins une carte personnage' };
  }

  return { ok: true };
}
