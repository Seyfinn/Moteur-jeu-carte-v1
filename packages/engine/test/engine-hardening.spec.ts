import { describe, expect, it } from 'vitest';
import type { EngineApi } from '../src/engine-api.js';
import {
  DECOY_ROSTER,
  ECHO_ROSTER,
  FX_ROSTER,
  TICKER_ROSTER,
  TINY_ROSTER,
  UNTOUCHABLE_ROSTER,
  registerTestFixtures,
} from './fixtures.js';
import { createReadyMatch, defaultAnswer, drive, findInstance, settle } from './test-utils.js';
import type { Match } from '../src/index.js';

registerTestFixtures();

const OBJECT_ROSTER = {
  characterCardIds: ['fx-striker', 'fx-tank'],
  objectCardIds: ['fx-heal-object', 'fx-heal-object', 'fx-heal-object', 'fx-heal-object'],
  terrainCardIds: [],
};

function apiOf(match: Match): EngineApi {
  return (match as unknown as { api: EngineApi }).api;
}

describe('turn economy limits', () => {
  it('caps objects at two per turn, so the second player cannot dump their whole pool on turn one', async () => {
    const match = await createReadyMatch({
      p1Name: 'A',
      p2Name: 'B',
      p1Roster: OBJECT_ROSTER,
      p2Roster: OBJECT_ROSTER,
      seed: 7,
    });
    const second = match.state.startingPlayerId === 'p1' ? 'p2' : 'p1';
    await drive(match, match.state.startingPlayerId, { kind: 'pass' });
    expect(match.state.activePlayerId).toBe(second);

    // The second player's first-turn exception makes the second object a free action.
    for (let i = 0; i < 2; i++) {
      const id = match.state.players[second].unplayedObjectInstanceIds[0]!;
      await drive(match, second, { kind: 'play-object', objectInstanceId: id });
    }
    expect(match.state.activePlayerId).toBe(second);
    expect(match.state.players[second].objectsPlayedThisTurn).toBe(2);

    // But a third one is refused outright rather than silently extending the exception.
    const third = match.state.players[second].unplayedObjectInstanceIds[0]!;
    const result = match.applyAction(second, { kind: 'play-object', objectInstanceId: third });
    expect(result.ok).toBe(false);
    expect(match.state.players[second].objectsPlayedThisTurn).toBe(2);
  });

  it('ends the turn on the second object for anyone but the second player on their first turn', async () => {
    const match = await createReadyMatch({
      p1Name: 'A',
      p2Name: 'B',
      p1Roster: OBJECT_ROSTER,
      p2Roster: OBJECT_ROSTER,
      seed: 11,
    });
    const starter = match.state.startingPlayerId;
    for (let i = 0; i < 2; i++) {
      const id = match.state.players[starter].unplayedObjectInstanceIds[0]!;
      await drive(match, starter, { kind: 'play-object', objectInstanceId: id });
    }
    expect(match.state.activePlayerId).not.toBe(starter);
  });

  it('allows only one terrain per turn, so on-play terrain effects cannot be chain-fired', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 5 },
      {}
    );
    const player = match.state.activePlayerId;
    const first = match.state.players[player].unplayedTerrainInstanceIds[0]!;
    await drive(match, player, { kind: 'play-terrain', terrainInstanceId: first });

    const second = match.state.players[player].unplayedTerrainInstanceIds[0]!;
    const result = match.applyAction(player, { kind: 'play-terrain', terrainInstanceId: second });
    expect(result.ok).toBe(false);
    expect(match.state.players[player].activeTerrainInstanceId).toBe(first);
  });

  it('emits onTerrainRemoved when a new terrain replaces the active one', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 5 },
      {}
    );
    const player = match.state.activePlayerId;
    const first = match.state.players[player].unplayedTerrainInstanceIds[0]!;
    await drive(match, player, { kind: 'play-terrain', terrainInstanceId: first });

    const events: string[] = [];
    const api = apiOf(match);
    const originalEmit = api.emitEvent.bind(api);
    api.emitEvent = async (event) => {
      events.push(event.name);
      await originalEmit(event);
    };

    // Play the second terrain directly (a fresh turn would be needed through the action
    // path); what matters is that the swap itself announces the removal.
    const second = match.state.players[player].unplayedTerrainInstanceIds[0]!;
    const { moveTerrainFromPoolToActive } = await import('../src/zones.js');
    await moveTerrainFromPoolToActive(match.state, player, second, api);

    expect(events).toContain('onTerrainRemoved');
    expect(match.state.players[player].graveyardTerrainInstanceIds).toContain(first);
    expect(match.state.players[player].activeTerrainInstanceId).toBe(second);
  });
});

describe('damage pipeline guards', () => {
  it('floors currentMaxHP at zero instead of letting valeur lock go negative', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: TINY_ROSTER, p2Roster: TINY_ROSTER, seed: 3 },
      {}
    );
    const victim = match.state.players.p2.benchCharacterInstanceIds[0]!;
    await apiOf(match).applyValeurLock(victim, 999);
    await settle(match);
    expect(match.state.players.p2.characters[victim]!.currentMaxHP).toBe(0);
  });

  it('ignores damage aimed at a character that has already left the board', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: TINY_ROSTER, p2Roster: TINY_ROSTER, seed: 3 },
      {}
    );
    const api = apiOf(match);
    const victim = match.state.players.p2.benchCharacterInstanceIds[0]!;
    await api.dealDamage(victim, 10);
    await settle(match);
    expect(match.state.players.p2.graveyardCharacterInstanceIds).toContain(victim);

    const damageAfterKO = match.state.players.p2.characters[victim]!.damage;
    await api.dealDamage(victim, 50);
    await settle(match);
    expect(match.state.players.p2.characters[victim]!.damage).toBe(damageAfterKO);
  });

  it('never rolls esquive when an effect targets one of its own owner characters', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: UNTOUCHABLE_ROSTER, p2Roster: UNTOUCHABLE_ROSTER, seed: 9 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-striker' }
    );
    const api = apiOf(match);
    const casterId = findInstance(match, 'p1', 'fx-striker');
    const allyId = findInstance(match, 'p1', 'fx-untouchable');
    const enemyId = findInstance(match, 'p2', 'fx-untouchable');
    const ctx = api.buildEffectContext(casterId, 'p1', undefined, 'ability');

    // A 100%-evasion ALLY must still receive its own side's status.
    ctx.applyStatus(allyId, { statusId: 'atk-boost', label: 'Buff allié', data: { amount: 10 } });
    expect(match.state.players.p1.characters[allyId]!.statuses.some((s) => s.statusId === 'atk-boost')).toBe(true);

    // The same rate on an ENEMY still negates a hostile hit.
    await ctx.dealDamage(enemyId, 40);
    await settle(match);
    expect(match.state.players.p2.characters[enemyId]!.damage).toBe(0);
  });

  it('stops ticking a character statuses once a tick has killed it', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: TINY_ROSTER, p2Roster: TINY_ROSTER, seed: 21 },
      {}
    );
    const victimId = match.state.players.p2.activeCharacterInstanceId!;
    const victim = match.state.players.p2.characters[victimId]!;
    // fx-glass has 10 HP; a single burn tick (50) is lethal, and the poison behind it
    // must not keep hitting the corpse.
    victim.statuses.push({ statusId: 'burn', label: 'Burn', remainingTurns: 3 });
    victim.statuses.push({ statusId: 'poison', label: 'Poison', remainingTurns: 3 });

    // Statuses tick at the *start* of their bearer's turn, so always pass at least once
    // to reach a fresh turn start for p2 (they may already be the active player).
    do {
      await drive(match, match.state.activePlayerId, { kind: 'pass' });
    } while (match.state.activePlayerId !== 'p2');
    await settle(match);

    expect(match.state.players.p2.graveyardCharacterInstanceIds).toContain(victimId);
    // Burn alone: 50. Poison would have added 10 + 10% of max HP on top.
    expect(victim.damage).toBe(50);
  });
});

describe('generic card mechanics moved out of the engine', () => {
  it('redirects damage onto a chosen benched ally when a card declares getDamageRedirectPercent', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: TINY_ROSTER, p2Roster: DECOY_ROSTER, seed: 41 },
      { p2ActiveCardId: 'fx-decoy' }
    );
    const decoyId = findInstance(match, 'p2', 'fx-decoy');
    const shieldId = findInstance(match, 'p2', 'fx-tank');
    const attackerId = findInstance(match, 'p1', 'fx-glass');
    const ctx = apiOf(match).buildEffectContext(attackerId, 'p1', undefined, 'attack');

    // Driven outside applyAction, so the choice has to be answered while the damage call
    // is still suspended -- don't await it before settling.
    const resolving = ctx.dealDamage(decoyId, 30, { skipEvasionRoll: true });
    await settle(match, (choice) =>
      choice.spec.kind === 'select-characters'
        ? { kind: 'select-characters', selected: [shieldId] }
        : defaultAnswer(choice)
    );
    await resolving;

    expect(match.state.players.p2.characters[decoyId]!.damage).toBe(0);
    expect(match.state.players.p2.characters[shieldId]!.damage).toBe(30);
  });

  it('pays the hit-bounty to the attacker on the first attack that lands, then consumes it', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 43 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const attackerId = findInstance(match, 'p1', 'fx-striker');
    const targetId = findInstance(match, 'p2', 'fx-tank');
    const api = apiOf(match);
    api.applyStatus(targetId, {
      statusId: 'hit-bounty',
      label: 'Prime',
      data: { bonusMaxHP: 150, forOwnerId: 'p1' },
    });

    const before = match.state.players.p1.characters[attackerId]!.currentMaxHP;
    const ctx = api.buildEffectContext(attackerId, 'p1', undefined, 'attack');
    await ctx.dealDamage(targetId, 20, { skipEvasionRoll: true });
    await settle(match);

    expect(match.state.players.p1.characters[attackerId]!.currentMaxHP).toBe(before + 150);
    expect(match.state.players.p2.characters[targetId]!.statuses.some((s) => s.statusId === 'hit-bounty')).toBe(false);

    // Consumed: a second hit pays nothing more.
    const after = match.state.players.p1.characters[attackerId]!.currentMaxHP;
    await ctx.dealDamage(targetId, 20, { skipEvasionRoll: true });
    await settle(match);
    expect(match.state.players.p1.characters[attackerId]!.currentMaxHP).toBe(after);
  });
});

describe('bench immunity scoping (Bouclier Ultime)', () => {
  const ROSTER = {
    characterCardIds: ['soraka', 'gojo-satoru', 'guts'],
    objectCardIds: [],
    terrainCardIds: ['bouclier-ultime'],
  };

  it('blocks enemy damage on the bench but not a cost the owner own card pays', async () => {
    const { registerDemoCards } = await import('../src/index.js');
    registerDemoCards();
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: ROSTER, seed: 61 },
      { p1ActiveCardId: 'gojo-satoru', p2ActiveCardId: 'gojo-satoru' }
    );
    const api = apiOf(match);
    const terrainId = match.state.players.p1.unplayedTerrainInstanceIds[0]!;
    const { moveTerrainFromPoolToActive } = await import('../src/zones.js');
    await moveTerrainFromPoolToActive(match.state, 'p1', terrainId, api);

    const benchedSorakaId = findInstance(match, 'p1', 'soraka');
    const enemyId = findInstance(match, 'p2', 'gojo-satoru');
    expect(match.state.players.p1.benchCharacterInstanceIds).toContain(benchedSorakaId);

    // Hostile damage from the other side is still fully absorbed.
    const hostile = api.buildEffectContext(enemyId, 'p2', undefined, 'ability');
    await hostile.dealDamage(benchedSorakaId, 80, { skipEvasionRoll: true });
    await settle(match);
    expect(match.state.players.p1.characters[benchedSorakaId]!.damage).toBe(0);

    // The owner own card paying an HP cost on that same bench character goes through.
    const own = api.buildEffectContext(benchedSorakaId, 'p1', undefined, 'ability');
    await own.dealDamage(benchedSorakaId, 100);
    await settle(match);
    expect(match.state.players.p1.characters[benchedSorakaId]!.damage).toBe(100);
  });
});

describe('event resolution', () => {
  it('rejects a malformed ordering answer and still fires each reacting passive exactly once', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: TICKER_ROSTER, p2Roster: TICKER_ROSTER, seed: 4 },
      {}
    );

    const active = match.state.activePlayerId;
    await drive(match, active, { kind: 'pass' }, (choice) => {
      if (choice.spec.kind !== 'order') return defaultAnswer(choice);
      // A hostile/buggy client answering "resolve source 0, then source 0 again" is
      // turned away at the boundary rather than reaching the resolution loop.
      const rejected = match.answerChoice(choice.playerId, choice.id, { kind: 'order', orderedKeys: ['0', '0'] });
      expect(rejected).toMatchObject({ ok: false });
      return defaultAnswer(choice);
    });
    await settle(match);

    const opponent = match.state.activePlayerId;
    const counts = Object.values(match.state.players[opponent].characters).map((char) =>
      Number(char.statuses.find((s) => s.statusId === 'fx-tick-count')?.data?.['count'] ?? 0)
    );
    // Both tickers ran, and neither ran twice for a single onTurnStart.
    expect(counts.filter((c) => c === 1)).toHaveLength(2);
  });

  it('cuts off an endless trigger chain instead of overflowing the stack', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ECHO_ROSTER, p2Roster: ECHO_ROSTER, seed: 13 },
      {}
    );
    const attacker = match.state.activePlayerId;
    const attackerActive = match.state.players[attacker].activeCharacterInstanceId!;

    await drive(match, attacker, { kind: 'attack', characterInstanceId: attackerActive, attackId: 'tap' });
    await settle(match);

    expect(match.state.log.some((entry) => entry.message.includes('Chaîne de déclenchements trop profonde'))).toBe(true);
    expect(match.state.result).toBeUndefined();
  });

  it('names the killer on onCharacterKO', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: TINY_ROSTER, p2Roster: TINY_ROSTER, seed: 17 },
      {}
    );
    const attacker = match.state.activePlayerId;
    const attackerActive = match.state.players[attacker].activeCharacterInstanceId!;

    const seen: Record<string, unknown>[] = [];
    const api = apiOf(match);
    const originalEmit = api.emitEvent.bind(api);
    api.emitEvent = async (event) => {
      if (event.name === 'onCharacterKO') seen.push(event.data);
      await originalEmit(event);
    };

    await drive(match, attacker, { kind: 'attack', characterInstanceId: attackerActive, attackId: 'shatter' });
    await settle(match);

    expect(seen).toHaveLength(1);
    expect(seen[0]!['killerInstanceId']).toBe(attackerActive);
    expect(seen[0]!['killerOwnerId']).toBe(attacker);
  });

  it('emits onGameStart before the first turn begins', async () => {
    const names: string[] = [];
    const { Match } = await import('../src/index.js');
    const match = Match.create({
      p1Name: 'A',
      p2Name: 'B',
      p1Roster: TINY_ROSTER,
      p2Roster: TINY_ROSTER,
      seed: 2,
    });
    const api = apiOf(match);
    const originalEmit = api.emitEvent.bind(api);
    api.emitEvent = async (event) => {
      names.push(event.name);
      await originalEmit(event);
    };
    await settle(match);

    expect(names).toContain('onGameStart');
    expect(names.indexOf('onGameStart')).toBeLessThan(names.indexOf('onTurnStart'));
  });
});

describe('zone integrity', () => {
  it('carries equipped objects across when two bench characters swap sides', async () => {
    const roster = {
      characterCardIds: ['fx-striker', 'fx-tank', 'fx-stunner'],
      objectCardIds: ['fx-sticky-object'],
      terrainCardIds: [],
    };
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: roster, p2Roster: roster, seed: 23 },
      {}
    );
    const api = apiOf(match);

    // Equip p1's *bench* character directly, then swap it with one of p2's.
    const ownBenchId = match.state.players.p1.benchCharacterInstanceIds[0]!;
    const enemyBenchId = match.state.players.p2.benchCharacterInstanceIds[0]!;
    const objectId = match.state.players.p1.unplayedObjectInstanceIds[0]!;
    match.state.players.p1.unplayedObjectInstanceIds = [];
    match.state.players.p1.inPlayObjectInstanceIds.push(objectId);
    api.attachObject(objectId, ownBenchId);
    expect(match.state.players.p1.characters[ownBenchId]!.attachedObjectInstanceIds).toContain(objectId);

    api.swapBenchCharacters('p1', ownBenchId, enemyBenchId);

    // The character now belongs to p2 -- and so must its equipment.
    expect(match.state.players.p2.characters[ownBenchId]).toBeDefined();
    expect(match.state.players.p2.objects[objectId]).toBeDefined();
    expect(match.state.players.p2.inPlayObjectInstanceIds).toContain(objectId);
    expect(match.state.players.p1.objects[objectId]).toBeUndefined();
    expect(match.state.players.p1.inPlayObjectInstanceIds).not.toContain(objectId);
  });

  it('un objet lié suit son porteur au cimetière quand celui-ci meurt -- y compris posé sur un ennemi', async () => {
    const roster: RosterConfig = {
      characterCardIds: ['fx-striker', 'fx-tank', 'fx-glass'],
      objectCardIds: ['fx-sticky-object', 'fx-sticky-object'],
      terrainCardIds: [],
    };
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: roster, p2Roster: roster, seed: 41 },
      {}
    );
    const api = apiOf(match);

    // Un objet de p1 posé sur son propre actif, un autre posé sur l'actif de p2 : le moteur
    // autorise explicitement d'équiper un personnage adverse, et chaque carte doit repartir
    // dans le cimetière de SON propriétaire, pas dans celui du porteur.
    const ownActiveId = match.state.players.p1.activeCharacterInstanceId!;
    const enemyActiveId = match.state.players.p2.activeCharacterInstanceId!;
    const [ownObjectId, enemyObjectId] = match.state.players.p1.unplayedObjectInstanceIds;
    match.state.players.p1.unplayedObjectInstanceIds = [];
    match.state.players.p1.inPlayObjectInstanceIds.push(ownObjectId!, enemyObjectId!);
    api.attachObject(ownObjectId!, ownActiveId);
    api.attachObject(enemyObjectId!, enemyActiveId);

    // Banc adverse vidé : le KO d'un actif ouvrirait sinon le choix du remplaçant, et ce
    // test-là ne parle que du sort des objets liés.
    match.state.players.p2.benchCharacterInstanceIds = [];
    await api.koCharacter(enemyActiveId);

    // Le porteur adverse est mort : son équipement part au cimetière de p1 (son propriétaire),
    // quitte le jeu, et n'est plus rattaché à personne.
    expect(match.state.players.p1.graveyardObjectInstanceIds).toContain(enemyObjectId);
    expect(match.state.players.p1.inPlayObjectInstanceIds).not.toContain(enemyObjectId);
    expect(match.state.players.p1.objects[enemyObjectId!]!.attachedToCharacterInstanceId).toBeUndefined();
    expect(match.state.players.p2.characters[enemyActiveId]!.attachedObjectInstanceIds).toEqual([]);

    // L'objet posé sur un personnage encore vivant, lui, n'a pas bougé.
    expect(match.state.players.p1.inPlayObjectInstanceIds).toContain(ownObjectId);
    expect(match.state.players.p1.characters[ownActiveId]!.attachedObjectInstanceIds).toContain(ownObjectId);
  });
});

describe('effect context isolation', () => {
  it('gives each execution its own scratch space, so concurrent matches cannot interfere', async () => {
    const matchA = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: TINY_ROSTER, p2Roster: TINY_ROSTER, seed: 31 },
      {}
    );
    const matchB = await createReadyMatch(
      { p1Name: 'C', p2Name: 'D', p1Roster: TINY_ROSTER, p2Roster: TINY_ROSTER, seed: 32 },
      {}
    );
    const ctxA = apiOf(matchA).buildEffectContext(matchA.state.players.p1.activeCharacterInstanceId!, 'p1');
    const ctxB = apiOf(matchB).buildEffectContext(matchB.state.players.p1.activeCharacterInstanceId!, 'p1');

    ctxA.scratch['flag'] = true;
    expect(ctxB.scratch['flag']).toBeUndefined();
  });
});
