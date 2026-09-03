import type { CharacterCardDef } from '../types.js';
import { simpleAttack } from './shared.js';
import { getCharacterCard } from '../registry.js';

export const metamorphe: CharacterCardDef = {
  type: 'character',
  id: 'metamorphe',
  name: 'Métamorphe',
  baseMaxHP: 60,
  attacks: [simpleAttack('gel-gluant', 'Gel gluant', 10, '')],
  abilities: [
    {
      id: 'metamorphose',
      name: 'Métamorphose',
      kind: 'active',
      description:
        'Se transforme en la carte personnage actif ennemi',
      usesPerGame: 1,
      async execute(ctx) {
        const enemyActive = ctx.getActive(ctx.opponentId);
        if (!enemyActive) return;
        const targetCardId = enemyActive.cardId;
        const targetDef = getCharacterCard(targetCardId);

        const self = ctx.getCharacter(ctx.sourceInstanceId);
        self.cardId = targetCardId;
        // baseMaxHP suit la carte copiée : plusieurs cartes calculent un bonus à partir
        // de l'écart currentMaxHP - baseMaxHP (Surcroissance de Mundo par exemple).
        // Le laisser sur les 60 HP du Métamorphe offrirait un bonus fantôme énorme.
        const previousBaseMaxHP = self.baseMaxHP;
        self.baseMaxHP = targetDef.baseMaxHP;

        const delta = targetDef.baseMaxHP - self.currentMaxHP;
        if (delta > 0) {
          ctx.raiseMaxHP(ctx.sourceInstanceId, delta);
        } else if (delta < 0) {
          await ctx.applyValeurLock(ctx.sourceInstanceId, -delta);
        }

        ctx.log(`Métamorphose : se transforme en ${targetDef.name}`, {
          characterInstanceId: ctx.sourceInstanceId,
          newCardId: targetCardId,
          previousBaseMaxHP,
        });
      },
    },
  ],
};
