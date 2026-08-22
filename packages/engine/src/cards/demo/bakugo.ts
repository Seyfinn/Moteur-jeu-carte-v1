import type { CharacterCardDef } from '../types.js';
import { otherPlayer } from '../../types.js';
import { hasStatus } from '../../statuses.js';

const EXPLOSION_ATK = 60;
const BURN_SYNERGY_BONUS = 70;

export const bakugo: CharacterCardDef = {
  type: 'character',
  id: 'bakugo',
  name: 'Bakugo',
  baseMaxHP: 250,
  attacks: [
    {
      id: 'explosion',
      name: 'Explosion',
      baseATK: EXPLOSION_ATK,
      description: `Inflige ${EXPLOSION_ATK} dégâts à l'actif adverse.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, EXPLOSION_ATK);
        await ctx.dealDamage(target.instanceId, atk);
      },
    },
  ],
  abilities: [
    {
      id: 'sueur-nitroglycerine',
      name: 'Sueur Nitroglycérine',
      kind: 'passive',
      description: `Si le personnage actif adverse subit déjà l'effet Burn, les attaques de Bakugo infligent +${BURN_SYNERGY_BONUS} dégâts supplémentaires.`,
      // Purement descriptif : implémenté via le modifier getEffectiveATK ci-dessous --
      // condition dynamique dépendant du statut de la cible, pas d'un statut à poser
      // soi-même (Bakugo n'inflige pas Burn lui-même, c'est une synergie avec une
      // source de burn tierce -- attaque/objet/terrain allié).
      async execute() {},
    },
  ],
  modifiers: [
    {
      query: 'getEffectiveATK',
      transform(ctx, current) {
        const characterInstanceId = ctx.query['characterInstanceId'] as string;
        if (characterInstanceId !== ctx.sourceInstanceId) return current;
        const opponentId = otherPlayer(ctx.sourceOwnerId);
        const opponent = ctx.state.players[opponentId];
        const opponentActiveId = opponent.activeCharacterInstanceId;
        const opponentActive = opponentActiveId ? opponent.characters[opponentActiveId] : undefined;
        if (opponentActive && hasStatus(opponentActive, 'burn')) {
          return (current as number) + BURN_SYNERGY_BONUS;
        }
        return current;
      },
    },
  ],
};
