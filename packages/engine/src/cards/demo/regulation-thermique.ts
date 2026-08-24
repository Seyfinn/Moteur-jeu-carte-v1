import type { TerrainCardDef } from '../types.js';
import { findCharacter, evaluateTransform } from '../../queries.js';
import { heal } from '../../hp.js';

const DURATION_TURNS = 5;
const HEAL_AMOUNT = 50;

export const regulationThermique: TerrainCardDef = {
  type: 'terrain',
  id: 'regulation-thermique',
  name: 'Régulation Thermique',
  description: `Pendant ${DURATION_TURNS} tours, la Brûlure ne blesse plus vos personnages (actif comme banc) : elle les soigne de ${HEAL_AMOUNT} HP à la place.`,
  durationTurns: DURATION_TURNS,
  modifiers: [
    {
      // N'intercepte que les dégâts tagués 'burn' (voir statuses.ts / DealDamageOptions.source) --
      // les autres dégâts subis par une carte alliée brûlée ne sont pas concernés.
      query: 'getIncomingDamageAmount',
      transform(ctx, current) {
        if (ctx.query['source'] !== 'burn') return current;
        const targetInstanceId = ctx.query['targetInstanceId'] as string;
        const target = findCharacter(ctx.state, targetInstanceId);
        if (target.ownerId !== ctx.sourceOwnerId) return current;
        // Passe par getIncomingHealAmount pour rester cohérent avec d'autres effets
        // de soin (ex: Hôpital) qui pourraient être en jeu en même temps.
        const boosted = evaluateTransform(ctx.state, 'getIncomingHealAmount', { targetInstanceId }, HEAL_AMOUNT);
        heal(target, Math.max(0, boosted as number));
        return 0;
      },
    },
  ],
};
