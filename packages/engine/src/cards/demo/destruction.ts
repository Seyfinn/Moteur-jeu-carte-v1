import type { TerrainCardDef } from '../types.js';

const DURATION_TURNS = 3;

export const destruction: TerrainCardDef = {
  type: 'terrain',
  id: 'destruction',
  name: 'Destruction',
  description: 'Détruit tous les objets actuellement équipés sur le terrain des 2 joueurs. aucun joueur ne peut utiliser ou équiper de cartes Objet. »',
  durationTurns: DURATION_TURNS,
  abilities: [
    {
      id: 'destruction-onplay',
      name: 'Destruction',
      kind: 'passive',
      // Plomberie : pas imprimée sur la carte (cf. `hidden` dans cards/types.ts).
      hidden: true,
      description: 'Détruit tous les objets actuellement équipés des 2 joueurs.',
      trigger: 'onTerrainPlayed',
      // Only for THIS terrain's own arrival. Without the guard, the event emitted when
      // *any* terrain hits the table (including the opponent's) re-fired this on-play
      // effect for every terrain already in play.
      condition(ctx) {
        return ctx.event?.data['terrainInstanceId'] === ctx.sourceInstanceId;
      },
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
