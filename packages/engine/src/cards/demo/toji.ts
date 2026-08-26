import type { CharacterCardDef, EffectContext } from '../types.js';
import { getCurrentHP } from '../../hp.js';
import { canTargetBench } from '../../queries.js';

const AIGUILLON_PERCENT_OF_TARGET_MAX_HP = 33;

/** Statuts couverts par "Restriction Céleste" -- stun, désarmé, et les 3 variantes de silence. */
const IMMUNE_STATUS_IDS = new Set(['stun', 'disarmed', 'silence-active', 'silence-passive', 'silence-ultimate']);

/** Banc adverse ciblable par "Traque du Plus Fort" (exclut un banc protégé, ex: Bouclier Ultime). */
function getTargetableBench(ctx: EffectContext) {
  return ctx
    .getBench(ctx.opponentId)
    .filter((c) => canTargetBench(ctx.state, ctx.sourceInstanceId, c.instanceId, true).allow);
}

export const toji: CharacterCardDef = {
  type: 'character',
  id: 'toji',
  name: 'Toji',
  baseMaxHP: 250,
  attacks: [
    {
      id: 'aiguillon-celeste',
      name: 'Aiguillon Céleste',
      baseATK: 0,
      description: 'Infligé 33% des pv par rapport aux pv maximum de la cible',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const amount = Math.round(target.currentMaxHP * (AIGUILLON_PERCENT_OF_TARGET_MAX_HP / 100));
        await ctx.dealDamage(target.instanceId, amount);
      },
    },
  ],
  abilities: [
    {
      id: 'traque-du-plus-fort',
      name: 'Traque du Plus Fort',
      kind: 'active',
      description: "Force l'adversaire à échanger son personnage actif avec celui de son banc qui possède le plus de HP actuels\nUtilisable 1x",
      usesPerGame: 1,
      condition(ctx) {
        return getTargetableBench(ctx).length > 0;
      },
      async execute(ctx) {
        const bench = getTargetableBench(ctx);
        if (bench.length === 0) return;
        // Ex-aequo : on garde le premier trouvé dans l'ordre du banc.
        const target = bench.reduce((best, c) => (getCurrentHP(c) > getCurrentHP(best) ? c : best));
        await ctx.forceSwitch(ctx.opponentId, target.instanceId);
      },
    },
    {
      id: 'restriction-celeste',
      name: 'Restriction Céleste',
      kind: 'passive',
      description: "Immunisé contre les Silences, les Stuns et l'effet Désarmé.",
      // Purement descriptive : implémentée par le modifier 'canApplyStatus' plus bas.
      async execute() {},
    },
  ],
  modifiers: [
    {
      // "Restriction Céleste" : immunité totale à stun / silence (toutes variantes) / désarmé.
      query: 'canApplyStatus',
      vote(ctx) {
        if (ctx.query['targetInstanceId'] !== ctx.sourceInstanceId) return undefined;
        if (!IMMUNE_STATUS_IDS.has(ctx.query['statusId'] as string)) return undefined;
        return { allow: false, source: 'toji-restriction-celeste', reason: 'Restriction Céleste (immunisé)' };
      },
    },
  ],
};
