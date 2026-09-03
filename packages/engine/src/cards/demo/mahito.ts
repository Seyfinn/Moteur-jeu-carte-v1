import type { CharacterCardDef } from '../types.js';

const PAUME_ATK = 90;

export const mahito: CharacterCardDef = {
  type: 'character',
  id: 'mahito',
  name: 'Mahito',
  baseMaxHP: 270,
  attacks: [
    {
      id: 'paume-transfiguratrice',
      name: 'Paume Transfiguratrice',
      baseATK: PAUME_ATK,
      description: '',
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, PAUME_ATK);
        const maxHpBefore = ctx.getCharacter(target.instanceId).currentMaxHP;
        await ctx.dealDamage(target.instanceId, atk, { asValeurLock: true });
        // "Marque" : ne marque que si le coup a réellement retiré du HP max (pas esquivé).
        // Un ciblage qui n'a rien retiré n'a rien à rendre "plus jamais récupérable". Un
        // seul jet d'esquive pour tout le coup (comme Chainsaw/Sukuna) : `skipEvasionRoll`
        // évite que la marque roule sa PROPRE esquive après que le coup a déjà touché.
        if (ctx.getCharacter(target.instanceId).currentMaxHP < maxHpBefore) {
          ctx.applyStatus(
            target.instanceId,
            {
              statusId: 'unhealable',
              label: 'Marque (Mahito)',
              sourcePlayerId: ctx.ownerId,
              sourceCardInstanceId: ctx.sourceInstanceId,
            },
            { skipEvasionRoll: true }
          );
        }
      },
    },
  ],
  abilities: [
    {
      id: 'alteration-de-lame',
      name: "Altération de l'Âme",
      kind: 'passive',
      description: 'Toutes les attaques de Mahito convertissent 100 % de leurs dégâts directement en réduction de HP max',
      // Purement descriptif : implémenté directement dans Paume Transfiguratrice via
      // l'option { asValeurLock: true } de dealDamage (esquive/critique résolus
      // normalement, seule la destination des dégâts change -- voir effect-context.ts).
      async execute() {},
    },
    {
      id: 'marque',
      name: 'Marque',
      kind: 'passive',
      description: 'La cible ne peut plus jamais soigner ces PV.',
      // Purement descriptif : implémenté directement dans Paume Transfiguratrice, qui pose
      // le statut générique 'unhealable' sur la cible touchée (voir statuses.ts).
      async execute() {},
    },
  ],
};
