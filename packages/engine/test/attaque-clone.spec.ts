import { beforeAll, describe, expect, it } from 'vitest';
import { registerDemoCards, type Match, type PlayerId, type RosterConfig } from '../src/index.js';
import { attaqueClone } from '../src/cards/demo/attaque-clone.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
  registerDemoCards();
});

const CLONE_ROSTER: RosterConfig = {
  characterCardIds: ['fx-striker', 'fx-tank'],
  objectCardIds: [attaqueClone.id],
  terrainCardIds: [],
};

/** Which side opens is seed-dependent; this test needs p1 (holder of the object) to act. */
async function ensureTurn(match: Match, playerId: PlayerId): Promise<void> {
  if (match.state.activePlayerId !== playerId) {
    await drive(match, match.state.activePlayerId, { kind: 'pass' });
  }
}

describe('"Attaque cloné" -- the generic `extra-attack` grant the engine spends', () => {
  it('lets the attack run twice in one turn, the second one at half damage', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: CLONE_ROSTER, p2Roster: FX_ROSTER, seed: 21 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const me = match.state.players.p1;
    const foe = match.state.players.p2;

    await ensureTurn(match, 'p1');
    const objectId = Object.values(me.objects).find((o) => o.cardId === attaqueClone.id)!.instanceId;
    await drive(match, 'p1', { kind: 'play-object', objectInstanceId: objectId });

    const attackerId = me.activeCharacterInstanceId!;
    const defenderId = foe.activeCharacterInstanceId!;
    expect(me.characters[attackerId]!.statuses.some((s) => s.statusId === 'extra-attack')).toBe(true);

    // First swing: full 40, and it must NOT end the turn.
    await drive(match, 'p1', { kind: 'attack', characterInstanceId: attackerId, attackId: 'strike' });
    expect(foe.characters[defenderId]!.damage).toBe(40);
    expect(match.state.activePlayerId).toBe('p1'); // still our turn

    // Second swing: 50% of 40 = 20, and this one closes the turn.
    await drive(match, 'p1', { kind: 'attack', characterInstanceId: attackerId, attackId: 'strike' });
    expect(foe.characters[defenderId]!.damage).toBe(60);
    expect(match.state.activePlayerId).toBe('p2');
    // Grant spent, so a later swing can't inherit the discount.
    expect(me.characters[attackerId]!.statuses.some((s) => s.statusId === 'extra-attack')).toBe(false);
  });

  it('leaves the current turn free of the silence, then blocks exactly the next two turns', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: CLONE_ROSTER, p2Roster: FX_ROSTER, seed: 33 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const me = match.state.players.p1;

    await ensureTurn(match, 'p1');
    const objectId = Object.values(me.objects).find((o) => o.cardId === attaqueClone.id)!.instanceId;
    await drive(match, 'p1', { kind: 'play-object', objectInstanceId: objectId });
    const attackerId = me.activeCharacterInstanceId!;

    const silenced = () => me.characters[attackerId]!.statuses.some((s) => s.statusId === 'silence-active');
    expect(silenced()).toBe(false); // turn the card was played on: still free

    // Turn N -> N+1
    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });
    expect(silenced()).toBe(true); // 1st blocked turn

    // Turn N+1 -> N+2
    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });
    expect(silenced()).toBe(true); // 2nd blocked turn

    // Turn N+2 -> N+3: the debt is paid.
    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });
    expect(silenced()).toBe(false);
  });

  it("refuse d'etre jouee si Locke, Light Yagami ou Yumeko est au poste actif", async () => {
    const { describeObjectUnplayable } = await import('../src/index.js');
    const roster: RosterConfig = {
      characterCardIds: ['locke', 'light-yagami', 'yumeko', 'fx-tank'],
      objectCardIds: [attaqueClone.id],
      terrainCardIds: [],
    };
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: roster, p2Roster: FX_ROSTER, seed: 5 },
      { p1ActiveCardId: 'locke', p2ActiveCardId: 'fx-tank' }
    );
    const me = match.state.players.p1;
    await ensureTurn(match, 'p1');
    const objectId = Object.values(me.objects).find((o) => o.cardId === attaqueClone.id)!.instanceId;

    expect(describeObjectUnplayable(match.state, 'p1', objectId)).toBe('Interaction trop puissante.');
    const refused = match.applyAction('p1', { kind: 'play-object', objectInstanceId: objectId });
    expect(refused.ok).toBe(false);

    // Meme refus avec Light Yagami ou Yumeko actifs, aucun avec un autre personnage.
    for (const bannedCardId of ['light-yagami', 'yumeko']) {
      const bannedId = Object.entries(me.characters).find(([, c]) => c.cardId === bannedCardId)![0];
      me.activeCharacterInstanceId = bannedId;
      expect(describeObjectUnplayable(match.state, 'p1', objectId)).toBe('Interaction trop puissante.');
    }
    const tankId = Object.entries(me.characters).find(([, c]) => c.cardId === 'fx-tank')![0];
    me.activeCharacterInstanceId = tankId;
    expect(describeObjectUnplayable(match.state, 'p1', objectId)).toBeNull();
  });

  it('still charges the silence when the extra attack was never taken', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: CLONE_ROSTER, p2Roster: FX_ROSTER, seed: 44 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const me = match.state.players.p1;

    await ensureTurn(match, 'p1');
    const objectId = Object.values(me.objects).find((o) => o.cardId === attaqueClone.id)!.instanceId;
    await drive(match, 'p1', { kind: 'play-object', objectInstanceId: objectId });
    const attackerId = me.activeCharacterInstanceId!;

    await drive(match, 'p1', { kind: 'pass' }); // never attacks at all
    await drive(match, 'p2', { kind: 'pass' });

    expect(me.characters[attackerId]!.statuses.some((s) => s.statusId === 'extra-attack')).toBe(false);
    expect(me.characters[attackerId]!.statuses.some((s) => s.statusId === 'silence-active')).toBe(true);
  });
});
