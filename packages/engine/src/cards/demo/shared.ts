import type { AttackDef } from '../types.js';

/** Straightforward "hit the opponent's active character for X" attack. */
export function simpleAttack(id: string, name: string, baseATK: number, description: string): AttackDef {
  return {
    id,
    name,
    baseATK,
    description,
    async execute(ctx) {
      const target = ctx.getActive(ctx.opponentId);
      if (!target) return;
      const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, baseATK);
      await ctx.dealDamage(target.instanceId, atk);
    },
  };
}
