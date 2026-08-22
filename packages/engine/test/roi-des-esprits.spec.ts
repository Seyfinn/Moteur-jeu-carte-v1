import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type PlayerId, type RosterConfig } from '../src/index.js';
import { roiDesEsprits } from '../src/cards/demo/roi-des-esprits.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

let roiRegistered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!roiRegistered) {
    roiRegistered = true;
    registerCard(roiDesEsprits);
  }
});

const ROI_ROSTER: RosterConfig = { characterCardIds: [roiDesEsprits.id], objectCardIds: [], terrainCardIds: [] };

describe('Roi des esprits "Explosion d\'esprits" (casts all 3 attacks at once, then can\'t attack for the rest of this turn)', () => {
  it('deals ice+fire damage combined, heals the chosen ally, and blocks attacking only until the next own turn', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROI_ROSTER, p2Roster: FX_ROSTER, seed: 110 },
      { p2ActiveCardId: 'fx-tank' }
    );
    const roiSide: PlayerId = 'p1';
    const enemySide: PlayerId = 'p2';
    if (match.state.activePlayerId !== roiSide) await drive(match, enemySide, { kind: 'pass' });

    const roiActiveId = match.state.players[roiSide].activeCharacterInstanceId!;
    const enemyActiveId = match.state.players[enemySide].activeCharacterInstanceId!;
    match.state.players[roiSide].characters[roiActiveId]!.damage = 60; // room for Esprit de soin's heal to matter

    await drive(match, roiSide, { kind: 'use-ability', characterInstanceId: roiActiveId, abilityId: 'explosion-desprits' });

    expect(match.state.players[enemySide].characters[enemyActiveId]!.damage).toBe(50); // 30 (glace) + 20 (feu)
    // Single-character roster -> "select an ally" only ever offers Roi des esprits
    // himself, so Esprit de soin heals him: 60 - 40 = 20 remaining damage.
    expect(match.state.players[roiSide].characters[roiActiveId]!.damage).toBe(20);

    // "Ne peut pas attaquer ce round" -- blocked for the rest of THIS turn.
    const blocked = match.applyAction(roiSide, { kind: 'attack', characterInstanceId: roiActiveId, attackId: 'esprit-de-feu' });
    expect(blocked.ok).toBe(false);

    // ...but gone by the start of Roi des esprits' next own turn.
    await drive(match, roiSide, { kind: 'pass' });
    await drive(match, enemySide, { kind: 'pass' });
    const allowedNextTurn = match.applyAction(roiSide, { kind: 'attack', characterInstanceId: roiActiveId, attackId: 'esprit-de-feu' });
    expect(allowedNextTurn.ok).toBe(true);
  });
});
