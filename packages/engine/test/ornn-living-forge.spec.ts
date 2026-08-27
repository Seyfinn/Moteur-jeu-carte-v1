import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type PlayerId, type RosterConfig } from '../src/index.js';
import { ornn } from '../src/cards/demo/ornn.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

let ornnRegistered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!ornnRegistered) {
    ornnRegistered = true;
    registerCard(ornn);
  }
});

const ORNN_ROSTER: RosterConfig = { characterCardIds: [ornn.id], objectCardIds: [], terrainCardIds: [] };

describe('Ornn "Living Forge" -- gated by Matériaux, then a delayed 3-turn survival payoff', () => {
  it('Living Forge is unusable before "Récupération de matériaux" has ever landed', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ORNN_ROSTER, p2Roster: FX_ROSTER, seed: 95 },
      { p2ActiveCardId: 'fx-tank' }
    );
    const ornnSide: PlayerId = 'p1';
    if (match.state.activePlayerId !== ornnSide) await drive(match, 'p2', { kind: 'pass' });
    const ornnId = match.state.players[ornnSide].activeCharacterInstanceId!;

    const tooEarly = match.applyAction(ornnSide, { kind: 'use-ability', characterInstanceId: ornnId, abilityId: 'living-forge' });
    expect(tooEarly.ok).toBe(false);

    await drive(match, ornnSide, {
      kind: 'attack',
      characterInstanceId: ornnId,
      attackId: 'recuperation-de-materiaux',
    }); // attacks end the turn by default
    await drive(match, 'p2', { kind: 'pass' }); // back to Ornn's turn

    const nowAllowed = match.applyAction(ornnSide, { kind: 'use-ability', characterInstanceId: ornnId, abilityId: 'living-forge' });
    expect(nowAllowed.ok).toBe(true);
  });

  it('locks Ornn for exactly 3 of his own turns (no attack, no standard switch), then recovers a card from a graveyard on survival', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ORNN_ROSTER, p2Roster: FX_ROSTER, seed: 96 },
      { p2ActiveCardId: 'fx-tank' }
    );
    const ornnSide: PlayerId = 'p1';
    const enemySide: PlayerId = 'p2';
    if (match.state.activePlayerId !== ornnSide) await drive(match, enemySide, { kind: 'pass' });
    const ornnId = match.state.players[ornnSide].activeCharacterInstanceId!;

    // Plant a discarded object in Ornn's own graveyard for him to later recover (Living
    // Forge no longer reaches into the enemy's graveyards).
    const stashedId = 'fixture-stashed-object';
    match.state.players[ornnSide].objects[stashedId] = { instanceId: stashedId, cardId: 'fx-heal-object', ownerId: ornnSide };
    match.state.players[ornnSide].graveyardObjectInstanceIds.push(stashedId);

    await drive(match, ornnSide, { kind: 'attack', characterInstanceId: ornnId, attackId: 'recuperation-de-materiaux' }); // ends his turn
    await drive(match, enemySide, { kind: 'pass' }); // back to Ornn's turn
    await drive(match, ornnSide, { kind: 'use-ability', characterInstanceId: ornnId, abilityId: 'living-forge' }); // doesn't end his turn
    await drive(match, ornnSide, { kind: 'pass' }); // now hand it over

    // Locked during his own next 3 turns: attack and standard switch both refused.
    for (let i = 0; i < 3; i++) {
      await drive(match, enemySide, { kind: 'pass' });
      const attackAttempt = match.applyAction(ornnSide, {
        kind: 'attack',
        characterInstanceId: ornnId,
        attackId: 'recuperation-de-materiaux',
      });
      expect(attackAttempt.ok).toBe(false);
      await drive(match, ornnSide, { kind: 'pass' });
    }

    // 4th of his own turns: the lock has expired and the survival reward fires,
    // auto-picking the only candidate (the stashed object in his own graveyard) via
    // defaultAnswer.
    await drive(match, enemySide, { kind: 'pass' });

    expect(match.state.players[ornnSide].objects[stashedId]).toBeDefined();
    expect(match.state.players[ornnSide].objects[stashedId]!.ownerId).toBe(ornnSide);
    expect(match.state.players[ornnSide].unplayedObjectInstanceIds).toContain(stashedId);
    expect(match.state.players[ornnSide].graveyardObjectInstanceIds).not.toContain(stashedId);

    const attackAllowedAgain = match.applyAction(ornnSide, {
      kind: 'attack',
      characterInstanceId: ornnId,
      attackId: 'recuperation-de-materiaux',
    });
    expect(attackAllowedAgain.ok).toBe(true);
  });
});
