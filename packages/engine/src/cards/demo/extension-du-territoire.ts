import type { ObjectCardDef } from '../types.js';

const EXTRA_TURNS = 2;

export const extensionDuTerritoire: ObjectCardDef = {
  type: 'object',
  id: 'extension-du-territoire',
  name: 'Extension du territoire',
  description: `UNIQUE EXEMPLAIRE
Rajoute 2 tours au terrain actif`,
  maxCopies: 1,
  async execute(ctx) {
    const terrainInstanceId = ctx.state.players[ctx.ownerId].activeTerrainInstanceId;
    if (!terrainInstanceId) return;
    ctx.extendTerrain(terrainInstanceId, EXTRA_TURNS);
  },
};
