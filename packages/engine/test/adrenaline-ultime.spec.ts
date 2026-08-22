import { beforeAll, describe, expect, it } from 'vitest';
import { registerTestFixtures, ADRENALINE_ROSTER } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

describe('"Adrénaline Ultime" mechanism (object play-condition gate + atk-multiplier status) -- through the engine', () => {
  it('cannot be played below the HP threshold', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ADRENALINE_ROSTER, p2Roster: ADRENALINE_ROSTER, seed: 96 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-striker' }
    );
    const playerId = match.state.activePlayerId;
    const player = match.state.players[playerId];
    const activeId = player.activeCharacterInstanceId!;
    player.characters[activeId]!.damage = 95; // fx-striker has 100 max HP -> 5 HP left, below the 150 threshold
    const objectId = Object.values(player.objects).find((o) => o.cardId === 'fx-adrenaline-object')!.instanceId;

    const result = match.applyAction(playerId, { kind: 'play-object', objectInstanceId: objectId });
    expect(result.ok).toBe(false);
  });

  it('drops current HP to 10 and doubles this turn\'s attack damage, then stops applying on a later turn', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ADRENALINE_ROSTER, p2Roster: ADRENALINE_ROSTER, seed: 97 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-striker' }
    );
    const attackerId = match.state.activePlayerId;
    const defenderId = attackerId === 'p1' ? 'p2' : 'p1';
    const attacker = match.state.players[attackerId];
    const defender = match.state.players[defenderId];
    const attackerActiveId = attacker.activeCharacterInstanceId!;
    const defenderActiveId = defender.activeCharacterInstanceId!;
    // Simulate having enough HP for the threshold without needing a dedicated high-HP fixture.
    attacker.characters[attackerActiveId]!.currentMaxHP = 200;
    attacker.characters[attackerActiveId]!.damage = 0;

    const objectId = Object.values(attacker.objects).find((o) => o.cardId === 'fx-adrenaline-object')!.instanceId;
    await drive(match, attackerId, { kind: 'play-object', objectInstanceId: objectId });
    expect(attacker.characters[attackerActiveId]!.currentMaxHP - attacker.characters[attackerActiveId]!.damage).toBe(10);

    await drive(match, attackerId, { kind: 'attack', characterInstanceId: attackerActiveId, attackId: 'strike' });
    expect(defender.characters[defenderActiveId]!.damage).toBe(80); // 40 base, doubled this turn

    await drive(match, defenderId, { kind: 'pass' }); // ends the defender's turn without touching the fragile (10 HP) attacker
    await drive(match, attackerId, { kind: 'attack', characterInstanceId: attackerActiveId, attackId: 'strike' });
    expect(defender.characters[defenderActiveId]!.damage).toBe(80 + 40); // no longer doubled -- the buff expired at this turn's start
  });
});
