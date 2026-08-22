import type { ObjectCardDef } from '../types.js';

export const voleurDeBouclier: ObjectCardDef = {
  type: 'object',
  id: 'voleur-de-bouclier',
  name: 'Voleur de bouclier',
  description: "Retire tout le shield du personnage actif ennemi et l'applique à votre personnage actif (s'ajoute à son shield existant, le cas échéant).",
  async execute(ctx) {
    const enemyActive = ctx.getActive(ctx.opponentId);
    if (!enemyActive || enemyActive.shield <= 0) return;
    const ownActive = ctx.getActive(ctx.ownerId);
    if (!ownActive) return;

    const stolen = enemyActive.shield;
    ctx.removeShield(enemyActive.instanceId);
    ctx.addShield(ownActive.instanceId, stolen);
  },
};
