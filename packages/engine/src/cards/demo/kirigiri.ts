import type { CharacterCardDef } from '../types.js';
import { simpleAttack } from './shared.js';

const DEDUCTION_ATK = 90;

export const kirigiri: CharacterCardDef = {
  type: 'character',
  id: 'kirigiri',
  name: 'Kirigiri',
  baseMaxHP: 300,
  attacks: [
    simpleAttack('deduction-froide', 'Déduction Froide', DEDUCTION_ATK, ''),
  ],
  abilities: [
    {
      id: 'ultimate-detective',
      name: 'Ultimate Détective',
      kind: 'active',
      description:
        "Permet de voir toute les cartes objets et terrains de l'adversaire",
      usesPerGame: 1,
      async execute(ctx) {
        ctx.state.players[ctx.ownerId].revealsOpponentUnplayedCards = true;
        ctx.log("Ultimate Détective : les cartes non jouées de l'adversaire sont révélées", {
          characterInstanceId: ctx.sourceInstanceId,
        });
      },
    },
  ],
};
