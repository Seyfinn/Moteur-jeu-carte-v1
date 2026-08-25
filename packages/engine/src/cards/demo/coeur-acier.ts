import type { CharacterInstance } from '../../types.js';
import type { EffectContext, TerrainCardDef } from '../types.js';
import { cardName } from '../../names.js';

const DURATION_TURNS = 6;
const BONUS_MAX_HP = 150;

/**
 * Statut « marque posée, pas encore chargée ». Il n'a aucune mécanique propre : il existe
 * pour que la cible VOIE la marque arriver sur elle, un tour avant qu'elle ne devienne
 * dangereuse. La charge, elle, est le statut générique `hit-bounty` (que le pipeline de
 * dégâts du moteur encaisse et consomme tout seul).
 */
const MARK_STATUS_ID = 'coeur-acier-mark';

/** Efface toute trace de la marque sur un personnage, chargée ou non. */
function clearMark(ctx: EffectContext, characterInstanceId: string): void {
  ctx.removeStatus(characterInstanceId, MARK_STATUS_ID);
  ctx.removeStatus(characterInstanceId, 'hit-bounty');
}

function hasBounty(ctx: EffectContext, characterInstanceId: string): boolean {
  return ctx.getCharacter(characterInstanceId).statuses.some((status) => status.statusId === 'hit-bounty');
}

/** Repart d'une marque neuve sur `target` : visible, mais pas encore chargée. */
function markFresh(ctx: EffectContext, target: CharacterInstance, message: string): void {
  const terrain = ctx.getTerrain(ctx.sourceInstanceId);
  terrain.data = { markedInstanceId: target.instanceId, charged: false };
  ctx.applyStatus(
    target.instanceId,
    {
      statusId: MARK_STATUS_ID,
      label: 'Coeur Acier (marque)',
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
    },
    { skipEvasionRoll: true }
  );
  ctx.log(message, { terrainInstanceId: terrain.instanceId, markedInstanceId: target.instanceId });
}

/**
 * Marque/charge l'actif adverse du moment. Appelé à la pose et à chaque tour suivant du
 * poseur (voir les deux abilities ci-dessous, même structure que Protection Divine).
 */
function updateMark(ctx: EffectContext): void {
  const terrain = ctx.getTerrain(ctx.sourceInstanceId);
  const opponentActive = ctx.getActive(ctx.opponentId);
  const marked = terrain.data?.['markedInstanceId'] as string | undefined;
  const charged = terrain.data?.['charged'] === true;

  // L'adversaire a switché (ou son actif est mort) : la marque posée sur l'ancien n'a
  // plus lieu d'être, elle repart de zéro sur le nouveau.
  if (marked && marked !== opponentActive?.instanceId) clearMark(ctx, marked);

  if (!opponentActive) {
    terrain.data = { markedInstanceId: undefined, charged: false };
    return;
  }

  const name = cardName(opponentActive.cardId);

  if (marked === opponentActive.instanceId) {
    if (!charged) {
      terrain.data = { ...terrain.data, charged: true };
      ctx.removeStatus(opponentActive.instanceId, MARK_STATUS_ID);
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
      ctx.log(`Coeur Acier : la marque sur ${name} est chargée`, {
        terrainInstanceId: terrain.instanceId,
        markedInstanceId: opponentActive.instanceId,
      });
      return;
    }

    // Marque chargée dont le `hit-bounty` a disparu = la prime a été encaissée. La carte
    // dit « puis la marque se réinitialise » : on repose une marque neuve, qui devra
    // attendre un tour de plus pour se recharger. Sans ce retour à zéro, le terrain
    // rechargeait la même cible à chaque tour et repayait la prime autant de fois.
    if (!hasBounty(ctx, opponentActive.instanceId)) {
      markFresh(ctx, opponentActive, `Coeur Acier : la marque sur ${name} se réinitialise`);
    }
    // Chargée et pas encore encaissée : rien à faire, elle attend son attaque.
    return;
  }

  markFresh(ctx, opponentActive, `Coeur Acier marque ${name}`);
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
      description: "Marque immédiatement le personnage actif adverse à la pose.",
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
        if (marked) clearMark(ctx, marked);
      },
    },
  ],
};
