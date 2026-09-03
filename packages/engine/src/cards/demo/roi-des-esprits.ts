import type { AttackDef, CharacterCardDef } from '../types.js';

const ICE_ATK = 30;
const STUN_CHANCE_PERCENT = 65;
const STUN_EFFECTIVE_TURNS = 1; // durée non précisée sur la carte -- défaut standard du jeu (Gojo, Killua...)
// Ciblé sur l'ennemi pendant le tour du Roi des esprits -> +1 : Stun est un statut
// "bloquant" vérifié via un gate avant que le joueur agisse (comme le Stun de Gojo/le
// Désarmé de Killua), contrairement à Poison/Burn qui tiquent sans condition sur
// remainingTurns (voir muzan.ts pour ce contraste).
const STUN_REMAINING_TURNS = STUN_EFFECTIVE_TURNS + 1;

const FIRE_ATK = 20;
// Burn tique sans condition sur remainingTurns (voir muzan.ts) : "pendant 1 tour" = remainingTurns: 1, sans +1.
const BURN_REMAINING_TURNS = 1;

const HEAL_ATK = 0;
const HEAL_AMOUNT = 40;

const espritDeGlace: AttackDef = {
  id: 'esprit-de-glace',
  name: 'Esprit de glace',
  baseATK: ICE_ATK,
  description: 'Lance un esprit de glace qui a 65% de chance de stun la cible',
  async execute(ctx) {
    const target = ctx.getActive(ctx.opponentId);
    if (!target) return;
    const damageBefore = ctx.getCharacter(target.instanceId).damage;
    const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, ICE_ATK);
    await ctx.dealDamage(target.instanceId, atk);

    const landed = ctx.getCharacter(target.instanceId).damage > damageBefore;
    if (landed && ctx.rollChance(STUN_CHANCE_PERCENT, 'Stun', { characterInstanceId: target.instanceId })) {
      ctx.applyStatus(target.instanceId, {
        statusId: 'stun',
        label: 'Stun (Esprit de glace)',
        sourcePlayerId: ctx.ownerId,
        sourceCardInstanceId: ctx.sourceInstanceId,
        remainingTurns: STUN_REMAINING_TURNS,
      });
    }
  },
};

const espritDeFeu: AttackDef = {
  id: 'esprit-de-feu',
  name: 'Esprit de feu',
  baseATK: FIRE_ATK,
  description: 'Inflige burn pendant 1 tour à la cible',
  async execute(ctx) {
    const target = ctx.getActive(ctx.opponentId);
    if (!target) return;

    // Un seul jet d'esquive partagé entre dégâts et burn (même pattern que "La
    // flamme" de Rengoku) : soit l'attaque touche et les deux s'appliquent, soit
    // elle est esquivée et rien ne se passe.
    if (ctx.rollEvasion(target.instanceId)) return;

    const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, FIRE_ATK);
    await ctx.dealDamage(target.instanceId, atk, { skipEvasionRoll: true });
    ctx.applyStatus(
      target.instanceId,
      {
        statusId: 'burn',
        label: 'Burn (Esprit de feu)',
        sourcePlayerId: ctx.ownerId,
        sourceCardInstanceId: ctx.sourceInstanceId,
        remainingTurns: BURN_REMAINING_TURNS,
      },
      { skipEvasionRoll: true }
    );
  },
};

const espritDeSoin: AttackDef = {
  id: 'esprit-de-soin',
  name: 'Esprit de soin',
  baseATK: HEAL_ATK,
  description: "Lance un esprit de soin qui heal de 40 l'allié choisi",
  async execute(ctx) {
    const allies = ctx.getAllOnBoard(ctx.ownerId);
    const [targetId] = await ctx.choose({
      kind: 'select-characters',
      prompt: 'Esprit de soin : choisissez le personnage allié à soigner',
      options: allies.map((c) => c.instanceId),
      min: 1,
      max: 1,
    });
    if (!targetId) return;
    ctx.heal(targetId, HEAL_AMOUNT);
  },
};

export const roiDesEsprits: CharacterCardDef = {
  type: 'character',
  id: 'roi-des-esprits',
  name: 'Roi des esprits',
  baseMaxHP: 240,
  attacks: [espritDeGlace, espritDeFeu, espritDeSoin],
  abilities: [
    {
      id: 'explosion-desprits',
      name: "Explosion d'esprits",
      kind: 'active',
      description:
        'Le Roi des esprits lance les 3 esprits en même temps. Ne peut pas attaquer ce round. Utilisable une fois.',
      usesPerGame: 1,
      async execute(ctx) {
        // "Ne peut pas attaquer ce round" : Désarmé bloque spécifiquement canAttack
        // (queries.ts) sans toucher aux abilities/switch, contrairement à Stun. Posé
        // sur soi-même, expire à la fin de ce même tour (remainingTurns: 1, même
        // calcul de durée "juste ce tour" que le multiplicateur d'Adrénaline Ultime).
        ctx.applyStatus(ctx.sourceInstanceId, {
          statusId: 'disarmed',
          label: "Explosion d'esprits",
          sourceCardInstanceId: ctx.sourceInstanceId,
          remainingTurns: 1,
        });

        await espritDeGlace.execute(ctx);
        await espritDeFeu.execute(ctx);
        await espritDeSoin.execute(ctx);
      },
    },
  ],
};
