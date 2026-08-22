import type { ObjectCardDef } from '../types.js';

const EXTRA_TURNS = 2;

export const extensionDuTerritoire: ObjectCardDef = {
  type: 'object',
  id: 'extension-du-territoire',
  name: 'Extension du territoire',
  description: `Exemplaire unique. Rajoute ${EXTRA_TURNS} tours au terrain actif du joueur qui la joue (aucun effet si ce terrain est de durée indéfinie, ou si le joueur n'a pas de terrain en jeu).`,
  maxCopies: 1,
  async execute(ctx) {
    const terrainInstanceId = ctx.state.players[ctx.ownerId].activeTerrainInstanceId;
    if (!terrainInstanceId) return;
    ctx.extendTerrain(terrainInstanceId, EXTRA_TURNS);
  },
};
