import type { ObjectCardDef } from '../types.js';
import { cardName } from '../../names.js';

/**
 * Statuts génériques considérés comme des "altérations négatives" transférables.
 * Volontairement une liste explicite plutôt qu'une exclusion des statuts positifs :
 * beaucoup de cartes utilisent des statusId propres à leur kit pour du bookkeeping
 * interne (bouclier de Blitzcrank, compteurs de Guts/Hulk...) qui ne doivent jamais
 * être déplacés vers un autre personnage.
 */
const NEGATIVE_STATUS_IDS = [
  'stun',
  'disarmed',
  'silence-active',
  'silence-passive',
  'silence-ultimate',
  'atk-reduction',
  'burn',
  'poison',
  'bleed',
  'chained',
];

export const poupeeVoodoo: ObjectCardDef = {
  type: 'object',
  id: 'poupee-voodoo',
  name: 'Poupée Voodoo',
  description:
    "Transfert toutes les altérations négatives de n'importe quel personnage (allié ou ennemi) vers un personnage allié de votre choix, ou le personnage ennemi actif.",
  async execute(ctx) {
    const sourcePool = [...ctx.getAllOnBoard(ctx.ownerId), ...ctx.getAllOnBoard(ctx.opponentId)];
    if (sourcePool.length === 0) return;
    const [sourceId] = await ctx.choose({
      kind: 'select-characters',
      prompt: 'Poupée Voodoo : choisissez le personnage dont on retire les altérations négatives',
      options: sourcePool.map((c) => c.instanceId),
      min: 1,
      max: 1,
    });
    if (!sourceId) return;

    const source = ctx.getCharacter(sourceId);
    const toTransfer = source.statuses.filter((s) => NEGATIVE_STATUS_IDS.includes(s.statusId));
    if (toTransfer.length === 0) {
      ctx.log('Poupée Voodoo : aucune altération négative à transférer', { sourceInstanceId: sourceId });
      return;
    }

    const destinationChoice = await ctx.chooseOption('Poupée Voodoo : transférer les altérations vers...', [
      { key: 'ally', label: 'Un personnage allié' },
      { key: 'enemy-active', label: "L'actif ennemi" },
    ]);

    let destinationId: string | undefined;
    if (destinationChoice === 'enemy-active') {
      destinationId = ctx.getActive(ctx.opponentId)?.instanceId;
    } else {
      const [selected] = await ctx.choose({
        kind: 'select-characters',
        prompt: 'Poupée Voodoo : choisissez le personnage allié qui reçoit les altérations',
        options: ctx.getAllOnBoard(ctx.ownerId).map((c) => c.instanceId),
        min: 1,
        max: 1,
      });
      destinationId = selected;
    }
    if (!destinationId) return;

    const distinctIds = [...new Set(toTransfer.map((s) => s.statusId))];
    for (const statusId of distinctIds) ctx.removeStatus(sourceId, statusId);
    for (const status of toTransfer) {
      ctx.applyStatus(destinationId, { ...status });
    }

    ctx.log(`Poupée Voodoo : transfère ${toTransfer.length} altération(s) de ${cardName(source.cardId)} vers la cible choisie`, {
      sourceInstanceId: sourceId,
      destinationInstanceId: destinationId,
      statusIds: toTransfer.map((s) => s.statusId),
    });
  },
};
