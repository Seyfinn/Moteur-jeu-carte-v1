import { beforeAll, describe, expect, it } from 'vitest';
import { checkWinCondition, type PlayerId } from '../src/index.js';
import { registerTestFixtures, TINY_ROSTER } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

function opponentOf(id: PlayerId): PlayerId {
  return id === 'p1' ? 'p2' : 'p1';
}

describe('KO, mandatory replacement and win condition (sections 2 & 5)', () => {
  it('KO of the active character triggers an immediate, free, mandatory replacement from the bench', async () => {
    const match = await createReadyMatch({
      p1Name: 'A',
      p2Name: 'B',
      p1Roster: TINY_ROSTER,
      p2Roster: TINY_ROSTER,
      seed: 30,
    });
    const attacker = match.state.activePlayerId;
    const defender = opponentOf(attacker);
    const attackerActive = match.state.players[attacker].activeCharacterInstanceId!;
    const defenderActiveBefore = match.state.players[defender].activeCharacterInstanceId!;

    await drive(match, attacker, { kind: 'attack', characterInstanceId: attackerActive, attackId: 'shatter' });

    expect(match.state.players[defender].graveyardCharacterInstanceIds).toContain(defenderActiveBefore);
    expect(match.state.players[defender].activeCharacterInstanceId).not.toBeNull();
    expect(match.state.players[defender].activeCharacterInstanceId).not.toBe(defenderActiveBefore);
  });

  it('a player with all characters KO’d loses; the other wins', async () => {
    const match = await createReadyMatch({
      p1Name: 'A',
      p2Name: 'B',
      p1Roster: TINY_ROSTER,
      p2Roster: TINY_ROSTER,
      seed: 31,
    });
    const winner = match.state.startingPlayerId;
    const loser = opponentOf(winner);

    for (let i = 0; i < 10 && !match.state.result; i++) {
      const active = match.state.activePlayerId;
      const instanceId = match.state.players[active].activeCharacterInstanceId!;
      await drive(match, active, { kind: 'attack', characterInstanceId: instanceId, attackId: 'shatter' });
    }

    expect(match.state.result).toEqual({ kind: 'win', winner });
    expect(match.state.players[loser].activeCharacterInstanceId).toBeNull();
    expect(match.state.players[loser].benchCharacterInstanceIds).toHaveLength(0);
  });

  it('simultaneous KO of both sides’ last characters is a perfect draw', async () => {
    const match = await createReadyMatch({
      p1Name: 'A',
      p2Name: 'B',
      p1Roster: TINY_ROSTER,
      p2Roster: TINY_ROSTER,
      seed: 32,
    });
    // Reduce both sides down to a single character each first (bench empty),
    // then KO both remaining actives back-to-back within the same primitive
    // access, simulating one effect wiping both boards at once.
    for (const playerId of ['p1', 'p2'] as PlayerId[]) {
      const bench = match.state.players[playerId].benchCharacterInstanceIds[0]!;
      match.state.players[playerId].graveyardCharacterInstanceIds.push(bench);
      match.state.players[playerId].benchCharacterInstanceIds = [];
    }

    const p1Active = match.state.players.p1.activeCharacterInstanceId!;
    const p2Active = match.state.players.p2.activeCharacterInstanceId!;

    const api = match['api'] as { koCharacter(id: string): Promise<void> };
    await api.koCharacter(p1Active);
    await api.koCharacter(p2Active);

    // In normal play checkWinCondition only runs at action/turn boundaries;
    // called directly here since the action pipeline was bypassed on purpose.
    checkWinCondition(match.state);

    expect(match.state.result).toEqual({ kind: 'draw' });
  });
});
