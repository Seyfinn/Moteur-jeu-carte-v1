import type { TerrainCardDef } from '../types.js';
import { findCharacter } from '../../queries.js';

const DURATION_TURNS = 6;

export const briseBouclier: TerrainCardDef = {
  type: 'terrain',
  id: 'brise-bouclier',
  name: 'Brise bouclier',
  description: `Pendant ${DURATION_TURNS} tours, le bouclier (shield) des personnages ennemis n'absorbe plus aucun dégât -- sa valeur reste inchangée mais ne protège plus tant que le terrain est en jeu (redevient efficace à l'expiration). N'affecte que le shield générique, pas les mécaniques de bouclier propres à une carte (ex: Mana Barrier de Blitzcrank).`,
  durationTurns: DURATION_TURNS,
  modifiers: [
    {
      query: 'canShieldAbsorb',
      vote(ctx) {
        const targetInstanceId = ctx.query['targetInstanceId'] as string;
        const target = findCharacter(ctx.state, targetInstanceId);
        if (target.ownerId === ctx.sourceOwnerId) return undefined; // ne bloque que le bouclier adverse
        return { allow: false, source: 'terrain:brise-bouclier' };
      },
    },
  ],
};
