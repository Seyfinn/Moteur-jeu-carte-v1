import type { ObjectCardDef } from '../types.js';
import { canTargetBench, getMaxAttachedObjects } from '../../queries.js';

const CHARGES = 3;
const BONUS_MAX_HP = 35;

export const coeurAcier: ObjectCardDef = {
  type: 'object',
  id: 'coeur-acier',
  name: 'Coeur acier',
  equipment: true,
  maxCopies: 1,
  description: 'Vos 3 prochaines attaques augmente vos hp max de 35 et vous rend 35hp.',
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
      prompt: 'Coeur acier : choisissez le personnage à équiper',
      options: candidates.map((c) => c.instanceId),
      min: 1,
      max: 1,
    });
    if (!targetId) return;

    ctx.attachSelfTo(targetId);
    // Statut générique moteur (voir match.ts::consumeAttackCharges) : consommé une charge
    // par attaque DÉCLARÉE par le porteur, touche ou non -- pas par ctx.dealDamage, pour
    // ne pas compter plusieurs fois une même attaque qui frappe plusieurs cibles (AoE).
    ctx.applyStatus(targetId, {
      statusId: 'attack-charges',
      label: 'Coeur Acier',
      sourceCardInstanceId: ctx.sourceInstanceId,
      data: { remaining: CHARGES, bonusMaxHP: BONUS_MAX_HP, objectInstanceId: ctx.sourceInstanceId },
    });
  },
};
