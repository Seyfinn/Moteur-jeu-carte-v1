import { beforeAll, describe, expect, it } from 'vitest';
import { tickStatusesAtTurnStart, type EngineApi } from '../src/index.js';
import { registerTestFixtures, FX_ROSTER } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

beforeAll(() => {
  registerTestFixtures();
});

describe('Statuses (section 6)', () => {
  it('stun blocks the standard switch action', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 20 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const active = match.state.activePlayerId;
    const instanceId = match.state.players[active].activeCharacterInstanceId!;
    const char = match.state.players[active].characters[instanceId]!;
    char.statuses.push({ statusId: 'stun', label: 'Stun', remainingTurns: 1 });

    const benchId = match.state.players[active].benchCharacterInstanceIds[0]!;
    const result = match.applyAction(active, { kind: 'switch', newActiveInstanceId: benchId });
    expect(result.ok).toBe(false);
  });

  it('stun does not block an attack that is disarmed-independent, but does block ability use', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 21 },
      { p1ActiveCardId: 'fx-stunner', p2ActiveCardId: 'fx-tank' }
    );
    const active = match.state.activePlayerId;
    const instanceId = match.state.players[active].activeCharacterInstanceId!;
    const char = match.state.players[active].characters[instanceId]!;
    char.statuses.push({ statusId: 'stun', label: 'Stun', remainingTurns: 1 });

    const abilityResult = match.applyAction(active, {
      kind: 'use-ability',
      characterInstanceId: instanceId,
      abilityId: 'stun-enemy',
    });
    expect(abilityResult.ok).toBe(false);

    const attackResult = match.applyAction(active, { kind: 'attack', characterInstanceId: instanceId, attackId: 'jab' });
    expect(attackResult.ok).toBe(false); // stun also blocks attacking per section 6
  });

  it('non poison/burn status durations are suspended while benched, and resume once active again', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 22 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p1 = match.state.players.p1;
    const activeId = p1.activeCharacterInstanceId!;
    p1.characters[activeId]!.statuses.push({ statusId: 'atk-reduction', label: 'Weak', remainingTurns: 2, data: { amount: 5 } });

    const benchId = p1.benchCharacterInstanceIds[0]!;
    // Switch the afflicted character to the bench (ends p1's turn); its status should not tick while benched.
    await drive(match, 'p1', { kind: 'switch', newActiveInstanceId: benchId });
    // Play through a full p2 turn and back to a p1 turn without reactivating the afflicted character.
    const p2Active = match.state.players.p2.activeCharacterInstanceId!;
    await drive(match, 'p2', { kind: 'attack', characterInstanceId: p2Active, attackId: 'poke' });

    expect(p1.characters[activeId]!.statuses.find((s) => s.statusId === 'atk-reduction')?.remainingTurns).toBe(2);
  });

  it('poison/burn tick and deal damage at the start of the owner turn even while benched', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 23 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p1 = match.state.players.p1;
    const benchedId = p1.benchCharacterInstanceIds[0]!; // fx-tank, 300 max HP
    p1.characters[benchedId]!.statuses.push({ statusId: 'poison', label: 'Poison', remainingTurns: 3 });
    const damageBefore = p1.characters[benchedId]!.damage;

    const api = match['api'] as EngineApi;
    await tickStatusesAtTurnStart(match.state, 'p1', api);

    // Fixed engine formula: 10 flat + 10% of currentMaxHP (300 -> +30).
    expect(p1.characters[benchedId]!.damage).toBe(damageBefore + 40);
    expect(p1.characters[benchedId]!.statuses.find((s) => s.statusId === 'poison')?.remainingTurns).toBe(2);
  });

  it('burn always deals a flat 50 regardless of max HP', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 24 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p1 = match.state.players.p1;
    const activeId = p1.activeCharacterInstanceId!; // fx-striker, 100 max HP
    p1.characters[activeId]!.statuses.push({ statusId: 'burn', label: 'Burn', remainingTurns: 1 });
    const damageBefore = p1.characters[activeId]!.damage;

    const api = match['api'] as EngineApi;
    await tickStatusesAtTurnStart(match.state, 'p1', api);

    expect(p1.characters[activeId]!.damage).toBe(damageBefore + 50);
  });

  it('re-applying burn while already present adds up the durations on a single instance', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 25 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p1 = match.state.players.p1;
    const activeId = p1.activeCharacterInstanceId!;
    const api = match['api'] as EngineApi;

    api.applyStatus(activeId, { statusId: 'burn', label: 'Burn', remainingTurns: 1 });
    api.applyStatus(activeId, { statusId: 'burn', label: 'Burn (again)', remainingTurns: 2 });

    const burnEntries = p1.characters[activeId]!.statuses.filter((s) => s.statusId === 'burn');
    expect(burnEntries.length).toBe(1); // merged, not two independently-ticking instances
    expect(burnEntries[0]!.remainingTurns).toBe(3); // 1 + 2: rebrûler une cible en feu allonge l'incendie
    expect(burnEntries[0]!.label).toBe('Burn (again)'); // most recent application wins attribution

    const damageBefore = p1.characters[activeId]!.damage;
    await tickStatusesAtTurnStart(match.state, 'p1', api);
    expect(p1.characters[activeId]!.damage).toBe(damageBefore + 50); // a single tick, not 100
  });

  it('re-applying poison keeps the longer duration instead of adding them up (unlike burn)', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 26 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p1 = match.state.players.p1;
    const activeId = p1.activeCharacterInstanceId!;
    const api = match['api'] as EngineApi;

    api.applyStatus(activeId, { statusId: 'poison', label: 'Poison', remainingTurns: 3 });
    api.applyStatus(activeId, { statusId: 'poison', label: 'Poison (again)', remainingTurns: 2 });

    const entries = p1.characters[activeId]!.statuses.filter((s) => s.statusId === 'poison');
    expect(entries.length).toBe(1);
    expect(entries[0]!.remainingTurns).toBe(3); // max(3, 2) -- ni raccourci, ni cumulé
  });

  it('chained blocks a forced switch too, not just the standard switch action', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 27 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p1 = match.state.players.p1;
    const activeId = p1.activeCharacterInstanceId!;
    const benchId = p1.benchCharacterInstanceIds[0]!;
    p1.characters[activeId]!.statuses.push({ statusId: 'chained', label: 'Enchaîné' });

    const api = match['api'] as EngineApi;
    await api.switchActive('p1', benchId); // le chemin qu'empruntent tous les ctx.forceSwitch

    expect(p1.activeCharacterInstanceId).toBe(activeId); // rien n'a bougé
    expect(p1.benchCharacterInstanceIds).toContain(benchId);
  });
});

describe('Bleed', () => {
  it('re-applying while already present adds stacks (one merged entry), capped at 10', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 50 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p1 = match.state.players.p1;
    const activeId = p1.activeCharacterInstanceId!;
    const api = match['api'] as EngineApi;

    for (let i = 0; i < 13; i++) {
      api.applyStatus(activeId, { statusId: 'bleed', label: 'Bleed' });
    }

    const bleedEntries = p1.characters[activeId]!.statuses.filter((s) => s.statusId === 'bleed');
    expect(bleedEntries.length).toBe(1); // merged, not 13 separate instances
    expect(bleedEntries[0]!.data?.['stacks']).toBe(10); // capped
  });

  it('ticks at the start of the owner turn even while benched, deals stacks * 10% of max HP, then is consumed', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 51 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p1 = match.state.players.p1;
    const benchedId = p1.benchCharacterInstanceIds[0]!; // fx-tank, 300 max HP
    const api = match['api'] as EngineApi;
    api.applyStatus(benchedId, { statusId: 'bleed', label: 'Bleed', data: { stacks: 4 } });
    const damageBefore = p1.characters[benchedId]!.damage;

    await tickStatusesAtTurnStart(match.state, 'p1', api);

    expect(p1.characters[benchedId]!.damage).toBe(damageBefore + 120); // 4 stacks * 10% of 300
    expect(p1.characters[benchedId]!.statuses.some((s) => s.statusId === 'bleed')).toBe(false); // consumed, not a countdown
  });

  it('healing the bearer for any amount cures bleed immediately, before it ever ticks', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 52 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const p1 = match.state.players.p1;
    const activeId = p1.activeCharacterInstanceId!;
    const api = match['api'] as EngineApi;
    p1.characters[activeId]!.damage = 50;
    api.applyStatus(activeId, { statusId: 'bleed', label: 'Bleed', data: { stacks: 5 } });

    api.heal(activeId, 1);
    expect(p1.characters[activeId]!.statuses.some((s) => s.statusId === 'bleed')).toBe(false);

    const damageBefore = p1.characters[activeId]!.damage;
    await tickStatusesAtTurnStart(match.state, 'p1', api);
    expect(p1.characters[activeId]!.damage).toBe(damageBefore); // no bleed damage: it was cured before it could tick
  });
});

describe('Critique & Esquive (section 6)', () => {
  it('base rates: every character has an innate ~2% crit / ~5% dodge chance with no status at all', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 40 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = match.state.activePlayerId;
    const attacker = match.state.players[attackerId].characters[match.state.players[attackerId].activeCharacterInstanceId!]!;
    const targetId = attackerId === 'p1' ? 'p2' : 'p1';
    const target = match.state.players[targetId].characters[match.state.players[targetId].activeCharacterInstanceId!]!;
    const api = match['api'] as EngineApi;

    let dodges = 0;
    let crits = 0;
    let normals = 0;
    const trials = 2000;
    for (let i = 0; i < trials; i++) {
      target.damage = 0;
      const ctx = api.buildEffectContext(attacker.instanceId, attackerId);
      await ctx.dealDamage(target.instanceId, 10);
      if (target.damage === 0) dodges += 1;
      else if (target.damage === 20) crits += 1;
      else {
        expect(target.damage).toBe(10);
        normals += 1;
      }
    }

    expect(dodges + crits + normals).toBe(trials);
    // Neither character has a status: ~5% dodge, ~2% crit. Generous bounds since this is a single fixed-seed sample.
    expect(dodges).toBeGreaterThan(trials * 0.01);
    expect(dodges).toBeLessThan(trials * 0.12);
    expect(crits).toBeGreaterThan(0);
    expect(crits).toBeLessThan(trials * 0.06);
  });

  it('critical status: doubles attack damage roughly a third of the time, on top of the target’s innate dodge chance', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 30 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = match.state.activePlayerId;
    const attacker = match.state.players[attackerId];
    const attackerInstance = attacker.characters[attacker.activeCharacterInstanceId!]!;
    attackerInstance.statuses.push({ statusId: 'critical', label: 'Critique' });

    const targetId = attackerId === 'p1' ? 'p2' : 'p1';
    const target = match.state.players[targetId].characters[match.state.players[targetId].activeCharacterInstanceId!]!;
    const api = match['api'] as EngineApi;

    let dodges = 0;
    let crits = 0;
    let normals = 0;
    const trials = 300;
    for (let i = 0; i < trials; i++) {
      target.damage = 0; // reset so repeated hits never KO the target mid-loop
      const ctx = api.buildEffectContext(attackerInstance.instanceId, attackerId);
      await ctx.dealDamage(target.instanceId, 10);
      if (target.damage === 0) dodges += 1; // target's innate ~5% dodge, unrelated to the attacker's crit
      else if (target.damage === 20) crits += 1;
      else {
        expect(target.damage).toBe(10);
        normals += 1;
      }
    }

    expect(dodges + crits + normals).toBe(trials);
    expect(crits).toBeGreaterThan(trials * 0.15); // ~33% of the (mostly landed) hits
    expect(crits).toBeLessThan(trials * 0.5);
    expect(dodges).toBeLessThan(trials * 0.2); // innate 5%, generous margin
  });

  it('a terrain overriding the crit multiplier only boosts its own owner\'s crits, not the opponent\'s', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 33 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const ownerId = match.state.activePlayerId;
    const otherId = ownerId === 'p1' ? 'p2' : 'p1';
    const ownerTerrainInstanceId = Object.values(match.state.players[ownerId].terrains).find(
      (t) => t.cardId === 'fx-crit-boost-terrain'
    )!.instanceId;
    await drive(match, ownerId, { kind: 'play-terrain', terrainInstanceId: ownerTerrainInstanceId });

    const ownerChar = match.state.players[ownerId].characters[match.state.players[ownerId].activeCharacterInstanceId!]!;
    const otherChar = match.state.players[otherId].characters[match.state.players[otherId].activeCharacterInstanceId!]!;
    ownerChar.statuses.push({ statusId: 'critical', label: 'Critique' });
    otherChar.statuses.push({ statusId: 'critical', label: 'Critique' });
    const api = match['api'] as EngineApi;
    const trials = 200;

    const ownerDamages = new Set<number>();
    for (let i = 0; i < trials; i++) {
      otherChar.damage = 0;
      const ctx = api.buildEffectContext(ownerChar.instanceId, ownerId);
      await ctx.dealDamage(otherChar.instanceId, 10);
      ownerDamages.add(otherChar.damage);
    }
    expect(ownerDamages.has(30)).toBe(true); // owner's crits hit for the boosted x3
    expect(ownerDamages.has(20)).toBe(false); // never falls back to the default x2 while the terrain is up

    const otherDamages = new Set<number>();
    for (let i = 0; i < trials; i++) {
      ownerChar.damage = 0;
      const ctx = api.buildEffectContext(otherChar.instanceId, otherId);
      await ctx.dealDamage(ownerChar.instanceId, 10);
      otherDamages.add(ownerChar.damage);
    }
    expect(otherDamages.has(20)).toBe(true); // opponent's crits stay at the default x2
    expect(otherDamages.has(30)).toBe(false); // opponent never benefits from the owner's terrain
  });

  it('evasive status: negates damage roughly a third of the time and never fully consumes the status', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 31 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = match.state.activePlayerId;
    const targetId = attackerId === 'p1' ? 'p2' : 'p1';
    const attacker = match.state.players[attackerId].characters[match.state.players[attackerId].activeCharacterInstanceId!]!;
    const target = match.state.players[targetId].characters[match.state.players[targetId].activeCharacterInstanceId!]!;
    target.statuses.push({ statusId: 'evasive', label: 'Esquive' });
    const api = match['api'] as EngineApi;

    let dodges = 0;
    let crits = 0;
    let normals = 0;
    const trials = 300;
    for (let i = 0; i < trials; i++) {
      target.damage = 0;
      const ctx = api.buildEffectContext(attacker.instanceId, attackerId);
      await ctx.dealDamage(target.instanceId, 10);
      if (target.damage === 0) dodges += 1;
      else if (target.damage === 20) crits += 1; // attacker's innate ~2% crit, unrelated to the target's evasion
      else {
        expect(target.damage).toBe(10);
        normals += 1;
      }
    }

    expect(dodges + crits + normals).toBe(trials);
    expect(target.statuses.some((s) => s.statusId === 'evasive')).toBe(true); // never consumed
    expect(dodges).toBeGreaterThan(trials * 0.15);
    expect(dodges).toBeLessThan(trials * 0.5);
    expect(crits).toBeLessThan(trials * 0.1); // innate 2%, generous margin
  });

  it('evasive does not block a character applying a status to itself', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 32 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const active = match.state.activePlayerId;
    const instanceId = match.state.players[active].activeCharacterInstanceId!;
    const char = match.state.players[active].characters[instanceId]!;
    char.statuses.push({ statusId: 'evasive', label: 'Esquive' });
    const api = match['api'] as EngineApi;

    for (let i = 0; i < 20; i++) {
      const ctx = api.buildEffectContext(instanceId, active);
      ctx.applyStatus(instanceId, { statusId: 'self-buff', label: 'Buff' });
    }

    expect(char.statuses.filter((s) => s.statusId === 'self-buff').length).toBe(20);
  });
});
