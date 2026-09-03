import type { CharacterCardDef } from '../types.js';
import { simpleAttack } from './shared.js';
import { findCharacter } from '../../queries.js';

const BASE_HP = 400;
const HACHE_VOLANTE_ATK = 25;
const HP_CHUNK = 100;
const ATK_BONUS_PER_CHUNK = 10;

export const mundo: CharacterCardDef = {
  type: 'character',
  id: 'mundo',
  name: 'Mundo',
  baseMaxHP: BASE_HP,
  attacks: [
    simpleAttack('hache-volante', 'Hache Volante', HACHE_VOLANTE_ATK, ''),
  ],
  abilities: [
    {
      id: 'surcroissance',
      name: 'Surcroissance',
      kind: 'passive',
      description: "Son attaque gagne 10 de dégâts supplémentaire tout les 100hp max qu'il a en plus de ses 400hp max de base.",
      // Purement descriptive : le bonus est calculé en continu par le modifier getEffectiveATK
      // ci-dessous à partir de currentMaxHP/baseMaxHP, pas de statut/compteur à maintenir.
      async execute() {},
    },
    {
      id: 'eveil',
      name: 'Eveil',
      kind: 'active',
      description:
        `Mundo gagne l'équivalent de ses hp manquant en hp max. 
Ensuite, il régénère instantanément la moitié de ses hp max.
Utilisable une fois.`,
      usesPerGame: 1,
      async execute(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const missing = self.damage;
        // raiseMaxHP monte le plafond ET les PV actuels d'autant : l'écart au plafond ne bouge
        // pas, Mundo est donc toujours à `missing` de dégâts après coup. Soigner ce reliquat
        // (relu APRÈS la montée du plafond) le remet à fond sur le nouveau maximum.
        ctx.raiseMaxHP(self.instanceId, missing);
        ctx.heal(self.instanceId, ctx.getCharacter(self.instanceId).damage);
      },
    },
  ],
  modifiers: [
    {
      query: 'getEffectiveATK',
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        const char = findCharacter(ctx.state, ctx.sourceInstanceId);
        const bonusChunks = Math.floor(Math.max(0, char.currentMaxHP - char.baseMaxHP) / HP_CHUNK);
        return (current as number) + bonusChunks * ATK_BONUS_PER_CHUNK;
      },
    },
  ],
};
