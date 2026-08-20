import type { CharacterCardDef } from '../types.js';
import { puissanceDuRoi } from './shared.js';

export const gilgameshV: CharacterCardDef = {
  type: 'character',
  id: 'gilgamesh-v',
  name: 'Gilgamesh V',
  baseMaxHP: 600,
  abilities: [puissanceDuRoi()],
  attacks: [
    {
      id: 'enma-eilish',
      name: 'Enma Eilish',
      baseATK: 150,
      description: "Inflige 150. Si cette carte a moins d'HP que la carte attaquée, soigne 100.",
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const selfHP = self.currentMaxHP - self.damage;
        const targetHP = target.currentMaxHP - target.damage;
        const shouldHeal = selfHP < targetHP;

        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, 150);
        await ctx.dealDamage(target.instanceId, atk);
        if (shouldHeal && !ctx.isKO(ctx.sourceInstanceId)) {
          ctx.heal(ctx.sourceInstanceId, 100);
        }
      },
    },
  ],
};
