import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type PlayerId, type RosterConfig } from '../src/index.js';
import { sion } from '../src/cards/demo/sion.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch } from './test-utils.js';

let sionRegistered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!sionRegistered) {
    sionRegistered = true;
    registerCard(sion);
  }
});

const SION_ROSTER: RosterConfig = { characterCardIds: [sion.id], objectCardIds: [], terrainCardIds: [] };

describe('Sion "Guerrier mourrant" -- attacks one last time on his own death', () => {
  it('fires even though koCharacter has already removed Sion from active/bench by the time onCharacterKO runs', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: SION_ROSTER, p2Roster: FX_ROSTER, seed: 90 },
      { p2ActiveCardId: 'fx-striker' }
    );
    const sionSide: PlayerId = 'p1';
    const enemySide: PlayerId = 'p2';
    const sionId = match.state.players[sionSide].activeCharacterInstanceId!;
    const enemyActiveId = match.state.players[enemySide].activeCharacterInstanceId!;
    const enemyActive = match.state.players[enemySide].characters[enemyActiveId]!;

    const api = match['api'] as { koCharacter(id: string): Promise<void> };

    // fx-striker's innate ~5% dodge could occasionally shrug off Sion's posthumous
    // hit; retry a few times (re-"killing" Sion fresh each time) until it lands.
    let landed = false;
    for (let i = 0; i < 15 && !landed; i++) {
      match.state.players[sionSide].graveyardCharacterInstanceIds = [];
      match.state.players[sionSide].activeCharacterInstanceId = sionId;
      match.state.players[sionSide].characters[sionId]!.damage = 0;
      match.state.players[sionSide].characters[sionId]!.abilityUsesThisTurn = {}; // simulate a fresh turn per retry
      enemyActive.damage = 0;

      await api.koCharacter(sionId);
      landed = enemyActive.damage > 0;
    }

    expect(match.state.players[sionSide].graveyardCharacterInstanceIds).toContain(sionId);
    expect(landed).toBe(true); // Sion's posthumous Hache Géante actually reached the enemy active
  });
});
