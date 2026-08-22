import type { AttackDef, CharacterCardDef } from '../types.js';
import { chancePercent } from '../../rng.js';

const BASE_ATK = 35;
const DISARM_CHANCE_PERCENT = 33;
const DISARM_EFFECTIVE_TURNS = 1;
// +1 : voir katarina.ts pour l'explication (le tick de statuses.ts décrémente PUIS
// filtre, avant que le joueur actif ne puisse agir ce tour-là).
const DISARM_REMAINING_TURNS = DISARM_EFFECTIVE_TURNS + 1;

const SHIELD_BASE = 50;
const SHIELD_PER_ENEMY_IN_GRAVEYARD = 50;

const hacheGeante: AttackDef = {
  id: 'hache-geante',
  name: 'Hache géante',
  baseATK: BASE_ATK,
  description: `Inflige ${BASE_ATK} dégâts à l'actif adverse. Si des dégâts passent réellement (pas d'esquive), ${DISARM_CHANCE_PERCENT}% de chance de désarmer la cible pendant ${DISARM_EFFECTIVE_TURNS} tour.`,
  async execute(ctx) {
    const target = ctx.getActive(ctx.opponentId);
    if (!target) return;
    const damageBefore = ctx.getCharacter(target.instanceId).damage;
    const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, BASE_ATK);
    await ctx.dealDamage(target.instanceId, atk);

    const landed = ctx.getCharacter(target.instanceId).damage > damageBefore;
    if (landed && chancePercent(ctx.state.rng, DISARM_CHANCE_PERCENT)) {
      ctx.applyStatus(target.instanceId, {
        statusId: 'disarmed',
        label: 'Désarmé (Hache géante)',
        sourcePlayerId: ctx.ownerId,
        sourceCardInstanceId: ctx.sourceInstanceId,
        remainingTurns: DISARM_REMAINING_TURNS,
      });
    }
  },
};

export const sion: CharacterCardDef = {
  type: 'character',
  id: 'sion',
  name: 'Sion',
  baseMaxHP: 500,
  attacks: [hacheGeante],
  abilities: [
    {
      id: 'essence-vitale',
      name: 'Essence vitale',
      kind: 'active',
      description: `Sion gagne ${SHIELD_BASE} de shield, augmenté de ${SHIELD_PER_ENEMY_IN_GRAVEYARD} par personnage ennemi dans le cimetière adverse. Utilisable une fois par partie.`,
      usesPerGame: 1,
      async execute(ctx) {
        const enemyGraveyardCount = ctx.state.players[ctx.opponentId].graveyardCharacterInstanceIds.length;
        const amount = SHIELD_BASE + SHIELD_PER_ENEMY_IN_GRAVEYARD * enemyGraveyardCount;
        ctx.addShield(ctx.sourceInstanceId, amount);
      },
    },
    {
      id: 'guerrier-mourant',
      name: 'Guerrier mourrant',
      kind: 'passive',
      description: "Lorsqu'il meurt, Sion attaque une dernière fois (Hache géante) le personnage actif ennemi.",
      trigger: 'onCharacterKO',
      // koCharacter (zones.ts) retire Sion de l'actif/banc AVANT d'émettre l'event --
      // sans usableFromBench, canUseAbility le bloquerait ("actif uniquement").
      usableFromBench: true,
      condition(ctx) {
        return ctx.event?.data['characterInstanceId'] === ctx.sourceInstanceId;
      },
      async execute(ctx) {
        await hacheGeante.execute(ctx);
      },
    },
  ],
};
