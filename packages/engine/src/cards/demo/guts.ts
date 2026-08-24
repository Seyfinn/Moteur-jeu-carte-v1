import type { CharacterCardDef } from '../types.js';
import { simpleAttack } from './shared.js';
import { getStatus } from '../../statuses.js';
import { findCharacter } from '../../queries.js';

const BERSERK_COUNTER_STATUS_ID = 'guts-berserk-record';
const HP_CHUNK = 100;
const BONUS_PER_CHUNK = 50;

export const guts: CharacterCardDef = {
  type: 'character',
  id: 'guts',
  name: 'Guts',
  baseMaxHP: 250,
  attacks: [simpleAttack('coup-depee', "Coup d'épée", 50, "Attaque simple : inflige 50 dégâts (+ bonus Berserk) à l'actif adverse.")],
  abilities: [
    {
      id: 'berserk',
      name: 'Berserk',
      kind: 'passive',
      description: `Tous les ${HP_CHUNK} HP que Guts perd au cours de la partie (cumulatif, ne redescend jamais même s'il est soigné), "Coup d'épée" inflige ${BONUS_PER_CHUNK} dégâts supplémentaires de façon permanente.`,
      trigger: 'afterDamage',
      // Le décompte doit valoir même si Guts encaisse les dégâts depuis le banc (AoE).
      usableFromBench: true,
      // Peut se déclencher plusieurs fois dans le même tour si Guts prend plusieurs coups d'affilée.
      usesPerTurn: Infinity,
      condition(ctx) {
        const event = ctx.event;
        return !!event && event.data['targetInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const existing = getStatus(self, BERSERK_COUNTER_STATUS_ID);
        const previousRecord = Number(existing?.data?.['highestDamage'] ?? 0);
        const highestDamage = Math.max(previousRecord, self.damage);
        if (highestDamage === previousRecord) return; // pas de nouveau palier, rien à mettre à jour

        if (existing) ctx.removeStatus(ctx.sourceInstanceId, BERSERK_COUNTER_STATUS_ID);
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: BERSERK_COUNTER_STATUS_ID,
          label: 'Berserk (record de dégâts subis)',
          sourceCardInstanceId: ctx.sourceInstanceId,
          hidden: true, // compteur interne : le palier atteint est déjà annoncé dans le journal
          data: { highestDamage },
        });

        const previousStacks = Math.floor(previousRecord / HP_CHUNK);
        const newStacks = Math.floor(highestDamage / HP_CHUNK);
        if (newStacks > previousStacks) {
          ctx.log(`Berserk : nouveau palier atteint, "Coup d'épée" inflige désormais +${newStacks * BONUS_PER_CHUNK} dégâts`, {
            characterInstanceId: ctx.sourceInstanceId,
            stacks: newStacks,
          });
        }
      },
    },
  ],
  modifiers: [
    {
      query: 'getEffectiveATK',
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        const char = findCharacter(ctx.state, ctx.sourceInstanceId);
        const record = getStatus(char, BERSERK_COUNTER_STATUS_ID);
        const highestDamage = Number(record?.data?.['highestDamage'] ?? 0);
        const stacks = Math.floor(highestDamage / HP_CHUNK);
        return (current as number) + stacks * BONUS_PER_CHUNK;
      },
    },
  ],
};
