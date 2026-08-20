import { beforeAll, describe, expect, it } from 'vitest';
import { applyValeurLock, dealDamage, getCurrentHP, heal, isKO, type CharacterInstance } from '../src/index.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch, drive, findInstance } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

function makeChar(baseMaxHP: number): CharacterInstance {
  return {
    instanceId: 'x',
    cardId: 'fx-tank',
    ownerId: 'p1',
    baseMaxHP,
    currentMaxHP: baseMaxHP,
    damage: 0,
    statuses: [],
    attachedObjectInstanceIds: [],
    abilityUsesThisTurn: {},
    abilityUsesThisGame: {},
  };
}

describe('HP model (section 5) -- pure math', () => {
  it('ordinary damage is healable', () => {
    const char = makeChar(300);
    dealDamage(char, 50);
    expect(getCurrentHP(char)).toBe(250);
    heal(char, 20);
    expect(getCurrentHP(char)).toBe(270);
  });

  it('valeur lock permanently lowers the ceiling and healing cannot touch it', () => {
    const char = makeChar(300);
    dealDamage(char, 50);
    applyValeurLock(char, 40);
    expect(char.currentMaxHP).toBe(260);
    expect(getCurrentHP(char)).toBe(210);

    heal(char, 1000);
    expect(char.currentMaxHP).toBe(260); // never restored
    expect(getCurrentHP(char)).toBe(260); // damage fully healed, but ceiling stays lowered
  });

  it('valeur lock KOs a character once currentMaxHP drops to 0 or below', () => {
    const char = makeChar(100);
    applyValeurLock(char, 500);
    expect(isKO(char)).toBe(true);
  });
});

describe('HP model -- through the engine', () => {
  it('ordinary attack damage cascades to KO + graveyard once currentHP hits 0', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 3 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p2Active = findInstance(match, 'p2', 'fx-tank'); // 300 HP, needs 8 strikes at 40 dmg

    for (let i = 0; i < 20 && !match.state.players.p2.graveyardCharacterInstanceIds.includes(p2Active); i++) {
      const attackerId = match.state.activePlayerId;
      const attacker = match.state.players[attackerId];
      const attackerCardId = attacker.characters[attacker.activeCharacterInstanceId!]!.cardId;
      const attackId = attackerCardId === 'fx-striker' ? 'strike' : attackerCardId === 'fx-tank' ? 'poke' : 'jab';
      await drive(match, attackerId, {
        kind: 'attack',
        characterInstanceId: attacker.activeCharacterInstanceId!,
        attackId,
      });
    }

    expect(match.state.players.p2.graveyardCharacterInstanceIds).toContain(p2Active);
  });
});
