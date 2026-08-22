import type { EffectContext, TerrainCardDef } from '../types.js';

const DURATION_TURNS = 3;
const SHIELD_AMOUNT = 50;

function grantShield(ctx: EffectContext): void {
  const active = ctx.getActive(ctx.ownerId);
  if (active) ctx.addShield(active.instanceId, SHIELD_AMOUNT);
}

export const protectionDivine: TerrainCardDef = {
  type: 'terrain',
  id: 'protection-divine',
  name: 'Protection Divine',
  description: `Pendant ${DURATION_TURNS} tours, au début de chaque tour du possesseur (${DURATION_TURNS} activations au total, dont celle à la pose), ajoute ${SHIELD_AMOUNT} de shield à son personnage actif du moment.`,
  durationTurns: DURATION_TURNS,
  abilities: [
    {
      id: 'protection-divine-onplay',
      name: 'Protection Divine',
      kind: 'passive',
      description: `Déclenche l'effet immédiatement à la pose (1ère des ${DURATION_TURNS} activations).`,
      trigger: 'onTerrainPlayed',
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
