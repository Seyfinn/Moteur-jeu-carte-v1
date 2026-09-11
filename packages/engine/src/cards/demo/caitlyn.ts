import type { CharacterCardDef } from '../types.js';
import { hasStatus } from '../../statuses.js';
import { findCharacter } from '../../queries.js';

const HEADSHOT_DAMAGE = 125;
const BASE_CRIT_PERCENT = 33;
const EXECUTION_CRIT_PERCENT = 50;

/** Marqueur permanent posé au premier kill de Caitlyn -- lu par le modifier de critique. */
const EXECUTION_UPGRADED_STATUS_ID = 'caitlyn-execution-upgraded';

export const caitlyn: CharacterCardDef = {
  type: 'character',
  id: 'caitlyn',
  name: 'Caitlyn',
  baseMaxHP: 200,
  attacks: [
    {
      id: 'headshot',
      name: 'Headshot',
      baseATK: HEADSHOT_DAMAGE,
      description: 'Cette attaque peut crit',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, HEADSHOT_DAMAGE);
        await ctx.dealDamage(target.instanceId, atk);
      },
    },
  ],
  abilities: [
    {
      id: 'execution',
      name: 'Execution',
      kind: 'passive',
      description: 'Si caitlyn tue un ennemi, elle a désormais 50% de chance de crit au lieu de 33%.',
      trigger: 'onCharacterKO',
      // Le kill peut arriver n'importe quand (y compris pendant qu'elle est au banc,
      // via un effet différé), et plusieurs fois dans un même tour.
      usableFromBench: true,
      usesPerTurn: Infinity,
      condition(ctx) {
        // onCharacterKO nomme désormais le tueur (data.killerInstanceId), donc plus
        // besoin de détecter le kill depuis l'attaque elle-même.
        if (ctx.event?.data['killerInstanceId'] !== ctx.sourceInstanceId) return false;
        return !hasStatus(ctx.getCharacter(ctx.sourceInstanceId), EXECUTION_UPGRADED_STATUS_ID);
      },
      async execute(ctx) {
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: EXECUTION_UPGRADED_STATUS_ID,
          label: 'Execution (amélioré)',
          sourceCardInstanceId: ctx.sourceInstanceId,
        });
        ctx.log(`Execution se déclenche : Caitlyn passe à ${EXECUTION_CRIT_PERCENT}% de critique pour le reste de la partie`, {
          characterInstanceId: ctx.sourceInstanceId,
        });
      },
    },
  ],
  // Deux modifiers et pas un seul, parce que les deux taux ne viennent pas du même texte :
  // le 33 % de base est celui de l'attaque ("Headshot : cette attaque peut crit"), la montée
  // à 50 % est celle de la passive "Execution". Un silence passif ne ferme pas les attaques
  // (cf. CLAUDE.md) : il doit donc faire retomber Caitlyn à 33 %, pas à 5 %.
  modifiers: [
    {
      // Le taux de base de Headshot. Un modifier plutôt qu'un statut 'critical' : actif dès
      // le premier tir, et impossible à dissiper ou à voler avec les statuts.
      query: 'getCriticalPercent',
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        return Math.max(current as number, BASE_CRIT_PERCENT);
      },
    },
    {
      // L'amélioration définitive d'"Execution" -- passive imprimée, donc coupée par le
      // silence passif / ultime.
      query: 'getCriticalPercent',
      silencedByPassive: true,
      transform(ctx, current) {
        if (ctx.query['characterInstanceId'] !== ctx.sourceInstanceId) return current;
        const self = findCharacter(ctx.state, ctx.sourceInstanceId);
        if (!hasStatus(self, EXECUTION_UPGRADED_STATUS_ID)) return current;
        return Math.max(current as number, EXECUTION_CRIT_PERCENT);
      },
    },
  ],
};
