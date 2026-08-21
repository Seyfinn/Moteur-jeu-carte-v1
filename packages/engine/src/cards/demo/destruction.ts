import type { TerrainCardDef } from '../types.js';

const DURATION_TURNS = 3;

export const destruction: TerrainCardDef = {
  type: 'terrain',
  id: 'destruction',
  name: 'Destruction',
  description: `Détruit tous les objets actuellement équipés sur le terrain des 2 joueurs. Pendant ${DURATION_TURNS} tours, aucun joueur ne peut utiliser ou équiper de cartes Objet.`,
  durationTurns: DURATION_TURNS,
  abilities: [
    {
      id: 'destruction-onplay',
      name: 'Destruction',
      kind: 'passive',
      description: 'Détruit tous les objets actuellement équipés des 2 joueurs.',
      trigger: 'onTerrainPlayed',
      async execute(ctx) {
        for (const playerId of ['p1', 'p2'] as const) {
          for (const char of ctx.getAllOnBoard(playerId)) {
            for (const objectInstanceId of [...char.attachedObjectInstanceIds]) {
              ctx.destroyObject(objectInstanceId);
            }
          }
        }
      },
    },
  ],
  modifiers: [
    {
      query: 'canPlayObject',
      vote() {
        return { allow: false, source: 'terrain:destruction' };
      },
    },
  ],
};
