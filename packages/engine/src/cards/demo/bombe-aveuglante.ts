import type { ObjectCardDef } from '../types.js';
import { listCards } from '../registry.js';
import { randomInt } from '../../rng.js';

const DISARM_EFFECTIVE_TURNS = 1;
/** Posé sur l'ennemi pendant NOTRE tour : doit survivre au tick qui ouvre son tour suivant. */
const DISARM_REMAINING_TURNS = DISARM_EFFECTIVE_TURNS + 1;
const SELF_DAMAGE = 40;

export const bombeAveuglante: ObjectCardDef = {
  type: 'object',
  id: 'bombe-aveuglante',
  name: 'Bombe aveuglante',
  description:
    "Empêche le personnage actif adverse d'attaquer (Désarmé) pendant 1 tour. En contrepartie, " +
    "l'adversaire obtient 1 carte Objet aléatoire dans sa main, et votre personnage  sur le poste actif subit 40 dégâts.",
  async execute(ctx) {
    const enemyActive = ctx.getActive(ctx.opponentId);
    if (enemyActive) {
      ctx.applyStatus(enemyActive.instanceId, {
        statusId: 'disarmed',
        label: 'Bombe aveuglante',
        sourcePlayerId: ctx.ownerId,
        sourceCardInstanceId: ctx.sourceInstanceId,
        remainingTurns: DISARM_REMAINING_TURNS,
      });
    }

    // « 1 carte Objet aléatoire » : tout le registre, comme le reroll d'Isaac D6 -- pas
    // seulement les objets du deck construit ou de la réserve du mode en cours.
    const pool = listCards()
      .filter((card) => card.type === 'object')
      .map((card) => card.id);
    if (pool.length > 0) {
      const randomCardId = pool[randomInt(ctx.state.rng, pool.length)]!;
      ctx.createObject(randomCardId, ctx.opponentId);
    }

    const ownActive = ctx.getActive(ctx.ownerId);
    if (ownActive) {
      // Coût auto-infligé (« en contrepartie ») : ignore bouclier et réduction de dégâts,
      // même traitement qu'Adrénaline Ultime / le Contrat de Mort de Gon Adulte.
      await ctx.dealDamage(ownActive.instanceId, SELF_DAMAGE, { ignoreShield: true, ignoreDamageReduction: true });
    }
  },
};
