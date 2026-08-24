import type { CharacterCardDef } from '../types.js';

const BLACKFLASH_ATK = 55;
const BLACKFLASH_CRIT_PERCENT = 33;
const INFINI_EVASION_PERCENT = 33;

// Ciblé sur l'ennemi pendant le tour de Gojo -> +1 (même correction que le Silence
// Ultime de Zoé, voir zoe.ts : le premier tick du statut a lieu au tout début du tour
// suivant, celui de la cible, donc remainingTurns doit dépasser de 1 le nombre de
// tours à bloquer réellement pour survivre jusque-là).
const STUN_EFFECTIVE_TURNS = 1;
const STUN_REMAINING_TURNS = STUN_EFFECTIVE_TURNS + 1;

export const gojoSatoru: CharacterCardDef = {
  type: 'character',
  id: 'gojo-satoru',
  name: 'Gojo Satoru',
  baseMaxHP: 190,
  attacks: [
    {
      id: 'blackflash',
      name: 'Blackflash',
      baseATK: BLACKFLASH_ATK,
      description: `Inflige ${BLACKFLASH_ATK} dégâts à l'actif adverse. ${BLACKFLASH_CRIT_PERCENT}% de chance de critique.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;

        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, BLACKFLASH_ATK);
        await ctx.dealDamage(target.instanceId, atk);
      },
    },
  ],
  abilities: [
    {
      id: 'infini',
      name: "L'Infini",
      kind: 'passive',
      description: "Gojo bénéficie en permanence de l'effet Esquive, qu'il soit actif ou au banc.",
      // Purement descriptive : implémentée par le modifier 'getEvasionPercent' plus bas.
      // Un modifier vit tant que la carte est en jeu, donc l'esquive est acquise dès le
      // premier coup de la partie, ne peut pas être dissipée comme un statut, et
      // survit à une résurrection (reviveCharacter vide les statuts).
      async execute() {},
    },
    {
      id: 'extension-du-territoire',
      name: 'Extension du Territoire',
      kind: 'active',
      description: `Inflige Stun au personnage actif adverse pendant son prochain tour. Utilisable une seule fois par partie.`,
      usesPerGame: 1,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        ctx.applyStatus(target.instanceId, {
          statusId: 'stun',
          label: 'Stun (Extension du Territoire)',
          sourcePlayerId: ctx.ownerId,
          sourceCardInstanceId: ctx.sourceInstanceId,
          remainingTurns: STUN_REMAINING_TURNS,
        });
      },
    },
  ],
  modifiers: [
    {
      // "L'Infini" : esquive innée permanente, actif ou au banc.
      query: 'getEvasionPercent',
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        return Math.max(current as number, INFINI_EVASION_PERCENT);
      },
    },
    {
      // "Blackflash" : chance de critique innée, sans statut à poser.
      query: 'getCriticalPercent',
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        return Math.max(current as number, BLACKFLASH_CRIT_PERCENT);
      },
    },
  ],
};
