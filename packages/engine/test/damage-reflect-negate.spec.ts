import { beforeAll, describe, expect, it } from 'vitest';
import { registerTestFixtures, MIRROR_NEGATE_ROSTER } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

/**
 * `damage-reflect`'s optional `data.negatesOriginal` (introduced for Yugi's "Puzzle
 * Millénaire", branche à 4 % : "renvoie 100% des dégâts... et ne les subit pas") -- the
 * bearer takes ZERO of the hit that triggers it, on top of the usual reflection. Miroir de
 * Renvoi never sets this field, and its own spec (miroir-de-renvoi.spec.ts) already covers
 * that the bearer keeps taking the hit in full when it's absent.
 */
describe('"damage-reflect" with negatesOriginal (Puzzle Millénaire) -- through the engine', () => {
  it('reflects 100% of the hit back to the attacker AND the bearer takes none of it', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: MIRROR_NEGATE_ROSTER, p2Roster: MIRROR_NEGATE_ROSTER, seed: 96 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-striker' }
    );
    const bearerId = match.state.activePlayerId;
    const attackerId = bearerId === 'p1' ? 'p2' : 'p1';
    const bearer = match.state.players[bearerId];
    const attacker = match.state.players[attackerId];
    const bearerActiveId = bearer.activeCharacterInstanceId!;
    const attackerActiveId = attacker.activeCharacterInstanceId!;

    const objectId = Object.values(bearer.objects).find((o) => o.cardId === 'fx-mirror-negate-object')!.instanceId;
    await drive(match, bearerId, { kind: 'play-object', objectInstanceId: objectId });
    await drive(match, bearerId, { kind: 'pass' });

    // Strike deals 40. Bearer should take NONE of it; attacker takes the full 40 reflected.
    await drive(match, attackerId, { kind: 'attack', characterInstanceId: attackerActiveId, attackId: 'strike' });
    expect(bearer.characters[bearerActiveId]!.damage).toBe(0);
    expect(attacker.characters[attackerActiveId]!.damage).toBe(40);
    expect(bearer.characters[bearerActiveId]!.statuses.some((s) => s.statusId === 'damage-reflect')).toBe(false);
    expect(bearer.graveyardObjectInstanceIds).toContain(objectId); // one-shot, self-destroyed

    // Second hit: nothing left to reflect or negate -- ordinary damage this time.
    await drive(match, bearerId, { kind: 'pass' });
    await drive(match, attackerId, { kind: 'attack', characterInstanceId: attackerActiveId, attackId: 'strike' });
    expect(bearer.characters[bearerActiveId]!.damage).toBe(40);
    expect(attacker.characters[attackerActiveId]!.damage).toBe(40); // unchanged
  });
});
