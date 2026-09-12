import type { ObjectCardDef } from '../types.js';

export const voleurDeBouclier: ObjectCardDef = {
  type: 'object',
  id: 'voleur-de-bouclier',
  name: 'Voleur de bouclier',
  description: "Vole le shield ennemi, lui retirant totalement son shield et se l'applique à soi-même.",
  // Refusée avant d'être consommée quand il n'y a rien à voler (cf. CLAUDE.md) : sans
  // bouclier en face, la carte partait au cimetière sans effet.
  unplayableReason(state, ownerId) {
    const opponentId = ownerId === 'p1' ? 'p2' : 'p1';
    const enemyActiveId = state.players[opponentId].activeCharacterInstanceId;
    const enemyActive = enemyActiveId ? state.players[opponentId].characters[enemyActiveId] : undefined;
    if (!enemyActive || enemyActive.shield <= 0) return "l'actif adverse n'a pas de bouclier";
    if (!state.players[ownerId].activeCharacterInstanceId) return "vous n'avez pas de personnage actif";
    return null;
  },
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
