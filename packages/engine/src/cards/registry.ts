import type { CardDef, CharacterCardDef, ObjectCardDef, TerrainCardDef } from './types.js';

const registry = new Map<string, CardDef>();

export function registerCard(def: CardDef): void {
  if (registry.has(def.id)) {
    throw new Error(`Card id "${def.id}" is already registered`);
  }
  registry.set(def.id, def);
}

export function getCard(id: string): CardDef {
  const def = registry.get(id);
  if (!def) throw new Error(`Unknown card id "${id}"`);
  return def;
}

export function getCharacterCard(id: string): CharacterCardDef {
  const def = getCard(id);
  if (def.type !== 'character') throw new Error(`Card "${id}" is not a character card`);
  return def;
}

export function getObjectCard(id: string): ObjectCardDef {
  const def = getCard(id);
  if (def.type !== 'object') throw new Error(`Card "${id}" is not an object card`);
  return def;
}

export function getTerrainCard(id: string): TerrainCardDef {
  const def = getCard(id);
  if (def.type !== 'terrain') throw new Error(`Card "${id}" is not a terrain card`);
  return def;
}

/** Les formes déclarées par `evolvesTo`, normalisées en liste. */
export function evolutionFormsOf(def: CardDef): string[] {
  if (def.type !== 'character' || !def.evolvesTo) return [];
  return Array.isArray(def.evolvesTo) ? def.evolvesTo : [def.evolvesTo];
}

/**
 * Les ids de toutes les cartes qui sont la forme évoluée de quelqu'un. Recalculé à chaque
 * appel plutôt que mémoïsé : le registre se remplit au fil des `registerCard`, et un cache
 * figé au premier appel manquerait les cartes enregistrées après lui (les tests en
 * enregistrent en cours de route).
 */
export function evolvedFormIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const def of listCards()) {
    for (const formId of evolutionFormsOf(def)) ids.add(formId);
  }
  return ids;
}

/** Une carte n'existe-t-elle que comme forme évoluée d'une autre ? */
export function isEvolvedForm(cardId: string): boolean {
  return evolvedFormIds().has(cardId);
}

export function listCards(): CardDef[] {
  return [...registry.values()];
}

/** Test-only escape hatch. */
export function clearRegistry(): void {
  registry.clear();
}
