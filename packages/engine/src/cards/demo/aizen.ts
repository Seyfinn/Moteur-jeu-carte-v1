import type { CharacterCardDef } from '../types.js';

const BASE_HP = 300;
const HADO_BASE_ATK = 70;

export const aizen: CharacterCardDef = {
  type: 'character',
  id: 'aizen',
  name: 'Aizen',
  baseMaxHP: BASE_HP,
  attacks: [
    {
      id: 'hado-90',
      name: 'Hado #90',
      baseATK: HADO_BASE_ATK,
      description:
        `Inflige ${HADO_BASE_ATK} dégâts à l'actif adverse. Ignore le shield (natif et tout statut de type ` +
        "bouclier) ainsi que tout modificateur de réduction de dégâts adverse ; un death ward adverse peut " +
        'toujours empêcher le KO direct.',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, HADO_BASE_ATK);
        await ctx.dealDamage(target.instanceId, atk, { ignoreShield: true, ignoreDamageReduction: true });
      },
    },
  ],
  abilities: [
    {
      id: 'hypnose-absolue',
      name: 'Hypnose Absolue',
      kind: 'passive',
      description:
        "Quand Aizen est attaqué (attaque ou ability adverse), 40 % de chance que les dégâts soient " +
        "entièrement redirigés vers un personnage du banc allié, désigné par le joueur d'Aizen.",
      // Purement descriptive : le mécanisme réel vit directement dans le pipeline de dégâts
      // (effect-context.ts::dealDamage, identifié par cardId === 'aizen'), pas ici. Aizen doit
      // être protégé dès le tout premier coup subi, avant même d'avoir pu agir une seule fois --
      // onGameStart/onBecomeActive ne se déclenchent pas à la mise en place initiale (voir
      // CLAUDE.md), donc aucun trigger de ce système ne serait fiable pour armer l'effet à temps.
      async execute() {},
    },
    {
      id: 'inversion-de-la-realite',
      name: 'Inversion de la Réalité',
      kind: 'active',
      description:
        "Échange tous les statuts (buffs/debuffs) d'Aizen avec ceux du personnage actif adverse. Le shield, " +
        "les HP et l'ATK de base ne sont pas concernés.",
      async execute(ctx) {
        const opponentActive = ctx.getActive(ctx.opponentId);
        if (!opponentActive) return;
        const self = ctx.getCharacter(ctx.sourceInstanceId);
        const selfStatuses = self.statuses;
        self.statuses = opponentActive.statuses;
        opponentActive.statuses = selfStatuses;
        ctx.log(`${self.cardId} inverse ses statuts avec ${opponentActive.cardId}`, {
          sourceInstanceId: self.instanceId,
          targetInstanceId: opponentActive.instanceId,
        });
      },
    },
  ],
};
