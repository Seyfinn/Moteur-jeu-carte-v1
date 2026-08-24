import type { ObjectCardDef } from '../types.js';

const BOOST_AMOUNT = 40;
const BOOST_DURATION_TURNS = 1;

export const potionForce: ObjectCardDef = {
  type: 'object',
  id: 'potion-force',
  name: 'Potion force',
  description: `Votre personnage actif inflige ${BOOST_AMOUNT} dégâts de plus avec ses attaques jusqu'à la fin de ce tour.`,
  async execute(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    if (!active) return;
    ctx.applyStatus(active.instanceId, {
      statusId: 'atk-boost',
      label: 'Potion force',
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      remainingTurns: BOOST_DURATION_TURNS,
      // Counts down even if its bearer is benched right after: otherwise a switch froze
      // the buff (bench suspends durations) and it came back intact much later.
      ticksOnBench: true,
      data: { amount: BOOST_AMOUNT },
    });
  },
};
