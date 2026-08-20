import type { CharacterCardDef } from '../types.js';
import { puissanceDuRoi } from './shared.js';

export const nakime: CharacterCardDef = {
  type: 'character',
  id: 'nakime',
  name: 'Nakime',
  baseMaxHP: 600,
  abilities: [puissanceDuRoi()],
  attacks: [
    {
      id: 'appel-de-infini',
      name: "Appel de l'infini",
      baseATK: 20,
      description: "Échangez une carte de votre banc avec une carte du banc adverse, au choix de l'attaquant.",
      async execute(ctx) {
        const ownBench = ctx.getBench(ctx.ownerId);
        const enemyBench = ctx.getBench(ctx.opponentId);
        if (ownBench.length === 0 || enemyBench.length === 0) {
          ctx.log("Appel de l'infini: aucun échange possible (banc vide)");
          return;
        }
        const [ownPick] = await ctx.choose({
          kind: 'select-characters',
          prompt: 'Choisissez votre carte du banc à échanger',
          options: ownBench.map((c) => c.instanceId),
          min: 1,
          max: 1,
        });
        const [enemyPick] = await ctx.choose({
          kind: 'select-characters',
          prompt: "Choisissez la carte adverse du banc à échanger",
          options: enemyBench.map((c) => c.instanceId),
          min: 1,
          max: 1,
        });
        if (ownPick && enemyPick) {
          ctx.swapBenchCharacters(ctx.ownerId, ownPick, enemyPick);
        }
      },
    },
  ],
};
