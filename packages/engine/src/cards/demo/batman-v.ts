import type { CharacterCardDef } from '../types.js';
import { simpleAttack } from './shared.js';

export const batmanV: CharacterCardDef = {
  type: 'character',
  id: 'batman-v',
  name: 'Batman V',
  baseMaxHP: 210,
  abilities: [
    {
      id: 'absolute',
      name: 'Absolute',
      kind: 'passive',
      trigger: 'onCharacterKO',
      usableFromBench: true,
      description: 'À la KO de cette carte : clone une carte du banc à 1 HP et inflige 80 à la carte active adverse.',
      condition(ctx) {
        return ctx.event?.data?.['characterInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        const bench = ctx.getBench(ctx.ownerId);
        if (bench.length > 0) {
          const [pick] = await ctx.choose({
            kind: 'select-characters',
            prompt: 'Absolute : choisissez la carte du banc à cloner (1 HP)',
            options: bench.map((c) => c.instanceId),
            min: 1,
            max: 1,
          });
          if (pick) ctx.cloneCharacter(pick, 1, 'active');
        }
        const enemyActive = ctx.getActive(ctx.opponentId);
        if (enemyActive) await ctx.dealDamage(enemyActive.instanceId, 80);
      },
    },
  ],
  attacks: [simpleAttack('hachage', 'Hachage', 90, 'Inflige 90 dégâts au personnage actif adverse.')],
};
