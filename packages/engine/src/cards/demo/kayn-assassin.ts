import type { CharacterCardDef } from '../types.js';
import { isSilencedPassive } from '../../statuses.js';

const FAUX_BLEU_ATK = 60;
const SHADOW_BONUS_PERCENT = 25;
const RUSH_HEAL = 60;

/**
 * Forme évoluée de Kayn (voie de l'assassin). Jamais sélectionnable dans un deck : c'est
 * le `evolvesTo` de `kayn` qui la sort du pool, elle n'arrive que par la transformation.
 */
export const kaynAssassin: CharacterCardDef = {
  type: 'character',
  id: 'kayn-assassin',
  name: 'Kayn assassin',
  baseMaxHP: 240,
  attacks: [
    {
      id: 'faux-bleue',
      name: 'Faux Bleu',
      baseATK: FAUX_BLEU_ATK,
      // Pas de texte d'attaque sur la carte : description implicite. Le bonus de Disciple
      // de l'ombre est porté par la passive, pas par cette ligne.
      description: `Inflige ${FAUX_BLEU_ATK} dégâts à l'actif adverse.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;

        let amount = ctx.getEffectiveATK(ctx.sourceInstanceId, FAUX_BLEU_ATK);
        // « Disciple de l'ombre » : 25 % des PV max de la CIBLE, fondus dans la même
        // instance de dégâts que l'attaque (un bouclier ou une esquive traitent donc le
        // tout comme un seul coup). Le bonus tombe sous silence passif / ultime, comme
        // n'importe quelle passive imprimée -- un modifier `getEffectiveATK` ne pourrait
        // pas le faire ici, faute de connaître la cible.
        if (!isSilencedPassive(ctx.getCharacter(ctx.sourceInstanceId))) {
          const victim = ctx.getCharacter(target.instanceId);
          amount += Math.floor((victim.currentMaxHP * SHADOW_BONUS_PERCENT) / 100);
        }
        await ctx.dealDamage(target.instanceId, amount);
      },
    },
  ],
  abilities: [
    {
      id: 'disciple-de-l-ombre',
      name: "Disciple de l'ombre",
      kind: 'passive',
      description: 'Les attaques de kayn infligent 25% des hp max en dégâts bonus.',
      // Purement descriptive : le bonus est appliqué dans l'AttackDef ci-dessus.
      async execute() {},
    },
    {
      id: 'ruee-de-l-ombre',
      name: "Ruée de l'ombre",
      kind: 'active',
      description:
        'Kayn assassin échange sa place avec une carte du banc, et se soigne de 60hp. Utilisable une fois',
      usesPerGame: 1,
      // `endsTurn` laissé au défaut des capacités (false) : le repli est gratuit.
      condition(ctx) {
        return ctx.getBench(ctx.ownerId).length > 0;
      },
      async execute(ctx) {
        const bench = ctx.getBench(ctx.ownerId);
        if (bench.length === 0) return;
        const [targetId] = await ctx.choose({
          kind: 'select-characters',
          prompt: "Ruée de l'ombre : choisissez le personnage du banc qui prend la place de Kayn",
          options: bench.map((c) => c.instanceId),
          min: 1,
          max: 1,
        });
        if (!targetId) return;

        // Le soin d'abord : si le switch est refusé (Arène, chaînes...), Kayn a quand même
        // payé son unique utilisation, il ne doit pas en ressortir les mains vides.
        ctx.heal(ctx.sourceInstanceId, RUSH_HEAL);
        await ctx.forceSwitch(ctx.ownerId, targetId);
      },
    },
  ],
};
