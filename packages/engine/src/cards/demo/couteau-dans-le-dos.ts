import type { ObjectCardDef } from '../types.js';

const BUFF_DURATION_TURNS = 2; // couvre le reste du tour en cours + tout le prochain tour du joueur
const DAMAGE_MULTIPLIER = 2;

export const couteauDansLeDos: ObjectCardDef = {
  type: 'object',
  id: 'couteau-dans-le-dos',
  name: 'Couteau dans le dos',
  description:
    "Exemplaire unique. Dès maintenant et jusqu'à la fin de votre prochain tour, les dégâts infligés au banc ennemi sont doublés.",
  maxCopies: 1,
  async execute(ctx) {
    for (const char of ctx.getAllOnBoard(ctx.ownerId)) {
      ctx.applyStatus(char.instanceId, {
        // Statut générique du moteur ('bench-damage-bonus', cf types.ts) : le pipeline de
        // dégâts applique le multiplicateur à TOUTE source (personnage, terrain, objet) --
        // il lit ce statut sur n'importe lequel des personnages du camp, pas seulement
        // l'attaquant du coup en cours. La carte ne fait que le poser.
        statusId: 'bench-damage-bonus',
        label: 'Couteau dans le dos',
        sourcePlayerId: ctx.ownerId,
        sourceCardInstanceId: ctx.sourceInstanceId,
        remainingTurns: BUFF_DURATION_TURNS,
        // This lands on all six of your characters at once, five of them benched --
        // where durations are normally suspended. Without this the buff was permanent
        // for everyone who never took the active slot.
        ticksOnBench: true,
        data: { multiplier: DAMAGE_MULTIPLIER },
      });
    }
  },
};
