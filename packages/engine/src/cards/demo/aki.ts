import type { CharacterCardDef } from '../types.js';
import { getStatus, hasStatus } from '../../statuses.js';
import { getObjectCard } from '../registry.js';

const SABRE_ATK = 55;

const OBJECT_DAMAGE_BONUS = 40;
const ATTACK_HP_GAIN = 20;
const STUN_EFFECTIVE_TURNS = 1;
/** Posé sur l'ennemi pendant SON tour : il doit survivre au tick qui ouvre son tour suivant. */
const STUN_REMAINING_TURNS = STUN_EFFECTIVE_TURNS + 1;

/**
 * Le bonus de dégâts accumulé par "Vision du Futur". `data.bonus` monte de 40 par objet
 * adverse posé et ne redescend qu'une fois qu'Aki a frappé : « cumulable jusqu'à la
 * prochaine attaque d'Aki ». Aucun `remainingTurns` -- ce n'est pas un compte à rebours,
 * c'est une lecture du jeu qui tient tant qu'elle n'a pas servi.
 */
const FORESIGHT_BONUS_STATUS_ID = 'aki-vision-bonus';

/**
 * La mémoire de "Spectre" : le dernier objet adverse posé (`data.cardId`), et si Aki l'a
 * déjà rejoué (`data.consumed`). Une fois consommé, Spectre reste fermé jusqu'à ce que
 * l'adversaire pose une NOUVELLE carte objet, qui réécrit la mémoire à neuf.
 */
const SPECTRE_MEMORY_STATUS_ID = 'aki-spectre-memoire';

export const aki: CharacterCardDef = {
  type: 'character',
  id: 'aki',
  name: 'Aki',
  baseMaxHP: 240,
  attacks: [
    {
      id: 'sabre-d-obsidienne',
      name: "Sabre d'Obsidienne",
      baseATK: SABRE_ATK,
      description: '',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        // Le bonus de Vision du Futur passe par le modifier getEffectiveATK plus bas.
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, SABRE_ATK);
        await ctx.dealDamage(target.instanceId, atk);
        // Dépensé par le coup, qu'il ait touché ou non : c'est la prévision qui se réalise.
        ctx.removeStatus(ctx.sourceInstanceId, FORESIGHT_BONUS_STATUS_ID);
      },
    },
  ],
  abilities: [
    {
      id: 'vision-du-futur',
      name: 'Vision du Futur',
      kind: 'passive',
      description:
        "Si l'ennemi utilise un Objet : +40 dégâts sur la prochaine attaque d'Aki.\nS'il utilise un Actif : Aki va stun au prochain tour.\nS'il effectue une Atk : Gagne 20 HP ",
      // Une seule passive imprimée, trois sortes d'action adverse à surveiller.
      trigger: ['onObjectPlayed', 'onAbilityUsed', 'onAttackDeclared'],
      // Aki lit le jeu où qu'elle soit, et l'adversaire peut enchaîner plusieurs actions
      // dans le même tour : chacune doit compter.
      usableFromBench: true,
      usesPerTurn: Infinity,
      condition(ctx) {
        return ctx.event?.playerId === ctx.opponentId;
      },
      async execute(ctx) {
        const event = ctx.event!;

        if (event.name === 'onObjectPlayed') {
          const objectInstanceId = event.data['objectInstanceId'] as string;
          const played = ctx.state.players[ctx.opponentId].objects[objectInstanceId];

          const self = ctx.getCharacter(ctx.sourceInstanceId);
          const bonus = Number(getStatus(self, FORESIGHT_BONUS_STATUS_ID)?.data?.['bonus'] ?? 0) + OBJECT_DAMAGE_BONUS;
          ctx.removeStatus(ctx.sourceInstanceId, FORESIGHT_BONUS_STATUS_ID);
          ctx.applyStatus(ctx.sourceInstanceId, {
            statusId: FORESIGHT_BONUS_STATUS_ID,
            label: `Vision du Futur (+${bonus})`,
            sourceCardInstanceId: ctx.sourceInstanceId,
            data: { bonus },
          });

          // Même occasion : "Spectre" retient l'objet et redevient utilisable, y compris
          // si Aki avait déjà consommé le précédent.
          if (played) {
            ctx.removeStatus(ctx.sourceInstanceId, SPECTRE_MEMORY_STATUS_ID);
            ctx.applyStatus(ctx.sourceInstanceId, {
              statusId: SPECTRE_MEMORY_STATUS_ID,
              label: 'Spectre (objet repéré)',
              sourceCardInstanceId: ctx.sourceInstanceId,
              hidden: true, // mémoire interne : le joueur voit déjà l'objet dans le journal
              data: { cardId: played.cardId, consumed: false },
            });
          }
          return;
        }

        if (event.name === 'onAbilityUsed') {
          const target = ctx.getActive(ctx.opponentId);
          if (!target) return;
          ctx.applyStatus(target.instanceId, {
            statusId: 'stun',
            label: 'Stun (Vision du Futur)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            remainingTurns: STUN_REMAINING_TURNS,
          });
          return;
        }

        // onAttackDeclared : les 20 HP sont à la fois un soin ET du plafond en plus. Le
        // `keepCurrentHP` est indispensable -- sans lui, monter le plafond soignerait déjà
        // d'autant et Aki gagnerait 40 PV au lieu de 20.
        ctx.raiseMaxHP(ctx.sourceInstanceId, ATTACK_HP_GAIN, { keepCurrentHP: true });
        ctx.heal(ctx.sourceInstanceId, ATTACK_HP_GAIN);
      },
    },
    {
      id: 'spectre',
      name: 'Spectre',
      kind: 'active',
      description: "Vole le dernier Objet utilisé par l'adversaire et l'applique immédiatement",
      condition(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const memory = getStatus(self, SPECTRE_MEMORY_STATUS_ID);
        // Un objet déjà volé ne se revole pas : il faut que l'adversaire en pose un nouveau.
        return !!memory && memory.data?.['consumed'] !== true;
      },
      async execute(ctx) {
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const memory = getStatus(self, SPECTRE_MEMORY_STATUS_ID);
        const cardId = memory?.data?.['cardId'];
        if (typeof cardId !== 'string' || memory?.data?.['consumed'] === true) return;

        // Marquée consommée AVANT de résoudre l'objet : celui-ci peut relancer des events
        // (donc d'autres passives), et la mémoire ne doit pas pouvoir être rejouée entre-temps.
        ctx.removeStatus(ctx.sourceInstanceId, SPECTRE_MEMORY_STATUS_ID);
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: SPECTRE_MEMORY_STATUS_ID,
          label: 'Spectre (objet déjà volé)',
          sourceCardInstanceId: ctx.sourceInstanceId,
          hidden: true,
          data: { cardId, consumed: true },
        });

        ctx.log(`Spectre : Aki rejoue ${getObjectCard(cardId).name}`, {
          kind: 'info',
          characterInstanceId: ctx.sourceInstanceId,
          cardId,
        });
        // Copie jouée pour le compte d'Aki, avec le cycle de vie complet d'un objet posé
        // (mise en jeu, effet, cimetière ou accrochage) mais sans coûter d'objet du tour.
        // L'exemplaire adverse déjà parti au cimetière n'est pas touché : Aki vole l'usage.
        await ctx.playObjectImmediately(cardId);
      },
    },
  ],
  modifiers: [
    {
      // "Vision du Futur" : les +40 par objet adverse, appliqués à la prochaine attaque.
      query: 'getEffectiveATK',
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        const self = ctx.state.players[ctx.sourceOwnerId].characters[ctx.sourceInstanceId];
        if (!self || !hasStatus(self, FORESIGHT_BONUS_STATUS_ID)) return current;
        const bonus = Number(getStatus(self, FORESIGHT_BONUS_STATUS_ID)?.data?.['bonus'] ?? 0);
        return (current as number) + bonus;
      },
    },
  ],
};
