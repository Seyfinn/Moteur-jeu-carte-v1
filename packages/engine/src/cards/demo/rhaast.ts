import type { CharacterCardDef, EffectContext } from '../types.js';
import { getStatus } from '../../statuses.js';
import { canTargetBench } from '../../queries.js';

const FAUX_ROUGE_ATK = 60;
const BLOODTHIRST_BONUS = 50;

/** Bonus armé par « Soif de sang », consommé par la prochaine « Faux Rouge ». */
const BLOODTHIRST_STATUS_ID = 'rhaast-soif-de-sang';

/**
 * Alliés du banc dont le sacrifice coûterait réellement quelque chose : la moitié arrondie
 * vers le bas vaut 0 en dessous de 2 PV, et le banc reste soumis aux protections adverses
 * (Bouclier Ultime, Arène) comme n'importe quel ciblage de banc.
 */
function sacrificeableBench(ctx: EffectContext) {
  return ctx
    .getBench(ctx.ownerId)
    .filter((c) => canTargetBench(ctx.state, ctx.sourceInstanceId, c.instanceId, true).allow)
    .filter((c) => c.currentMaxHP - c.damage >= 2);
}

/**
 * Forme évoluée de Kayn (voie de Rhaast). Jamais sélectionnable dans un deck : c'est le
 * `evolvesTo` de `kayn` qui la sort du pool, elle n'arrive que par la transformation.
 */
export const rhaast: CharacterCardDef = {
  type: 'character',
  id: 'rhaast',
  name: 'Rhaast',
  baseMaxHP: 240,
  attacks: [
    {
      id: 'faux-rouge',
      name: 'Faux Rouge',
      baseATK: FAUX_ROUGE_ATK,
      // Pas de texte d'attaque sur la carte : description implicite.
      description: '',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;

        // « Soif de sang » est consommée par cette attaque, qu'elle touche ou soit esquivée :
        // les PV de l'allié ont déjà été payés.
        const bonus = Number(
          getStatus(ctx.getCharacter(ctx.sourceInstanceId), BLOODTHIRST_STATUS_ID)?.data?.['amount'] ?? 0
        );
        if (bonus > 0) ctx.removeStatus(ctx.sourceInstanceId, BLOODTHIRST_STATUS_ID);

        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, FAUX_ROUGE_ATK) + bonus;
        await ctx.dealDamage(target.instanceId, atk);
      },
    },
  ],
  abilities: [
    {
      id: 'buveur-de-sang',
      name: 'Buveur de sang',
      kind: 'passive',
      description: 'Heal de la moitié de ses dégâts infligés.',
      trigger: 'afterDamage',
      // Le vol de vie doit valoir pour chaque instance de dégâts du tour (attaque
      // supplémentaire, coup renvoyé...), pas une seule fois.
      usesPerTurn: Infinity,
      usableFromBench: true,
      condition(ctx) {
        const data = ctx.event?.data;
        if (!data || data['sourceInstanceId'] !== ctx.sourceInstanceId) return false;
        // `amount` = dégâts réellement encaissés (après bouclier) : rien d'infligé, rien à voler.
        if (Number(data['amount'] ?? 0) <= 0) return false;
        // Le coût en PV de « Soif de sang » frappe un allié : il ne doit pas soigner Rhaast.
        const victim = ctx.getCharacter(String(data['targetInstanceId']));
        return victim.ownerId !== ctx.ownerId;
      },
      async execute(ctx) {
        const dealt = Number(ctx.event?.data['amount'] ?? 0);
        ctx.heal(ctx.sourceInstanceId, Math.floor(dealt / 2));
      },
    },
    {
      id: 'soif-de-sang',
      name: 'Soif de sang',
      kind: 'active',
      description:
        'Sacrifie la moitié des hp actuels d’une carte allié sur le banc pour infliger 50 dégâts supplémentaires à la prochaine attaque.',
      condition(ctx) {
        // Non cumulable : tant que le bonus n'a pas été consommé, sacrifier un second allié
        // ne ferait que gâcher ses PV sans rien ajouter.
        if (getStatus(ctx.getCharacter(ctx.sourceInstanceId), BLOODTHIRST_STATUS_ID)) return false;
        return sacrificeableBench(ctx).length > 0;
      },
      async execute(ctx) {
        const bench = sacrificeableBench(ctx);
        if (bench.length === 0) return;
        const [targetId] = await ctx.choose({
          kind: 'select-characters',
          prompt: 'Soif de sang : choisissez le personnage du banc à sacrifier',
          options: bench.map((c) => c.instanceId),
          min: 1,
          max: 1,
        });
        if (!targetId) return;

        const ally = ctx.getCharacter(targetId);
        const cost = Math.floor((ally.currentMaxHP - ally.damage) / 2);
        // Coût que le camp se paie à lui-même : ni bouclier ni réduction de dégâts ne
        // doivent l'absorber, sinon le sacrifice devient gratuit.
        if (cost > 0) {
          await ctx.dealDamage(targetId, cost, { ignoreShield: true, ignoreDamageReduction: true });
        }

        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: BLOODTHIRST_STATUS_ID,
          label: `Soif de sang (+${BLOODTHIRST_BONUS} dégâts)`,
          sourceCardInstanceId: ctx.sourceInstanceId,
          data: { amount: BLOODTHIRST_BONUS },
        });
      },
    },
  ],
};
