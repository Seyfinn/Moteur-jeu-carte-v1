import type { ObjectCardDef } from '../types.js';

const BOOST_AMOUNT = 40;
const BOOST_DURATION_TURNS = 1;

export const potionForce: ObjectCardDef = {
  type: 'object',
  id: 'potion-force',
  name: 'Potion force',
  description: `Augmente les dégâts des attaques du personnage sur le poste actif de ${BOOST_AMOUNT} pendant ${BOOST_DURATION_TURNS} tour.`,
  async execute(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    if (!active) return;
    ctx.applyStatus(active.instanceId, {
      statusId: 'atk-boost',
      label: 'Potion force',
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      remainingTurns: BOOST_DURATION_TURNS,
      data: { amount: BOOST_AMOUNT },
    });
  },
};
