import type { CharacterCardDef } from '../types.js';

const BURN_TURNS = 2;

export const rengoku: CharacterCardDef = {
  type: 'character',
  id: 'rengoku',
  name: 'Rengoku',
  baseMaxHP: 340,
  attacks: [
    {
      id: 'souffle-du-feu',
      name: 'Souffle du feu',
      baseATK: 30,
      description:
        'Inflige 30 dégâts à l\'actif adverse. Passif "La flamme" : si le coup touche, applique l\'effet burn pendant 2 tours (cumulable en plusieurs stacks indépendants si Rengoku touche plusieurs fois).',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;

        // Un seul jet d'esquive partagé entre les dégâts et le burn : soit
        // l'attaque touche et les deux s'appliquent, soit elle est esquivée
        // et rien ne se passe (pas de "esquive les dégâts mais brûlé quand même").
        if (ctx.rollEvasion(target.instanceId)) return;

        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, 30);
        await ctx.dealDamage(target.instanceId, atk, { skipEvasionRoll: true });
        ctx.applyStatus(
          target.instanceId,
          {
            statusId: 'burn',
            label: 'Brûlure (La flamme)',
            sourcePlayerId: ctx.ownerId,
            sourceCardInstanceId: ctx.sourceInstanceId,
            remainingTurns: BURN_TURNS,
          },
          { skipEvasionRoll: true }
        );
      },
    },
  ],
  abilities: [
    {
      id: 'la-flamme',
      name: 'La flamme',
      kind: 'passive',
      description:
        'À chaque fois qu\'un ennemi est touché par "Souffle du feu", applique l\'effet burn pendant 2 tours (cumulable). Purement descriptif ici : implémenté directement dans "Souffle du feu" plutôt que via un trigger, car l\'event afterDamage ne permet pas de savoir quelle attaque a causé les dégâts.',
      // Pas de trigger : le mécanisme vit entièrement dans l'attaque, cf description ci-dessus.
      async execute() {},
    },
  ],
};
