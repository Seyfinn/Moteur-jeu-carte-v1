import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type ChoiceAnswer, type Match, type PendingChoice, type PlayerId, type RosterConfig } from '../src/index.js';
import { jacobEtEssau } from '../src/cards/demo/jacob-et-essau.js';
import { pheonix } from '../src/cards/demo/pheonix.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch, drive, defaultAnswer } from './test-utils.js';

let cardsRegistered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!cardsRegistered) {
    cardsRegistered = true;
    registerCard(jacobEtEssau);
    registerCard(pheonix);
  }
});

const LINK_ROSTER: RosterConfig = {
  characterCardIds: ['fx-striker', 'fx-tank'],
  objectCardIds: [jacobEtEssau.id],
  terrainCardIds: [],
};

const PHEONIX_ROSTER: RosterConfig = {
  characterCardIds: ['fx-striker', 'fx-tank'],
  objectCardIds: [pheonix.id],
  terrainCardIds: [],
};

/** Answers a "pick N characters" prompt with the first N options, everything else by default. */
function pickFirst(count: number) {
  return (choice: PendingChoice): ChoiceAnswer => {
    if (choice.spec.kind !== 'select-characters') return defaultAnswer(choice);
    return { kind: 'select-characters', selected: choice.spec.options.slice(0, count) };
  };
}

/** Which side opens is seed-dependent; these tests need p1 (the one holding the object) to act. */
async function ensureTurn(match: Match, playerId: PlayerId): Promise<void> {
  if (match.state.activePlayerId !== playerId) {
    await drive(match, match.state.activePlayerId, { kind: 'pass' });
  }
}

describe('"Jacob et Essau" -- the generic `linked` status the engine enforces', () => {
  it('mirrors every damage instance onto the partner, and a death takes both', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: LINK_ROSTER, p2Roster: FX_ROSTER, seed: 7 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-striker' }
    );
    const bearer = match.state.players.p1;
    const enemy = match.state.players.p2;

    await ensureTurn(match, 'p1');
    const linkObjectId = Object.values(bearer.objects).find((o) => o.cardId === jacobEtEssau.id)!.instanceId;
    await drive(match, 'p1', { kind: 'play-object', objectInstanceId: linkObjectId }, pickFirst(2));

    const linkedIds = Object.values(bearer.characters)
      .filter((c) => c.statuses.some((s) => s.statusId === 'linked'))
      .map((c) => c.instanceId);
    expect(linkedIds).toHaveLength(2);
    // Symmetric pairing: each half points at the other.
    const [firstId, secondId] = linkedIds as [string, string];
    expect(bearer.characters[firstId]!.statuses.find((s) => s.statusId === 'linked')!.data!['partnerInstanceId']).toBe(secondId);
    expect(bearer.characters[secondId]!.statuses.find((s) => s.statusId === 'linked')!.data!['partnerInstanceId']).toBe(firstId);

    await drive(match, 'p1', { kind: 'pass' });

    // One enemy strike (40) lands on the active half; the mirror puts the same 40 on the
    // benched half, which never got hit directly.
    const enemyActiveId = enemy.activeCharacterInstanceId!;
    const damageBefore = linkedIds.map((id) => bearer.characters[id]!.damage);
    expect(damageBefore).toEqual([0, 0]);
    await drive(match, 'p2', { kind: 'attack', characterInstanceId: enemyActiveId, attackId: 'strike' });

    const activeHalfId = bearer.activeCharacterInstanceId!;
    const benchHalfId = linkedIds.find((id) => id !== activeHalfId)!;
    expect(bearer.characters[activeHalfId]!.damage).toBe(40);
    expect(bearer.characters[benchHalfId]!.damage).toBe(40); // mirrored, not hit directly
  });

  it('kills the partner too when one half dies, and never offers the doomed partner as the replacement', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: LINK_ROSTER, p2Roster: FX_ROSTER, seed: 11 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-striker' }
    );
    const bearer = match.state.players.p1;

    await ensureTurn(match, 'p1');
    const linkObjectId = Object.values(bearer.objects).find((o) => o.cardId === jacobEtEssau.id)!.instanceId;
    await drive(match, 'p1', { kind: 'play-object', objectInstanceId: linkObjectId }, pickFirst(2));
    await drive(match, 'p1', { kind: 'pass' });

    // Instant KO on the active half, straight through ctx.koCharacter (no damage
    // pipeline) -- so this exercises the shared-death rule on its own, not the mirror.
    const enemyActiveId = match.state.players.p2.activeCharacterInstanceId!;
    await drive(match, 'p2', { kind: 'use-ability', characterInstanceId: enemyActiveId, abilityId: 'instant-ko' });

    expect(bearer.graveyardCharacterInstanceIds).toHaveLength(2); // both halves gone
    expect(bearer.activeCharacterInstanceId).toBeNull();
    expect(bearer.benchCharacterInstanceIds).toHaveLength(0);
    expect(match.state.result).toEqual({ kind: 'win', winner: 'p2' });
  });
});

describe('"Pheonix" -- the delayed revive the engine ticks from the graveyard', () => {
  it('brings the sacrificed character back after its countdown, with the permanent bonuses', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: PHEONIX_ROSTER, p2Roster: FX_ROSTER, seed: 3 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-striker' }
    );
    const owner = match.state.players.p1;

    await ensureTurn(match, 'p1');
    const pheonixId = Object.values(owner.objects).find((o) => o.cardId === pheonix.id)!.instanceId;
    const sacrificedId = owner.activeCharacterInstanceId!;
    const maxHPBefore = owner.characters[sacrificedId]!.currentMaxHP;

    await drive(match, 'p1', { kind: 'play-object', objectInstanceId: pheonixId }, pickFirst(1));

    expect(owner.graveyardCharacterInstanceIds).toContain(sacrificedId);
    expect(owner.pendingRevives).toHaveLength(1);
    expect(owner.pendingRevives[0]!.characterInstanceId).toBe(sacrificedId);
    const scheduledTurns = owner.pendingRevives[0]!.turnsRemaining;

    // Countdown is in the OWNER's turns: each p1 turn start ticks it down by one.
    for (let i = 0; i < scheduledTurns; i++) {
      expect(owner.graveyardCharacterInstanceIds).toContain(sacrificedId);
      await drive(match, 'p1', { kind: 'pass' });
      await drive(match, 'p2', { kind: 'pass' });
    }

    expect(owner.pendingRevives).toHaveLength(0);
    expect(owner.graveyardCharacterInstanceIds).not.toContain(sacrificedId);
    const revived = owner.characters[sacrificedId]!;
    expect(revived.currentMaxHP).toBe(maxHPBefore + 100);
    expect(revived.damage).toBe(0); // back at full HP
    const atkBoost = revived.statuses.find((s) => s.statusId === 'atk-boost');
    expect(atkBoost?.data?.['amount']).toBe(50);
    expect(atkBoost?.remainingTurns).toBeUndefined(); // permanent, never ticks away
  });

  it('refuses to play when it would leave its owner with no character at all', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: PHEONIX_ROSTER, p2Roster: FX_ROSTER, seed: 5 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-striker' }
    );
    const owner = match.state.players.p1;

    // Empty the bench so only the active character is left alive.
    const benched = [...owner.benchCharacterInstanceIds];
    for (const id of benched) {
      owner.benchCharacterInstanceIds.splice(owner.benchCharacterInstanceIds.indexOf(id), 1);
      owner.graveyardCharacterInstanceIds.push(id);
    }

    await ensureTurn(match, 'p1');
    const pheonixId = Object.values(owner.objects).find((o) => o.cardId === pheonix.id)!.instanceId;
    const result = match.applyAction('p1', { kind: 'play-object', objectInstanceId: pheonixId });
    expect(result.ok).toBe(false);
    expect(owner.graveyardCharacterInstanceIds).not.toContain(owner.activeCharacterInstanceId);
  });
});
