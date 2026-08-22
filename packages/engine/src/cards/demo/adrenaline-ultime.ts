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
    if (toLose > 0) await ctx.dealDamage(active.instanceId, toLose);

    ctx.applyStatus(active.instanceId, {
      statusId: 'atk-multiplier',
      label: 'Adrénaline Ultime',
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      remainingTurns: BUFF_DURATION_TURNS,
      data: { multiplier: ATK_MULTIPLIER },
    });
  },
};
