import { beforeAll, describe, expect, it } from 'vitest';
import { type EngineApi } from '../src/index.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

describe('"Altération de l\'Âme" mechanism (dealDamage asValeurLock option) -- through the engine', () => {
  it('redirects the final (post esquive/critique) amount into max-HP loss instead of ordinary damage', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 90 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = match.state.activePlayerId;
    const attacker = match.state.players[attackerId].characters[match.state.players[attackerId].activeCharacterInstanceId!]!;
    const targetId = attackerId === 'p1' ? 'p2' : 'p1';
    const target = match.state.players[targetId].characters[match.state.players[targetId].activeCharacterInstanceId!]!;
    const api = match['api'] as EngineApi;
    const baseMaxHP = target.currentMaxHP;

    let dodges = 0;
    let crits = 0;
    let normals = 0;
    const trials = 300;
    for (let i = 0; i < trials; i++) {
      target.currentMaxHP = baseMaxHP; // reset between trials so repeated valeur-lock hits never KO the target mid-loop
      target.damage = 0;
      const ctx = api.buildEffectContext(attacker.instanceId, attackerId);
      await ctx.dealDamage(target.instanceId, 10, { asValeurLock: true });

      expect(target.damage).toBe(0); // never ordinary damage, ever
      const lost = baseMaxHP - target.currentMaxHP;
      if (lost === 0) dodges += 1;
      else if (lost === 20) crits += 1;
      else {
        expect(lost).toBe(10);
        normals += 1;
      }
    }

    expect(dodges + crits + normals).toBe(trials);
    expect(dodges).toBeGreaterThan(0); // target's innate ~5% dodge still applies
    expect(crits).toBeGreaterThan(0); // attacker's innate ~2% crit still applies (still doubles the locked amount)
  });
});
