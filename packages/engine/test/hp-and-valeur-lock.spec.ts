import { beforeAll, describe, expect, it } from 'vitest';
import {
  absorbWithShield,
  addShield,
  applyValeurLock,
  dealDamage,
  getCurrentHP,
  heal,
  isKO,
  removeShield,
  type CharacterInstance,
} from '../src/index.js';
import { registerTestFixtures, FX_ROSTER, TINY_ROSTER } from './fixtures.js';
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
    shield: 0,
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

describe('Shield -- pure math', () => {
  it('stacks additively and absorbs up to its full amount', () => {
    const char = makeChar(100);
    addShield(char, 30);
    addShield(char, 20);
    expect(char.shield).toBe(50);

    const absorbed = absorbWithShield(char, 35);
    expect(absorbed).toBe(35);
    expect(char.shield).toBe(15);
  });

  it('only absorbs up to what remains, leaving the rest to spill onto HP', () => {
    const char = makeChar(100);
    addShield(char, 20);

    const absorbed = absorbWithShield(char, 50);
    expect(absorbed).toBe(20);
    expect(char.shield).toBe(0);

    dealDamage(char, 50 - absorbed);
    expect(getCurrentHP(char)).toBe(70);
  });

  it('removeShield with an amount only strips that much; without one it clears it entirely', () => {
    const char = makeChar(100);
    addShield(char, 40);
    removeShield(char, 15);
    expect(char.shield).toBe(25);

    removeShield(char);
    expect(char.shield).toBe(0);
  });

  it('never goes negative and does not affect HP directly', () => {
    const char = makeChar(100);
    removeShield(char, 999);
    expect(char.shield).toBe(0);
    expect(getCurrentHP(char)).toBe(100);
  });
});

describe('Shield -- through the engine', () => {
  it('absorbs incoming attack damage before HP, with the excess spilling over in the same hit', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 7 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p2ActiveId = findInstance(match, 'p2', 'fx-tank');
    match.state.players.p2.characters[p2ActiveId]!.shield = 25; // fx-striker's "strike" deals 40

    await drive(match, match.state.activePlayerId, {
      kind: 'attack',
      characterInstanceId: match.state.players.p1.activeCharacterInstanceId!,
      attackId: 'strike',
    });

    const p2Active = match.state.players.p2.characters[p2ActiveId]!;
    expect(p2Active.shield).toBe(0);
    expect(getCurrentHP(p2Active)).toBe(300 - (40 - 25)); // shield ate 25, the remaining 15 hit HP
  });

  it('persists while the character sits on the bench', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 11 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const benchedId = match.state.players.p2.benchCharacterInstanceIds[0]!;
    match.state.players.p2.characters[benchedId]!.shield = 10;

    await drive(match, match.state.activePlayerId, { kind: 'pass' });
    await drive(match, match.state.activePlayerId, { kind: 'pass' });

    expect(match.state.players.p2.characters[benchedId]!.shield).toBe(10);
  });

  it("a terrain that nullifies enemy shield absorption stops it from blocking any damage", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 9 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    if (match.state.activePlayerId !== 'p1') await drive(match, 'p2', { kind: 'pass' });

    const p2ActiveId = match.state.players.p2.activeCharacterInstanceId!;
    match.state.players.p2.characters[p2ActiveId]!.shield = 25;

    const terrainInstanceId = Object.values(match.state.players.p1.terrains).find(
      (t) => t.cardId === 'fx-shield-nullifier-terrain'
    )!.instanceId;
    await drive(match, 'p1', { kind: 'play-terrain', terrainInstanceId });

    await drive(match, 'p1', {
      kind: 'attack',
      characterInstanceId: match.state.players.p1.activeCharacterInstanceId!,
      attackId: 'strike',
    });

    const p2Active = match.state.players.p2.characters[p2ActiveId]!;
    expect(p2Active.shield).toBe(25); // value untouched -- it just stops absorbing
    expect(getCurrentHP(p2Active)).toBe(300 - 40); // full damage goes through, unblocked
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

describe('Heal amount modifiers -- through the engine', () => {
  it('a terrain that doubles healing only boosts heals landing on its own owner\'s characters', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 5 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p1 = match.state.players.p1;
    const p2 = match.state.players.p2;
    const p1TerrainInstanceId = Object.values(p1.terrains).find((t) => t.cardId === 'fx-heal-aura-terrain')!.instanceId;
    const p1ObjectInstanceId = Object.values(p1.objects).find((o) => o.cardId === 'fx-heal-object')!.instanceId;
    const p2ObjectInstanceId = Object.values(p2.objects).find((o) => o.cardId === 'fx-heal-object')!.instanceId;

    // p1 plays the doubling terrain, damages its own active down first so the heal has room to apply.
    const p1ActiveId = p1.activeCharacterInstanceId!;
    p1.characters[p1ActiveId]!.damage = 50;
    await drive(match, 'p1', { kind: 'play-terrain', terrainInstanceId: p1TerrainInstanceId });

    // p2 also takes damage so its own (unboosted) heal has room to apply.
    const p2ActiveId = p2.activeCharacterInstanceId!;
    p2.characters[p2ActiveId]!.damage = 50;

    await drive(match, 'p1', { kind: 'play-object', objectInstanceId: p1ObjectInstanceId });
    expect(p1.characters[p1ActiveId]!.damage).toBe(50 - 15 * 2); // doubled by p1's own Fixture Heal Aura Terrain

    await drive(match, 'p1', { kind: 'pass' }); // playing a single object doesn't end the turn on its own
    await drive(match, 'p2', { kind: 'play-object', objectInstanceId: p2ObjectInstanceId });
    expect(p2.characters[p2ActiveId]!.damage).toBe(50 - 15); // p1's terrain does not boost p2's heals
  });
});

describe('Death ward -- through the engine', () => {
  it('clamps ordinary damage so current HP never drops below 1', async () => {
    const match = await createReadyMatch({ p1Name: 'A', p2Name: 'B', p1Roster: TINY_ROSTER, p2Roster: TINY_ROSTER, seed: 13 });
    const attackerId = match.state.activePlayerId;
    const defenderId = attackerId === 'p1' ? 'p2' : 'p1';
    const defenderActiveId = match.state.players[defenderId].activeCharacterInstanceId!;
    match.state.players[defenderId].characters[defenderActiveId]!.statuses.push({
      statusId: 'death-ward',
      label: 'Death Ward',
      remainingTurns: 1,
    });

    await drive(match, attackerId, {
      kind: 'attack',
      characterInstanceId: match.state.players[attackerId].activeCharacterInstanceId!,
      attackId: 'shatter', // fx-glass: 10HP, deals 10 -- would KO without the ward
    });

    const defenderActive = match.state.players[defenderId].characters[defenderActiveId]!;
    expect(getCurrentHP(defenderActive)).toBe(1);
    expect(match.state.players[defenderId].graveyardCharacterInstanceIds).not.toContain(defenderActiveId);
  });

  it('without the status, the same hit KOs as normal', async () => {
    const match = await createReadyMatch({ p1Name: 'A', p2Name: 'B', p1Roster: TINY_ROSTER, p2Roster: TINY_ROSTER, seed: 13 });
    const attackerId = match.state.activePlayerId;
    const defenderId = attackerId === 'p1' ? 'p2' : 'p1';
    const defenderActiveId = match.state.players[defenderId].activeCharacterInstanceId!;

    await drive(match, attackerId, {
      kind: 'attack',
      characterInstanceId: match.state.players[attackerId].activeCharacterInstanceId!,
      attackId: 'shatter',
    });

    expect(match.state.players[defenderId].graveyardCharacterInstanceIds).toContain(defenderActiveId);
  });
});
