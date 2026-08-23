import { DECK_LIMITS, DEMO_STARTER_DECK, listDeckPool, validateRoster, type RosterConfig } from 'engine';

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

/**
 * Seeded so a brand new player can start a game before ever opening the deck builder.
 * DEMO_STARTER_DECK is already a legal deck (6/6/2, <=2 copies) -- building one here by
 * slicing the full card pool produced an over-cap deck that the server refused, so
 * "Créer un salon" failed for anyone who had never edited their decks.
 */
function defaultDecks(): Deck[] {
  return [{ id: 'deck-demo-starter', name: 'Deck de démo', ...DEMO_STARTER_DECK }];
}

function asIdArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * Decks live in localStorage, so they outlive any change to the card pool or to the
 * deck rules -- an entry can reference a card that no longer exists, or exceed a cap
 * that got tightened. Anything the engine would reject is dropped here rather than at
 * "Créer un salon", where it would surface as an opaque server error.
 */
function sanitizeDeck(raw: unknown): Deck | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  if (typeof source['id'] !== 'string') return null;

  const known = new Set(listDeckPool().map((entry) => entry.id));
  const trim = (ids: string[], max: number) => {
    const kept: string[] = [];
    const copies = new Map<string, number>();
    for (const id of ids) {
      if (!known.has(id) || kept.length >= max) continue;
      const used = copies.get(id) ?? 0;
      if (used >= DECK_LIMITS.maxCopiesPerCard) continue;
      copies.set(id, used + 1);
      kept.push(id);
    }
    return kept;
  };

  return {
    id: source['id'],
    name: typeof source['name'] === 'string' ? source['name'] : '',
    characterCardIds: trim(asIdArray(source['characterCardIds']), DECK_LIMITS.character),
    objectCardIds: trim(asIdArray(source['objectCardIds']), DECK_LIMITS.object),
    terrainCardIds: trim(asIdArray(source['terrainCardIds']), DECK_LIMITS.terrain),
  };
}

export function loadDecks(): Deck[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultDecks();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultDecks();
    const decks = parsed.map(sanitizeDeck).filter((deck): deck is Deck => deck !== null);
    return decks.length > 0 ? decks : defaultDecks();
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

/** A deck the server will accept: at least one character and inside every deck-building cap. */
export function deckIssue(deck: Deck): string | null {
  const validation = validateRoster(deckToRoster(deck));
  return validation.ok ? null : validation.error;
}

export function isDeckPlayable(deck: Deck): boolean {
  return deckIssue(deck) === null;
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
