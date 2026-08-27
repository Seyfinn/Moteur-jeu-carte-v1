import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type EngineApi, type PendingChoice, type PlayerId, type RosterConfig } from '../src/index.js';
import { absorptionVitale } from '../src/cards/demo/absorption-vitale.js';
import { aizen } from '../src/cards/demo/aizen.js';
import { autelDemoniaque } from '../src/cards/demo/autel-demoniaque.js';
import { hopital } from '../src/cards/demo/hopital.js';
import { killua } from '../src/cards/demo/killua.js';
import { registerTestFixtures, FX_ROSTER, TINY_ROSTER } from './fixtures.js';
import { createReadyMatch, defaultAnswer, drive, findInstance, settle } from './test-utils.js';

let demoRegistered = false;
beforeAll(() => {
  registerTestFixtures();
  if (demoRegistered) return;
  demoRegistered = true;
  for (const def of [absorptionVitale, aizen, autelDemoniaque, hopital, killua]) {
    try {
      registerCard(def);
    } catch {
      /* another spec in the same worker already registered it */
    }
  }
});

function apiOf(match: { state: unknown }): EngineApi {
  return (match as unknown as { api: EngineApi }).api;
}

describe('a terrain on-play trigger only fires for its own terrain', () => {
  const AUTEL_ROSTER: RosterConfig = {
    characterCardIds: FX_ROSTER.characterCardIds,
    objectCardIds: [],
    terrainCardIds: ['autel-demoniaque'],
  };
  const OTHER_TERRAIN_ROSTER: RosterConfig = {
    characterCardIds: FX_ROSTER.characterCardIds,
    objectCardIds: [],
    terrainCardIds: ['hopital'],
  };

  it('does not re-strike when the opponent puts down a terrain of their own', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: AUTEL_ROSTER, p2Roster: OTHER_TERRAIN_ROSTER, seed: 404 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-tank' }
    );
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });

    const autelId = Object.values(match.state.players[owner].terrains)[0]!.instanceId;
    await drive(match, owner, { kind: 'play-terrain', terrainInstanceId: autelId });

    const enemyActiveId = match.state.players[enemy].activeCharacterInstanceId!;
    const afterFirstStrike = match.state.players[enemy].characters[enemyActiveId]!.damage;
    expect(afterFirstStrike).toBeGreaterThan(0); // the on-play strike itself still happens

    // Posing a terrain is a free action, so hand the turn over explicitly.
    await drive(match, owner, { kind: 'pass' });

    // The opponent posing their own terrain used to re-run every in-play terrain's
    // on-play ability, giving the Autel a free extra AoE on someone else's turn.
    const hopitalId = Object.values(match.state.players[enemy].terrains)[0]!.instanceId;
    await drive(match, enemy, { kind: 'play-terrain', terrainInstanceId: hopitalId });

    expect(match.state.players[enemy].characters[enemyActiveId]!.damage).toBe(afterFirstStrike);
  });
});

describe('ticksOnBench', () => {
  it('counts a turn-scoped buff down even while its bearer sits on the bench', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 505 },
      {}
    );
    const owner = match.state.activePlayerId;
    const enemy: PlayerId = owner === 'p1' ? 'p2' : 'p1';
    const benchId = match.state.players[owner].benchCharacterInstanceIds[0]!;
    const bench = match.state.players[owner].characters[benchId]!;

    bench.statuses.push({ statusId: 'atk-boost', label: 'Opt-in', remainingTurns: 1, ticksOnBench: true, data: { amount: 40 } });
    bench.statuses.push({ statusId: 'atk-reduction', label: 'Suspendu', remainingTurns: 1, data: { amount: 40 } });

    await drive(match, owner, { kind: 'pass' });
    await drive(match, enemy, { kind: 'pass' }); // back round to the owner: one tick for the bench

    const after = match.state.players[owner].characters[benchId]!;
    expect(after.statuses.some((s) => s.statusId === 'atk-boost')).toBe(false); // opted in, expired
    expect(after.statuses.some((s) => s.statusId === 'atk-reduction')).toBe(true); // default: frozen on the bench
  });
});

describe("Killua's Godspeed", () => {
  const KILLUA_ROSTER: RosterConfig = {
    characterCardIds: ['killua', ...FX_ROSTER.characterCardIds.slice(0, 2)],
    objectCardIds: [],
    terrainCardIds: [],
  };

  it('is still armed on the turn after the switch that triggered it', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: KILLUA_ROSTER, p2Roster: FX_ROSTER, seed: 606 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });

    const killuaId = Object.values(match.state.players[owner].characters).find((c) => c.cardId === 'killua')!.instanceId;
    // Switching is a final action, so Killua only gets to swing on the NEXT turn -- the
    // whole point of the ability, and exactly when the "ready" marker used to be gone.
    await drive(match, owner, { kind: 'switch', newActiveInstanceId: killuaId });
    await drive(match, enemy, { kind: 'pass' });

    const armed = match.state.players[owner].characters[killuaId]!.statuses.some(
      (s) => s.statusId === 'killua-godspeed-ready'
    );
    expect(armed).toBe(true);
  });
});

describe('self-inflicted costs', () => {
  it('are not absorbed by the payer own shield', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 707 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-tank' }
    );
    const owner = match.state.activePlayerId;
    const activeId = match.state.players[owner].activeCharacterInstanceId!;
    const api = apiOf(match);
    api.addShield(activeId, 500);

    const ctx = api.buildEffectContext(activeId, owner, undefined, 'ability');
    await ctx.dealDamage(activeId, 100, { ignoreShield: true, ignoreDamageReduction: true });
    await settle(match);

    expect(match.state.players[owner].characters[activeId]!.damage).toBe(100);
    expect(match.state.players[owner].characters[activeId]!.shield).toBe(500);
  });
});

describe('valeur lock kills', () => {
  it('name their killer on onCharacterKO, like ordinary damage does', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 808 },
      {}
    );
    const attackerSide = match.state.activePlayerId;
    const victimSide: PlayerId = attackerSide === 'p1' ? 'p2' : 'p1';
    const attackerId = match.state.players[attackerSide].activeCharacterInstanceId!;
    const victimId = match.state.players[victimSide].benchCharacterInstanceIds[0]!;

    const api = apiOf(match);
    const killers: unknown[] = [];
    const originalEmit = api.emitEvent.bind(api);
    api.emitEvent = async (event) => {
      if (event.name === 'onCharacterKO') killers.push(event.data['killerInstanceId']);
      await originalEmit(event);
    };

    const ctx = api.buildEffectContext(attackerId, attackerSide, undefined, 'ability');
    await ctx.dealDamage(victimId, 9999, { asValeurLock: true, skipEvasionRoll: true });
    await settle(match);

    expect(match.state.players[victimSide].graveyardCharacterInstanceIds).toContain(victimId);
    expect(killers).toContain(attackerId);
  });
});

describe('status-tick kills', () => {
  it('name the character that applied the status (bleed) as killer on onCharacterKO', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: TINY_ROSTER, p2Roster: TINY_ROSTER, seed: 810 },
      {}
    );
    const attackerSide = match.state.activePlayerId;
    const victimSide: PlayerId = attackerSide === 'p1' ? 'p2' : 'p1';
    const attackerId = match.state.players[attackerSide].activeCharacterInstanceId!;
    const victimId = match.state.players[victimSide].activeCharacterInstanceId!;
    // fx-glass has 10 HP; 10 stacks of bleed (100% of max HP) is lethal in one tick.
    match.state.players[victimSide].characters[victimId]!.statuses.push({
      statusId: 'bleed',
      label: 'Bleed',
      sourceCardInstanceId: attackerId,
      data: { stacks: 10 },
    });

    const api = apiOf(match);
    const killers: unknown[] = [];
    const originalEmit = api.emitEvent.bind(api);
    api.emitEvent = async (event) => {
      if (event.name === 'onCharacterKO') killers.push(event.data['killerInstanceId']);
      await originalEmit(event);
    };

    // Bleed ticks at the start of its bearer's own turn.
    do {
      await drive(match, match.state.activePlayerId, { kind: 'pass' });
    } while (match.state.activePlayerId !== victimSide);
    await settle(match);

    expect(match.state.players[victimSide].graveyardCharacterInstanceIds).toContain(victimId);
    expect(killers).toContain(attackerId);
  });
});

describe('choice answers coming off the wire', () => {
  it('are rejected when they name something that was never offered', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: FX_ROSTER, p2Roster: FX_ROSTER, seed: 909 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const owner = match.state.activePlayerId;
    const enemy: PlayerId = owner === 'p1' ? 'p2' : 'p1';
    const victimId = match.state.players[enemy].activeCharacterInstanceId!;
    // One strike away from death, so the attack below forces the mandatory
    // "who becomes active" prompt on the defending side.
    const victim = match.state.players[enemy].characters[victimId]!;
    victim.damage = victim.currentMaxHP - 1;

    const attackerId = match.state.players[owner].activeCharacterInstanceId!;
    expect(match.applyAction(owner, { kind: 'attack', characterInstanceId: attackerId, attackId: 'strike' })).toMatchObject({
      ok: true,
    });
    await match.waitForNextPause();

    const pending = match.state.pendingChoice!;
    expect(pending.spec.kind).toBe('select-characters');
    expect(match.answerChoice(pending.playerId, pending.id, { kind: 'select-characters', selected: ['nope'] })).toMatchObject({
      ok: false,
    });
    expect(match.state.pendingChoice).toBeDefined(); // still waiting, not silently swallowed

    await settle(match);
    expect(match.state.players[enemy].activeCharacterInstanceId).not.toBeNull();
  });
});

describe("Aizen's status swap", () => {
  const AIZEN_ROSTER: RosterConfig = {
    characterCardIds: ['aizen', ...FX_ROSTER.characterCardIds.slice(0, 2)],
    objectCardIds: [],
    terrainCardIds: [],
  };

  it('trades engine statuses but leaves each card private bookkeeping where it is', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: AIZEN_ROSTER, p2Roster: FX_ROSTER, seed: 1010 },
      { p1ActiveCardId: 'aizen', p2ActiveCardId: 'fx-tank' }
    );
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });

    const aizenId = match.state.players[owner].activeCharacterInstanceId!;
    const enemyId = match.state.players[enemy].activeCharacterInstanceId!;
    match.state.players[owner].characters[aizenId]!.statuses.push({
      statusId: 'my-card-private-counter',
      label: 'Compteur interne',
      data: { stacks: 7 },
    });
    match.state.players[enemy].characters[enemyId]!.statuses.push({
      statusId: 'atk-boost',
      label: 'Buff ennemi',
      data: { amount: 40 },
    });

    await drive(match, owner, { kind: 'use-ability', characterInstanceId: aizenId, abilityId: 'inversion-de-la-realite' });

    const aizenNow = match.state.players[owner].characters[aizenId]!;
    const enemyNow = match.state.players[enemy].characters[enemyId]!;
    expect(aizenNow.statuses.some((s) => s.statusId === 'atk-boost')).toBe(true); // generic buff changed hands
    expect(enemyNow.statuses.some((s) => s.statusId === 'atk-boost')).toBe(false);
    // The private counter would have been silently destroyed on a card that cannot read it.
    expect(aizenNow.statuses.some((s) => s.statusId === 'my-card-private-counter')).toBe(true);
    expect(enemyNow.statuses.some((s) => s.statusId === 'my-card-private-counter')).toBe(false);
  });
});

describe('Absorption Vitale revive pool', () => {
  const OWNER_ROSTER: RosterConfig = {
    characterCardIds: FX_ROSTER.characterCardIds,
    objectCardIds: ['absorption-vitale'],
    terrainCardIds: [],
  };

  it('never offers back the character it just sacrificed', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: FX_ROSTER, seed: 1111 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });

    const sacrificedId = match.state.players[owner].activeCharacterInstanceId!;
    // A second body already in the graveyard, so the prompt has something else to offer.
    const spareId = findInstance(match, owner, 'fx-stunner');
    const player = match.state.players[owner];
    player.benchCharacterInstanceIds = player.benchCharacterInstanceIds.filter((id) => id !== spareId);
    player.graveyardCharacterInstanceIds.push(spareId);

    const objectInstanceId = Object.values(player.objects).find((o) => o.cardId === 'absorption-vitale')!.instanceId;
    await drive(match, owner, { kind: 'play-object', objectInstanceId });

    const offered: string[][] = [];
    // The payoff resolves in the owner's startTurn, i.e. at the tail of whichever drive
    // hands the turn back to them -- so the capture hook has to be on both passes.
    const capture = (choice: PendingChoice) => {
      if (choice.spec.kind === 'select-option') offered.push(choice.spec.options.map((o) => o.key));
      return defaultAnswer(choice);
    };
    for (let i = 0; i < 4; i++) {
      await drive(match, owner, { kind: 'pass' }, capture);
      await drive(match, enemy, { kind: 'pass' }, capture);
    }

    expect(offered.length).toBeGreaterThan(0); // the revive prompt did fire
    for (const options of offered) expect(options).not.toContain(sacrificedId);
    // ...and the sacrifice actually stuck.
    expect(match.state.players[owner].graveyardCharacterInstanceIds).toContain(sacrificedId);
    expect(match.state.players[owner].benchCharacterInstanceIds).toContain(spareId);
  });
});
