import type { EffectContext, TerrainCardDef } from '../types.js';

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
    ctx.log(`Coeur Acier : la marque sur ${opponentActive.cardId} est chargée`, {
      terrainInstanceId: terrain.instanceId,
      markedInstanceId: opponentActive.instanceId,
    });
    return;
  }

  terrain.data = { markedInstanceId: opponentActive?.instanceId, charged: false };
  if (opponentActive) {
    ctx.log(`Coeur Acier marque ${opponentActive.cardId}`, {
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
    "Pose une marque sur le personnage actif adverse ; elle prend 1 tour à être chargée. Si le personnage " +
    'actif adverse est toujours le même au tour suivant du poseur, la première attaque qui le touche ' +
    `réellement pendant que la marque est chargée octroie ${BONUS_MAX_HP}HP max (sans soin) au personnage qui ` +
    "l'a attaqué, puis la marque se réinitialise. Sinon (l'adversaire a switché), la marque est réinitialisée " +
    'sur le nouvel actif adverse.',
  durationTurns: DURATION_TURNS,
  abilities: [
    {
      id: 'coeur-acier-onplay',
      name: 'Coeur acier',
      kind: 'passive',
      description: "Marque immédiatement le personnage actif adverse à la pose (1ère des activations).",
      trigger: 'onTerrainPlayed',
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
