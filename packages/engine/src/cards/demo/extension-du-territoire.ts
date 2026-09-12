import type { ObjectCardDef } from '../types.js';

const EXTRA_TURNS = 2;

export const extensionDuTerritoire: ObjectCardDef = {
  type: 'object',
  id: 'extension-du-territoire',
  name: 'Extension du territoire',
  description: `UNIQUE EXEMPLAIRE
Rajoute 2 tours au terrain actif`,
  maxCopies: 1,
  // Refusée avant d'être consommée quand il n'y a rien à prolonger (cf. CLAUDE.md) : sans
  // terrain actif, ou avec un terrain à durée indéfinie (`extendTerrain` y est un no-op),
  // la carte partait au cimetière sans effet.
  unplayableReason(state, ownerId) {
    const player = state.players[ownerId];
    const terrainId = player.activeTerrainInstanceId;
    if (!terrainId) return "vous n'avez aucun terrain actif";
    if (player.terrains[terrainId]?.remainingTurns === undefined) return 'votre terrain actif est à durée indéfinie';
    return null;
  },
  async execute(ctx) {
    const terrainInstanceId = ctx.state.players[ctx.ownerId].activeTerrainInstanceId;
    if (!terrainInstanceId) return;
    ctx.extendTerrain(terrainInstanceId, EXTRA_TURNS);
  },
};
