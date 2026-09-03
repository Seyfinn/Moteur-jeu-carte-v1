import type { ObjectCardDef } from '../types.js';
import type { ChoiceOption } from '../../types.js';
import { getObjectCard } from '../registry.js';
import { DECK_LIMITS } from '../../deck.js';

export const cameleon: ObjectCardDef = {
  type: 'object',
  id: 'cameleon',
  name: 'Caméléon',
  description:
    `Choisissez une carte objet de votre main actuelle, Caméléon devient celle-ci.
Possible seulement si la carte choisi n'est pas une carte déjà sélectionné 2 fois ou si ce n'est pas une carte unique exemplaire.`,
  async execute(ctx) {
    const player = ctx.state.players[ctx.ownerId];

    // "Votre main actuelle" = la réserve non jouée (Caméléon lui-même en est déjà sorti
    // par handlePlayObject avant que son execute() ne tourne, il ne peut donc pas
    // s'auto-sélectionner en boucle une fois déjà à son propre plafond d'exemplaires).
    const handCardIds = new Set(player.unplayedObjectInstanceIds.map((id) => player.objects[id]!.cardId));

    const options: ChoiceOption[] = [];
    for (const cardId of handCardIds) {
      const def = getObjectCard(cardId);
      const maxCopies = def.maxCopies ?? DECK_LIMITS.maxCopiesPerCard;
      const currentCopies = Object.values(player.objects).filter((o) => o.cardId === cardId).length;
      // Devenir une copie de plus compte comme un exemplaire supplémentaire : même
      // plafond que le nombre max d'exemplaires du deck -- une carte déjà à son plafond
      // (un exemplaire unique dès sa première copie) n'est pas proposée.
      if (currentCopies < maxCopies) {
        options.push({ key: cardId, label: def.name, card: { cardId, kind: 'object' } });
      }
    }
    if (options.length === 0) return; // rien d'éligible -- Caméléon part au cimetière sans effet

    const chosenCardId = await ctx.chooseOption('Caméléon : choisissez la carte objet à devenir', options);

    // Caméléon *devient* la carte choisie : sa propre instance change de carte en place
    // (même principe qu'une évolution de personnage, mais pour un objet) et repart en
    // main. Le texte s'arrête là -- devenir une carte n'est pas la jouer : la nouvelle
    // carte se joue plus tard, normalement, avec ses propres cibles et son propre coût en
    // budget d'objets. Poser Caméléon a bien consommé une pose, elle.
    const self = player.objects[ctx.sourceInstanceId]!;
    self.cardId = chosenCardId;
    const targetDef = getObjectCard(chosenCardId);
    ctx.returnSelfToHand();
    // `privateTo` : une carte non jouée est secrète (view.ts masque la réserve adverse).
    // Annoncer publiquement ce que Caméléon est devenu reviendrait à retourner une carte
    // de la main sur la table.
    ctx.log(`Caméléon devient ${targetDef.name}`, { kind: 'info', privateTo: ctx.ownerId, cardId: chosenCardId });
  },
};
