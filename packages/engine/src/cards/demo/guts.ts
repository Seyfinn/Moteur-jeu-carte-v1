import type { CharacterCardDef } from '../types.js';
import { getStatus } from '../../statuses.js';
import { findCharacter } from '../../queries.js';

const BERSERK_COUNTER_STATUS_ID = 'guts-berserk-record';
const HP_CHUNK = 100;
const BONUS_PER_CHUNK = 50;

const COUP_DEPEE_ATK = 50;
const COUP_DEPEE_SELF_HEAL = 25;

export const guts: CharacterCardDef = {
  type: 'character',
  id: 'guts',
  name: 'Guts',
  baseMaxHP: 250,
  attacks: [
    {
      id: 'coup-depee',
      name: "Coup d'épée",
      baseATK: COUP_DEPEE_ATK,
      // Texte carte : "Se soigne de 25." -- l'ATK 50 affiché inflige les dégâts (implicite,
      // comme les autres attaques), le texte ne décrit que l'effet secondaire (même
      // convention que Soraka).
      description: `Inflige ${COUP_DEPEE_ATK} dégâts à l'actif adverse, puis Guts se soigne de ${COUP_DEPEE_SELF_HEAL}.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (target) {
          const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, COUP_DEPEE_ATK);
          await ctx.dealDamage(target.instanceId, atk);
        }
        ctx.heal(ctx.sourceInstanceId, COUP_DEPEE_SELF_HEAL);
      },
    },
  ],
  abilities: [
    {
      id: 'berserk',
      name: 'Berserk',
      kind: 'passive',
      description: `Tous les ${HP_CHUNK} HP que Guts perd au cours de la partie, "Coup d'épée" inflige ${BONUS_PER_CHUNK} dégâts supplémentaires de façon permanente.`,
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
