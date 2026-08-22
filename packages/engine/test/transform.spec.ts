import { beforeAll, describe, expect, it } from 'vitest';
import { getCurrentHP } from '../src/index.js';
import { registerTestFixtures, FX_ROSTER, TINY_ROSTER, TRANSFORMER_ROSTER } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

describe('Card-identity transform ("Métamorphe" mechanism) -- through the engine', () => {
  it('copies the enemy active card, raises the HP ceiling, and grants its attacks', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: TRANSFORMER_ROSTER, p2Roster: FX_ROSTER, seed: 50 },
      { p2ActiveCardId: 'fx-tank' }
    );
    if (match.state.activePlayerId !== 'p1') await drive(match, 'p2', { kind: 'pass' });
    const selfId = match.state.players.p1.activeCharacterInstanceId!;
    const self = match.state.players.p1.characters[selfId]!;
    self.damage = 20; // pre-existing damage must survive the transform

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: selfId, abilityId: 'transform' });

    expect(self.cardId).toBe('fx-tank');
    expect(self.currentMaxHP).toBe(300); // fx-tank's baseMaxHP
    expect(self.damage).toBe(20); // untouched by the ceiling change
    expect(getCurrentHP(self)).toBe(280);

    // The new kit is live immediately: "poke" (fx-tank's attack) now resolves for this instance.
    await drive(match, 'p1', { kind: 'attack', characterInstanceId: selfId, attackId: 'poke' });
    const enemyActiveId = match.state.players.p2.activeCharacterInstanceId!;
    expect(match.state.players.p2.characters[enemyActiveId]!.damage).toBe(10);
  });

  it('transforming into a lower-HP card can instantly KO through the same path as Valeur Lock', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: TRANSFORMER_ROSTER, p2Roster: TINY_ROSTER, seed: 51 },
      { p2ActiveCardId: 'fx-glass' }
    );
    if (match.state.activePlayerId !== 'p1') await drive(match, 'p2', { kind: 'pass' });
    const selfId = match.state.players.p1.activeCharacterInstanceId!;
    const self = match.state.players.p1.characters[selfId]!;
    self.damage = 55; // 5 HP left out of 60

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: selfId, abilityId: 'transform' });

    expect(self.cardId).toBe('fx-glass'); // baseMaxHP 10 < 55 already-taken damage
    expect(match.state.players.p1.graveyardCharacterInstanceIds).toContain(selfId);
  });

  it('statuses already on the character survive the transform', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: TRANSFORMER_ROSTER, p2Roster: FX_ROSTER, seed: 52 },
      { p2ActiveCardId: 'fx-tank' }
    );
    if (match.state.activePlayerId !== 'p1') await drive(match, 'p2', { kind: 'pass' });
    const selfId = match.state.players.p1.activeCharacterInstanceId!;
    const self = match.state.players.p1.characters[selfId]!;
    self.statuses.push({ statusId: 'atk-reduction', label: 'Faiblesse', data: { amount: 15 } });

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: selfId, abilityId: 'transform' });

    expect(self.statuses.some((s) => s.statusId === 'atk-reduction')).toBe(true);
  });
});
