import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type PlayerId, type RosterConfig } from '../src/index.js';
import { zoe } from '../src/cards/demo/zoe.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

let zoeRegistered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!zoeRegistered) {
    zoeRegistered = true;
    registerCard(zoe);
  }
});

function opponentOf(id: PlayerId): PlayerId {
  return id === 'p1' ? 'p2' : 'p1';
}

const ZOE_ROSTER: RosterConfig = { characterCardIds: [zoe.id], objectCardIds: [], terrainCardIds: [] };

describe('Zoé "Spell Thief" (tracks + re-executes the enemy\'s last active ability, Zoé as source)', () => {
  it("re-executes the stolen ability with Zoé as the source (the buff lands on her, not the original caster)", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ZOE_ROSTER, p2Roster: FX_ROSTER, seed: 80 },
      { p2ActiveCardId: 'fx-tank' }
    );
    const zoeSide: PlayerId = 'p1';
    const enemySide: PlayerId = 'p2';
    if (match.state.activePlayerId !== enemySide) await drive(match, zoeSide, { kind: 'pass' });

    const enemyActiveId = match.state.players[enemySide].activeCharacterInstanceId!;
    const zoeActiveId = match.state.players[zoeSide].activeCharacterInstanceId!;

    await drive(match, enemySide, { kind: 'use-ability', characterInstanceId: enemyActiveId, abilityId: 'self-buff' });
    expect(match.state.players[enemySide].characters[enemyActiveId]!.statuses.some((s) => s.statusId === 'atk-boost')).toBe(true);

    await drive(match, enemySide, { kind: 'pass' });
    expect(match.state.activePlayerId).toBe(zoeSide);

    await drive(match, zoeSide, { kind: 'use-ability', characterInstanceId: zoeActiveId, abilityId: 'spell-thief' });

    const zoeChar = match.state.players[zoeSide].characters[zoeActiveId]!;
    expect(zoeChar.statuses.some((s) => s.statusId === 'atk-boost')).toBe(true); // stolen buff landed on Zoé herself
    expect(zoeChar.statuses.some((s) => s.statusId === 'zoe-spell-thief-cooldown')).toBe(true);

    // Immediate reuse is blocked by the 3-turn cooldown.
    const secondAttempt = match.applyAction(zoeSide, { kind: 'use-ability', characterInstanceId: zoeActiveId, abilityId: 'spell-thief' });
    expect(secondAttempt.ok).toBe(false);
  });

  it('is unusable with nothing recorded yet, and becomes usable again once the cooldown fully ticks off', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ZOE_ROSTER, p2Roster: FX_ROSTER, seed: 82 },
      { p2ActiveCardId: 'fx-tank' }
    );
    const zoeSide: PlayerId = 'p1';
    const enemySide: PlayerId = 'p2';
    const enemyActiveId = match.state.players[enemySide].activeCharacterInstanceId!;
    const zoeActiveId = match.state.players[zoeSide].activeCharacterInstanceId!;

    // Nothing recorded yet: condition() must refuse the action outright, on Zoé's own turn.
    if (match.state.activePlayerId !== zoeSide) await drive(match, enemySide, { kind: 'pass' });
    const tooEarly = match.applyAction(zoeSide, { kind: 'use-ability', characterInstanceId: zoeActiveId, abilityId: 'spell-thief' });
    expect(tooEarly.ok).toBe(false);
    await drive(match, zoeSide, { kind: 'pass' });

    await drive(match, enemySide, { kind: 'use-ability', characterInstanceId: enemyActiveId, abilityId: 'self-buff' });
    await drive(match, enemySide, { kind: 'pass' });
    await drive(match, zoeSide, { kind: 'use-ability', characterInstanceId: zoeActiveId, abilityId: 'spell-thief' });
    await drive(match, zoeSide, { kind: 'pass' });

    // 3-turn cooldown: still blocked on Zoé's next three turns, usable again on the fourth.
    for (let i = 0; i < 3; i++) {
      await drive(match, enemySide, { kind: 'pass' });
      const blocked = match.applyAction(zoeSide, { kind: 'use-ability', characterInstanceId: zoeActiveId, abilityId: 'spell-thief' });
      expect(blocked.ok).toBe(false);
      await drive(match, zoeSide, { kind: 'pass' });
    }
    await drive(match, enemySide, { kind: 'pass' });
    const readyAgain = match.applyAction(zoeSide, { kind: 'use-ability', characterInstanceId: zoeActiveId, abilityId: 'spell-thief' });
    expect(readyAgain.ok).toBe(true);
  });
});
