import type { EffectContext, TerrainCardDef } from '../types.js';
import { cardName } from '../../names.js';

const DURATION_TURNS = 6;
const BONUS_MAX_HP = 150;

/**
 * Marque/charge l'actif adverse du moment. Appelé à la pose et à chaque tour suivant du
 * poseur (voir les deux abilities ci-dessous, même structure que Protection Divine).
 */
function updateMark(ctx: EffectContext): void {
  const terrain = ctx.getTerrain(ctx.sourceInstanceId);
  const opponentActive = ctx.getActive(ctx.opponentId);
  const previouslyMarked = terrain.data?.['markedInstanceId'] as string | undefined;

  // La charge est matérialisée par le statut générique 'hit-bounty' posé sur la cible :
  // c'est le pipeline de dégâts du moteur qui l'encaisse et le consomme (voir types.ts).
  // Tant qu'elle n'est pas chargée, la marque n'est qu'une donnée du terrain.
  if (previouslyMarked && previouslyMarked !== opponentActive?.instanceId) {
    ctx.removeStatus(previouslyMarked, 'hit-bounty');
  }

  if (previouslyMarked && opponentActive && previouslyMarked === opponentActive.instanceId) {
    terrain.data = { ...terrain.data, charged: true };
    ctx.applyStatus(
      opponentActive.instanceId,
      {
        statusId: 'hit-bounty',
        label: 'Coeur Acier (marque chargée)',
        sourcePlayerId: ctx.ownerId,
        sourceCardInstanceId: ctx.sourceInstanceId,
        data: { bonusMaxHP: BONUS_MAX_HP, forOwnerId: ctx.ownerId },
      },
      { skipEvasionRoll: true }
    );
    ctx.log(`Coeur Acier : la marque sur ${cardName(opponentActive.cardId)} est chargée`, {
      terrainInstanceId: terrain.instanceId,
      markedInstanceId: opponentActive.instanceId,
    });
    return;
  }

  terrain.data = { markedInstanceId: opponentActive?.instanceId, charged: false };
  if (opponentActive) {
    ctx.log(`Coeur Acier marque ${cardName(opponentActive.cardId)}`, {
      terrainInstanceId: terrain.instanceId,
      markedInstanceId: opponentActive.instanceId,
    });
  }
}

export const coeurAcier: TerrainCardDef = {
  type: 'terrain',
  id: 'coeur-acier',
  name: 'Coeur acier',
  description:
    "Marque l'actif adverse. Si c'est toujours le même à votre tour suivant, la marque se charge : la première " +
    `attaque qui le touche alors rapporte ${BONUS_MAX_HP} HP max à son attaquant (pas de soin), puis la marque se ` +
    "réinitialise. Si l'adversaire a switché entre-temps, la marque passe simplement sur le nouvel actif.",
  durationTurns: DURATION_TURNS,
  abilities: [
    {
      id: 'coeur-acier-onplay',
      name: 'Coeur acier',
      kind: 'passive',
      description: "Marque immédiatement le personnage actif adverse à la pose (1ère des activations).",
      trigger: 'onTerrainPlayed',
      // Only for THIS terrain's own arrival. Without the guard, the event emitted when
      // *any* terrain hits the table (including the opponent's) re-fired this on-play
      // effect for every terrain already in play.
      condition(ctx) {
        return ctx.event?.data['terrainInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        updateMark(ctx);
      },
    },
    {
      id: 'coeur-acier-tick',
      name: 'Coeur acier',
      kind: 'passive',
      description:
        'Vérifie/renouvelle la marque au début de chacun des tours suivants du poseur, tant que le terrain ' +
        'reste en jeu.',
      trigger: 'onTurnStart',
      condition(ctx) {
        if (ctx.event?.playerId !== ctx.ownerId) return false;
        // Même logique que Protection Divine : s'appuie sur remainingTurns plutôt qu'un
        // compteur dédié, pour rester correct si la durée est prolongée/raccourcie.
        const remaining = ctx.getTerrain(ctx.sourceInstanceId).remainingTurns;
        return remaining !== undefined && remaining > 1;
      },
      async execute(ctx) {
        updateMark(ctx);
      },
    },
    {
      id: 'coeur-acier-cleanup',
      name: 'Coeur acier',
      kind: 'passive',
      description: 'Retire la marque chargée quand le terrain quitte le jeu (expiration, remplacement ou destruction).',
      trigger: 'onTerrainRemoved',
      condition(ctx) {
        return ctx.event?.data['terrainInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        const marked = ctx.getTerrain(ctx.sourceInstanceId).data?.['markedInstanceId'] as string | undefined;
        if (marked) ctx.removeStatus(marked, 'hit-bounty');
      },
    },
  ],
};
