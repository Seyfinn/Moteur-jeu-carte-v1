import type { CharacterCardDef } from '../types.js';
import { simpleAttack } from './shared.js';

export const kashimoV: CharacterCardDef = {
  type: 'character',
  id: 'kashimo-v',
  name: 'Kashimo V',
  baseMaxHP: 100,
  abilities: [
    {
      id: 'god-of-thunder',
      name: 'God of Thunder',
      kind: 'passive',
      trigger: 'onTurnStart',
      usableFromBench: true,
      description: "Chaque tour adverse : lance une pièce. \"Face\" = esquive la prochaine attaque ciblant cette carte.",
      condition(ctx) {
        return ctx.event?.playerId === ctx.opponentId;
      },
      async execute(ctx) {
        if (ctx.flipCoin() === 'heads') {
          ctx.applyStatus(ctx.sourceInstanceId, { statusId: 'evasive', label: 'Évasif (God of Thunder)' });
          ctx.log('Kashimo devient évasif ce tour-ci');
        }
      },
    },
  ],
  attacks: [simpleAttack('funerailles', 'Funérailles', 120, 'Inflige 120 dégâts au personnage actif adverse.')],
};
