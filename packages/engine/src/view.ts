import { otherPlayer, type GameState, type PlayerId, type PlayerState } from './types.js';

/**
 * Mode Pioche : personne ne doit connaître l'ORDRE des piles, pas même le propriétaire de
 * la sienne -- ce serait lire l'avenir. Elles sont donc réduites à leur taille, des deux
 * côtés, avec des ids qui ne résolvent nulle part : la main peut afficher « N cartes »
 * sans jamais pouvoir dire lesquelles.
 */
function redactPiles(player: PlayerState): PlayerState {
  if (player.drawPiles.characterCardIds.length === 0 && player.drawPiles.objectCardIds.length === 0) {
    return player;
  }
  return {
    ...player,
    drawPiles: {
      characterCardIds: player.drawPiles.characterCardIds.map((_, i) => `hidden-pile-character-${i}`),
      objectCardIds: player.drawPiles.objectCardIds.map((_, i) => `hidden-pile-object-${i}`),
    },
  };
}

/**
 * Section 1: character cards are always public; object/terrain cards are
 * hidden from the opponent until played. This strips the opponent's
 * unplayed object/terrain instances out of the view handed to `forPlayerId`.
 *
 * Mode Pioche ajoute deux secrets : la **Main Personnage** de l'adversaire (les
 * personnages y sont pourtant des cartes normalement publiques -- ils ne le deviennent
 * qu'en arrivant sur le plateau) et l'ordre des **piles de pioche**, celle de chacun
 * comme la pile de terrains commune.
 */
export function getPlayerView(state: GameState, forPlayerId: PlayerId): GameState {
  const opponentId = otherPlayer(forPlayerId);
  const opponent = state.players[opponentId];

  // L'ordre des piles n'est jamais révélé, quoi qu'il arrive par ailleurs -- y compris
  // quand "Ultimate Détective" a ouvert la main adverse.
  const base: GameState = {
    ...state,
    sharedTerrainPile: state.sharedTerrainPile.map((_, i) => `hidden-pile-terrain-${i}`),
    players: {
      ...state.players,
      [forPlayerId]: redactPiles(state.players[forPlayerId]),
      [opponentId]: redactPiles(opponent),
    },
  };

  // "Ultimate Détective" (Kirigiri) and similar effects: once this player has
  // revealed the opponent's hidden pool, stop redacting it for every future view.
  if (state.players[forPlayerId].revealsOpponentUnplayedCards) return base;

  const redactedOpponent = base.players[opponentId];
  const hiddenCharacterIds = new Set(opponent.handCharacterInstanceIds);

  const visibleObjects = Object.fromEntries(
    Object.entries(opponent.objects).filter(([id]) => !opponent.unplayedObjectInstanceIds.includes(id))
  );
  const visibleTerrains = Object.fromEntries(
    Object.entries(opponent.terrains).filter(([id]) => !opponent.unplayedTerrainInstanceIds.includes(id))
  );
  // Un personnage en Main Personnage n'est pas encore en jeu : son identité reste secrète,
  // comme celle d'un objet non joué.
  const visibleCharacters = Object.fromEntries(
    Object.entries(opponent.characters).filter(([id]) => !hiddenCharacterIds.has(id))
  );

  // Identities are hidden, but the *count* of hidden cards isn't secret (a
  // player can see their opponent still has cards in hand) -- replaced with
  // unresolvable placeholder ids so the UI can still render "N face-down
  // cards" without ever being able to look up what they are.
  const hiddenObjectIds = opponent.unplayedObjectInstanceIds.map((_, i) => `hidden-object-${i}`);
  const hiddenTerrainIds = opponent.unplayedTerrainInstanceIds.map((_, i) => `hidden-terrain-${i}`);
  const hiddenHandIds = opponent.handCharacterInstanceIds.map((_, i) => `hidden-character-${i}`);

  return {
    ...base,
    players: {
      ...base.players,
      [opponentId]: {
        ...redactedOpponent,
        characters: visibleCharacters,
        handCharacterInstanceIds: hiddenHandIds,
        objects: visibleObjects,
        unplayedObjectInstanceIds: hiddenObjectIds,
        terrains: visibleTerrains,
        unplayedTerrainInstanceIds: hiddenTerrainIds,
      },
    },
  };
}
