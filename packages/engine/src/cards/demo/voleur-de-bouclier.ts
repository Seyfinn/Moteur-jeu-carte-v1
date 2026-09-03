import type { ObjectCardDef } from '../types.js';

export const voleurDeBouclier: ObjectCardDef = {
  type: 'object',
  id: 'voleur-de-bouclier',
  name: 'Voleur de bouclier',
  description: "Vole le shield ennemi, lui retirant totalement son shield et se l'applique à soit même.",
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
