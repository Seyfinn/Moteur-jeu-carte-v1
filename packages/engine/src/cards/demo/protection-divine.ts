import type { EffectContext, TerrainCardDef } from '../types.js';

const DURATION_TURNS = 3;
const ALLY_SHIELD_AMOUNT = 50;
const ENEMY_SHIELD_AMOUNT = 30;

function grantShield(ctx: EffectContext): void {
  const active = ctx.getActive(ctx.ownerId);
  if (active) ctx.addShield(active.instanceId, ALLY_SHIELD_AMOUNT);
  const enemyActive = ctx.getActive(ctx.opponentId);
  if (enemyActive) ctx.addShield(enemyActive.instanceId, ENEMY_SHIELD_AMOUNT);
}

export const protectionDivine: TerrainCardDef = {
  type: 'terrain',
  id: 'protection-divine',
  name: 'Protection Divine',
  description: `Ajoute ${ALLY_SHIELD_AMOUNT} de shield au personnage actif allié et ${ENEMY_SHIELD_AMOUNT} de shield au personnage actif ennemi.`,
  durationTurns: DURATION_TURNS,
  abilities: [
    {
      id: 'protection-divine-onplay',
      name: 'Protection Divine',
      kind: 'passive',
      description: "Déclenche l'effet immédiatement à la pose.",
      trigger: 'onTerrainPlayed',
      // Only for THIS terrain's own arrival. Without the guard, the event emitted when
      // *any* terrain hits the table (including the opponent's) re-fired this on-play
      // effect for every terrain already in play.
      condition(ctx) {
        return ctx.event?.data['terrainInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        grantShield(ctx);
      },
    },
    {
      id: 'protection-divine-tick',
      name: 'Protection Divine',
      kind: 'passive',
      description: 'Répète l\'effet au début de chacun des tours suivants du possesseur, tant que le terrain reste en jeu.',
      trigger: 'onTurnStart',
      condition(ctx) {
        if (ctx.event?.playerId !== ctx.ownerId) return false;
        // Même logique qu'Autel Démoniaque : s'appuie sur remainingTurns plutôt qu'un
        // compteur dédié, pour rester correct si la durée est prolongée/raccourcie.
        // onTurnStart est émis avant le tick qui fait expirer le terrain, donc sur le
        // tour où remainingTurns vaut 1, cette activation-là est déjà comptée (pose).
        const remaining = ctx.getTerrain(ctx.sourceInstanceId).remainingTurns;
        return remaining !== undefined && remaining > 1;
      },
      async execute(ctx) {
        grantShield(ctx);
      },
    },
  ],
};
