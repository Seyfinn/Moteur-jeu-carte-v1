import type { TerrainCardDef } from '../types.js';
import { findCharacter } from '../../queries.js';

const DURATION_TURNS = 2;
const MULTIPLIER = 3;

export const pointFaible: TerrainCardDef = {
  type: 'terrain',
  id: 'point-faible',
  name: 'Point faible',
  description: `Pendant ${DURATION_TURNS} tours, les coups critiques du joueur qui a posé ce terrain infligent ${MULTIPLIER} fois les dégâts de base au lieu de 2 fois.`,
  durationTurns: DURATION_TURNS,
  modifiers: [
    {
      query: 'getCriticalMultiplier',
      transform(ctx, current) {
        const characterInstanceId = ctx.query['characterInstanceId'] as string;
        const attacker = findCharacter(ctx.state, characterInstanceId);
        if (attacker.ownerId !== ctx.sourceOwnerId) return current;
        return MULTIPLIER;
      },
    },
  ],
};
