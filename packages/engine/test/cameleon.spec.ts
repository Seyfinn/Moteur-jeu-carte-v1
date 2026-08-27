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

describe('Caméléon -- transforms in place into a card from hand and immediately resolves its effect', () => {
  it('becomes the chosen card and plays it, refusing a target already at its copy limit', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: FX_ROSTER, seed: 110 },
      { p2ActiveCardId: 'fx-tank' }
    );
    const ownerSide: PlayerId = 'p1';
    if (match.state.activePlayerId !== ownerSide) await drive(match, 'p2', { kind: 'pass' });
    const player = match.state.players[ownerSide];

    const cameleonId = Object.values(player.objects).find((o) => o.cardId === 'cameleon')!.instanceId;
    const chainesId = Object.values(player.objects).find((o) => o.cardId === 'chaines')!.instanceId;

    await drive(match, ownerSide, { kind: 'play-object', objectInstanceId: cameleonId }, (choice) => {
      if (choice.spec.kind === 'select-option') {
        // "chaines" (maxCopies 1) is already at its cap with this very instance -- it must
        // not be offered. "potion-force" (maxCopies 2, currently 1 owned) is under its cap.
        expect(choice.spec.options.some((o) => o.key === 'chaines')).toBe(false);
        expect(choice.spec.options.some((o) => o.key === 'potion-force')).toBe(true);
        return { kind: 'select-option', key: 'potion-force' };
      }
      // The nested "select-characters" prompt from potion-force's own execute (which
      // character to equip) is left to the default answer (first legal candidate).
      return defaultAnswer(choice);
    });

    // Caméléon's own instance transformed in place -- same instanceId, new cardId.
    const transformed = player.objects[cameleonId]!;
    expect(transformed.cardId).toBe('potion-force');

    // potion-force's effect actually resolved: some character got equipped and boosted.
    expect(transformed.attachedToCharacterInstanceId).toBeDefined();
    const equipped = player.characters[transformed.attachedToCharacterInstanceId!]!;
    expect(equipped.attachedObjectInstanceIds).toContain(cameleonId);
    expect(equipped.statuses.some((s) => s.statusId === 'atk-boost')).toBe(true);

    // "chaines" was never touched by any of this -- still sitting untouched in hand.
    expect(player.objects[chainesId]!.cardId).toBe('chaines');
    expect(player.unplayedObjectInstanceIds).toContain(chainesId);
  });
});
