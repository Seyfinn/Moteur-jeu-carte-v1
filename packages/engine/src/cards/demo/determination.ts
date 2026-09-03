import type { ObjectCardDef } from '../types.js';
import { getMaxAttachedObjects } from '../../queries.js';

const WARD_DURATION_TURNS = 1;

export const determination: ObjectCardDef = {
  type: 'object',
  id: 'determination',
  name: 'Détermination',
  // À lier (maquette) : s'accroche au personnage actif (ctx.attachSelfTo ci-dessous). Le
  // statut 'death-ward' porte data.objectInstanceId, donc statuses.ts détruit l'objet tout
  // seul dès que la protection expire naturellement -- rien ne reste accroché pour rien une
  // fois le tour terminé (même convention qu'Attaque cloné / Potion force).
  equipment: true,
  description:
    'Empêche le personnage actif de mourir pendant 1 tour, si il subit des dégâts, ne peut pas descendre en dessous de 1hp.',
  maxCopies: 1,
  unplayableReason(state, ownerId) {
    const player = state.players[ownerId];
    const activeId = player.activeCharacterInstanceId;
    if (!activeId) return "Vous n'avez pas de personnage actif.";
    const active = player.characters[activeId];
    if (active && active.attachedObjectInstanceIds.length >= getMaxAttachedObjects(state, activeId)) {
      return 'Votre personnage actif ne peut pas porter un objet de plus.';
    }
    return null;
  },
  async execute(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    if (!active) return;
    ctx.attachSelfTo(active.instanceId);
    ctx.applyStatus(active.instanceId, {
      statusId: 'death-ward',
      label: 'Détermination',
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      remainingTurns: WARD_DURATION_TURNS,
      // Turn-scoped: benching the bearer must not freeze the ward indefinitely.
      ticksOnBench: true,
      data: { objectInstanceId: ctx.sourceInstanceId },
    });
  },
};
