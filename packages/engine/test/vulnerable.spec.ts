import { beforeAll, describe, expect, it } from 'vitest';
import { tickStatusesAtTurnStart, type EngineApi } from '../src/index.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

describe('"Vulnérable" status (+50% damage taken)', () => {
  it('raises every incoming damage instance by 50%, and leaves an unafflicted target alone', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 90 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = match.state.activePlayerId;
    const defenderId = attackerId === 'p1' ? 'p2' : 'p1';
    const attackerInstanceId = match.state.players[attackerId].activeCharacterInstanceId!;
    const defenderActiveId = match.state.players[defenderId].activeCharacterInstanceId!;
    const defenderBenchId = match.state.players[defenderId].benchCharacterInstanceIds[0]!;

    match.state.players[defenderId].characters[defenderActiveId]!.statuses.push({
      statusId: 'vulnerable',
      label: 'Vulnérable',
      remainingTurns: 2,
    });

    const api = match['api'] as EngineApi;
    const ctx = api.buildEffectContext(attackerInstanceId, attackerId, undefined, 'ability');
    await ctx.dealDamage(defenderActiveId, 40, { skipEvasionRoll: true });
    await ctx.dealDamage(defenderBenchId, 40, { skipEvasionRoll: true });

    expect(match.state.players[defenderId].characters[defenderActiveId]!.damage).toBe(60);
    expect(match.state.players[defenderId].characters[defenderBenchId]!.damage).toBe(40);
  });

  it('is not consumed by the hit: it keeps amplifying until its duration runs out', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 91 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = match.state.activePlayerId;
    const defenderId = attackerId === 'p1' ? 'p2' : 'p1';
    const attackerInstanceId = match.state.players[attackerId].activeCharacterInstanceId!;
    const defenderActiveId = match.state.players[defenderId].activeCharacterInstanceId!;
    match.state.players[defenderId].characters[defenderActiveId]!.statuses.push({
      statusId: 'vulnerable',
      label: 'Vulnérable',
      remainingTurns: 3,
    });

    const api = match['api'] as EngineApi;
    const ctx = api.buildEffectContext(attackerInstanceId, attackerId, undefined, 'ability');
    await ctx.dealDamage(defenderActiveId, 10, { skipEvasionRoll: true });
    await ctx.dealDamage(defenderActiveId, 10, { skipEvasionRoll: true });

    expect(match.state.players[defenderId].characters[defenderActiveId]!.damage).toBe(30);
  });

  it('does not inflate an HP cost a character pays to itself (ignoreDamageReduction)', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 92 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const playerId = match.state.activePlayerId;
    const selfId = match.state.players[playerId].activeCharacterInstanceId!;
    match.state.players[playerId].characters[selfId]!.statuses.push({
      statusId: 'vulnerable',
      label: 'Vulnérable',
      remainingTurns: 2,
    });

    const api = match['api'] as EngineApi;
    const ctx = api.buildEffectContext(selfId, playerId, undefined, 'ability');
    // Same options an HP-cost card uses (Adrénaline Ultime, Soin Sacrificiel).
    await ctx.dealDamage(selfId, 30, { ignoreShield: true, ignoreDamageReduction: true });

    expect(match.state.players[playerId].characters[selfId]!.damage).toBe(30);
  });

  it('amplifies burn/poison ticks too -- they are damage like any other', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 93 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const playerId = match.state.activePlayerId;
    const victimId = match.state.players[playerId].activeCharacterInstanceId!;
    const victim = match.state.players[playerId].characters[victimId]!;
    victim.statuses.push({ statusId: 'vulnerable', label: 'Vulnérable', remainingTurns: 3 });
    victim.statuses.push({ statusId: 'burn', label: 'Brûlure', remainingTurns: 2 });

    const api = match['api'] as EngineApi;
    await tickStatusesAtTurnStart(match.state, playerId, api);

    expect(victim.damage).toBe(75); // BURN_DAMAGE 50 x1.5
  });
});
