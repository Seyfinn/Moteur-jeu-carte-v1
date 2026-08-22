import type { ObjectCardDef } from '../types.js';

const BUFF_DURATION_TURNS = 2; // couvre le reste du tour en cours + tout le prochain tour du joueur

export const couteauDansLeDos: ObjectCardDef = {
  type: 'object',
  id: 'couteau-dans-le-dos',
  name: 'Couteau dans le dos',
  description:
    "Exemplaire unique. Dès maintenant et jusqu'à la fin de votre prochain tour, les dégâts infligés au banc ennemi par n'importe lequel de vos personnages (attaque ou capacité) sont doublés.",
  maxCopies: 1,
  async execute(ctx) {
    for (const char of ctx.getAllOnBoard(ctx.ownerId)) {
      ctx.applyStatus(char.instanceId, {
        statusId: 'couteau-dans-le-dos',
        label: 'Couteau dans le dos',
        sourcePlayerId: ctx.ownerId,
        sourceCardInstanceId: ctx.sourceInstanceId,
        remainingTurns: BUFF_DURATION_TURNS,
      });
    }
  },
};
