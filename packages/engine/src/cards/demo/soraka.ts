import type { CharacterCardDef } from '../types.js';

const ATTACK_BASE_ATK = 50;
const ATTACK_SELF_HEAL = 50;
const SACRIFICE_COST = 100;
const SACRIFICE_HEAL = 150;

export const soraka: CharacterCardDef = {
  type: 'character',
  id: 'soraka',
  name: 'Soraka',
  baseMaxHP: 160,
  attacks: [
    {
      id: 'don-force',
      name: 'Don forcé',
      baseATK: ATTACK_BASE_ATK,
      // Texte carte : "Heal de 50." — l'ATK 50 affiché inflige les dégâts (implicite, comme les autres attaques), le texte ne décrit que l'effet secondaire.
      description: `Inflige ${ATTACK_BASE_ATK} dégâts à l'actif adverse, puis Soraka se soigne de ${ATTACK_SELF_HEAL}.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (target) {
          const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, ATTACK_BASE_ATK);
          await ctx.dealDamage(target.instanceId, atk);
        }
        ctx.heal(ctx.sourceInstanceId, ATTACK_SELF_HEAL);
      },
    },
  ],
  abilities: [
    {
      id: 'soin-sacrificiel',
      name: 'Soin Sacrificiel',
      kind: 'active',
      description: `Sacrifie ${SACRIFICE_COST}HP pour rendre ${SACRIFICE_HEAL}HP au personnage de votre choix. Utilisable sur le banc. Nécessite plus de ${SACRIFICE_COST}HP actuels (ne peut pas se tuer avec cette ability).`,
      usableFromBench: true,
      condition(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const currentHP = self.currentMaxHP - self.damage;
        return currentHP > SACRIFICE_COST;
      },
      async execute(ctx) {
        const allies = ctx.getAllOnBoard(ctx.ownerId);
        const [targetId] = await ctx.choose({
          kind: 'select-characters',
          prompt: 'Soin Sacrificiel : choisissez le personnage allié à soigner',
          options: allies.map((c) => c.instanceId),
          min: 1,
          max: 1,
        });
        if (!targetId) return;

        await ctx.dealDamage(ctx.sourceInstanceId, SACRIFICE_COST);
        ctx.heal(targetId, SACRIFICE_HEAL);
      },
    },
  ],
};
