import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type PlayerId, type RosterConfig } from '../src/index.js';
import { cameleon } from '../src/cards/demo/cameleon.js';
import { chaines } from '../src/cards/demo/chaines.js';
import { potionForce } from '../src/cards/demo/potion-force.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch, defaultAnswer, drive } from './test-utils.js';

let demoCardsRegistered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!demoCardsRegistered) {
    demoCardsRegistered = true;
    registerCard(cameleon);
    registerCard(chaines);
    registerCard(potionForce);
  }
});

const OWNER_ROSTER: RosterConfig = {
  characterCardIds: FX_ROSTER.characterCardIds,
  objectCardIds: ['cameleon', 'chaines', 'potion-force'],
  terrainCardIds: [],
};

describe('Caméléon -- swaps an unplayed object for a fresh one, capped by remaining copy allowance', () => {
  it("destroys the chosen card and creates the replacement, refusing a replacement already at its copy limit", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: FX_ROSTER, seed: 110 },
      { p2ActiveCardId: 'fx-tank' }
    );
    const ownerSide: PlayerId = 'p1';
    if (match.state.activePlayerId !== ownerSide) await drive(match, 'p2', { kind: 'pass' });
    const player = match.state.players[ownerSide];

    const chainesId = Object.values(player.objects).find((o) => o.cardId === 'chaines')!.instanceId;
    const cameleonId = Object.values(player.objects).find((o) => o.cardId === 'cameleon')!.instanceId;
    const potionForceId = Object.values(player.objects).find((o) => o.cardId === 'potion-force')!.instanceId;
    const potionCountBefore = Object.values(player.objects).filter((o) => o.cardId === 'potion-force').length;
    expect(potionCountBefore).toBe(1);

    // Only "chaines" is left as a removal candidate (cameleon itself is auto-removed
    // from this same pool by handlePlayObject before its own execute() runs). For the
    // replacement choice, "cameleon" would also be eligible and sort first -- steer
    // explicitly onto "potion-force" instead, to exercise a real swap to a different card.
    player.unplayedObjectInstanceIds = player.unplayedObjectInstanceIds.filter((id) => id !== potionForceId);

    await drive(match, ownerSide, { kind: 'play-object', objectInstanceId: cameleonId }, (choice) => {
      if (choice.spec.kind === 'select-option' && choice.spec.options.some((o) => o.key === 'potion-force')) {
        return { kind: 'select-option', key: 'potion-force' };
      }
      return defaultAnswer(choice);
    });

    // "chaines" (maxCopies 1) removed -- but the instance still exists (now in the
    // graveyard), so its total copy count is unchanged: it must NOT be offered back
    // as a replacement. "potion-force" (maxCopies 2, currently 1) is under its cap,
    // so it's the only eligible candidate and gets auto-picked by defaultAnswer.
    expect(player.graveyardObjectInstanceIds).toContain(chainesId);
    const potionCountAfter = Object.values(player.objects).filter((o) => o.cardId === 'potion-force').length;
    expect(potionCountAfter).toBe(2);
    const chainesCountAfter = Object.values(player.objects).filter((o) => o.cardId === 'chaines').length;
    expect(chainesCountAfter).toBe(1); // still just the one, now-graveyarded, instance
  });
});
