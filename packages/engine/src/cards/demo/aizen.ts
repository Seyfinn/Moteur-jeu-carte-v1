import type { CharacterCardDef } from '../types.js';
import { BUILTIN_STATUS_IDS } from '../../statuses.js';
import { cardName } from '../../names.js';

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
        `Inflige ${HADO_BASE_ATK} dégâts à l'actif adverse en traversant tous les boucliers et toutes les ` +
        "réductions de dégâts. Seule une protection contre la mort (Détermination) peut encore empêcher le KO.",
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
        "Échange les altérations d'Aizen (buffs comme malus) avec celles du personnage actif adverse. " +
        "Le bouclier, les HP et l'ATK de base ne bougent pas, et les compteurs internes de chaque carte " +
        "restent chez leur propriétaire.",
      async execute(ctx) {
        const opponentActive = ctx.getActive(ctx.opponentId);
        if (!opponentActive) return;
        const self = ctx.getCharacter(ctx.sourceInstanceId);

        // Seuls les statuts génériques du moteur (buffs/debuffs que n'importe quelle carte
        // subit de la même façon) changent de camp. Le bookkeeping propre à une carte --
        // le record de dégâts de Guts, la réserve de Mana Barrier de Blitzcrank, la mémoire
        // de Kakashi -- reste chez son propriétaire : déplacé sur une carte incapable de le
        // lire, il était purement et simplement supprimé, annulant en silence plusieurs
        // tours d'accumulation.
        const keep = (statuses: typeof self.statuses) => statuses.filter((s) => !BUILTIN_STATUS_IDS.has(s.statusId));
        const swap = (statuses: typeof self.statuses) => statuses.filter((s) => BUILTIN_STATUS_IDS.has(s.statusId));
        const selfSwapped = swap(self.statuses);
        self.statuses = [...keep(self.statuses), ...swap(opponentActive.statuses)];
        opponentActive.statuses = [...keep(opponentActive.statuses), ...selfSwapped];
        ctx.log(`${cardName(self.cardId)} inverse ses statuts avec ${cardName(opponentActive.cardId)}`, {
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
