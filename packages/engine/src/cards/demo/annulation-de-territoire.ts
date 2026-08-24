import type { ObjectCardDef } from '../types.js';

const TURNS_REMOVED = 3;

export const annulationDeTerritoire: ObjectCardDef = {
  type: 'object',
  id: 'annulation-de-territoire',
  name: 'Annulation de territoire',
  description: `Sacrifiez votre terrain actif pour retirer ${TURNS_REMOVED} tours au terrain adverse.`,
  // La carte a besoin des DEUX terrains pour faire quoi que ce soit : sans le sien il n'y a
  // rien à sacrifier, sans celui d'en face il n'y a rien à annuler. Refusée avant d'être
  // consommée plutôt que jouée dans le vide.
  unplayableReason(state, ownerId) {
    const opponentId = ownerId === 'p1' ? 'p2' : 'p1';
    if (!state.players[ownerId].activeTerrainInstanceId) return "vous n'avez aucun terrain actif à sacrifier";
    if (!state.players[opponentId].activeTerrainInstanceId) return "aucun terrain adverse à annuler";
    return null;
  },
  async execute(ctx) {
    const ownTerrainId = ctx.state.players[ctx.ownerId].activeTerrainInstanceId;
    if (!ownTerrainId) return;

    await ctx.destroyTerrain(ownTerrainId);

    const enemyTerrainId = ctx.state.players[ctx.opponentId].activeTerrainInstanceId;
    if (enemyTerrainId) {
      await ctx.shortenTerrain(enemyTerrainId, TURNS_REMOVED);
    }
  },
};
