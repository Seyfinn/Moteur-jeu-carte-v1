import type { CharacterCardDef } from '../types.js';
import { getCharacterCard } from '../registry.js';
import { simpleAttack } from './shared.js';

export const beyondNeteroVmax: CharacterCardDef = {
  type: 'character',
  id: 'beyond-netero-vmax',
  name: 'Beyond Netero VMAX',
  baseMaxHP: 220,
  family: 'NEN',
  abilities: [
    {
      id: 'nen',
      name: 'Nen',
      kind: 'active',
      usesPerGame: 1,
      description: 'Si une carte de la famille NEN est dans votre cimetière, +50 HP max à toutes vos cartes. 1x par partie.',
      condition(ctx) {
        const player = ctx.state.players[ctx.ownerId];
        const self = getCharacterCard(ctx.getCharacter(ctx.sourceInstanceId).cardId);
        if (!self.family) return false;
        return player.graveyardCharacterInstanceIds.some((id) => {
          const inst = player.characters[id];
          if (!inst) return false;
          return getCharacterCard(inst.cardId).family === self.family;
        });
      },
      async execute(ctx) {
        for (const ally of ctx.getAllOnBoard(ctx.ownerId)) {
          ctx.raiseMaxHP(ally.instanceId, 50);
        }
      },
    },
  ],
  attacks: [simpleAttack('tuerie-de-nen', 'Tuerie de Nen', 100, 'Inflige 100 dégâts au personnage actif adverse.')],
};
