import type { TerrainCardDef } from '../types.js';

const DURATION_TURNS = 2;
const HEAL_MULTIPLIER = 2;

export const hopital: TerrainCardDef = {
  type: 'terrain',
  id: 'hopital',
  name: 'Hôpital',
  description: `Les soins sont multipliés par 2 
`,
  durationTurns: DURATION_TURNS,
  modifiers: [
    {
      query: 'getIncomingHealAmount',
      // Actif pour les deux joueurs, pas seulement celui qui a posé ce terrain.
      transform(ctx, current) {
        return (current as number) * HEAL_MULTIPLIER;
      },
    },
  ],
};
