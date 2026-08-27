import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type PlayerId, type RosterConfig } from '../src/index.js';
import { echangeEquivalent } from '../src/cards/demo/echange-equivalent.js';
import { registerTestFixtures } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

let registered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!registered) {
    registered = true;
    registerCard(echangeEquivalent);
  }
});

const OWNER_ROSTER: RosterConfig = {
  characterCardIds: ['fx-striker', 'fx-tank'],
  objectCardIds: ['echange-equivalent', 'fx-heal-object', 'fx-heal-object'],
  terrainCardIds: [],
};

describe('Echange équivalent -- sacrifices 2 cards for a fresh copy of ANY object/terrain in the game', () => {
  it('recovers a brand-new instance of a card the player never owned, capped by the deck copy limit', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: OWNER_ROSTER, seed: 200 },
      {}
    );
    const ownerSide: PlayerId = 'p1';
    if (match.state.activePlayerId !== ownerSide) await drive(match, 'p2', { kind: 'pass' });
    const player = match.state.players[ownerSide];

    const echangeId = Object.values(player.objects).find((o) => o.cardId === 'echange-equivalent')!.instanceId;
    const healIds = Object.values(player.objects)
      .filter((o) => o.cardId === 'fx-heal-object')
      .map((o) => o.instanceId);
    expect(healIds).toHaveLength(2);

    await drive(match, ownerSide, { kind: 'play-object', objectInstanceId: echangeId }, (choice) => {
      if (choice.spec.kind !== 'select-option') throw new Error('unexpected choice kind');
      // The two sacrifice prompts only ever offer the two fx-heal-object instances
      // (echange-equivalent itself is already out of the unplayed pool by the time its
      // own execute() runs).
      if (choice.spec.options.every((o) => healIds.includes(o.key))) {
        return { kind: 'select-option', key: choice.spec.options[0]!.key };
      }
      // The recovery prompt: every registered object/terrain the player is still under
      // the copy cap for -- pick a terrain the player never owned at all.
      expect(choice.spec.options.some((o) => o.key === 'fx-aura-terrain')).toBe(true);
      // fx-heal-object is already at its default cap of 2 (both sacrificed copies still
      // count, just relocated to the graveyard) -- it must NOT be offered back.
      expect(choice.spec.options.some((o) => o.key === 'fx-heal-object')).toBe(false);
      return { kind: 'select-option', key: 'fx-aura-terrain' };
    });

    expect(player.graveyardObjectInstanceIds).toEqual(expect.arrayContaining(healIds));

    const gainedTerrainId = Object.values(player.terrains).find((t) => t.cardId === 'fx-aura-terrain')?.instanceId;
    expect(gainedTerrainId).toBeDefined();
    expect(player.unplayedTerrainInstanceIds).toContain(gainedTerrainId);
  });
});
