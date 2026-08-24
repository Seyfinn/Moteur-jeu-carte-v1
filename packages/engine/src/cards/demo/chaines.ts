import type { ObjectCardDef } from '../types.js';

export const chaines: ObjectCardDef = {
  type: 'object',
  id: 'chaines',
  name: 'Chaînes',
  description:
    "Enchaîne le personnage actif ennemi : il ne peut plus être switché TOTALEMENT, jusqu'à sa mort. Un exemplaire.",
  maxCopies: 1,
  async execute(ctx) {
    const target = ctx.getActive(ctx.opponentId);
    if (!target) return;
    ctx.applyStatus(target.instanceId, {
      statusId: 'chained',
      label: 'Enchaîné',
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      // Pas de remainingTurns : dure indéfiniment jusqu'à la mort du personnage.
      // Le blocage lui-même est générique (statut 'chained') : zones.switchActive
      // refuse TOUT départ du poste actif, switch forcé compris.
    });
  },
};
