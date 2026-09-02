import type { TerrainCardDef } from '../types.js';

const DURATION_TURNS = 3;
const WHEEL_CHANCE_PERCENT = 50;
const ATK_BOOST_AMOUNT = 20;
const ATK_BOOST_EFFECTIVE_TURNS = 1;
/** Posé à la fin du tour du bénéficiaire : doit survivre au tick qui ouvre son tour suivant. */
const ATK_BOOST_REMAINING_TURNS = ATK_BOOST_EFFECTIVE_TURNS + 1;
const WHEEL_DAMAGE_AMOUNT = 30;
const ON_PLAY_SHIELD_AMOUNT = 30;

export const jeuDeLaMort: TerrainCardDef = {
  type: 'terrain',
  id: 'jeu-de-la-mort',
  name: 'Jeu de la mort',
  description:
    'Pendant 3 tours, à la fin de son tour, les personnage sur le poste actif lance la roue.\n' +
    '50% : Le personnage actif gagne un bonus de +20 ATK pour son prochain tour.\n' +
    '50% : Le personnage actif subit 30 dégâts. \n' +
    'Si vous avez posé le terrain, votre personnage sur le actif gagne 30 de bouclier. ',
  durationTurns: DURATION_TURNS,
  abilities: [
    {
      id: 'jeu-de-la-mort-pose',
      name: 'Jeu de la mort',
      kind: 'passive',
      description: 'À la pose, le personnage actif du poseur gagne 30 de bouclier.',
      trigger: 'onTerrainPlayed',
      // Pour CE terrain seulement (cf. CLAUDE.md) : l'event part pour n'importe quelle pose.
      condition(ctx) {
        return ctx.event?.data['terrainInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        const active = ctx.getActive(ctx.ownerId);
        if (!active) return;
        ctx.addShield(active.instanceId, ON_PLAY_SHIELD_AMOUNT);
      },
    },
    {
      id: 'jeu-de-la-mort-roue',
      name: 'Jeu de la mort',
      kind: 'passive',
      description: 'À la fin de son tour, le personnage actif (des deux camps) lance la roue.',
      trigger: 'onTurnEnd',
      async execute(ctx) {
        const switchingPlayerId = ctx.event?.playerId;
        if (!switchingPlayerId) return;
        const active = ctx.getActive(switchingPlayerId);
        if (!active) return;
        const won = ctx.rollChance(WHEEL_CHANCE_PERCENT, 'Jeu de la mort', { characterInstanceId: active.instanceId });
        if (won) {
          // Traité comme le résultat d'un jet déjà résolu, pas comme une nouvelle attaque :
          // pas de second jet d'esquive par-dessus (même logique que Ronces grimpantes).
          ctx.applyStatus(
            active.instanceId,
            {
              statusId: 'atk-boost',
              label: `Jeu de la mort (+${ATK_BOOST_AMOUNT} ATK)`,
              sourceCardInstanceId: ctx.sourceInstanceId,
              remainingTurns: ATK_BOOST_REMAINING_TURNS,
              ticksOnBench: true,
              data: { amount: ATK_BOOST_AMOUNT },
            },
            { skipEvasionRoll: true }
          );
        } else {
          await ctx.dealDamage(active.instanceId, WHEEL_DAMAGE_AMOUNT, { skipEvasionRoll: true });
        }
      },
    },
  ],
};
