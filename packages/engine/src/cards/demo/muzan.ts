import type { CharacterCardDef } from '../types.js';
import { findCharacter } from '../../queries.js';

const BLACK_BLOOD_ATK = 40;
// Poison/burn tiquent sans condition sur remainingTurns (le tic a lieu tant que le
// statut est présent, PUIS remainingTurns décrémente -- voir tickStatusesAtTurnStart,
// statuses.ts). Contrairement au Stun/Désarmé (statuts "bloquants" vérifiés via un
// gate avant que le joueur agisse), remainingTurns correspond donc directement au
// nombre de tics voulu, sans le +1 de correction utilisé pour Stun/Désarmé/Silence.
const POISON_REMAINING_TURNS = 1;

export const muzan: CharacterCardDef = {
  type: 'character',
  id: 'muzan',
  name: 'Muzan',
  baseMaxHP: 270,
  attacks: [
    {
      id: 'black-blood',
      name: 'Black Blood',
      baseATK: BLACK_BLOOD_ATK,
      description: `Inflige ${BLACK_BLOOD_ATK} dégâts à l'actif adverse et applique Poison pendant ${POISON_REMAINING_TURNS} tour.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, BLACK_BLOOD_ATK);
        await ctx.dealDamage(target.instanceId, atk);
        ctx.applyStatus(target.instanceId, {
          statusId: 'poison',
          label: 'Poison (Black Blood)',
          sourcePlayerId: ctx.ownerId,
          sourceCardInstanceId: ctx.sourceInstanceId,
          remainingTurns: POISON_REMAINING_TURNS,
        });
      },
    },
  ],
  abilities: [
    {
      id: 'sang-maudit',
      name: 'Sang Maudit',
      kind: 'passive',
      description:
        "Tant que Muzan est actif, le poison des personnages adverses (quelle qu'en soit la source) ronge leurs HP max au lieu d'infliger des dégâts soignables. Redevient du poison normal dès que Muzan quitte le poste actif.",
      // Purement descriptif : la logique vit dans le modifier 'poisonTicksAsValeurLock'
      // ci-dessous, consulté directement par tickStatusesAtTurnStart (statuses.ts) à
      // chaque tic de poison -- il n'y a pas d'event dédié à écouter ici.
      async execute() {},
    },
  ],
  modifiers: [
    {
      query: 'poisonTicksAsValeurLock',
      isActive(ctx) {
        return ctx.state.players[ctx.sourceOwnerId].activeCharacterInstanceId === ctx.sourceInstanceId;
      },
      vote(ctx) {
        const targetInstanceId = ctx.query['targetInstanceId'] as string;
        const target = findCharacter(ctx.state, targetInstanceId);
        if (target.ownerId === ctx.sourceOwnerId) return undefined; // n'affecte jamais son propre camp
        return { allow: true, source: 'muzan:sang-maudit' };
      },
    },
  ],
};
