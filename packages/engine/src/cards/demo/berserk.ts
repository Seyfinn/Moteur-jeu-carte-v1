import type { ObjectCardDef } from '../types.js';
import { canTargetBench, getMaxAttachedObjects } from '../../queries.js';

const HP_THRESHOLD = 30;
const REWARD_HEAL_PERCENT = 50;

export const berserk: ObjectCardDef = {
  type: 'object',
  id: 'berserk',
  name: 'Berserk',
  equipment: true,
  description:
    `Le porteur doit descendre sous la barre des 30 HP actuels sans mourir.
Récompense : Il gagne définitivement le passif Buveur de Sang (se soigne de 50 % des dégâts qu'il inflige). En contrepartie, plus aucun soin externe (alliés, objets) n'a d'effet sur lui 
`,
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
      prompt: 'Berserk : choisissez le personnage à équiper',
      options: candidates.map((c) => c.instanceId),
      min: 1,
      max: 1,
    });
    if (!targetId) return;

    ctx.attachSelfTo(targetId);
    // Vœu résolu par le moteur, à chaque dégât/Valeur Lock encaissé par le porteur -- et une
    // fois de plus juste après cette pose, au cas où il serait déjà sous la barre (un objet
    // ne peut réagir à aucun event de lui-même -- cf. CLAUDE.md et zones.ts::resolveBerserkVow).
    ctx.applyStatus(targetId, {
      statusId: 'berserk-vow',
      label: `Berserk (sous ${HP_THRESHOLD} HP)`,
      sourceCardInstanceId: ctx.sourceInstanceId,
      data: {
        hpThreshold: HP_THRESHOLD,
        healPercent: REWARD_HEAL_PERCENT,
        objectInstanceId: ctx.sourceInstanceId,
      },
    });
  },
};
