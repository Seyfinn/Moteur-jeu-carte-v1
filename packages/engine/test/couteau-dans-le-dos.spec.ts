import { beforeAll, describe, expect, it } from 'vitest';
import { type EngineApi } from '../src/index.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

describe('"Couteau dans le dos" mechanism (bench-damage doubling from any of the owner\'s characters) -- through the engine', () => {
  it('doubles damage dealt to the enemy bench, but not to the enemy active', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 70 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = match.state.activePlayerId;
    const defenderId = attackerId === 'p1' ? 'p2' : 'p1';
    const attacker = match.state.players[attackerId].characters[match.state.players[attackerId].activeCharacterInstanceId!]!;
    attacker.statuses.push({ statusId: 'bench-damage-bonus', label: 'Couteau dans le dos', remainingTurns: 2, data: { multiplier: 2 } });

    const defenderActiveId = match.state.players[defenderId].activeCharacterInstanceId!;
    const defenderBenchId = match.state.players[defenderId].benchCharacterInstanceIds[0]!;
    const api = match['api'] as EngineApi;
    const ctx = api.buildEffectContext(attacker.instanceId, attackerId, undefined, 'ability');

    await ctx.dealDamage(defenderBenchId, 10, { skipEvasionRoll: true });
    await ctx.dealDamage(defenderActiveId, 10, { skipEvasionRoll: true });

    expect(match.state.players[defenderId].characters[defenderBenchId]!.damage).toBe(20); // doubled
    expect(match.state.players[defenderId].characters[defenderActiveId]!.damage).toBe(10); // untouched, not benched
  });

  it("a bench-mate of the caster (not just their active) also benefits from the buff", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 71 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = match.state.activePlayerId;
    const defenderId = attackerId === 'p1' ? 'p2' : 'p1';
    const benchAllyId = match.state.players[attackerId].benchCharacterInstanceIds[0]!;
    match.state.players[attackerId].characters[benchAllyId]!.statuses.push({
      statusId: 'bench-damage-bonus',
      label: 'Couteau dans le dos',
      remainingTurns: 2,
      data: { multiplier: 2 },
    });

    const defenderBenchId = match.state.players[defenderId].benchCharacterInstanceIds[0]!;
    const api = match['api'] as EngineApi;
    const ctx = api.buildEffectContext(benchAllyId, attackerId, undefined, 'ability');
    await ctx.dealDamage(defenderBenchId, 10, { skipEvasionRoll: true });

    expect(match.state.players[defenderId].characters[defenderBenchId]!.damage).toBe(20);
  });

  it('also doubles damage from a source that is not a character (a terrain or an object)', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 72 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = match.state.activePlayerId;
    const defenderId = attackerId === 'p1' ? 'p2' : 'p1';
    // The buff is posed on every one of the owner's characters, not tied to whichever one
    // happens to deal this particular hit -- so it must still apply when the hit comes
    // from a terrain/object effect, whose `sourceInstanceId` isn't a character at all.
    const anyAlly = match.state.players[attackerId].characters[match.state.players[attackerId].activeCharacterInstanceId!]!;
    anyAlly.statuses.push({ statusId: 'bench-damage-bonus', label: 'Couteau dans le dos', remainingTurns: 2, data: { multiplier: 2 } });

    const defenderBenchId = match.state.players[defenderId].benchCharacterInstanceIds[0]!;
    const api = match['api'] as EngineApi;
    const ctx = api.buildEffectContext('not-a-character-instance-id', attackerId, undefined, 'other');
    await ctx.dealDamage(defenderBenchId, 10, { skipEvasionRoll: true });

    expect(match.state.players[defenderId].characters[defenderBenchId]!.damage).toBe(20);
  });
});
