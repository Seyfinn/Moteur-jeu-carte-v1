import type { ObjectCardDef } from '../types.js';

const CRIT_CHANCE_PERCENT = 70;

export const concentration: ObjectCardDef = {
  type: 'object',
  id: 'concentration',
  name: 'Concentration',
  description: `La prochaine attaque du personnage actif a ${CRIT_CHANCE_PERCENT}% de chances de critiquer. Si elle ne crit pas, elle n'inflige aucun dégât et le personnage actif ne pourra pas attaquer au tour suivant.`,
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
