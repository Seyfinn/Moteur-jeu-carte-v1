import type { CharacterCardDef } from '../types.js';
import { simpleAttack } from './shared.js';
import { getStatus } from '../../statuses.js';
import { findCharacter } from '../../queries.js';

const ENERVEMENT_STATUS_ID = 'hulk-enervement';
const ATK_BONUS_PER_STACK = 30;

export const hulk: CharacterCardDef = {
  type: 'character',
  id: 'hulk',
  name: 'Hulk',
  baseMaxHP: 500,
  attacks: [simpleAttack('smash', 'Smash', 30, '')],
  abilities: [
    {
      id: 'enervement',
      name: 'Enervement',
      kind: 'passive',
      description: "A chaque fois que Hulk subit une instance de dégâts, il s'énerve et gagne 30 dégâts d'attaque.",
      trigger: 'afterDamage',
      // Se déclenche même si Hulk encaisse les dégâts depuis le banc (ex: AoE adverse).
      usableFromBench: true,
      // Peut se déclencher plusieurs fois dans le même tour si Hulk prend plusieurs coups d'affilée.
      usesPerTurn: Infinity,
      condition(ctx) {
        const event = ctx.event;
        return !!event && event.data['targetInstanceId'] === ctx.sourceInstanceId && Number(event.data['amount']) > 0;
      },
      async execute(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const existing = getStatus(self, ENERVEMENT_STATUS_ID);
        const stacks = Number(existing?.data?.['stacks'] ?? 0) + 1;

        if (existing) ctx.removeStatus(ctx.sourceInstanceId, ENERVEMENT_STATUS_ID);
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: ENERVEMENT_STATUS_ID,
          label: 'Enervement',
          sourceCardInstanceId: ctx.sourceInstanceId,
          data: { stacks },
        });

        ctx.log(`Enervement : Hulk gagne ${ATK_BONUS_PER_STACK} ATK (total +${stacks * ATK_BONUS_PER_STACK})`, {
          characterInstanceId: ctx.sourceInstanceId,
          stacks,
        });
      },
    },
  ],
  modifiers: [
    {
      query: 'getEffectiveATK',
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        const char = findCharacter(ctx.state, ctx.sourceInstanceId);
        const record = getStatus(char, ENERVEMENT_STATUS_ID);
        const stacks = Number(record?.data?.['stacks'] ?? 0);
        return (current as number) + stacks * ATK_BONUS_PER_STACK;
      },
    },
  ],
};
