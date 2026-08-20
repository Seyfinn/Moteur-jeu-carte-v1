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

export function listCards(): CardDef[] {
  return [...registry.values()];
}

/** Test-only escape hatch. */
export function clearRegistry(): void {
  registry.clear();
}
