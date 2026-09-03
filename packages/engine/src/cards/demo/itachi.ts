import type { CharacterCardDef } from '../types.js';
import { EVASIVE_STATUS_CHANCE_PERCENT, getStatus } from '../../statuses.js';

const KATON_ATK = 40;
const KATON_BURN_CHANCE_PERCENT = 60;
// Brûlure : statut qui tique, remainingTurns = nombre de tics voulu, pas de +1 (cf. CLAUDE.md).
const KATON_BURN_REMAINING_TURNS = 1;

/** Même lecture que Kakashi/L'Infini de Gojo : « l'effet esquive », donc le taux du moteur. */
const SHARINGAN_EVASION_PERCENT = EVASIVE_STATUS_CHANCE_PERCENT;

const PLUMES_STATUS_ID = 'itachi-corbeaux-plumes';
const PLUMES_MAX = 5;
const PLUMES_SILENCE_THRESHOLD = 3;
const PLUMES_GAIN_ATTACK = 1;
const PLUMES_GAIN_ABILITY = 3;
// Statuts bloquants : +1 (cf. CLAUDE.md) -- "pendant un tour"/"pendant 1 tour" = 1 tour bloqué.
const SILENCE_ULTIME_REMAINING_TURNS = 2;
const TSUKUYOMI_STUN_REMAINING_TURNS = 2;

export const itachi: CharacterCardDef = {
  type: 'character',
  id: 'itachi',
  name: 'Itachi',
  baseMaxHP: 210,
  attacks: [
    {
      id: 'katon-boule-de-feu',
      name: 'Katon (Boule de Feu)',
      baseATK: KATON_ATK,
      description: "A 60% d'appliquer Burn pendant un tour",
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const damageBefore = ctx.getCharacter(target.instanceId).damage;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, KATON_ATK);
        await ctx.dealDamage(target.instanceId, atk);

        const landed = ctx.getCharacter(target.instanceId).damage > damageBefore;
        if (landed && ctx.rollChance(KATON_BURN_CHANCE_PERCENT, 'Burn', { characterInstanceId: target.instanceId })) {
          ctx.applyStatus(target.instanceId, {
            statusId: 'burn',
            label: 'Burn (Katon)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            remainingTurns: KATON_BURN_REMAINING_TURNS,
          });
        }
      },
    },
  ],
  abilities: [
    {
      id: 'sharingan',
      name: 'Sharingan',
      kind: 'passive',
      description: "Bénéficie de l'effet esquive ",
      // Purement descriptive : implémentée par le modifier 'getEvasionPercent' plus bas
      // (même mécanisme que Kakashi / L'Infini de Gojo).
      async execute() {},
    },
    {
      id: 'illusion-des-corbeaux',
      name: 'Illusion des Corbeaux',
      kind: 'passive',
      description:
        `Des plumes s'accumulent sur les personnages adverses (max 5) :
Gains : Un ennemi reçoit 1 plume chaque fois qu'il lance une attaque à Itachi
Il reçoit 3 plumes s'il utilise une capacité active
Effets sur l'adversaire :
3 plumes : Est réduit au Silence Ultime pendant un tour
5 plumes (Tsukuyomi) :  est Stun pendant 1 tour, puis toutes ses plumes sont consommées`,
      trigger: ['onAttackDeclared', 'onAbilityUsed'],
      // Pas de usableFromBench (choix assumé) : la surveillance ne tourne que quand Itachi
      // est lui-même actif -- une attaque adverse ne peut de toute façon viser Itachi que
      // dans ce cas (les attaques visent toujours l'actif adverse).
      usesPerTurn: Infinity,
      condition(ctx) {
        return ctx.event?.playerId === ctx.opponentId;
      },
      async execute(ctx) {
        const event = ctx.event!;
        const data = event.data as { characterInstanceId: string };
        const targetId = data.characterInstanceId;
        const gain = event.name === 'onAttackDeclared' ? PLUMES_GAIN_ATTACK : PLUMES_GAIN_ABILITY;

        const enemy = ctx.getCharacter(targetId);
        const before = Number(getStatus(enemy, PLUMES_STATUS_ID)?.data?.['count'] ?? 0);
        const rawAfter = before + gain;

        if (rawAfter >= PLUMES_MAX) {
          // Tsukuyomi : prime sur le palier 3 plumes si un seul gain franchit les deux
          // seuils d'un coup (ex: 2 -> 5 via une capacité active) -- stun immédiat, puis
          // toutes les plumes sont consommées (le compteur est retiré, pas juste remis à 0).
          ctx.removeStatus(targetId, PLUMES_STATUS_ID);
          ctx.applyStatus(targetId, {
            statusId: 'stun',
            label: 'Stun (Tsukuyomi)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            remainingTurns: TSUKUYOMI_STUN_REMAINING_TURNS,
          });
          return;
        }

        ctx.removeStatus(targetId, PLUMES_STATUS_ID);
        ctx.applyStatus(targetId, {
          statusId: PLUMES_STATUS_ID,
          label: `Illusion des Corbeaux (${rawAfter}/${PLUMES_MAX})`,
          sourcePlayerId: ctx.ownerId,
          sourceCardInstanceId: ctx.sourceInstanceId,
          data: { count: rawAfter },
        });

        // Silence Ultime ne se (re)déclenche qu'au moment où le compteur franchit 3 pour la
        // première fois depuis le dernier reset -- pas à chaque gain tant qu'il reste à 3-4.
        const crossedThreshold = before < PLUMES_SILENCE_THRESHOLD && rawAfter >= PLUMES_SILENCE_THRESHOLD;
        if (crossedThreshold) {
          ctx.applyStatus(targetId, {
            statusId: 'silence-ultimate',
            label: 'Silence Ultime (Illusion des Corbeaux)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            remainingTurns: SILENCE_ULTIME_REMAINING_TURNS,
          });
        }
      },
    },
  ],
  modifiers: [
    {
      // "Sharingan" : esquive innée permanente. Passive imprimée, donc coupée par le
      // silence passif / ultime (cf. Kakashi / L'Infini de Gojo).
      query: 'getEvasionPercent',
      silencedByPassive: true,
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        return Math.max(current as number, SHARINGAN_EVASION_PERCENT);
      },
    },
  ],
};
