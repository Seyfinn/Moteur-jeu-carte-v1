import { getCard } from './cards/registry.js';
import type { GameState, PlayerId } from './types.js';

/**
 * Display name of a card, for log entries and prompts. Falls back to the raw id rather
 * than throwing: the log is written from deep inside effect resolution and must never be
 * the thing that breaks an action (a card id can legitimately be unknown to a client
 * that hasn't registered the same pool).
 */
export function cardName(cardId: string): string {
  try {
    return getCard(cardId).name;
  } catch {
    return cardId;
  }
}

/** Display name a player chose when joining, falling back to their seat id. */
export function playerName(state: GameState, playerId: PlayerId): string {
  return state.players[playerId]?.displayName || playerId;
}
