import type { ObjectCardDef } from '../types.js';
import { getMaxAttachedObjects } from '../../queries.js';

const LOCK_EFFECTIVE_TURNS = 3;
// +1 : statuts bloquants (chained/silence-ultimate) posés sur SOI-MÊME pendant son propre
// tour -- voir CLAUDE.md, "Durées de statuts". 'sacrifice-revive' partage la même durée :
// il doit expirer exactement au moment où le blocage se lève.
const LOCK_REMAINING_TURNS = LOCK_EFFECTIVE_TURNS + 1;

export const absorptionVitale: ObjectCardDef = {
  type: 'object',
  id: 'absorption-vitale',
  name: 'Absorption Vitale',
  // À lier (maquette) : s'accroche au personnage scellé (ctx.attachSelfTo ci-dessous). Le
  // décompte, le KO différé et la résurrection sont entièrement portés par le statut
  // générique 'sacrifice-revive' (statuses.ts) -- un objet ne peut réagir à aucun event
  // (voir CLAUDE.md), donc ce comportement ne pouvait pas vivre dans une AbilityDef comme
  // au temps où Absorption Vitale était un terrain.
  equipment: true,
  description:
    "Pendant 3 tours, empêche votre personnage actif de switch et d'utiliser ses abilities. Si il est encore vivant après les 3 tours, le tue, et vous permet de récupérer un personnage dans votre cimetière, le ramenant sur votre banc avec la moitié de ses hp. Si votre personnage actif meurt avant la fin des 3 tours, cette carte va au cimetière sans faire effet.",
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
    // 'chained' bloque tout switch (standard ou forcé) : plus besoin de suivre l'actif
    // "du moment" comme au temps du terrain -- le porteur ne peut plus quitter le poste.
    ctx.applyStatus(active.instanceId, {
      statusId: 'chained',
      label: 'Absorption Vitale',
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      remainingTurns: LOCK_REMAINING_TURNS,
    });
    ctx.applyStatus(active.instanceId, {
      statusId: 'silence-ultimate',
      label: 'Absorption Vitale',
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      remainingTurns: LOCK_REMAINING_TURNS,
    });
    ctx.applyStatus(active.instanceId, {
      statusId: 'sacrifice-revive',
      label: 'Absorption Vitale (scellé)',
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      remainingTurns: LOCK_REMAINING_TURNS,
    });
  },
};
