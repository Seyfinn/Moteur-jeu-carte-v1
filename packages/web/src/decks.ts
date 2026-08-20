import { DECK_LIMITS, DEMO_ROSTER, type RosterConfig } from 'engine';

export interface Deck {
  id: string;
  name: string;
  characterCardIds: string[];
  objectCardIds: string[];
  terrainCardIds: string[];
}

const STORAGE_KEY = 'ctg-decks-v1';

function makeId(): string {
  return `deck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Seeded so a brand new player can start a game before ever opening the deck builder. */
function defaultDecks(): Deck[] {
  return [
    {
      id: 'deck-demo-starter',
      name: 'Deck de démo',
      characterCardIds: DEMO_ROSTER.characterCardIds.slice(0, DECK_LIMITS.character),
      objectCardIds: DEMO_ROSTER.objectCardIds.flatMap((id) => Array(DECK_LIMITS.maxCopiesPerCard).fill(id)),
      terrainCardIds: DEMO_ROSTER.terrainCardIds.flatMap((id) => Array(DECK_LIMITS.maxCopiesPerCard).fill(id)),
    },
  ];
}

export function loadDecks(): Deck[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultDecks();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultDecks();
    return parsed;
  } catch {
    return defaultDecks();
  }
}

export function saveDecks(decks: Deck[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

export function createEmptyDeck(): Deck {
  return { id: makeId(), name: '', characterCardIds: [], objectCardIds: [], terrainCardIds: [] };
}

export function deckToRoster(deck: Deck): RosterConfig {
  return {
    characterCardIds: deck.characterCardIds,
    objectCardIds: deck.objectCardIds,
    terrainCardIds: deck.terrainCardIds,
  };
}

export function deckCardCount(deck: Deck): number {
  return deck.characterCardIds.length + deck.objectCardIds.length + deck.terrainCardIds.length;
}

export function isDeckPlayable(deck: Deck): boolean {
  return deck.characterCardIds.length > 0;
}

export { DECK_LIMITS };
