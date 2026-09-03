import type { TerrainCardDef } from '../types.js';

const DURATION_TURNS = 2;

export const confiscation: TerrainCardDef = {
  type: 'terrain',
  id: 'confiscation',
  name: 'Confiscation',
  description: "Empêche toute les cartes du jeu à la fois ennemis et alliées d'utiliser les actives et passifs",
  durationTurns: DURATION_TURNS,
  modifiers: [
    {
      query: 'canUseAbility',
      vote: () => ({ allow: false, source: 'terrain:confiscation' }),
    },
  ],
};
