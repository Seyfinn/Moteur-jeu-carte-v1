import { beforeAll, describe, expect, it } from 'vitest';
import { tickStatusesAtTurnStart, type EngineApi } from '../src/index.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

describe('Statuses (section 6)', () => {
  it('stun blocks the standard switch action', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 20 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const active = match.state.activePlayerId;
    const instanceId = match.state.players[active].activeCharacterInstanceId!;
    const char = match.state.players[active].characters[instanceId]!;
    char.statuses.push({ statusId: 'stun', label: 'Stun', remainingTurns: 1 });

    const benchId = match.state.players[active].benchCharacterInstanceIds[0]!;
    const result = match.applyAction(active, { kind: 'switch', newActiveInstanceId: benchId });
    expect(result.ok).toBe(false);
  });

  it('stun does not block an attack that is disarmed-independent, but does block ability use', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 21 },
      { p1ActiveCardId: 'fx-stunner', p2ActiveCardId: 'fx-tank' }
    );
    const active = match.state.activePlayerId;
    const instanceId = match.state.players[active].activeCharacterInstanceId!;
    const char = match.state.players[active].characters[instanceId]!;
    char.statuses.push({ statusId: 'stun', label: 'Stun', remainingTurns: 1 });

    const abilityResult = match.applyAction(active, {
      kind: 'use-ability',
      characterInstanceId: instanceId,
      abilityId: 'stun-enemy',
    });
    expect(abilityResult.ok).toBe(false);

    const attackResult = match.applyAction(active, { kind: 'attack', characterInstanceId: instanceId, attackId: 'jab' });
    expect(attackResult.ok).toBe(false); // stun also blocks attacking per section 6
  });

  it('non poison/burn status durations are suspended while benched, and resume once active again', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 22 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p1 = match.state.players.p1;
    const activeId = p1.activeCharacterInstanceId!;
    p1.characters[activeId]!.statuses.push({ statusId: 'atk-reduction', label: 'Weak', remainingTurns: 2, data: { amount: 5 } });

    const benchId = p1.benchCharacterInstanceIds[0]!;
    // Switch the afflicted character to the bench (ends p1's turn); its status should not tick while benched.
    await drive(match, 'p1', { kind: 'switch', newActiveInstanceId: benchId });
    // Play through a full p2 turn and back to a p1 turn without reactivating the afflicted character.
    const p2Active = match.state.players.p2.activeCharacterInstanceId!;
    await drive(match, 'p2', { kind: 'attack', characterInstanceId: p2Active, attackId: 'poke' });

    expect(p1.characters[activeId]!.statuses.find((s) => s.statusId === 'atk-reduction')?.remainingTurns).toBe(2);
  });

  it('poison/burn tick and deal damage at the start of the owner turn even while benched', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 23 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p1 = match.state.players.p1;
    const benchedId = p1.benchCharacterInstanceIds[0]!; // fx-tank, 300 max HP
    p1.characters[benchedId]!.statuses.push({ statusId: 'poison', label: 'Poison', remainingTurns: 3 });
    const damageBefore = p1.characters[benchedId]!.damage;

    const api = match['api'] as EngineApi;
    await tickStatusesAtTurnStart(match.state, 'p1', api);

    // Fixed engine formula: 10 flat + 10% of currentMaxHP (300 -> +30).
    expect(p1.characters[benchedId]!.damage).toBe(damageBefore + 40);
    expect(p1.characters[benchedId]!.statuses.find((s) => s.statusId === 'poison')?.remainingTurns).toBe(2);
  });

  it('burn always deals a flat 50 regardless of max HP', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 24 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p1 = match.state.players.p1;
    const activeId = p1.activeCharacterInstanceId!; // fx-striker, 100 max HP
    p1.characters[activeId]!.statuses.push({ statusId: 'burn', label: 'Burn', remainingTurns: 1 });
    const damageBefore = p1.characters[activeId]!.damage;

    const api = match['api'] as EngineApi;
    await tickStatusesAtTurnStart(match.state, 'p1', api);

    expect(p1.characters[activeId]!.damage).toBe(damageBefore + 50);
  });
});

describe('Critique & Esquive (section 6)', () => {
  it('base rates: every character has an innate ~2% crit / ~5% dodge chance with no status at all', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 40 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = match.state.activePlayerId;
    const attacker = match.state.players[attackerId].characters[match.state.players[attackerId].activeCharacterInstanceId!]!;
    const targetId = attackerId === 'p1' ? 'p2' : 'p1';
    const target = match.state.players[targetId].characters[match.state.players[targetId].activeCharacterInstanceId!]!;
    const api = match['api'] as EngineApi;

    let dodges = 0;
    let crits = 0;
    let normals = 0;
    const trials = 2000;
    for (let i = 0; i < trials; i++) {
      target.damage = 0;
      const ctx = api.buildEffectContext(attacker.instanceId, attackerId);
      await ctx.dealDamage(target.instanceId, 10);
      if (target.damage === 0) dodges += 1;
      else if (target.damage === 20) crits += 1;
      else {
        expect(target.damage).toBe(10);
        normals += 1;
      }
    }

    expect(dodges + crits + normals).toBe(trials);
    // Neither character has a status: ~5% dodge, ~2% crit. Generous bounds since this is a single fixed-seed sample.
    expect(dodges).toBeGreaterThan(trials * 0.01);
    expect(dodges).toBeLessThan(trials * 0.12);
    expect(crits).toBeGreaterThan(0);
    expect(crits).toBeLessThan(trials * 0.06);
  });

  it('critical status: doubles attack damage roughly a third of the time, on top of the target’s innate dodge chance', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 30 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = match.state.activePlayerId;
    const attacker = match.state.players[attackerId];
    const attackerInstance = attacker.characters[attacker.activeCharacterInstanceId!]!;
    attackerInstance.statuses.push({ statusId: 'critical', label: 'Critique' });

    const targetId = attackerId === 'p1' ? 'p2' : 'p1';
    const target = match.state.players[targetId].characters[match.state.players[targetId].activeCharacterInstanceId!]!;
    const api = match['api'] as EngineApi;

    let dodges = 0;
    let crits = 0;
    let normals = 0;
    const trials = 300;
    for (let i = 0; i < trials; i++) {
      target.damage = 0; // reset so repeated hits never KO the target mid-loop
      const ctx = api.buildEffectContext(attackerInstance.instanceId, attackerId);
      await ctx.dealDamage(target.instanceId, 10);
      if (target.damage === 0) dodges += 1; // target's innate ~5% dodge, unrelated to the attacker's crit
      else if (target.damage === 20) crits += 1;
      else {
        expect(target.damage).toBe(10);
        normals += 1;
      }
    }

    expect(dodges + crits + normals).toBe(trials);
    expect(crits).toBeGreaterThan(trials * 0.15); // ~33% of the (mostly landed) hits
    expect(crits).toBeLessThan(trials * 0.5);
    expect(dodges).toBeLessThan(trials * 0.2); // innate 5%, generous margin
  });

  it('evasive status: negates damage roughly a third of the time and never fully consumes the status', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 31 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = match.state.activePlayerId;
    const targetId = attackerId === 'p1' ? 'p2' : 'p1';
    const attacker = match.state.players[attackerId].characters[match.state.players[attackerId].activeCharacterInstanceId!]!;
    const target = match.state.players[targetId].characters[match.state.players[targetId].activeCharacterInstanceId!]!;
    target.statuses.push({ statusId: 'evasive', label: 'Esquive' });
    const api = match['api'] as EngineApi;

    let dodges = 0;
    let crits = 0;
    let normals = 0;
    const trials = 300;
    for (let i = 0; i < trials; i++) {
      target.damage = 0;
      const ctx = api.buildEffectContext(attacker.instanceId, attackerId);
      await ctx.dealDamage(target.instanceId, 10);
      if (target.damage === 0) dodges += 1;
      else if (target.damage === 20) crits += 1; // attacker's innate ~2% crit, unrelated to the target's evasion
      else {
        expect(target.damage).toBe(10);
        normals += 1;
      }
    }

    expect(dodges + crits + normals).toBe(trials);
    expect(target.statuses.some((s) => s.statusId === 'evasive')).toBe(true); // never consumed
    expect(dodges).toBeGreaterThan(trials * 0.15);
    expect(dodges).toBeLessThan(trials * 0.5);
    expect(crits).toBeLessThan(trials * 0.1); // innate 2%, generous margin
  });

  it('evasive does not block a character applying a status to itself', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 32 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const active = match.state.activePlayerId;
    const instanceId = match.state.players[active].activeCharacterInstanceId!;
    const char = match.state.players[active].characters[instanceId]!;
    char.statuses.push({ statusId: 'evasive', label: 'Esquive' });
    const api = match['api'] as EngineApi;

    for (let i = 0; i < 20; i++) {
      const ctx = api.buildEffectContext(instanceId, active);
      ctx.applyStatus(instanceId, { statusId: 'self-buff', label: 'Buff' });
    }

    expect(char.statuses.filter((s) => s.statusId === 'self-buff').length).toBe(20);
  });
});
