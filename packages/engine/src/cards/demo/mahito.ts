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
      description: `Inflige ${PAUME_ATK} dégâts à l'actif adverse, convertis à 100% en réduction de HP max (voir Altération de l'Âme) -- donc jamais soignables.`,
      async execute(ctx) {
        const target = ctx.getActive(ctx.opponentId);
        if (!target) return;
        const atk = ctx.getEffectiveATK(ctx.sourceInstanceId, PAUME_ATK);
        await ctx.dealDamage(target.instanceId, atk, { asValeurLock: true });
      },
    },
  ],
  abilities: [
    {
      id: 'alteration-de-lame',
      name: "Altération de l'Âme",
      kind: 'passive',
      description: 'Toutes les attaques de Mahito convertissent 100% de leurs dégâts directement en réduction de HP max.',
      // Purement descriptif : implémenté directement dans Paume Transfiguratrice via
      // l'option { asValeurLock: true } de dealDamage (esquive/critique résolus
      // normalement, seule la destination des dégâts change -- voir effect-context.ts).
      async execute() {},
    },
    {
      id: 'marque',
      name: 'Marque',
      kind: 'passive',
      description: "Les PV retirés par Mahito ne peuvent plus jamais être récupérés, par aucun soin.",
      async execute() {},
    },
  ],
};
