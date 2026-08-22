import type { ObjectCardDef } from '../types.js';
import { getObjectCard } from '../registry.js';
import { DECK_LIMITS } from '../../deck.js';

export const cameleon: ObjectCardDef = {
  type: 'object',
  id: 'cameleon',
  name: 'Caméléon',
  description:
    "Choisissez une carte objet de votre réserve non jouée, envoyez-la au cimetière, et remplacez-la par une autre carte objet de votre choix parmi celles de votre deck (impossible si la carte de remplacement a déjà atteint son nombre d'exemplaires maximum autorisé).",
  async execute(ctx) {
    const player = ctx.state.players[ctx.ownerId];
    if (player.unplayedObjectInstanceIds.length === 0) return;

    const removeOptions = player.unplayedObjectInstanceIds.map((id) => ({
      key: id,
      label: getObjectCard(player.objects[id]!.cardId).name,
    }));
    const removedId = await ctx.chooseOption('Caméléon : choisissez la carte objet à remplacer', removeOptions);
    const removedCardId = player.objects[removedId]?.cardId;
    if (!removedCardId) return;

    // Retrait effectif d'abord : les copies restantes de la carte retirée comptent
    // ensuite normalement, comme n'importe quelle autre, pour l'éligibilité ci-dessous.
    const idx = player.unplayedObjectInstanceIds.indexOf(removedId);
    if (idx !== -1) player.unplayedObjectInstanceIds.splice(idx, 1);
    player.graveyardObjectInstanceIds.push(removedId);

    // "Votre deck" = les cartes objet dont vous possédez au moins un exemplaire
    // (peu importe la zone) -- le moteur ne conserve pas de liste de deck séparée.
    const deckCardIds = new Set(Object.values(player.objects).map((o) => o.cardId));

    const replacementOptions: { key: string; label: string }[] = [];
    for (const cardId of deckCardIds) {
      const def = getObjectCard(cardId);
      const maxCopies = def.maxCopies ?? DECK_LIMITS.maxCopiesPerCard;
      const currentCopies = Object.values(player.objects).filter((o) => o.cardId === cardId).length;
      if (currentCopies < maxCopies) {
        replacementOptions.push({ key: cardId, label: def.name });
      }
    }
    if (replacementOptions.length === 0) return; // rien d'éligible -- la retirée reste au cimetière

    const chosenCardId = await ctx.chooseOption('Caméléon : choisissez la carte objet de remplacement', replacementOptions);
    ctx.createObject(chosenCardId);

    ctx.log(`Caméléon : remplace ${removedCardId} par ${chosenCardId}`, { removedCardId, chosenCardId });
  },
};
