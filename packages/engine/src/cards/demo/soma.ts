import type { CharacterCardDef } from '../types.js';
import { hasStatus, getStatus } from '../../statuses.js';

const COUTEAU_ATK = 40;
const COUTEAU_BLEED_STACKS = 1;

const MENU_SURPRISE_COOLDOWN_STATUS_ID = 'soma-menu-surprise-cooldown';
// "Ne peut pas être utilisée les 2 prochains tours" : +1 (cf. CLAUDE.md), comme la Traque de Chopper.
const MENU_SURPRISE_COOLDOWN_REMAINING_TURNS = 3;
const MENU_SURPRISE_HEAL = 80;
const MENU_SURPRISE_STUN_REMAINING_TURNS = 2;
const MENU_SURPRISE_REFUSE_DAMAGE = 50;
const MENU_SURPRISE_REFUSE_SILENCE_REMAINING_TURNS = 2;

export const soma: CharacterCardDef = {
  type: 'character',
  id: 'soma',
  name: 'Soma',
  baseMaxHP: 220,
  attacks: [
    {
      id: 'couteau-de-chef',
      name: 'Couteau de Chef',
      baseATK: COUTEAU_ATK,
      description: 'Applique 1 de bleed',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        // Statut garanti au contact : soit l'attaque touche et les deux effets
        // s'appliquent, soit elle est esquivée et rien ne se passe (cf. Chainsaw Man / Sukuna).
        if (ctx.rollEvasion(target.instanceId)) return;

        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, COUTEAU_ATK);
        await ctx.dealDamage(target.instanceId, atk, { skipEvasionRoll: true });
        ctx.applyStatus(target.instanceId, {
          statusId: 'bleed',
          label: 'Bleed (Couteau de Chef)',
          sourcePlayerId: ctx.ownerId,
          sourceCardInstanceId: ctx.sourceInstanceId,
          data: { stacks: COUTEAU_BLEED_STACKS },
        });
      },
    },
  ],
  abilities: [
    {
      id: 'menu-surprise',
      name: 'Menu Surprise',
      kind: 'active',
      description:
        "Ne peut pas être utiliser les 2 prochains tours après avoir été utilisé\nSoma cuisine un plat mystérieux et force le personnage sur le poste actif adverse à choisir instantanément entre deux options :\nManger le plat : Si vous mangez le plat vous soigne de 80 HP, mais l'extase culinaire Stun 1 tour.\nRefuser le plat : Si vous refusez le plat, vous subissez 50 dégâts et Silence passif pendant 1 tour",
      condition(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        return !hasStatus(self, MENU_SURPRISE_COOLDOWN_STATUS_ID);
      },
      async execute(ctx) {
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: MENU_SURPRISE_COOLDOWN_STATUS_ID,
          label: 'Menu Surprise (recharge)',
          remainingTurns: MENU_SURPRISE_COOLDOWN_REMAINING_TURNS,
          // Une recharge descend même au banc (cf. Traque de Chopper).
          ticksOnBench: true,
        });

        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const targetId = target.instanceId;

        // C'est l'ADVERSAIRE qui subit le plat et doit choisir, pas Soma : chooseOptionFor
        // adresse la question à ctx.opponentId (cf. Offrande du Dieu de la Mort).
        const choice = await ctx.chooseOptionFor(
          ctx.opponentId,
          'Menu Surprise : Soma vous sert un plat mystérieux. Que faites-vous ?',
          [
            { key: 'manger', label: 'Manger le plat (soigne 80 HP, mais Stun 1 tour)' },
            { key: 'refuser', label: 'Refuser le plat (subir 50 dégâts et Silence passif 1 tour)' },
          ]
        );

        if (choice === 'manger') {
          ctx.heal(targetId, MENU_SURPRISE_HEAL);
          ctx.applyStatus(targetId, {
            statusId: 'stun',
            label: 'Stun (Extase culinaire)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            remainingTurns: MENU_SURPRISE_STUN_REMAINING_TURNS,
          });
        } else {
          await ctx.dealDamage(targetId, MENU_SURPRISE_REFUSE_DAMAGE);
          ctx.applyStatus(targetId, {
            statusId: 'silence-passive',
            label: 'Silence passif (Menu Surprise)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            remainingTurns: MENU_SURPRISE_REFUSE_SILENCE_REMAINING_TURNS,
          });
        }
      },
    },
    {
      id: 'sabotage-de-recette',
      name: 'Sabotage de Recette',
      kind: 'passive',
      description:
        "Chaque fois que l'adversaire joue une carte Objet Soma réduit immédiatement la recharge de sa capacité Menu Surprise de 1 tour.",
      trigger: 'onObjectPlayed',
      // Doit continuer de réduire la recharge même si Soma est au banc.
      usableFromBench: true,
      usesPerTurn: Infinity,
      condition(ctx) {
        if (ctx.event?.playerId !== ctx.opponentId) return false;
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        return hasStatus(self, MENU_SURPRISE_COOLDOWN_STATUS_ID);
      },
      async execute(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const cooldown = getStatus(self, MENU_SURPRISE_COOLDOWN_STATUS_ID);
        if (!cooldown) return;

        const remaining = (cooldown.remainingTurns ?? 0) - 1;
        ctx.removeStatus(ctx.sourceInstanceId, MENU_SURPRISE_COOLDOWN_STATUS_ID);
        if (remaining > 0) {
          ctx.applyStatus(ctx.sourceInstanceId, {
            statusId: MENU_SURPRISE_COOLDOWN_STATUS_ID,
            label: 'Menu Surprise (recharge)',
            remainingTurns: remaining,
            ticksOnBench: true,
          });
        }
      },
    },
  ],
};
