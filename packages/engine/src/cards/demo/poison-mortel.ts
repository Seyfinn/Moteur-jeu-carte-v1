import type { ObjectCardDef } from '../types.js';

const POISON_DURATION_TURNS = 3;

export const poisonMortel: ObjectCardDef = {
  type: 'object',
  id: 'poison-mortel',
  name: 'Poison Mortel',
  description: `Applique poison sur la carte ennemi du poste actif pendant ${POISON_DURATION_TURNS} tours.`,
  async execute(ctx) {
    const active = ctx.getActive(ctx.opponentId);
    if (!active) return;
    ctx.applyStatus(active.instanceId, {
      statusId: 'poison',
      label: 'Poison',
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      remainingTurns: POISON_DURATION_TURNS,
    });
  },
};
