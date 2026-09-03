import type { ObjectCardDef } from '../types.js';

const CRIT_CHANCE_PERCENT = 70;

export const concentration: ObjectCardDef = {
  type: 'object',
  id: 'concentration',
  name: 'Concentration',
  description: 'La prochaine attaque à 70% de crit, si elle ne crit pas, elle inflige aucun dégâts et le personnage actif ne pourra pas attaquer au prochain tour.',
  async execute(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    if (!active) return;
    ctx.applyStatus(active.instanceId, {
      statusId: 'concentration',
      label: 'Concentration',
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      data: { percent: CRIT_CHANCE_PERCENT },
    });
  },
};
