import { beforeAll, describe, expect, it } from 'vitest';
import type { PlayerId } from '../src/index.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

function opponentOf(id: PlayerId): PlayerId {
  return id === 'p1' ? 'p2' : 'p1';
}

describe('Turn structure (section 2)', () => {
  // Un tour de jeu couvre l'action des DEUX joueurs, comme aux échecs : le compteur
  // n'avance qu'au retour à celui qui a ouvert la partie.
  it('compte un tour par manche, pas un par joueur', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 12 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const starter = match.state.startingPlayerId;
    const other = opponentOf(starter);
    expect(match.state.turnNumber).toBe(1);

    await drive(match, starter, { kind: 'pass' });
    expect(match.state.activePlayerId).toBe(other);
    expect(match.state.turnNumber).toBe(1); // toujours le tour 1 : l'autre n'a pas joué

    await drive(match, other, { kind: 'pass' });
    expect(match.state.activePlayerId).toBe(starter);
    expect(match.state.turnNumber).toBe(2); // les deux ont joué -> tour suivant

    await drive(match, starter, { kind: 'pass' });
    await drive(match, other, { kind: 'pass' });
    expect(match.state.turnNumber).toBe(3);
  });

  it('playing one object is a free action; a second object ends the turn', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 10 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const starter = match.state.startingPlayerId;
    const other = opponentOf(starter);
    // The starting player never gets the second-player exception (tested
    // separately below), so their own first turn is the clean case to check.

    // Snapshot the ids: unplayedObjectInstanceIds is mutated in place as objects are played.
    const objects = [...match.state.players[starter].unplayedObjectInstanceIds];
    expect(objects.length).toBeGreaterThanOrEqual(2);

    await drive(match, starter, { kind: 'play-object', objectInstanceId: objects[0]! });
    expect(match.state.activePlayerId).toBe(starter); // still their turn: free action

    await drive(match, starter, { kind: 'play-object', objectInstanceId: objects[1]! });
    expect(match.state.activePlayerId).toBe(other); // 2nd object ends the turn
  });

  it("the second player's very first turn gets a free exception for their 2nd object", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 11 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const starter = match.state.startingPlayerId;
    const second = opponentOf(starter);

    await drive(match, starter, { kind: 'pass' });
    expect(match.state.activePlayerId).toBe(second);

    const objects = [...match.state.players[second].unplayedObjectInstanceIds];
    await drive(match, second, { kind: 'play-object', objectInstanceId: objects[0]! });
    await drive(match, second, { kind: 'play-object', objectInstanceId: objects[1]! });

    // Second player's first turn: even a 2nd object doesn't end the turn.
    expect(match.state.activePlayerId).toBe(second);
  });

  it('an attack ends the turn by default', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 12 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const active = match.state.activePlayerId;
    const other = opponentOf(active);
    const instanceId = match.state.players[active].activeCharacterInstanceId!;
    const cardId = match.state.players[active].characters[instanceId]!.cardId;
    const attackId = cardId === 'fx-striker' ? 'strike' : 'poke';

    await drive(match, active, { kind: 'attack', characterInstanceId: instanceId, attackId });
    expect(match.state.activePlayerId).toBe(other);
  });

  it('a card-level endsTurn:false override on an attack keeps the turn going', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 13 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-striker' } // both sides carry the override attack
    );
    const active = match.state.activePlayerId;
    const instanceId = match.state.players[active].activeCharacterInstanceId!;

    await drive(match, active, { kind: 'attack', characterInstanceId: instanceId, attackId: 'no-end-strike' });
    expect(match.state.activePlayerId).toBe(active); // turn did not end
  });

  it('using an ability is a free action and does not end the turn', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 14 },
      { p1ActiveCardId: 'fx-stunner', p2ActiveCardId: 'fx-stunner' }
    );
    const active = match.state.activePlayerId;
    const instanceId = match.state.players[active].activeCharacterInstanceId!;

    await drive(match, active, { kind: 'use-ability', characterInstanceId: instanceId, abilityId: 'stun-enemy' });
    expect(match.state.activePlayerId).toBe(active);
  });

  it('switching to the bench ends the turn', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 15 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const active = match.state.activePlayerId;
    const other = opponentOf(active);
    const benchId = match.state.players[active].benchCharacterInstanceIds[0]!;

    await drive(match, active, { kind: 'switch', newActiveInstanceId: benchId });
    expect(match.state.players[active].activeCharacterInstanceId).toBe(benchId);
    expect(match.state.activePlayerId).toBe(other);
  });
});
