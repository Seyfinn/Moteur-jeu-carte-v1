import type { TerrainCardDef } from '../types.js';
import { findCharacter } from '../../queries.js';

const DURATION_TURNS = 6;

export const briseBouclier: TerrainCardDef = {
  type: 'terrain',
  id: 'brise-bouclier',
  name: 'Brise bouclier',
  description: `Pendant ${DURATION_TURNS} tours, le bouclier des personnages ennemis n'absorbe plus rien : sa valeur reste affichée mais ne protège plus, et redevient efficace dès l'expiration du terrain. Ne touche pas les boucliers propres à une carte (Mana Barrier de Blitzcrank par exemple).`,
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
