import type { TerrainCardDef } from '../types.js';

const DURATION_TURNS = 2;
const MULTIPLIER = 3;

export const pointFaible: TerrainCardDef = {
  type: 'terrain',
  id: 'point-faible',
  name: 'Point faible',
  description: 'Les crits infligent 3 fois plus de dégâts plutôt que 2 fois plus.   ',
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
