import type { ObjectCardDef } from '../types.js';

const WARD_DURATION_TURNS = 1;

export const determination: ObjectCardDef = {
  type: 'object',
  id: 'determination',
  name: 'Détermination',
  description: `Exemplaire unique. Empêche le personnage actif de mourir de dégâts classiques pendant ${WARD_DURATION_TURNS} tour : tant que l'effet dure, aucun coup ne peut le faire descendre en dessous de 1HP (Valeur Lock n'est pas concerné).`,
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
    });
  },
};
