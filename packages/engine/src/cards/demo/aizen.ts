import type { CharacterCardDef } from '../types.js';

const BASE_HP = 300;
const HADO_BASE_ATK = 70;
const REDIRECT_PERCENT = 40;

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
        `Quand Aizen est attaqué (attaque ou ability adverse), ${REDIRECT_PERCENT} % de chance que les dégâts soient ` +
        "entièrement redirigés vers un personnage du banc allié, désigné par le joueur d'Aizen.",
      // Purement descriptive : le mécanisme vit dans le modifier 'getDamageRedirectPercent'
      // ci-dessous. Un modifier est scanné en continu tant que la carte est en jeu, donc
      // l'effet est actif dès le tout premier coup subi -- sans dépendre d'un trigger de
      // mise en place, et il suit automatiquement les clones et les Métamorphes.
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
  modifiers: [
    {
      // "Hypnose Absolue" : requête générique du moteur -- le pipeline de dégâts tire le
      // pourcentage et demande au camp d'Aizen quel personnage du banc encaisse à sa place.
      query: 'getDamageRedirectPercent',
      transform(ctx, current) {
        if (ctx.query['targetInstanceId'] !== ctx.sourceInstanceId) return current;
        return Math.max(current as number, REDIRECT_PERCENT);
      },
    },
  ],
};
