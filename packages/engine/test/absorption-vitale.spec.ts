import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type PlayerId, type RosterConfig } from '../src/index.js';
import { absorptionVitale } from '../src/cards/demo/absorption-vitale.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

let absorptionVitaleRegistered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!absorptionVitaleRegistered) {
    absorptionVitaleRegistered = true;
    registerCard(absorptionVitale);
  }
});

const OWNER_ROSTER: RosterConfig = {
  characterCardIds: FX_ROSTER.characterCardIds,
  objectCardIds: ['absorption-vitale'],
  terrainCardIds: [],
};

describe('Absorption Vitale -- lock, then a delayed kill+revive payoff conditioned on survival', () => {
  it('kills the locked character after 3 turns and revives a graveyard character at half max HP', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: FX_ROSTER, seed: 100 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const ownerSide: PlayerId = 'p1';
    const enemySide: PlayerId = 'p2';
    if (match.state.activePlayerId !== ownerSide) await drive(match, enemySide, { kind: 'pass' });

    const lockedId = match.state.players[ownerSide].activeCharacterInstanceId!;
    const stunnerId = Object.values(match.state.players[ownerSide].characters).find((c) => c.cardId === 'fx-stunner')!
      .instanceId;
    // Pretend fx-stunner already died earlier this game.
    match.state.players[ownerSide].benchCharacterInstanceIds = match.state.players[ownerSide].benchCharacterInstanceIds.filter(
      (id) => id !== stunnerId
    );
    match.state.players[ownerSide].graveyardCharacterInstanceIds.push(stunnerId);

    const objectInstanceId = Object.values(match.state.players[ownerSide].objects).find(
      (o) => o.cardId === 'absorption-vitale'
    )!.instanceId;
    await drive(match, ownerSide, { kind: 'play-object', objectInstanceId });

    const locked = match.state.players[ownerSide].characters[lockedId]!;
    expect(locked.statuses.some((s) => s.statusId === 'chained')).toBe(true);
    expect(locked.statuses.some((s) => s.statusId === 'silence-ultimate')).toBe(true);
    expect(locked.statuses.some((s) => s.statusId === 'sacrifice-revive')).toBe(true);
    expect(locked.attachedObjectInstanceIds).toContain(objectInstanceId);

    // Nobody attacks him; he survives his own next 3 turns untouched, plus the
    // extra pass-pair to actually reach the 4th onTurnStart where the payoff fires
    // (remainingTurns reads 1 there, one tick shy of the statuses' own expiry).
    for (let i = 0; i < 4; i++) {
      await drive(match, ownerSide, { kind: 'pass' });
      await drive(match, enemySide, { kind: 'pass' });
    }

    expect(match.state.players[ownerSide].graveyardCharacterInstanceIds).toContain(lockedId);
    // The equipped object dies with its bearer -- straight to the owner's graveyard.
    expect(match.state.players[ownerSide].graveyardObjectInstanceIds).toContain(objectInstanceId);
    const revived = match.state.players[ownerSide].characters[stunnerId]!;
    expect(match.state.players[ownerSide].benchCharacterInstanceIds).toContain(stunnerId);
    expect(match.state.players[ownerSide].graveyardCharacterInstanceIds).not.toContain(stunnerId);
    expect(revived.damage).toBe(revived.currentMaxHP - Math.floor(revived.currentMaxHP / 2));
    expect(revived.shield).toBe(0);
    expect(revived.statuses).toEqual([]);
  });

  it('goes to the graveyard without effect if the locked character dies before the 3 turns are up', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: FX_ROSTER, seed: 101 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-striker' }
    );
    const ownerSide: PlayerId = 'p1';
    const enemySide: PlayerId = 'p2';
    if (match.state.activePlayerId !== ownerSide) await drive(match, enemySide, { kind: 'pass' });
    const lockedId = match.state.players[ownerSide].activeCharacterInstanceId!;

    const objectInstanceId = Object.values(match.state.players[ownerSide].objects).find(
      (o) => o.cardId === 'absorption-vitale'
    )!.instanceId;
    await drive(match, ownerSide, { kind: 'play-object', objectInstanceId });
    await drive(match, ownerSide, { kind: 'pass' });

    // Enemy kills the locked character outright (bypassing the damage pipeline, like
    // Akali's Perfect Execution) before the 3 turns are up.
    const enemyId = match.state.players[enemySide].activeCharacterInstanceId!;
    await drive(match, enemySide, { kind: 'use-ability', characterInstanceId: enemyId, abilityId: 'instant-ko' });

    expect(match.state.players[ownerSide].graveyardCharacterInstanceIds).toContain(lockedId);
    // The equipped object dies with its bearer -- straight to the owner's graveyard,
    // without ever triggering the sacrifice-revive payoff (the character never survives
    // to see 'sacrifice-revive' expire).
    expect(match.state.players[ownerSide].graveyardObjectInstanceIds).toContain(objectInstanceId);
    expect(match.state.players[ownerSide].objects[objectInstanceId]!.attachedToCharacterInstanceId).toBeUndefined();
  });
});
