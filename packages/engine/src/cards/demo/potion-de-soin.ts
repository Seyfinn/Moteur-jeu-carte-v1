import type { ObjectCardDef } from '../types.js';

const HEAL_AMOUNT = 100;

export const potionDeSoin: ObjectCardDef = {
  type: 'object',
  id: 'potion-de-soin',
  name: 'Potion de soin',
  description: `Soigne un personnage de ${HEAL_AMOUNT} HP.`,
  async execute(ctx) {
    const options = ctx.getAllOnBoard(ctx.ownerId);
    if (options.length === 0) return;
    const selected = await ctx.choose({
      kind: 'select-characters',
      prompt: 'Potion de soin : choisissez le personnage à soigner',
      options: options.map((c) => c.instanceId),
      min: 1,
      max: 1,
    });
    const targetId = selected[0];
    if (!targetId) return;
    ctx.heal(targetId, HEAL_AMOUNT);
  },
};
