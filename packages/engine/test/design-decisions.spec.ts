import { beforeAll, describe, expect, it } from 'vitest';
import {
  defaultChoiceAnswer,
  registerCard,
  type EngineApi,
  type Match,
  type PendingChoice,
  type PlayerId,
  type RosterConfig,
} from '../src/index.js';
import { dioBrando } from '../src/cards/demo/dio-brando.js';
import { killua } from '../src/cards/demo/killua.js';
import { makima } from '../src/cards/demo/makima.js';
import { regulationThermique } from '../src/cards/demo/regulation-thermique.js';
import { getSealedIds, hasStatus } from '../src/statuses.js';
import { registerTestFixtures, MIRROR_NEGATE_ROSTER } from './fixtures.js';
import { createReadyMatch, defaultAnswer, drive, findInstance } from './test-utils.js';

/**
 * Décisions de design tranchées par l'auteur après l'audit du catalogue -- un test de
 * reproduction par changement de comportement, pour que personne ne les « re-corrige »
 * dans l'autre sens sans s'en rendre compte.
 */

let registered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!registered) {
    registered = true;
    for (const card of [dioBrando, killua, makima, regulationThermique]) registerCard(card);
  }
});

async function ensureTurn(match: Match, playerId: PlayerId): Promise<void> {
  if (match.state.activePlayerId !== playerId) {
    await drive(match, match.state.activePlayerId, { kind: 'pass' });
  }
}

function answerOption(optionKey: string) {
  return (choice: PendingChoice) => {
    if (choice.spec.kind === 'select-option' && choice.spec.options.some((o) => o.key === optionKey)) {
      return { kind: 'select-option' as const, key: optionKey };
    }
    return defaultAnswer(choice);
  };
}

function answerCharacter(instanceId: string) {
  return (choice: PendingChoice) => {
    if (choice.spec.kind === 'select-characters' && choice.spec.options.includes(instanceId)) {
      return { kind: 'select-characters' as const, selected: [instanceId] };
    }
    return defaultAnswer(choice);
  };
}

function statusIds(match: Match, playerId: PlayerId, instanceId: string): string[] {
  return match.state.players[playerId].characters[instanceId]!.statuses.map((s) => s.statusId);
}

const FOE: RosterConfig = { characterCardIds: ['fx-tank', 'fx-stunner'], objectCardIds: [], terrainCardIds: [] };

describe('1. Dio -- Chair Vampirique : pas de jet de Silence Passif sur un coup esquivé', () => {
  const ROSTER: RosterConfig = { characterCardIds: [dioBrando.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };
  const UNTOUCHABLE: RosterConfig = { characterCardIds: ['fx-untouchable', 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

  it("un coup esquivé (100 % d'esquive) ne pose pas silence-passive et ne lance même pas la roue", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: UNTOUCHABLE, seed: 11 },
      { p1ActiveCardId: dioBrando.id, p2ActiveCardId: 'fx-untouchable' }
    );
    await ensureTurn(match, 'p1');
    const dioId = findInstance(match, 'p1', dioBrando.id);
    const targetId = findInstance(match, 'p2', 'fx-untouchable');
    const logBefore = match.state.log.length;

    await drive(match, 'p1', { kind: 'attack', characterInstanceId: dioId, attackId: 'chair-vampirique' });

    expect(match.state.players.p2.characters[targetId]!.damage).toBe(0); // esquivé
    expect(statusIds(match, 'p2', targetId)).not.toContain('silence-passive');
    const newEntries = match.state.log.slice(logBefore);
    expect(newEntries.some((e) => e.data?.['kind'] === 'evasion')).toBe(true);
    // Le jet de 50 % n'a pas eu lieu du tout : aucune roue affichée pour rien.
    expect(newEntries.some((e) => e.data?.['kind'] === 'chance-roll')).toBe(false);
  });
});

describe("2. Killua -- Godspeed ne s'arme que sur un vrai switch", () => {
  const ROSTER: RosterConfig = { characterCardIds: ['fx-glass', killua.id], objectCardIds: [], terrainCardIds: [] };
  const STRIKER: RosterConfig = { characterCardIds: ['fx-striker', 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

  it("remplacer un allié KO (reason 'ko-replacement') n'arme pas Godspeed", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: STRIKER, seed: 3 },
      { p1ActiveCardId: 'fx-glass', p2ActiveCardId: 'fx-striker' }
    );
    await ensureTurn(match, 'p2');
    const strikerId = findInstance(match, 'p2', 'fx-striker');
    const killuaId = findInstance(match, 'p1', killua.id);

    // Strike = 40 sur un fx-glass à 10 HP : KO, puis Killua prend le poste.
    await drive(match, 'p2', { kind: 'attack', characterInstanceId: strikerId, attackId: 'strike' }, answerCharacter(killuaId));
    expect(match.state.players.p1.activeCharacterInstanceId).toBe(killuaId);
    expect(statusIds(match, 'p1', killuaId)).not.toContain('killua-godspeed-ready');
  });

  it("l'action de switch (reason 'switch') arme bien Godspeed", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: STRIKER, seed: 3 },
      { p1ActiveCardId: 'fx-glass', p2ActiveCardId: 'fx-striker' }
    );
    await ensureTurn(match, 'p1');
    const killuaId = findInstance(match, 'p1', killua.id);

    await drive(match, 'p1', { kind: 'switch', newActiveInstanceId: killuaId });
    expect(match.state.players.p1.activeCharacterInstanceId).toBe(killuaId);
    expect(statusIds(match, 'p1', killuaId)).toContain('killua-godspeed-ready');
  });
});

describe('3. Makima -- les sceaux de Sacrifice survivent à sa mort (statut générique `sealed`)', () => {
  const ROSTER: RosterConfig = { characterCardIds: [makima.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };
  const KILLER: RosterConfig = { characterCardIds: ['fx-striker', 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

  it('une capacité scellée reste refusée une fois Makima au cimetière', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: KILLER, seed: 21 },
      { p1ActiveCardId: makima.id, p2ActiveCardId: 'fx-striker' }
    );
    await ensureTurn(match, 'p1');
    const makimaId = findInstance(match, 'p1', makima.id);
    const tankId = findInstance(match, 'p1', 'fx-tank');
    const strikerId = findInstance(match, 'p2', 'fx-striker');

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: makimaId, abilityId: 'sacrifice' }, answerOption('self-buff'));
    const tank = match.state.players.p1.characters[tankId]!;
    expect(hasStatus(tank, 'sealed')).toBe(true);
    expect(getSealedIds(tank)).toEqual({ abilityIds: ['self-buff'], attackIds: [] });

    // Makima meurt pendant le tour adverse ; le tank la remplace au poste actif.
    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'use-ability', characterInstanceId: strikerId, abilityId: 'instant-ko' });
    expect(match.state.players.p1.graveyardCharacterInstanceIds).toContain(makimaId);
    expect(match.state.players.p1.activeCharacterInstanceId).toBe(tankId);
    await drive(match, 'p2', { kind: 'pass' });

    // Plus aucun modifier de Makima n'est scanné : c'est le statut porté par la victime,
    // lu par le moteur, qui doit tenir le sceau.
    const refused = match.applyAction('p1', { kind: 'use-ability', characterInstanceId: tankId, abilityId: 'self-buff' });
    expect(refused.ok).toBe(false);
    // L'attaque non scellée, elle, passe toujours (le sceau ne vise qu'un id précis).
    const allowed = match.applyAction('p1', { kind: 'attack', characterInstanceId: tankId, attackId: 'poke' });
    expect(allowed.ok).toBe(true);
    await match.waitForNextPause();
  });

  it('une attaque scellée reste refusée elle aussi, sans désarmer le reste', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: KILLER, seed: 22 },
      { p1ActiveCardId: makima.id, p2ActiveCardId: 'fx-striker' }
    );
    await ensureTurn(match, 'p1');
    const makimaId = findInstance(match, 'p1', makima.id);
    const tankId = findInstance(match, 'p1', 'fx-tank');
    const strikerId = findInstance(match, 'p2', 'fx-striker');

    await drive(match, 'p1', { kind: 'use-ability', characterInstanceId: makimaId, abilityId: 'sacrifice' }, answerOption('poke'));
    expect(getSealedIds(match.state.players.p1.characters[tankId]!)).toEqual({ abilityIds: [], attackIds: ['poke'] });

    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'use-ability', characterInstanceId: strikerId, abilityId: 'instant-ko' });
    await drive(match, 'p2', { kind: 'pass' });
    expect(match.state.players.p1.activeCharacterInstanceId).toBe(tankId);

    expect(match.applyAction('p1', { kind: 'attack', characterInstanceId: tankId, attackId: 'poke' }).ok).toBe(false);
    expect(match.applyAction('p1', { kind: 'use-ability', characterInstanceId: tankId, abilityId: 'self-buff' }).ok).toBe(true);
    await match.waitForNextPause();
  });
});

describe('4. Régulation Thermique -- son soin respecte `unhealable`', () => {
  const ROSTER: RosterConfig = { characterCardIds: ['fx-tank', 'fx-stunner'], objectCardIds: [], terrainCardIds: [regulationThermique.id] };

  it('sous la Marque de Mahito, le burn est annulé mais le porteur ne récupère rien', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 31 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const tankId = findInstance(match, 'p1', 'fx-tank');
    const foeId = match.state.players.p2.activeCharacterInstanceId!;

    const api = match['api'] as EngineApi;
    const ctx = api.buildEffectContext(foeId, 'p2', undefined, 'ability');
    await ctx.dealDamage(tankId, 100, { skipEvasionRoll: true });
    ctx.applyStatus(tankId, { statusId: 'burn', label: 'Burn', remainingTurns: 3 }, { skipEvasionRoll: true });
    ctx.applyStatus(tankId, { statusId: 'unhealable', label: 'Marque' }, { skipEvasionRoll: true });
    expect(match.state.players.p1.characters[tankId]!.damage).toBe(100);

    const terrainId = Object.values(match.state.players.p1.terrains).find((t) => t.cardId === regulationThermique.id)!.instanceId;
    await drive(match, 'p1', { kind: 'play-terrain', terrainInstanceId: terrainId });
    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });

    // Tick de burn au début du tour de p1 : ni les 50 de dégâts (annulés), ni les 50 de soin.
    expect(match.state.players.p1.characters[tankId]!.damage).toBe(100);
  });

  it('sans la Marque, le même tick soigne bien de 50 (comportement de référence)', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 31 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const tankId = findInstance(match, 'p1', 'fx-tank');
    const foeId = match.state.players.p2.activeCharacterInstanceId!;

    const api = match['api'] as EngineApi;
    const ctx = api.buildEffectContext(foeId, 'p2', undefined, 'ability');
    await ctx.dealDamage(tankId, 100, { skipEvasionRoll: true });
    ctx.applyStatus(tankId, { statusId: 'burn', label: 'Burn', remainingTurns: 3 }, { skipEvasionRoll: true });

    const terrainId = Object.values(match.state.players.p1.terrains).find((t) => t.cardId === regulationThermique.id)!.instanceId;
    await drive(match, 'p1', { kind: 'play-terrain', terrainInstanceId: terrainId });
    await drive(match, 'p1', { kind: 'pass' });
    await drive(match, 'p2', { kind: 'pass' });

    expect(match.state.players.p1.characters[tankId]!.damage).toBe(50);
  });
});

describe("5. Moteur -- le choix du remplaçant après un KO n'est jamais annulable", () => {
  it("l'attaquant tué par un renvoi pendant sa propre attaque ne peut pas rembobiner sa mort", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: MIRROR_NEGATE_ROSTER, p2Roster: MIRROR_NEGATE_ROSTER, seed: 96 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-striker' }
    );
    const bearerId = match.state.activePlayerId;
    const attackerId: PlayerId = bearerId === 'p1' ? 'p2' : 'p1';
    const bearer = match.state.players[bearerId];
    const attacker = match.state.players[attackerId];
    const attackerActiveId = attacker.activeCharacterInstanceId!;

    // fx-striker fait 100 HP : on l'amène à 40 pour que les 40 renvoyés le tuent net.
    const api = match['api'] as EngineApi;
    const ctx = api.buildEffectContext(bearer.activeCharacterInstanceId!, bearerId, undefined, 'ability');
    await ctx.dealDamage(attackerActiveId, 60, { skipEvasionRoll: true });

    const objectId = Object.values(bearer.objects).find((o) => o.cardId === 'fx-mirror-negate-object')!.instanceId;
    await drive(match, bearerId, { kind: 'play-object', objectInstanceId: objectId });
    await drive(match, bearerId, { kind: 'pass' });

    const result = match.applyAction(attackerId, { kind: 'attack', characterInstanceId: attackerActiveId, attackId: 'strike' });
    expect(result.ok).toBe(true);
    await match.waitForNextPause();

    const pending = match.state.pendingChoice;
    expect(pending).toBeDefined();
    expect(pending!.playerId).toBe(attackerId);
    expect(pending!.spec.kind).toBe('select-characters');
    expect(pending!.spec.prompt).toBe('Choisissez le personnage qui devient actif');
    expect(pending!.cancellable).toBe(false);
    expect(attacker.graveyardCharacterInstanceIds).toContain(attackerActiveId);

    expect(match.cancelPendingChoice(attackerId)).toEqual({ ok: false, error: 'Cette action ne peut plus être annulée' });
    // La mort tient toujours : rien n'a été rembobiné.
    expect(match.state.pendingChoice?.id).toBe(pending!.id);
    expect(attacker.graveyardCharacterInstanceIds).toContain(attackerActiveId);

    const answer = match.answerChoice(attackerId, pending!.id, defaultChoiceAnswer(pending!.spec));
    expect(answer.ok).toBe(true);
    await match.waitForNextPause();
    expect(match.state.players[attackerId].activeCharacterInstanceId).not.toBeNull();
  });
});

describe('6. Moteur -- une question oui/non sans réponse vaut « non »', () => {
  it('defaultChoiceAnswer renvoie false sur un yes-no', () => {
    expect(defaultChoiceAnswer({ kind: 'yes-no', prompt: 'Sacrifier ?' })).toEqual({ kind: 'yes-no', value: false });
  });
});
