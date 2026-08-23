import { beforeAll, describe, expect, it } from 'vitest';
import { registerTestFixtures, MIRROR_ROSTER } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

describe('"Miroir de Renvoi" mechanism (attached object reflects the next hit back to the attacker, then self-destroys) -- through the engine', () => {
  it('reflects 50% of the first hit back to the attacker, then stops reflecting', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: MIRROR_ROSTER, p2Roster: MIRROR_ROSTER, seed: 95 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-striker' }
    );
    const bearerId = match.state.activePlayerId;
    const attackerId = bearerId === 'p1' ? 'p2' : 'p1';
    const bearer = match.state.players[bearerId];
    const attacker = match.state.players[attackerId];
    const bearerActiveId = bearer.activeCharacterInstanceId!;
    const attackerActiveId = attacker.activeCharacterInstanceId!;

    const mirrorObjectId = Object.values(bearer.objects).find((o) => o.cardId === 'fx-mirror-object')!.instanceId;
    await drive(match, bearerId, { kind: 'play-object', objectInstanceId: mirrorObjectId });
    expect(bearer.characters[bearerActiveId]!.statuses.some((s) => s.statusId === 'damage-reflect')).toBe(true);
    expect(bearer.inPlayObjectInstanceIds).toContain(mirrorObjectId); // attached, not discarded
    await drive(match, bearerId, { kind: 'pass' }); // playing a single object doesn't end the turn on its own

    // Attacker's first hit: strike deals 40. Bearer takes it in full, attacker gets 50% (20) reflected back.
    await drive(match, attackerId, { kind: 'attack', characterInstanceId: attackerActiveId, attackId: 'strike' });
    expect(bearer.characters[bearerActiveId]!.damage).toBe(40);
    expect(attacker.characters[attackerActiveId]!.damage).toBe(20);
    expect(bearer.characters[bearerActiveId]!.statuses.some((s) => s.statusId === 'damage-reflect')).toBe(false);
    expect(bearer.inPlayObjectInstanceIds).not.toContain(mirrorObjectId);
    expect(bearer.graveyardObjectInstanceIds).toContain(mirrorObjectId); // one-shot, self-destroyed

    // Second hit: nothing left to reflect.
    await drive(match, bearerId, { kind: 'pass' });
    await drive(match, attackerId, { kind: 'attack', characterInstanceId: attackerActiveId, attackId: 'strike' });
    expect(bearer.characters[bearerActiveId]!.damage).toBe(80);
    expect(attacker.characters[attackerActiveId]!.damage).toBe(20); // unchanged -- no more reflection
  });
});
