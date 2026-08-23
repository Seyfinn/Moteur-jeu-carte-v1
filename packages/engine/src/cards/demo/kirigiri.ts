import type { CharacterCardDef } from '../types.js';
import { simpleAttack } from './shared.js';

const DEDUCTION_ATK = 90;

export const kirigiri: CharacterCardDef = {
  type: 'character',
  id: 'kirigiri',
  name: 'Kirigiri',
  baseMaxHP: 300,
  attacks: [
    simpleAttack('deduction-froide', 'Déduction Froide', DEDUCTION_ATK, `Inflige ${DEDUCTION_ATK} dégâts à l'actif adverse.`),
  ],
  abilities: [
    {
      id: 'ultimate-detective',
      name: 'Ultimate Détective',
      kind: 'active',
      description:
        "Révèle définitivement toutes les cartes objets et terrains non jouées de l'adversaire pour le reste de la partie. Utilisation unique.",
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
