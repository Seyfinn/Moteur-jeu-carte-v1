import type { EffectContext, TerrainCardDef } from '../types.js';
import { canTargetBench } from '../../queries.js';

const DURATION_TURNS = 3;
const ACTIVE_DAMAGE = 30;
const BENCH_DAMAGE = 15;

async function strikeOpponentBoard(ctx: EffectContext): Promise<void> {
  const active = ctx.getActive(ctx.opponentId);
  if (active) {
    await ctx.dealDamage(active.instanceId, ACTIVE_DAMAGE, { skipEvasionRoll: true });
  }
  // Le banc n'est arrosé que s'il est réellement atteignable : un banc protégé (Bouclier
  // Ultime) ou isolé (Arène) n'a pas à encaisser un effet qui ne lui demande rien.
  for (const bench of ctx.getBench(ctx.opponentId)) {
    if (!canTargetBench(ctx.state, ctx.sourceInstanceId, bench.instanceId, true).allow) continue;
    await ctx.dealDamage(bench.instanceId, BENCH_DAMAGE, { skipEvasionRoll: true });
  }
}

export const autelDemoniaque: TerrainCardDef = {
  type: 'terrain',
  id: 'autel-demoniaque',
  name: 'Autel Démoniaque',
  description: 'Chaque tour, inflige 30 dégâts au personnage actif adverse et 15 dégâts à chaque personnages sur le banc adverse et allié.',
  durationTurns: DURATION_TURNS,
  abilities: [
    {
      id: 'autel-demoniaque-onplay',
      name: 'Autel Démoniaque',
      kind: 'passive',
      // Plomberie : pas imprimée sur la carte (cf. `hidden` dans cards/types.ts).
      hidden: true,
      description: "Déclenche l'effet immédiatement à la pose.",
      trigger: 'onTerrainPlayed',
      // Only for THIS terrain's own arrival. Without the guard, the event emitted when
      // *any* terrain hits the table (including the opponent's) re-fired this on-play
      // effect for every terrain already in play.
      condition(ctx) {
        return ctx.event?.data['terrainInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        await strikeOpponentBoard(ctx);
      },
    },
    {
      id: 'autel-demoniaque-tick',
      name: 'Autel Démoniaque',
      kind: 'passive',
      // Plomberie : pas imprimée sur la carte (cf. `hidden` dans cards/types.ts).
      hidden: true,
      description: `Répète l'effet au début de chacun des tours suivants du possesseur, tant que le terrain reste en jeu.`,
      trigger: 'onTurnStart',
      condition(ctx) {
        if (ctx.event?.playerId !== ctx.ownerId) return false;
        // S'appuie sur remainingTurns plutôt que sur un compteur dédié, pour
        // rester correct si la durée est prolongée/raccourcie (ctx.extendTerrain
        // / ctx.shortenTerrain). onTurnStart est émis *avant* le tick qui fait
        // expirer le terrain (tickTerrainAtTurnStart, zones.ts) -- donc sur le
        // tour où remainingTurns vaut 1, ce tick est sur le point de retirer le
        // terrain et cette activation-là doit être sautée (déjà comptée via
        // l'activation à la pose).
        const remaining = ctx.getTerrain(ctx.sourceInstanceId).remainingTurns;
        return remaining !== undefined && remaining > 1;
      },
      async execute(ctx) {
        await strikeOpponentBoard(ctx);
      },
    },
  ],
};
