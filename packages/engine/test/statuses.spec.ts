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
    const benchedId = p1.benchCharacterInstanceIds[0]!;
    p1.characters[benchedId]!.statuses.push({
      statusId: 'poison',
      label: 'Poison',
      remainingTurns: 3,
      data: { amount: 10 },
    });
    const damageBefore = p1.characters[benchedId]!.damage;

    const api = match['api'] as EngineApi;
    await tickStatusesAtTurnStart(match.state, 'p1', api);

    expect(p1.characters[benchedId]!.damage).toBe(damageBefore + 10);
    expect(p1.characters[benchedId]!.statuses.find((s) => s.statusId === 'poison')?.remainingTurns).toBe(2);
  });
});
