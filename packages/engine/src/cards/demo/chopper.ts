import type { CharacterCardDef } from '../types.js';
import { chancePercent } from '../../rng.js';
import { hasStatus } from '../../statuses.js';

const HEAVY_POINT_ATK = 60;
const POISON_CHANCE_PERCENT = 33;
// Poison tique sans condition sur remainingTurns (voir muzan.ts) : remainingTurns
// correspond directement au nombre de tics voulu, pas de +1 comme pour un statut
// bloquant (Stun/Désarmé/Silence).
const POISON_REMAINING_TURNS = 1;

const TRAQUE_HEAL_AMOUNT = 70;
const TRAQUE_COOLDOWN_EFFECTIVE_TURNS = 3;
// Posé sur soi-même pendant son propre tour -> +1 (même correction que Spell Thief de
// Zoé, voir zoe.ts) : utilisée au tour N, réutilisable au tour N+4.
const TRAQUE_COOLDOWN_REMAINING_TURNS = TRAQUE_COOLDOWN_EFFECTIVE_TURNS + 1;
const TRAQUE_COOLDOWN_STATUS_ID = 'chopper-traque-cooldown';

export const chopper: CharacterCardDef = {
  type: 'character',
  id: 'chopper',
  name: 'Chopper',
  baseMaxHP: 250,
  attacks: [
    {
      id: 'heavy-point',
      name: 'Heavy Point',
      baseATK: HEAVY_POINT_ATK,
      description: `Inflige ${HEAVY_POINT_ATK} dégâts à l'actif adverse. Si les dégâts passent réellement (pas d'esquive), ${POISON_CHANCE_PERCENT}% de chance d'appliquer Poison pendant ${POISON_REMAINING_TURNS} tour.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const damageBefore = ctx.getCharacter(target.instanceId).damage;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, HEAVY_POINT_ATK);
        await ctx.dealDamage(target.instanceId, atk);

        const landed = ctx.getCharacter(target.instanceId).damage > damageBefore;
        if (landed && chancePercent(ctx.state.rng, POISON_CHANCE_PERCENT)) {
          ctx.applyStatus(target.instanceId, {
            statusId: 'poison',
            label: 'Poison (Heavy Point)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            remainingTurns: POISON_REMAINING_TURNS,
          });
        }
      },
    },
  ],
  abilities: [
    {
      id: 'traque',
      name: 'Traque',
      kind: 'active',
      description: `Soigne un personnage allié au choix (actif ou banc) de ${TRAQUE_HEAL_AMOUNT} HP. Utilisable même depuis le banc. Rechargement : ${TRAQUE_COOLDOWN_EFFECTIVE_TURNS} tours après usage.`,
      usableFromBench: true,
      condition(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        return !hasStatus(self, TRAQUE_COOLDOWN_STATUS_ID);
      },
      async execute(ctx) {
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: TRAQUE_COOLDOWN_STATUS_ID,
          label: 'Traque (recharge)',
          remainingTurns: TRAQUE_COOLDOWN_REMAINING_TURNS,
        });

        const allies = ctx.getAllOnBoard(ctx.ownerId);
        const [targetId] = await ctx.choose({
          kind: 'select-characters',
          prompt: 'Traque : choisissez le personnage allié à soigner',
          options: allies.map((c) => c.instanceId),
          min: 1,
          max: 1,
        });
        if (!targetId) return;
        ctx.heal(targetId, TRAQUE_HEAL_AMOUNT);
      },
    },
  ],
};
