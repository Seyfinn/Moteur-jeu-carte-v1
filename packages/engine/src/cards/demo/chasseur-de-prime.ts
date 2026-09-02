import type { ObjectCardDef } from '../types.js';
import { canTargetBench, getMaxAttachedObjects } from '../../queries.js';

const KILLS_REQUIRED = 2;
const REWARD_ATK = 40;
const REWARD_SHIELD = 50;

export const chasseurDePrime: ObjectCardDef = {
  type: 'object',
  id: 'chasseur-de-prime',
  name: 'Chasseur De Prime',
  equipment: true,
  description:
    " Le porteur doit mettre KO deux personnages adverses s'il réussis le porteur gagne définitivement +40 ATK et 50 de Shield. ",
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
      prompt: 'Chasseur de prime : choisissez le personnage à équiper',
      options: candidates.map((c) => c.instanceId),
      min: 1,
      max: 1,
    });
    if (!targetId) return;

    ctx.attachSelfTo(targetId);
    // Contrat résolu par le moteur, à chaque KO attribué au porteur (un objet ne peut
    // réagir à aucun event de lui-même -- cf. CLAUDE.md et zones.ts::resolveBountyVow).
    ctx.applyStatus(targetId, {
      statusId: 'bounty-vow',
      label: `Chasseur de prime (0/${KILLS_REQUIRED})`,
      sourceCardInstanceId: ctx.sourceInstanceId,
      data: {
        count: 0,
        threshold: KILLS_REQUIRED,
        bonusATK: REWARD_ATK,
        bonusShield: REWARD_SHIELD,
        objectInstanceId: ctx.sourceInstanceId,
      },
    });
  },
};
