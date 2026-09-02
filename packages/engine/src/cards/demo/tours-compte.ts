import type { ObjectCardDef } from '../types.js';
import { canTargetBench, getMaxAttachedObjects } from '../../queries.js';

const VOW_TICKS = 3;
const VOW_DAMAGE_PERCENT = 10;
const VOW_REWARD_MAX_HP_REDUCTION = 150;
const VOW_REWARD_HEAL = 50;

export const toursCompte: ObjectCardDef = {
  type: 'object',
  id: 'tours-compte',
  name: 'Tours compté',
  equipment: true,
  description:
    'Le porteur doit survivre pendant 3 tours de combat au poste actif.\n' +
    'A la fin de chacun de ces 3 tours tours, le porteur subit 10% HP Max \n' +
    'Récompense :  inflige une réduction définitive de -150 PV Max au personnage actif adverse et récupère les 50 HP.',
  unplayableReason(state, ownerId) {
    const player = state.players[ownerId];
    const ids = [player.activeCharacterInstanceId, ...player.benchCharacterInstanceIds].filter(
      (id): id is string => id !== null
    );
    const hasRoom = ids.some((id) => {
      const char = player.characters[id];
      return !!char && char.attachedObjectInstanceIds.length < getMaxAttachedObjects(state, id);
    });
    if (!hasRoom) return 'Aucun de vos personnages ne peut porter un objet de plus.';
    return null;
  },
  async execute(ctx) {
    const activeAlly = ctx.getActive(ctx.ownerId);
    const candidates = ctx
      .getAllOnBoard(ctx.ownerId)
      .filter((c) => c.attachedObjectInstanceIds.length < getMaxAttachedObjects(ctx.state, c.instanceId))
      // Un banc isolé (Arène) n'est plus équipable, même par son propre camp.
      .filter(
        (c) =>
          c.instanceId === activeAlly?.instanceId ||
          canTargetBench(ctx.state, ctx.sourceInstanceId, c.instanceId, true).allow
      );
    if (candidates.length === 0) return;

    const [targetId] = await ctx.choose({
      kind: 'select-characters',
      prompt: 'Tours compté : choisissez le personnage à équiper',
      options: candidates.map((c) => c.instanceId),
      min: 1,
      max: 1,
    });
    if (!targetId) return;

    ctx.attachSelfTo(targetId);
    // Compte à rebours résolu par le moteur, à la fin de chaque tour du porteur (un objet
    // ne peut réagir à aucun event de lui-même -- cf. CLAUDE.md et turn.ts::resolveSurvivalVow).
    ctx.applyStatus(targetId, {
      statusId: 'survival-vow',
      label: 'Tours compté',
      sourceCardInstanceId: ctx.sourceInstanceId,
      data: {
        ticksRemaining: VOW_TICKS,
        damagePercent: VOW_DAMAGE_PERCENT,
        rewardMaxHPReduction: VOW_REWARD_MAX_HP_REDUCTION,
        rewardHeal: VOW_REWARD_HEAL,
        objectInstanceId: ctx.sourceInstanceId,
      },
    });
  },
};
