import { beforeAll, describe, expect, it } from 'vitest';
import { type EngineApi } from '../src/index.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

describe('"Concentration" mechanism (attack-only, one-shot crit-or-nothing) -- through the engine', () => {
  it('~70% of attacks crit for the boosted amount, and the status is consumed either way', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 60 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = match.state.activePlayerId;
    const attacker = match.state.players[attackerId].characters[match.state.players[attackerId].activeCharacterInstanceId!]!;
    const targetId = attackerId === 'p1' ? 'p2' : 'p1';
    const target = match.state.players[targetId].characters[match.state.players[targetId].activeCharacterInstanceId!]!;
    const api = match['api'] as EngineApi;

    let crits = 0;
    let misses = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      target.damage = 0;
      attacker.statuses.push({ statusId: 'concentration', label: 'Concentration', data: { percent: 70 } });

      const ctx = api.buildEffectContext(attacker.instanceId, attackerId, undefined, 'attack');
      await ctx.dealDamage(target.instanceId, 10);

      expect(attacker.statuses.some((s) => s.statusId === 'concentration')).toBe(false); // always consumed
      if (target.damage === 20) {
        crits += 1;
      } else {
        expect(target.damage).toBe(0); // miss (concentration failure or innate dodge): no damage either way
        expect(attacker.statuses.some((s) => s.statusId === 'disarmed')).toBe(true);
        attacker.statuses = attacker.statuses.filter((s) => s.statusId !== 'disarmed'); // reset for the next trial
        misses += 1;
      }
    }

    expect(crits + misses).toBe(trials);
    expect(crits).toBeGreaterThan(trials * 0.5); // ~66.5% (95% no-dodge * 70% crit)
    expect(crits).toBeLessThan(trials * 0.9);
  });

  it("does not arm on an ability's damage -- attack-only, per the card's ruling", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 61 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = match.state.activePlayerId;
    const attacker = match.state.players[attackerId].characters[match.state.players[attackerId].activeCharacterInstanceId!]!;
    const targetId = attackerId === 'p1' ? 'p2' : 'p1';
    const target = match.state.players[targetId].characters[match.state.players[targetId].activeCharacterInstanceId!]!;
    attacker.statuses.push({ statusId: 'concentration', label: 'Concentration', data: { percent: 70 } });
    const api = match['api'] as EngineApi;

    const ctx = api.buildEffectContext(attacker.instanceId, attackerId, undefined, 'ability');
    await ctx.dealDamage(target.instanceId, 10);

    expect(attacker.statuses.some((s) => s.statusId === 'concentration')).toBe(true); // untouched by ability damage
    expect([0, 10, 20]).toContain(target.damage); // normal dodge/hit/innate-crit only, no boosted multiplier forced
  });

  it('a missed Concentration disarms for exactly the bearer\'s next turn, then clears', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 62 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    if (match.state.activePlayerId !== 'p1') await drive(match, 'p2', { kind: 'pass' });
    const selfId = match.state.players.p1.activeCharacterInstanceId!;
    const self = match.state.players.p1.characters[selfId]!;
    self.statuses.push({ statusId: 'concentration', label: 'Concentration', data: { percent: 0 } }); // guaranteed miss

    await drive(match, 'p1', { kind: 'attack', characterInstanceId: selfId, attackId: 'strike' });
    expect(self.statuses.some((s) => s.statusId === 'disarmed')).toBe(true);

    await drive(match, 'p2', { kind: 'pass' });
    const blockedAttempt = match.applyAction('p1', { kind: 'attack', characterInstanceId: selfId, attackId: 'strike' });
    expect(blockedAttempt.ok).toBe(false);

    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });
    const laterAttempt = match.applyAction('p1', { kind: 'attack', characterInstanceId: selfId, attackId: 'strike' });
    expect(laterAttempt.ok).toBe(true);
  });
});
