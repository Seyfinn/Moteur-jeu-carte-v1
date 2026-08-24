import type { ObjectCardDef } from '../types.js';

const WARD_DURATION_TURNS = 1;

export const determination: ObjectCardDef = {
  type: 'object',
  id: 'determination',
  name: 'Détermination',
  description: "Exemplaire unique. Jusqu'à la fin de ce tour, aucun coup ne peut faire descendre votre personnage actif en dessous de 1 HP.",
  maxCopies: 1,
  async execute(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    if (!active) return;
    ctx.applyStatus(active.instanceId, {
      statusId: 'death-ward',
      label: 'Détermination',
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      remainingTurns: WARD_DURATION_TURNS,
      // Turn-scoped: benching the bearer must not freeze the ward indefinitely.
      ticksOnBench: true,
    });
  },
};
