import type { TerrainCardDef } from '../types.js';

const DURATION_TURNS = 2;

export const confiscation: TerrainCardDef = {
  type: 'terrain',
  id: 'confiscation',
  name: 'Confiscation',
  description: `Pendant ${DURATION_TURNS} tours, aucun personnage (allié comme ennemi) ne peut utiliser ses capacités actives ou passives. Les attaques et les cartes Terrain ne sont pas concernées.`,
  durationTurns: DURATION_TURNS,
  modifiers: [
    {
      query: 'canUseAbility',
      vote: () => ({ allow: false, source: 'terrain:confiscation' }),
    },
  ],
};
