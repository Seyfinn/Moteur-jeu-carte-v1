import type { CharacterCardDef } from '../types.js';

const BLACK_FLASH_ATK = 70;
const BLACK_FLASH_CRIT_PERCENT = 33;

export const todo: CharacterCardDef = {
  type: 'character',
  id: 'todo',
  name: 'Todo',
  baseMaxHP: 200,
  attacks: [
    {
      id: 'black-flash',
      name: 'Black Flash',
      baseATK: BLACK_FLASH_ATK,
      description: `Inflige ${BLACK_FLASH_ATK} dégâts à l'actif adverse. ${BLACK_FLASH_CRIT_PERCENT}% de chance de critique (au lieu des 2% de base).`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;

        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, BLACK_FLASH_ATK);
        await ctx.dealDamage(target.instanceId, atk);
      },
    },
  ],
  abilities: [
    {
      id: 'boogie-woogie',
      name: 'Boogie Woogie',
      kind: 'active',
      description:
        "Switch gratuitement le personnage actif avec un personnage du banc allié de votre choix, même si Todo lui-même n'est pas l'actif. Utilisable une seule fois par partie.",
      usableFromBench: true,
      usesPerGame: 1,
      async execute(ctx) {
        const bench = ctx.getBench(ctx.ownerId);
        if (bench.length === 0) return;
        const [targetId] = await ctx.choose({
          kind: 'select-characters',
          prompt: 'Boogie Woogie : choisissez le personnage du banc à faire entrer en jeu',
          options: bench.map((c) => c.instanceId),
          min: 1,
          max: 1,
        });
        if (!targetId) return;
        await ctx.forceSwitch(ctx.ownerId, targetId);
      },
    },
  ],
  modifiers: [
    {
      // Chance de critique innée de Black Flash : un modifier plutôt qu'un statut posé
      // paresseusement, donc actif dès le premier coup et impossible à dissiper.
      query: 'getCriticalPercent',
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        return Math.max(current as number, BLACK_FLASH_CRIT_PERCENT);
      },
    },
  ],
};
