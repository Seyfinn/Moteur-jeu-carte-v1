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
      // Statut générique du moteur ('damage-reflect', cf types.ts) : le pipeline de
      // dégâts renvoie le pourcentage et détruit l'objet porteur, la carte ne fait
      // que le poser.
      statusId: 'damage-reflect',
      label: 'Miroir de Renvoi',
      sourceCardInstanceId: ctx.sourceInstanceId,
      data: { percent: REFLECT_PERCENT, objectInstanceId: ctx.sourceInstanceId },
    });
  },
};
