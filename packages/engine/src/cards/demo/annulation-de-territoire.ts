import type { ObjectCardDef } from '../types.js';

const TURNS_REMOVED = 3;

export const annulationDeTerritoire: ObjectCardDef = {
  type: 'object',
  id: 'annulation-de-territoire',
  name: 'Annulation de territoire',
  description: `Sacrifiez votre terrain actif pour retirer ${TURNS_REMOVED} tours au terrain adverse. Sans effet si vous n'avez pas de terrain en jeu.`,
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
