import type { ObjectCardDef } from '../types.js';

const REFLECT_PERCENT = 50;

export const miroirDeRenvoi: ObjectCardDef = {
  type: 'object',
  id: 'miroir-de-renvoi',
  name: 'Miroir de Renvoi',
  description:
    `À lier à votre personnage actif. Celui-ci subit 100% des dégâts de la prochaine attaque qu'il subit et en renvoie immédiatement ${REFLECT_PERCENT}% à l'attaquant, puis le miroir se détruit.`,
  async execute(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    if (!active) return;
    ctx.attachSelfTo(active.instanceId);
    ctx.applyStatus(active.instanceId, {
      statusId: 'miroir-de-renvoi',
      label: 'Miroir de Renvoi',
      sourceCardInstanceId: ctx.sourceInstanceId,
      data: { percent: REFLECT_PERCENT, objectInstanceId: ctx.sourceInstanceId },
    });
  },
};
