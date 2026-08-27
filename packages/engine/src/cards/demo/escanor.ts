import type { CharacterCardDef, EffectContext } from '../types.js';
import { findCharacter } from '../../queries.js';
import { getStatus, hasStatus } from '../../statuses.js';

const MAX_HP = 340;

const CYCLE_STATUS_ID = 'escanor-cycle';
const AURA_STATUS_ID = 'escanor-aura-solaire';
const AURA_REDUCTION_PERCENT = 50;

const MIN_CYCLE = 1;
const MAX_CYCLE = 4;
const ULTIMATE_PERCENT = 10;
// Second jet, conditionné à l'échec du premier : 45% / (100% - 10%) = 50%, ce qui
// reproduit exactement les probabilités globales imprimées (45 / 45 / 10) avec deux
// jets binaires enchaînés au lieu d'une roue à trois issues (que le moteur ne sait pas
// afficher en un seul jet).
const SUCCESS_PERCENT_AMONG_REMAINING = 50;

const CYCLE_1_ATTACK_ID = 'cycle-1-aube';
const CYCLE_2_ATTACK_ID = 'cycle-2-aura-solaire';
const CYCLE_3_ATTACK_ID = 'cycle-3-vague-solaire';
const CYCLE_4_ATTACK_ID = 'cycle-4-soleil';

const CYCLE_1_ATK = 20;
const CYCLE_2_ATK = 20;
const CYCLE_3_ATK = 15;
const CYCLE_4_ATK = 150;

function getCycle(ctx: EffectContext): number {
  const self = ctx.getCharacter(ctx.sourceInstanceId);
  return Number(getStatus(self, CYCLE_STATUS_ID)?.data?.['cycle'] ?? MIN_CYCLE);
}

function setCycle(ctx: EffectContext, cycle: number): void {
  ctx.removeStatus(ctx.sourceInstanceId, CYCLE_STATUS_ID);
  ctx.applyStatus(ctx.sourceInstanceId, {
    statusId: CYCLE_STATUS_ID,
    label: `Cycle ${cycle}`,
    sourceCardInstanceId: ctx.sourceInstanceId,
    data: { cycle },
  });
}

export const escanor: CharacterCardDef = {
  type: 'character',
  id: 'escanor',
  name: 'Escanor',
  baseMaxHP: MAX_HP,
  attacks: [
    {
      id: CYCLE_1_ATTACK_ID,
      name: 'Cycle 1 - Aube',
      baseATK: CYCLE_1_ATK,
      description: '',
      condition(ctx) {
        return getCycle(ctx) === 1;
      },
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, CYCLE_1_ATK);
        await ctx.dealDamage(target.instanceId, atk);
      },
    },
    {
      id: CYCLE_2_ATTACK_ID,
      name: 'Cycle 2 - Aura Solaire',
      baseATK: CYCLE_2_ATK,
      description: 'Annule 50 % des dégâts subits pendant un tour.',
      condition(ctx) {
        return getCycle(ctx) === 2;
      },
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (target) {
          const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, CYCLE_2_ATK);
          await ctx.dealDamage(target.instanceId, atk);
        }
        ctx.removeStatus(ctx.sourceInstanceId, AURA_STATUS_ID);
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: AURA_STATUS_ID,
          label: 'Aura Solaire',
          sourceCardInstanceId: ctx.sourceInstanceId,
          remainingTurns: 1,
          // Le tour adverse ne doit pas geler la réduction si Escanor est renvoyé au banc
          // entre-temps (cf. Potion force).
          ticksOnBench: true,
        });
      },
    },
    {
      id: CYCLE_3_ATTACK_ID,
      name: 'Cycle 3 - Vague Solaire',
      baseATK: CYCLE_3_ATK,
      description: 'Inflige 15 dégâts à l\'ensemble du banc adverse.',
      condition(ctx) {
        return getCycle(ctx) === 3;
      },
      async execute(ctx) {
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, CYCLE_3_ATK);
        const activeTarget = ctx.getActive(ctx.opponentId);
        if (activeTarget) await ctx.dealDamage(activeTarget.instanceId, atk);
        for (const bench of ctx.getBench(ctx.opponentId)) {
          await ctx.dealDamage(bench.instanceId, atk);
        }
      },
    },
    {
      id: CYCLE_4_ATTACK_ID,
      name: 'Cycle 4 - Soleil',
      baseATK: CYCLE_4_ATK,
      description: 'Retourne au cycle 1 après avoir attaqué avec Soleil',
      condition(ctx) {
        return getCycle(ctx) === MAX_CYCLE;
      },
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, CYCLE_4_ATK);
        await ctx.dealDamage(target.instanceId, atk);
      },
    },
  ],
  abilities: [
    {
      id: 'energie-solaire',
      name: 'Énergie solaire',
      kind: 'passive',
      description:
        "Escanor commence la partie au cycle 1, et ne peut que utiliser l'attaque correspondant à son cycle actuel. Attaquer fait augmenter le cycle actuel de 1.",
      trigger: ['onGameStart', 'onAttackDeclared'],
      // onGameStart peut tomber alors qu'Escanor est encore sur le banc.
      usableFromBench: true,
      usesPerTurn: Infinity,
      condition(ctx) {
        const event = ctx.event;
        if (!event) return false;
        if (event.name === 'onGameStart') return true;
        return event.data['characterInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        const event = ctx.event!;
        if (event.name === 'onGameStart') {
          setCycle(ctx, MIN_CYCLE);
          return;
        }
        // onAttackDeclared : Soleil (cycle 4) revient directement au cycle 1 -- les
        // autres attaques font avancer le cycle d'un cran (1→2→3→4).
        const attackId = event.data['attackId'] as string;
        if (attackId === CYCLE_4_ATTACK_ID) {
          setCycle(ctx, MIN_CYCLE);
        } else {
          setCycle(ctx, Math.min(MAX_CYCLE, getCycle(ctx) + 1));
        }
      },
    },
    {
      id: 'orgueil-absolu',
      name: 'Orgueil absolu',
      kind: 'active',
      description:
        "Réussite (45 %) : Augmente d'un cycle\nÉchec (45 %) : Recule d'un cycle. S'il est déjà au cycle 1, ne peut pas infliger de dégâts ce tour.\nOrgueil Ultime (10 %) : Passe au cycle 4 directement.",
      async execute(ctx) {
        const cycle = getCycle(ctx);

        const ultimate = ctx.rollChance(ULTIMATE_PERCENT, 'Orgueil Ultime', {
          characterInstanceId: ctx.sourceInstanceId,
        });
        if (ultimate) {
          setCycle(ctx, MAX_CYCLE);
          return;
        }

        const success = ctx.rollChance(SUCCESS_PERCENT_AMONG_REMAINING, 'Orgueil absolu : réussite', {
          characterInstanceId: ctx.sourceInstanceId,
        });
        if (success) {
          if (cycle < MAX_CYCLE) setCycle(ctx, cycle + 1);
          return;
        }

        if (cycle > MIN_CYCLE) {
          setCycle(ctx, cycle - 1);
          return;
        }
        // Déjà au cycle 1 : le recul est bloqué, remplacé par l'incapacité à infliger des
        // dégâts ce tour-ci (statut générique disarmed, retiré avant son prochain tour).
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: 'disarmed',
          label: 'Orgueil absolu (échec)',
          sourceCardInstanceId: ctx.sourceInstanceId,
          remainingTurns: 1,
        });
      },
    },
  ],
  modifiers: [
    {
      // Aura Solaire : réduction de 50% des dégâts subits tant que le statut est présent.
      query: 'getIncomingDamageAmount',
      transform(ctx, current) {
        if (ctx.query['targetInstanceId'] !== ctx.sourceInstanceId) return current;
        const self = findCharacter(ctx.state, ctx.sourceInstanceId);
        if (!hasStatus(self, AURA_STATUS_ID)) return current;
        return Math.round((current as number) * (1 - AURA_REDUCTION_PERCENT / 100));
      },
    },
  ],
};
