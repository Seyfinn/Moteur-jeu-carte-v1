import type { ObjectCardDef } from '../types.js';

const MIN_HP_REQUIRED = 150;
const HP_AFTER_USE = 10;
const ATK_MULTIPLIER = 2;
const BUFF_DURATION_TURNS = 1;

export const adrenalineUltime: ObjectCardDef = {
  type: 'object',
  id: 'adrenaline-ultime',
  name: 'Adrénaline Ultime',
  description: `Utilisable uniquement si ton personnage actif a au moins ${MIN_HP_REQUIRED} HP restants. Réduit ses HP actuels à ${HP_AFTER_USE} HP et multiplie par ${ATK_MULTIPLIER} les dégâts de toutes ses attaques pendant ce tour.`,
  condition(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    if (!active) return false;
    return active.currentMaxHP - active.damage >= MIN_HP_REQUIRED;
  },
  async execute(ctx) {
    const active = ctx.getActive(ctx.ownerId);
    if (!active) return;

    const currentHP = active.currentMaxHP - active.damage;
    const toLose = currentHP - HP_AFTER_USE;
    // A self-inflicted *cost*, not an attack: it has to land in full. Routed through the
    // normal pipeline it was absorbed by the character's own shield (or reduced by a
    // damage-reduction modifier), which handed out the x2 for free.
    if (toLose > 0) await ctx.dealDamage(active.instanceId, toLose, { ignoreShield: true, ignoreDamageReduction: true });

    ctx.applyStatus(active.instanceId, {
      statusId: 'atk-multiplier',
      label: 'Adrénaline Ultime',
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      remainingTurns: BUFF_DURATION_TURNS,
      // Scoped to this turn: without this the buff freezes the moment its bearer is
      // benched (durations are suspended there) and comes back intact turns later.
      ticksOnBench: true,
      data: { multiplier: ATK_MULTIPLIER },
    });
  },
};
