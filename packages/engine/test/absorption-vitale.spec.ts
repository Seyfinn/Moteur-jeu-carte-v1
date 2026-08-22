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
  objectCardIds: [],
  terrainCardIds: ['absorption-vitale'],
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

    const terrainInstanceId = Object.values(match.state.players[ownerSide].terrains).find(
      (t) => t.cardId === 'absorption-vitale'
    )!.instanceId;
    await drive(match, ownerSide, { kind: 'play-terrain', terrainInstanceId });

    const locked = match.state.players[ownerSide].characters[lockedId]!;
    expect(locked.statuses.some((s) => s.statusId === 'chained')).toBe(true);
    expect(locked.statuses.some((s) => s.statusId === 'silence-ultimate')).toBe(true);

    // Nobody attacks him; he survives his own next 3 turns untouched, plus the
    // extra pass-pair to actually reach the 4th onTurnStart where the payoff fires
    // (remainingTurns reads 1 there, one tick shy of the terrain's own expiry).
    for (let i = 0; i < 4; i++) {
      await drive(match, ownerSide, { kind: 'pass' });
      await drive(match, enemySide, { kind: 'pass' });
    }

    expect(match.state.players[ownerSide].graveyardCharacterInstanceIds).toContain(lockedId);
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
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const ownerSide: PlayerId = 'p1';
    const enemySide: PlayerId = 'p2';
    if (match.state.activePlayerId !== ownerSide) await drive(match, enemySide, { kind: 'pass' });
    const lockedId = match.state.players[ownerSide].activeCharacterInstanceId!;

    const terrainInstanceId = Object.values(match.state.players[ownerSide].terrains).find(
      (t) => t.cardId === 'absorption-vitale'
    )!.instanceId;
    await drive(match, ownerSide, { kind: 'play-terrain', terrainInstanceId });
    await drive(match, ownerSide, { kind: 'pass' });

    // Simulate the locked character dying (replaced by a bench-mate), before turn 3
    // elapses. Applied directly to state rather than through koCharacter: that helper
    // awaits a mandatory-replacement choice internally, which can only be answered by
    // code that runs *after* the same await -- i.e. calling it synchronously here would
    // deadlock. Keeping a bench-mate alive also avoids a false win condition, since
    // dropping the owner to zero characters would end the game before turn 3 hits.
    const player = match.state.players[ownerSide];
    const replacementId = player.benchCharacterInstanceIds[0]!;
    player.benchCharacterInstanceIds = player.benchCharacterInstanceIds.filter((id) => id !== replacementId);
    player.graveyardCharacterInstanceIds.push(lockedId);
    player.activeCharacterInstanceId = replacementId;

    await drive(match, enemySide, { kind: 'pass' }); // back to the owner's side -- tick sees the target is gone

    expect(match.state.players[ownerSide].graveyardTerrainInstanceIds).toContain(terrainInstanceId);
    expect(match.state.players[ownerSide].activeTerrainInstanceId).toBeNull();
    // The lock statuses are cleaned up rather than left stranded on the dead character.
    expect(match.state.players[ownerSide].characters[lockedId]!.statuses).toEqual([]);
  });
});
