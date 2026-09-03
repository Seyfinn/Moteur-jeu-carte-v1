import type { CharacterCardDef } from '../types.js';
import { simpleAttack } from './shared.js';

const JAJANKEN_ATK = 115;
const CONTRAT_DE_MORT_DAMAGE = 30;

/**
 * Forme évoluée de Gon. Jamais sélectionnable dans un deck : c'est le `evolvesTo` de `gon`
 * qui la sort du pool, elle n'arrive que par le Sermet de Vengance.
 */
export const gonAdulte: CharacterCardDef = {
  type: 'character',
  id: 'gon-adulte',
  name: 'Gon Adulte',
  baseMaxHP: 300,
  attacks: [
    // Pas de texte d'attaque sur la carte : description implicite.
    simpleAttack('jajanken-ultime', 'Jajanken Ultime', JAJANKEN_ATK, ''),
  ],
  abilities: [
    {
      id: 'contrat-de-mort',
      name: 'Sermet de Vengance',
      kind: 'passive',
      description: 'Contrat de Mort : Gon Adulte subit 30 dégâts auto-infligés à la fin de chacun de ses tours',
      trigger: 'onTurnEnd',
      // `usableFromBench` volontairement absent : `canUseAbility` exige alors le poste
      // actif, donc le contrat cesse de saigner dès que Gon Adulte se replie au banc.
      condition(ctx) {
        return ctx.event?.playerId === ctx.ownerId;
      },
      async execute(ctx) {
        // « auto-infligés » : un coût que le camp se paie à lui-même, donc ni bouclier ni
        // réduction de dégâts ne doivent l'absorber -- sinon le contrat devient gratuit.
        await ctx.dealDamage(ctx.sourceInstanceId, CONTRAT_DE_MORT_DAMAGE, {
          ignoreShield: true,
          ignoreDamageReduction: true,
        });
      },
    },
    {
      id: 'teleportation',
      name: 'Téléportation',
      kind: 'active',
      description: 'Peut passer du banc au terrain (utilisable 1x) depuis le banc',
      usableFromBench: true,
      usesPerGame: 1,
      // `endsTurn` laissé au défaut des capacités (false) : la montée est gratuite.
      condition(ctx) {
        return ctx.state.players[ctx.ownerId].activeCharacterInstanceId !== ctx.sourceInstanceId;
      },
      async execute(ctx) {
        await ctx.forceSwitch(ctx.ownerId, ctx.sourceInstanceId);
      },
    },
  ],
};
