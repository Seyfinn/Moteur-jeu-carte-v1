import type { CharacterCardDef } from '../types.js';
import { getStatus } from '../../statuses.js';
import { cardName } from '../../names.js';

const GRIFFES_ATK = 30;
const VULNERABLE_CHANCE_PERCENT = 40;
const VULNERABLE_EFFECTIVE_TURNS = 1;
// Ciblé sur l'ennemi pendant le tour de Black Panther -> +1. Sans ça,
// tickStatusesAtTurnStart le retirerait au tout début du tour adverse, donc avant que
// Black Panther ait pu frapper une seule fois une cible réellement vulnérable (même
// correction que le Silence de Zoé, le Désarmement de Sion/Killua).
const VULNERABLE_REMAINING_TURNS = VULNERABLE_EFFECTIVE_TURNS + 1;

const STORE_PERCENT = 40;
/** Réserve d'énergie cinétique. Volontairement VISIBLE : le joueur doit voir ce qu'il a en banque. */
const ENERGY_STATUS_ID = 'black-panther-kinetic-energy';

export const blackPanther: CharacterCardDef = {
  type: 'character',
  id: 'black-panther',
  name: 'Black Panther',
  baseMaxHP: 360,
  attacks: [
    {
      id: 'griffes',
      name: 'Griffes',
      baseATK: GRIFFES_ATK,
      description: `${VULNERABLE_CHANCE_PERCENT}% de chance d'infliger vulnérable pendant ${VULNERABLE_EFFECTIVE_TURNS} tour.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const damageBefore = ctx.getCharacter(target.instanceId).damage;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, GRIFFES_ATK);
        await ctx.dealDamage(target.instanceId, atk);

        // Même convention que Sion/Killua/Chopper : le jet n'a lieu que si le coup a
        // réellement entamé la cible (esquive ratée, dégâts non intégralement absorbés).
        const landed = ctx.getCharacter(target.instanceId).damage > damageBefore;
        if (landed && ctx.rollChance(VULNERABLE_CHANCE_PERCENT, 'Vulnérable', { characterInstanceId: target.instanceId })) {
          ctx.applyStatus(target.instanceId, {
            statusId: 'vulnerable',
            label: 'Vulnérable (Griffes)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            remainingTurns: VULNERABLE_REMAINING_TURNS,
          });
        }
      },
    },
  ],
  abilities: [
    {
      id: 'energie-cinetique',
      name: 'Energie Cinétique',
      kind: 'active',
      description:
        `Black Panther stock ${STORE_PERCENT}% des dégâts qu'il reçoit. Peut relacher cette énergie stocké ` +
        "à l'ennemi actif. Utilisable une fois.",
      // « Utilisable une fois » porte sur la LIBÉRATION seule : le stockage, lui, tourne en
      // permanence via le passive ci-dessous, dès le début de partie et jusqu'à la fin.
      usesPerGame: 1,
      condition(ctx) {
        const stored = Number(getStatus(ctx.getCharacter(ctx.sourceInstanceId), ENERGY_STATUS_ID)?.data?.['stored'] ?? 0);
        return stored > 0; // rien en réserve : ne pas laisser gâcher l'unique utilisation
      },
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const stored = Number(getStatus(self, ENERGY_STATUS_ID)?.data?.['stored'] ?? 0);
        if (stored <= 0) return;

        ctx.removeStatus(ctx.sourceInstanceId, ENERGY_STATUS_ID);
        ctx.log(`Energie Cinétique : Black Panther relâche ${stored} dégâts sur ${cardName(target.cardId)}`, {
          characterInstanceId: ctx.sourceInstanceId,
          amount: stored,
        });
        await ctx.dealDamage(target.instanceId, stored);
      },
    },
    {
      // Le stockage proprement dit. Second AbilityDef parce que « Energie Cinétique » doit
      // rester activable manuellement (kind: 'active' SANS trigger -- voir CLAUDE.md), alors
      // que l'accumulation, elle, réagit à un event : les deux ne peuvent pas cohabiter dans
      // la même AbilityDef. Même découpage que Chainsaw Man / la mémoire de Zoé et Kakashi.
      id: 'energie-cinetique-stockage',
      name: 'Energie Cinétique (réserve)',
      kind: 'passive',
      description: `Accumule ${STORE_PERCENT}% des dégâts subis par Black Panther, en réserve pour Energie Cinétique.`,
      trigger: 'afterDamage',
      // Il encaisse aussi au banc (AoE, tics de poison/brûlure/saignement), et peut se faire
      // toucher plusieurs fois dans un même tour.
      usableFromBench: true,
      usesPerTurn: Infinity,
      condition(ctx) {
        return ctx.event?.data['targetInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        // Montant brut du coup tel qu'il l'a atteint : `amount` (PV réellement perdus) plus
        // ce que le bouclier a mangé -- la réserve monte donc même quand un bouclier le
        // protège entièrement. En revanche, une réduction de dégâts en amont (Bouclier
        // Ultime) diminue bien le brut : ce coup-là ne l'a jamais atteint.
        const amount = Number(ctx.event?.data['amount'] ?? 0);
        const shieldAbsorbed = Number(ctx.event?.data['shieldAbsorbed'] ?? 0);
        const gross = amount + shieldAbsorbed;
        if (gross <= 0) return;

        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const existing = getStatus(self, ENERGY_STATUS_ID);
        const stored = Number(existing?.data?.['stored'] ?? 0) + Math.round(gross * (STORE_PERCENT / 100));

        // Pas d'API "update" sur un statut : on retire puis on repose (cf. CLAUDE.md).
        if (existing) ctx.removeStatus(ctx.sourceInstanceId, ENERGY_STATUS_ID);
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: ENERGY_STATUS_ID,
          label: `Energie Cinétique (${stored})`,
          sourcePlayerId: ctx.ownerId,
          sourceCardInstanceId: ctx.sourceInstanceId,
          // Pas de remainingTurns : la réserve ne s'évapore pas, elle attend sa libération.
          data: { stored },
        });
      },
    },
  ],
};
