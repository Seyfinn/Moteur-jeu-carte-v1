import type { CharacterCardDef } from '../types.js';
import { simpleAttack } from './shared.js';
import { getCharacterCard } from '../registry.js';

export const metamorphe: CharacterCardDef = {
  type: 'character',
  id: 'metamorphe',
  name: 'Métamorphe',
  baseMaxHP: 60,
  attacks: [simpleAttack('gel-gluant', 'Gel gluant', 10, "Attaque simple : inflige 10 dégâts à l'actif adverse.")],
  abilities: [
    {
      id: 'metamorphose',
      name: 'Métamorphose',
      kind: 'active',
      description:
        "Se transforme définitivement en une copie de la carte du personnage actif ennemi (mêmes attaques/capacités pour le reste de la partie). Les dégâts déjà subis et les statuts en cours sont conservés ; seul le plafond de HP change pour correspondre à la carte copiée (Valeur Lock s'il est plus bas, relevé s'il est plus haut). Utilisable une seule fois.",
      usesPerGame: 1,
      async execute(ctx) {
        const enemyActive = ctx.getActive(ctx.opponentId);
        if (!enemyActive) return;
        const targetCardId = enemyActive.cardId;
        const targetDef = getCharacterCard(targetCardId);

        const self = ctx.getCharacter(ctx.sourceInstanceId);
        self.cardId = targetCardId;

        const delta = targetDef.baseMaxHP - self.currentMaxHP;
        if (delta > 0) {
          ctx.raiseMaxHP(ctx.sourceInstanceId, delta);
        } else if (delta < 0) {
          await ctx.applyValeurLock(ctx.sourceInstanceId, -delta);
        }

        ctx.log(`Métamorphose : se transforme en ${targetDef.name}`, {
          characterInstanceId: ctx.sourceInstanceId,
          newCardId: targetCardId,
        });
      },
    },
  ],
};
