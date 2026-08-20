import type { AbilityDef, AttackDef } from '../types.js';

/** Straightforward "hit the opponent's active character for X" attack, used by several demo cards. */
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

/**
 * "Puissance du roi": on each attack this character declares, flip coins
 * until landing on "pile" (tails); every "face" (heads) flipped along the
 * way permanently removes 100 max HP from this card (valeur lock), resolved
 * before the attack's own damage per section 3's ordering rule.
 */
export function puissanceDuRoi(): AbilityDef {
  return {
    id: 'puissance-du-roi',
    name: 'Puissance du roi',
    kind: 'active',
    trigger: 'onAttackDeclared',
    description: 'À chaque attaque : lance une pièce jusqu’à "pile", -100 HP max par "face" obtenu.',
    condition(ctx) {
      return ctx.event?.data?.['characterInstanceId'] === ctx.sourceInstanceId;
    },
    async execute(ctx) {
      let faces = 0;
      // Safety cap: astronomically unlikely to matter with a fair coin, just guards against a broken RNG.
      for (let i = 0; i < 50; i++) {
        if (ctx.flipCoin() === 'tails') break;
        faces += 1;
      }
      if (faces > 0) {
        const amount = faces * 100;
        ctx.log(`Puissance du roi: ${faces} "face", -${amount} HP max`, { faces, amount });
        await ctx.applyValeurLock(ctx.sourceInstanceId, amount);
      }
    },
  };
}
