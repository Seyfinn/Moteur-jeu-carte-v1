import { otherPlayer, type GameState, type PlayerId } from './types.js';

/**
 * Section 1: character cards are always public; object/terrain cards are
 * hidden from the opponent until played. This strips the opponent's
 * unplayed object/terrain instances out of the view handed to `forPlayerId`.
 */
export function getPlayerView(state: GameState, forPlayerId: PlayerId): GameState {
  const opponentId = otherPlayer(forPlayerId);
  const opponent = state.players[opponentId];

  // "Ultimate Détective" (Kirigiri) and similar effects: once this player has
  // revealed the opponent's hidden pool, stop redacting it for every future view.
  if (state.players[forPlayerId].revealsOpponentUnplayedCards) return state;

  const visibleObjects = Object.fromEntries(
    Object.entries(opponent.objects).filter(([id]) => !opponent.unplayedObjectInstanceIds.includes(id))
  );
  const visibleTerrains = Object.fromEntries(
    Object.entries(opponent.terrains).filter(([id]) => !opponent.unplayedTerrainInstanceIds.includes(id))
  );

  // Identities are hidden, but the *count* of hidden cards isn't secret (a
  // player can see their opponent still has cards in hand) -- replaced with
  // unresolvable placeholder ids so the UI can still render "N face-down
  // cards" without ever being able to look up what they are.
  const hiddenObjectIds = opponent.unplayedObjectInstanceIds.map((_, i) => `hidden-object-${i}`);
  const hiddenTerrainIds = opponent.unplayedTerrainInstanceIds.map((_, i) => `hidden-terrain-${i}`);

  return {
    ...state,
    players: {
      ...state.players,
      [opponentId]: {
        ...opponent,
        objects: visibleObjects,
        unplayedObjectInstanceIds: hiddenObjectIds,
        terrains: visibleTerrains,
        unplayedTerrainInstanceIds: hiddenTerrainIds,
      },
    },
  };
}
