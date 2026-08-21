import type { TerrainCardDef } from '../types.js';
import { findCharacter } from '../../queries.js';

const DURATION_TURNS = 2;
const HEAL_MULTIPLIER = 2;

export const hopital: TerrainCardDef = {
  type: 'terrain',
  id: 'hopital',
  name: 'Hôpital',
  description: `Les soins reçus par vos personnages sont multipliés par ${HEAL_MULTIPLIER} pendant ${DURATION_TURNS} tours.`,
  durationTurns: DURATION_TURNS,
  modifiers: [
    {
      query: 'getIncomingHealAmount',
      transform(ctx, current) {
        const targetInstanceId = ctx.query['targetInstanceId'] as string;
        const target = findCharacter(ctx.state, targetInstanceId);
        if (target.ownerId !== ctx.sourceOwnerId) return current;
        return (current as number) * HEAL_MULTIPLIER;
      },
    },
  ],
};
