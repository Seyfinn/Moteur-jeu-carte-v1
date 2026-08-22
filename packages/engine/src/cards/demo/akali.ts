import type { CharacterCardDef } from '../types.js';
import { hasDeathWard } from '../../statuses.js';

const BASE_ATK = 70;
const EXECUTE_THRESHOLD_HP = 20;
const SHROUD_DURATION_TURNS = 3;

export const akali: CharacterCardDef = {
  type: 'character',
  id: 'akali',
  name: 'Akali',
  baseMaxHP: 260,
  attacks: [
    {
      id: 'kunai',
      name: 'Kunaï',
      baseATK: BASE_ATK,
      description: `Inflige ${BASE_ATK} dégâts à l'actif adverse. Si celui-ci se retrouve à ${EXECUTE_THRESHOLD_HP}HP ou moins après le coup, il meurt immédiatement (Perfect Execution) -- sauf s'il est protégé par un effet du type Détermination.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, BASE_ATK);
        await ctx.dealDamage(target.instanceId, atk);

        if (ctx.isKO(target.instanceId)) return; // déjà mort via les dégâts normaux
        const current = ctx.getCharacter(target.instanceId);
        const remainingHP = current.currentMaxHP - current.damage;
        if (remainingHP <= EXECUTE_THRESHOLD_HP && !hasDeathWard(current)) {
          ctx.log(`Perfect Execution : achève ${current.cardId} (${remainingHP} HP restants)`, {
            characterInstanceId: current.instanceId,
          });
          await ctx.koCharacter(current.instanceId);
        }
      },
    },
  ],
  abilities: [
    {
      id: 'shroud',
      name: 'Shroud',
      kind: 'active',
      description: `Akali lance son nuage de fumée, lui accordant esquive pendant ${SHROUD_DURATION_TURNS} tours.`,
      async execute(ctx) {
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: 'evasive',
          label: 'Shroud',
          sourcePlayerId: ctx.ownerId,
          sourceCardInstanceId: ctx.sourceInstanceId,
          remainingTurns: SHROUD_DURATION_TURNS,
        });
      },
    },
    {
      id: 'perfect-execution',
      name: 'Perfect Execution',
      kind: 'passive',
      description: `Si après une attaque de Akali, l'ennemi touché est à ${EXECUTE_THRESHOLD_HP}HP ou moins, il meurt immédiatement.`,
      // Purement descriptive : la logique vit dans l'AttackDef de Kunaï ci-dessus,
      // pas via un trigger d'event -- afterDamage ne dit pas qui a infligé les
      // dégâts, donc impossible de savoir depuis un trigger séparé si c'est bien
      // Akali qui vient de frapper (même limite que "on kill" documentée dans CLAUDE.md).
      async execute() {},
    },
  ],
};
