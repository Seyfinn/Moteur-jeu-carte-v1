import { beforeAll, describe, expect, it } from 'vitest';
import { tickStatusesAtTurnStart, type EngineApi } from '../src/index.js';
import { registerTestFixtures, FX_ROSTER, POISON_CURSE_ROSTER } from './fixtures.js';
import { createReadyMatch } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

describe('"Sang Maudit" mechanism (poison ticks as valeur lock while the curse-bearer is active) -- through the engine', () => {
  it('converts a poison tick on the enemy into an unhealable max-HP loss while the curse-bearer is active', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: POISON_CURSE_ROSTER, p2Roster: FX_ROSTER, seed: 80 },
      { p1ActiveCardId: 'fx-poison-curse', p2ActiveCardId: 'fx-tank' }
    );
    const p2 = match.state.players.p2;
    const targetId = p2.activeCharacterInstanceId!; // fx-tank, 300 max HP
    p2.characters[targetId]!.statuses.push({ statusId: 'poison', label: 'Poison', remainingTurns: 2 });
    const maxHPBefore = p2.characters[targetId]!.currentMaxHP;
    const damageBefore = p2.characters[targetId]!.damage;

    const api = match['api'] as EngineApi;
    await tickStatusesAtTurnStart(match.state, 'p2', api);

    // Fixed engine formula: 10 flat + 10% of currentMaxHP (300 -> +30 = 40).
    expect(p2.characters[targetId]!.currentMaxHP).toBe(maxHPBefore - 40);
    expect(p2.characters[targetId]!.damage).toBe(damageBefore); // untouched -- not ordinary damage
  });

  it('reverts to ordinary healable damage the moment the curse-bearer is no longer active (rechecked every tick)', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: POISON_CURSE_ROSTER, p2Roster: FX_ROSTER, seed: 81 },
      { p1ActiveCardId: 'fx-poison-curse', p2ActiveCardId: 'fx-tank' }
    );
    const p1 = match.state.players.p1;
    const p2 = match.state.players.p2;
    const targetId = p2.activeCharacterInstanceId!;
    p2.characters[targetId]!.statuses.push({ statusId: 'poison', label: 'Poison', remainingTurns: 3 });
    const api = match['api'] as EngineApi;

    await tickStatusesAtTurnStart(match.state, 'p2', api);
    const maxHPAfterFirstTick = p2.characters[targetId]!.currentMaxHP;
    const damageAfterFirstTick = p2.characters[targetId]!.damage;
    expect(damageAfterFirstTick).toBe(0); // first tick: converted to valeur lock

    // Bench the curse-bearer: swap p1's active with its bench-mate directly (no need to drive a full switch action for this).
    const curseBearerId = p1.activeCharacterInstanceId!;
    const benchMateId = p1.benchCharacterInstanceIds[0]!;
    p1.activeCharacterInstanceId = benchMateId;
    p1.benchCharacterInstanceIds = [curseBearerId];

    await tickStatusesAtTurnStart(match.state, 'p2', api);

    // Second tick's formula runs off the already-reduced currentMaxHP from the first
    // tick (260, not 300): 10 flat + 10% of 260 = 36.
    expect(p2.characters[targetId]!.currentMaxHP).toBe(maxHPAfterFirstTick); // unchanged this time
    expect(p2.characters[targetId]!.damage).toBe(damageAfterFirstTick + 36); // ordinary damage this tick instead
  });

  it("never affects the curse-bearer's own side, even while active", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: POISON_CURSE_ROSTER, p2Roster: FX_ROSTER, seed: 82 },
      { p1ActiveCardId: 'fx-poison-curse', p2ActiveCardId: 'fx-tank' }
    );
    const p1 = match.state.players.p1;
    const benchMateId = p1.benchCharacterInstanceIds[0]!; // fx-tank, own side
    p1.characters[benchMateId]!.statuses.push({ statusId: 'poison', label: 'Poison', remainingTurns: 2 });
    const maxHPBefore = p1.characters[benchMateId]!.currentMaxHP;

    const api = match['api'] as EngineApi;
    await tickStatusesAtTurnStart(match.state, 'p1', api);

    expect(p1.characters[benchMateId]!.currentMaxHP).toBe(maxHPBefore); // untouched
    expect(p1.characters[benchMateId]!.damage).toBe(40); // ordinary damage instead
  });
});
