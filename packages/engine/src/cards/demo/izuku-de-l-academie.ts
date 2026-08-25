import type { CharacterCardDef } from '../types.js';
import { simpleAttack } from './shared.js';

const TEXAS_SMASH_ATK = 60;
const ATK_BONUS = 60;
const SELF_DAMAGE = 80;
// Posé sur soi-même pendant son propre tour : le premier tick n'a lieu qu'au tour suivant
// d'Izuku (l'adversaire s'intercale sans jamais faire tiquer un statut allié -- voir
// zoe.ts). `1` couvre donc exactement « ce round » et rien de plus, comme Potion force.
const BOOST_DURATION_TURNS = 1;

export const izukuDeLAcademie: CharacterCardDef = {
  type: 'character',
  id: 'izuku-de-l-academie',
  name: "Izuku de l'Académie",
  baseMaxHP: 280,
  attacks: [
    simpleAttack('texas-smash', 'Texas Smash', TEXAS_SMASH_ATK, `Inflige ${TEXAS_SMASH_ATK} dégâts à l'actif adverse.`),
  ],
  abilities: [
    {
      id: 'nouvel-alter',
      name: 'Nouvel Alter',
      kind: 'active',
      description: `Izuku utilise son alter pour infliger ${ATK_BONUS} dégâts en plus ce round, mais il se blesse aussi de ${SELF_DAMAGE}hp.`,
      // Aucune limite de partie déclarée : le défaut du moteur (1 fois par tour) s'applique.
      // Le vrai frein est le coût en HP, pas un compteur.
      //
      // Pas de `condition` interdisant de descendre à 0 : contrairement au Soin Sacrificiel
      // de Soraka, Izuku a le droit de se tuer avec son propre alter (choix assumé).
      async execute(ctx) {
        ctx.applyStatus(ctx.sourceInstanceId, {
          // Statut générique du moteur : getEffectiveATK additionne les 'atk-boost'.
          statusId: 'atk-boost',
          label: 'Nouvel Alter',
          sourcePlayerId: ctx.ownerId,
          sourceCardInstanceId: ctx.sourceInstanceId,
          remainingTurns: BOOST_DURATION_TURNS,
          // Buff cadré sur le tour en cours : sans ça, mettre Izuku au banc juste après
          // gèlerait la durée (les durées y sont suspendues) et le bonus reviendrait
          // intact bien plus tard -- même correctif que Potion force.
          ticksOnBench: true,
          data: { amount: ATK_BONUS },
        });

        // Coût que le camp se paie à lui-même : sans ignoreShield + ignoreDamageReduction,
        // le bouclier d'Izuku (ou n'importe quelle réduction) absorberait la blessure et
        // l'alter deviendrait gratuit.
        await ctx.dealDamage(ctx.sourceInstanceId, SELF_DAMAGE, {
          ignoreShield: true,
          ignoreDamageReduction: true,
        });
      },
    },
  ],
};
