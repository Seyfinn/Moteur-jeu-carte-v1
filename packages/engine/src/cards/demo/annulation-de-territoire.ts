import type { ObjectCardDef } from '../types.js';

const TURNS_REMOVED = 3;

export const annulationDeTerritoire: ObjectCardDef = {
  type: 'object',
  id: 'annulation-de-territoire',
  name: 'Annulation de territoire',
  description: `Envoie votre terrain actif au cimetière, ce qui retire ${TURNS_REMOVED} tours au terrain ennemi (aucun effet sur le terrain ennemi s'il n'y en a pas). Sans effet si vous n'avez pas de terrain actif.`,
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
