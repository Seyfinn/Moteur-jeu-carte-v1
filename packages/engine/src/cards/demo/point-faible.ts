import type { TerrainCardDef } from '../types.js';

const DURATION_TURNS = 2;
const MULTIPLIER = 3;

export const pointFaible: TerrainCardDef = {
  type: 'terrain',
  id: 'point-faible',
  name: 'Point faible',
  description: `Pendant ${DURATION_TURNS} tours, les coups critiques infligent ${MULTIPLIER} fois les dégâts de base au lieu de 2 fois.`,
  durationTurns: DURATION_TURNS,
  modifiers: [
    {
      query: 'getCriticalMultiplier',
      // Actif pour les deux joueurs, pas seulement celui qui a posé ce terrain.
      transform() {
        return MULTIPLIER;
      },
    },
  ],
};
