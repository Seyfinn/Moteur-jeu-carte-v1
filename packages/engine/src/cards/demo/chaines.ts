import type { ObjectCardDef } from '../types.js';

export const chaines: ObjectCardDef = {
  type: 'object',
  id: 'chaines',
  name: 'Chaînes',
  // À lier (maquette) : s'accroche à sa cible -- l'actif ennemi enchaîné (ctx.attachSelfTo
  // ci-dessous), y compris quand ce porteur est de l'autre camp (cf. Miroir de Renvoi). La
  // durée de vie de l'objet suit exactement celle du statut 'chained' : indéfinie, jusqu'à
  // la mort du porteur, où zones.koCharacter envoie l'objet au cimetière de SON propriétaire.
  equipment: true,
  description:
    "Enchaîne le personnage actif ennemi : il ne peut plus être switché TOTALEMENT, jusqu'à sa mort. Un exemplaire.",
  maxCopies: 1,
  async execute(ctx) {
    const target = ctx.getActive(ctx.opponentId);
    if (!target) return;
    ctx.attachSelfTo(target.instanceId);
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
