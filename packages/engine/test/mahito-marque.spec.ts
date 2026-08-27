import { beforeAll, describe, expect, it } from 'vitest';
import { type EngineApi } from '../src/index.js';
import { mahito } from '../src/cards/demo/mahito.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

const has = (statuses: { statusId: string }[], statusId: string) => statuses.some((s) => s.statusId === statusId);

describe('"Marque" mechanism (Mahito\'s unhealable mark) -- through the engine', () => {
  it('marks the target unhealable only on a hit that actually removed max HP, never on a dodge', async () => {
    const match = await createReadyMatch(
      // Both sides open on fx-tank (300 HP): a single Paume Transfiguratrice, even at its
      // rare crit (x2 of the 90 base), can never be lethal, whichever side ends up
      // attacking first -- so no KO-replacement prompt can fire mid-loop.
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 95 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = match.state.activePlayerId;
    const targetSide = attackerId === 'p1' ? 'p2' : 'p1';
    const attacker = match.state.players[attackerId].characters[match.state.players[attackerId].activeCharacterInstanceId!]!;
    const target = match.state.players[targetSide].characters[match.state.players[targetSide].activeCharacterInstanceId!]!;
    const api = match['api'] as EngineApi;
    const baseMaxHP = target.currentMaxHP;

    let hits = 0;
    let dodges = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      target.currentMaxHP = baseMaxHP;
      target.damage = 0;
      target.statuses = [];
      const ctx = api.buildEffectContext(attacker.instanceId, attackerId);
      await mahito.attacks[0]!.execute(ctx);

      const lost = baseMaxHP - target.currentMaxHP;
      if (lost === 0) {
        dodges += 1;
        expect(has(target.statuses, 'unhealable')).toBe(false);
      } else {
        hits += 1;
        expect(has(target.statuses, 'unhealable')).toBe(true);
      }
    }

    expect(hits + dodges).toBe(trials);
    expect(hits).toBeGreaterThan(0);
    expect(dodges).toBeGreaterThan(0); // target's innate ~5% dodge still applies
  });

  it('makes every subsequent heal() a permanent no-op, including its usual bleed cure', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 96 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const targetId = match.state.players.p2.activeCharacterInstanceId!;
    const target = match.state.players.p2.characters[targetId]!;
    target.damage = 100;
    target.statuses.push({ statusId: 'bleed', label: 'Bleed', data: { stacks: 3 } });
    target.statuses.push({ statusId: 'unhealable', label: 'Marque (Mahito)' });

    const api = match['api'] as EngineApi;
    api.heal(targetId, 50);

    expect(target.damage).toBe(100); // untouched
    expect(has(target.statuses, 'bleed')).toBe(true); // heal's usual bleed-cure didn't run either
  });
});
