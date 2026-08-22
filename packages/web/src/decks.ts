import { DECK_LIMITS, DEMO_ROSTER, validateRoster, type RosterConfig } from 'engine';

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

const EXPORT_PREFIX = 'CTGDECK1:';

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Serializes a deck to a short text code that another player can paste into "Importer un deck". */
export function encodeDeckCode(deck: Deck): string {
  const payload: RosterConfig & { name: string } = {
    name: deck.name,
    characterCardIds: deck.characterCardIds,
    objectCardIds: deck.objectCardIds,
    terrainCardIds: deck.terrainCardIds,
  };
  return EXPORT_PREFIX + utf8ToBase64(JSON.stringify(payload));
}

/** Inverse of {@link encodeDeckCode}. Throws with a user-facing message if the code is malformed or the deck is invalid. */
export function decodeDeckCode(code: string): Deck {
  const trimmed = code.trim();
  if (!trimmed.startsWith(EXPORT_PREFIX)) {
    throw new Error("Code de deck invalide -- vérifiez que vous avez copié le code en entier.");
  }
  let payload: Partial<RosterConfig & { name: string }>;
  try {
    payload = JSON.parse(base64ToUtf8(trimmed.slice(EXPORT_PREFIX.length)));
  } catch {
    throw new Error("Code de deck invalide -- vérifiez que vous avez copié le code en entier.");
  }
  if (
    typeof payload.name !== 'string' ||
    !Array.isArray(payload.characterCardIds) ||
    !Array.isArray(payload.objectCardIds) ||
    !Array.isArray(payload.terrainCardIds)
  ) {
    throw new Error('Code de deck invalide -- format inattendu.');
  }
  const roster: RosterConfig = {
    characterCardIds: payload.characterCardIds,
    objectCardIds: payload.objectCardIds,
    terrainCardIds: payload.terrainCardIds,
  };
  const validation = validateRoster(roster);
  if (!validation.ok) throw new Error(validation.error);
  return { id: makeId(), name: payload.name, ...roster };
}

export { DECK_LIMITS };
