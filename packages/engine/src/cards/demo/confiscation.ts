import type { TerrainCardDef } from '../types.js';

const DURATION_TURNS = 2;

export const confiscation: TerrainCardDef = {
  type: 'terrain',
  id: 'confiscation',
  name: 'Confiscation',
  description: `Empêche toutes les cartes du jeu, ennemies et alliées, d'utiliser leurs actives et passifs pendant ${DURATION_TURNS} tours (le compte à rebours ne descend que sur les tours du joueur qui l'a posée). N'affecte pas les attaques.`,
  durationTurns: DURATION_TURNS,
  modifiers: [
    {
      query: 'canUseAbility',
      vote: () => ({ allow: false, source: 'terrain:confiscation' }),
    },
  ],
};
