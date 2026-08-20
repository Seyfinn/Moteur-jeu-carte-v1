import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_ROSTER,
  beyondNeteroVmax,
  canTargetBench,
  getEffectiveATK,
  katarina,
  registerDemoCards,
  type EngineApi,
} from '../src/index.js';
import { createReadyMatch, drive, findInstance } from './test-utils.js';

beforeAll(() => {
  registerDemoCards();
});

describe('Nakime -- "Appel de l\'infini" swaps a bench character with the opponent\'s', () => {
  it('swaps ownership of the two chosen bench characters', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: DEMO_ROSTER, p2Roster: DEMO_ROSTER, seed: 50 },
      { p1ActiveCardId: 'nakime', p2ActiveCardId: 'batman-v' }
    );
    const active = match.state.activePlayerId;
    if (match.state.players[active].characters[match.state.players[active].activeCharacterInstanceId!]!.cardId !== 'nakime') {
      // Whichever side has Nakime active drives the attack; if it's not this player's turn yet, pass through once.
      await drive(match, active, { kind: 'pass' });
    }
    const attacker = match.state.activePlayerId;
    const defender = attacker === 'p1' ? 'p2' : 'p1';
    const nakimeInstance = match.state.players[attacker].activeCharacterInstanceId!;
    expect(match.state.players[attacker].characters[nakimeInstance]!.cardId).toBe('nakime');

    const ownBenchBefore = [...match.state.players[attacker].benchCharacterInstanceIds];
    const enemyBenchBefore = [...match.state.players[defender].benchCharacterInstanceIds];

    await drive(match, attacker, {
      kind: 'attack',
      characterInstanceId: nakimeInstance,
      attackId: 'appel-de-infini',
    });

    const ownPick = ownBenchBefore.find((id) => !match.state.players[attacker].benchCharacterInstanceIds.includes(id));
    const enemyPick = enemyBenchBefore.find((id) => !match.state.players[defender].benchCharacterInstanceIds.includes(id));
    expect(ownPick).toBeDefined();
    expect(enemyPick).toBeDefined();
    expect(match.state.players[attacker].benchCharacterInstanceIds).toContain(enemyPick);
    expect(match.state.players[defender].benchCharacterInstanceIds).toContain(ownPick);
    expect(match.state.players[attacker].characters[enemyPick!]!.ownerId).toBe(attacker);
  });
});

describe('Kashimo V -- "evasive" fully negates the next hit and is single-use', () => {
  it('a dodged attack deals 0 damage and consumes the status', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: DEMO_ROSTER, p2Roster: DEMO_ROSTER, seed: 51 },
      { p1ActiveCardId: 'kashimo-v', p2ActiveCardId: 'batman-v' }
    );
    const kashimoOwner: 'p1' = 'p1';
    const kashimoInstance = findInstance(match, kashimoOwner, 'kashimo-v');
    match.state.players[kashimoOwner].characters[kashimoInstance]!.statuses.push({
      statusId: 'evasive',
      label: 'test-forced-evasive',
    });

    const api = match['api'] as EngineApi;
    const damageBefore = match.state.players[kashimoOwner].characters[kashimoInstance]!.damage;
    await api.dealDamage(kashimoInstance, 999);

    expect(match.state.players[kashimoOwner].characters[kashimoInstance]!.damage).toBe(damageBefore);
    expect(match.state.players[kashimoOwner].characters[kashimoInstance]!.statuses.some((s) => s.statusId === 'evasive')).toBe(
      false
    );
  });
});

describe('Beyond Netero VMAX -- "nen" reads the graveyard and buffs the whole board once per game', () => {
  it('raises max HP for all board characters when a "nen" card is in the graveyard', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: DEMO_ROSTER, p2Roster: DEMO_ROSTER, seed: 52 },
      { p1ActiveCardId: 'beyond-netero-vmax', p2ActiveCardId: 'batman-v' }
    );
    const neteroInstance = findInstance(match, 'p1', 'beyond-netero-vmax');
    // Simulate "a copy of this card is in the graveyard" without corrupting the live board.
    match.state.players.p1.graveyardCharacterInstanceIds.push(neteroInstance);

    const api = match['api'] as EngineApi;
    const ctx = api.buildEffectContext(neteroInstance, 'p1');
    const ability = beyondNeteroVmax.abilities.find((a) => a.id === 'nen')!;
    expect(ability.condition!(ctx)).toBe(true);

    const before = ctx.getCharacter(neteroInstance).currentMaxHP;
    await ability.execute(ctx);
    expect(ctx.getCharacter(neteroInstance).currentMaxHP).toBe(before + 50);
  });
});

describe('Batman V -- "absolute" clones a bench character and punishes the opponent on KO', () => {
  it('clones the chosen bench character as the new active (1 HP) and deals 80 to the enemy active', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: DEMO_ROSTER, p2Roster: DEMO_ROSTER, seed: 53 },
      { p1ActiveCardId: 'batman-v', p2ActiveCardId: 'nakime' }
    );
    const batmanInstance = match.state.players.p1.activeCharacterInstanceId!;
    const benchBefore = [...match.state.players.p1.benchCharacterInstanceIds];
    const enemyActive = match.state.players.p2.activeCharacterInstanceId!;
    const enemyDamageBefore = match.state.players.p2.characters[enemyActive]!.damage;

    const api = match['api'] as EngineApi;
    const koPromise = api.koCharacter(batmanInstance);

    const pending = match.state.pendingChoice;
    if (!pending || pending.spec.kind !== 'select-characters') {
      throw new Error('Expected a select-characters choice from Batman\'s "absolute" ability');
    }
    const pick = pending.spec.options[0]!;
    match.answerChoice(pending.playerId, pending.id, { kind: 'select-characters', selected: [pick] });
    await koPromise;

    expect(match.state.players.p1.graveyardCharacterInstanceIds).toContain(batmanInstance);
    const newActive = match.state.players.p1.activeCharacterInstanceId!;
    expect(newActive).not.toBe(batmanInstance);
    expect(match.state.players.p1.characters[newActive]!.currentMaxHP).toBe(1);
    expect(benchBefore).toContain(pick);
    expect(match.state.players.p2.characters[enemyActive]!.damage).toBe(enemyDamageBefore + 80);
  });
});

describe('Allié indomptable -- valeur-locks the whole board and attaches an ATK bonus', () => {
  it('removes 10 max HP per ally and grants the chosen ally the total as a persistent ATK bonus', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: DEMO_ROSTER, p2Roster: DEMO_ROSTER, seed: 56 },
      { p1ActiveCardId: 'gilgamesh-v', p2ActiveCardId: 'nakime' }
    );
    if (match.state.activePlayerId !== 'p1') {
      await drive(match, 'p2', { kind: 'pass' });
    }
    const p1 = match.state.players.p1;
    const active = p1.activeCharacterInstanceId!;
    const allyCount = 1 + p1.benchCharacterInstanceIds.length;
    const maxHPBefore = p1.characters[active]!.currentMaxHP;

    const objectId = p1.unplayedObjectInstanceIds[0]!;
    await drive(match, 'p1', { kind: 'play-object', objectInstanceId: objectId }, (choice) => {
      if (choice.spec.kind === 'select-characters') {
        // Always pick the active character as the ATK-bonus recipient.
        return { kind: 'select-characters', selected: [active] };
      }
      return { kind: 'yes-no', value: true };
    });

    expect(p1.characters[active]!.currentMaxHP).toBe(maxHPBefore - 10);
    const totalBonus = allyCount * 10;
    expect(getEffectiveATK(match.state, active, 0)).toBe(totalBonus);
  });
});

describe('Gogeta Blue V + Terrain Domaine Quincy -- frequency override and bench protection', () => {
  it("doubles the terrain heal on Gogeta's own turn start while Gogeta is active", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: DEMO_ROSTER, p2Roster: DEMO_ROSTER, seed: 54 },
      { p1ActiveCardId: 'gogeta-blue-v', p2ActiveCardId: 'kashimo-v' }
    );
    if (match.state.activePlayerId !== 'p1') {
      await drive(match, 'p2', { kind: 'pass' });
    }
    const p1 = match.state.players.p1;
    const gogeta = p1.activeCharacterInstanceId!;

    const api = match['api'] as EngineApi;
    await api.dealDamage(gogeta, 100); // give the heal something to restore
    const hpAfterDamage = p1.characters[gogeta]!.currentMaxHP - p1.characters[gogeta]!.damage;

    const terrainId = p1.unplayedTerrainInstanceIds[0]!;
    await drive(match, 'p1', { kind: 'play-terrain', terrainInstanceId: terrainId });
    await drive(match, 'p1', { kind: 'pass' }); // end p1's turn
    await drive(match, 'p2', { kind: 'pass' }); // end p2's turn -> triggers p1's next onTurnStart

    const hpNow = p1.characters[gogeta]!.currentMaxHP - p1.characters[gogeta]!.damage;
    expect(hpNow - hpAfterDamage).toBe(20); // 2x the terrain's +10 heal
  });

  it('protects the bench from targeting while active with no terrain, but not once a terrain is in play', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: DEMO_ROSTER, p2Roster: DEMO_ROSTER, seed: 55 },
      { p1ActiveCardId: 'gogeta-blue-v', p2ActiveCardId: 'nakime' }
    );
    const benchTarget = match.state.players.p1.benchCharacterInstanceIds[0]!;

    const protectedResult = canTargetBench(match.state, 'some-external-source', benchTarget, true);
    expect(protectedResult.allow).toBe(false);

    if (match.state.activePlayerId !== 'p1') {
      await drive(match, 'p2', { kind: 'pass' });
    }
    const terrainId = match.state.players.p1.unplayedTerrainInstanceIds[0]!;
    await drive(match, 'p1', { kind: 'play-terrain', terrainInstanceId: terrainId });

    const unprotectedResult = canTargetBench(match.state, 'some-external-source', benchTarget, true);
    expect(unprotectedResult.allow).toBe(true);
  });
});

describe('Katarina -- "Verocity" attacks again on a kill, "Death lotus" gates on 3 tracked kills', () => {
  it("Shunpo doesn't end the turn when it KOs the target, and records the kill", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: DEMO_ROSTER, p2Roster: DEMO_ROSTER, seed: 60 },
      { p1ActiveCardId: 'katarina', p2ActiveCardId: 'batman-v' }
    );
    if (match.state.activePlayerId !== 'p1') {
      await drive(match, 'p2', { kind: 'pass' });
    }
    const katarinaInstance = match.state.players.p1.activeCharacterInstanceId!;
    const enemyInstance = match.state.players.p2.activeCharacterInstanceId!;
    match.state.players.p2.characters[enemyInstance]!.damage =
      match.state.players.p2.characters[enemyInstance]!.currentMaxHP - 1; // one hit from KO

    await drive(match, 'p1', { kind: 'attack', characterInstanceId: katarinaInstance, attackId: 'shunpo' });

    expect(match.state.players.p2.graveyardCharacterInstanceIds).toContain(enemyInstance);
    expect(match.state.activePlayerId).toBe('p1'); // turn kept going
    const kills = match.state.players.p1.characters[katarinaInstance]!.statuses.find((s) => s.statusId === 'katarina-kills');
    expect(kills?.data?.['count']).toBe(1);
  });

  it('Death lotus is only usable at 3 tracked kills and hits every enemy on board for 100', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: DEMO_ROSTER, p2Roster: DEMO_ROSTER, seed: 61 },
      { p1ActiveCardId: 'katarina', p2ActiveCardId: 'batman-v' }
    );
    const katarinaInstance = findInstance(match, 'p1', 'katarina');
    const api = match['api'] as EngineApi;
    const ctx = api.buildEffectContext(katarinaInstance, 'p1');
    const ability = katarina.abilities.find((a) => a.id === 'death-lotus')!;

    expect(ability.condition!(ctx)).toBe(false);
    match.state.players.p1.characters[katarinaInstance]!.statuses.push({
      statusId: 'katarina-kills',
      label: 'test-forced-kills',
      data: { count: 3 },
    });
    expect(ability.condition!(ctx)).toBe(true);

    const enemyBoard = ctx.getAllOnBoard('p2');
    const damageBefore = new Map(enemyBoard.map((c) => [c.instanceId, c.damage]));
    await ability.execute(ctx);
    for (const enemy of enemyBoard) {
      expect(ctx.getCharacter(enemy.instanceId).damage).toBe(damageBefore.get(enemy.instanceId)! + 100);
    }
  });
});
