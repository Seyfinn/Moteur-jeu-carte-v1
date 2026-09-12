import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type Match, type PendingChoice, type PlayerId, type RosterConfig } from '../src/index.js';
import { levi } from '../src/cards/demo/levi.js';
import { chaines } from '../src/cards/demo/chaines.js';
import { destruction } from '../src/cards/demo/destruction.js';
import { arene } from '../src/cards/demo/arene.js';
import { dieuDuTonnerreVolant } from '../src/cards/demo/dieu-du-tonnerre-volant.js';
import { coupDeMain } from '../src/cards/demo/coup-de-main.js';
import { muzan } from '../src/cards/demo/muzan.js';
import { describeObjectUnplayable } from '../src/queries.js';
import { hasStatus } from '../src/statuses.js';
import { registerTestFixtures } from './fixtures.js';
import { createReadyMatch, defaultAnswer, drive, findInstance } from './test-utils.js';

let registered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!registered) {
    registered = true;
    for (const card of [levi, chaines, destruction, arene, dieuDuTonnerreVolant, coupDeMain, muzan]) registerCard(card);
  }
});

async function ensureTurn(match: Match, playerId: PlayerId): Promise<void> {
  if (match.state.activePlayerId !== playerId) {
    await drive(match, match.state.activePlayerId, { kind: 'pass' });
  }
}

/** Sélectionne un personnage précis dans une fenêtre de ciblage ; défaut sinon. */
function answerCharacter(instanceId: string) {
  return (choice: PendingChoice) => {
    if (choice.spec.kind === 'select-characters' && choice.spec.options.includes(instanceId)) {
      return { kind: 'select-characters' as const, selected: [instanceId] };
    }
    return defaultAnswer(choice);
  };
}

function objectInstance(match: Match, playerId: PlayerId, cardId: string): string {
  return Object.values(match.state.players[playerId].objects).find((o) => o.cardId === cardId)!.instanceId;
}

function terrainInstance(match: Match, playerId: PlayerId, cardId: string): string {
  return Object.values(match.state.players[playerId].terrains).find((t) => t.cardId === cardId)!.instanceId;
}

const FOE: RosterConfig = { characterCardIds: ['fx-tank', 'fx-stunner'], objectCardIds: [], terrainCardIds: [] };

describe('Levi -- "Traque" est une passive imprimée, donc coupée par le silence passif', () => {
  const ROSTER: RosterConfig = { characterCardIds: [levi.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

  it('ne propose plus le banc affaibli quand Levi est sous silence passif', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 13 },
      { p1ActiveCardId: levi.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const leviId = findInstance(match, 'p1', levi.id);
    const benchFoeId = findInstance(match, 'p2', 'fx-stunner');
    const foeActiveId = match.state.players.p2.activeCharacterInstanceId!;

    match.state.players.p2.characters[benchFoeId]!.damage = 50; // 50 PV restants : sous le seuil
    match.state.players.p1.characters[leviId]!.statuses.push({ statusId: 'silence-passive', label: 'test', remainingTurns: 5 });

    const foeActiveDamageBefore = match.state.players.p2.characters[foeActiveId]!.damage;
    await drive(
      match,
      'p1',
      { kind: 'attack', characterInstanceId: leviId, attackId: 'taillade-eclair' },
      answerCharacter(benchFoeId)
    );
    // Silencé, Levi n'a plus que l'actif adverse en face : le banc n'a pas été touché.
    expect(match.state.players.p2.characters[benchFoeId]!.damage).toBe(50);
    expect(match.state.players.p2.characters[foeActiveId]!.damage).toBeGreaterThan(foeActiveDamageBefore);
  });
});

describe('Chaînes -- un objet à lier dont l\'effet part avec lui', () => {
  const ROSTER: RosterConfig = {
    characterCardIds: ['fx-striker', 'fx-tank'],
    objectCardIds: [chaines.id],
    terrainCardIds: [destruction.id],
  };

  it('Destruction détruit Chaînes et libère le personnage enchaîné', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 21 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const foeActiveId = match.state.players.p2.activeCharacterInstanceId!;

    await drive(match, 'p1', { kind: 'play-object', objectInstanceId: objectInstance(match, 'p1', chaines.id) });
    const foeActive = () => match.state.players.p2.characters[foeActiveId]!;
    expect(hasStatus(foeActive(), 'chained')).toBe(true);
    expect(foeActive().attachedObjectInstanceIds).toHaveLength(1);

    await drive(match, 'p1', { kind: 'play-terrain', terrainInstanceId: terrainInstance(match, 'p1', destruction.id) });
    expect(foeActive().attachedObjectInstanceIds).toHaveLength(0);
    expect(hasStatus(foeActive(), 'chained')).toBe(false);
  });
});

describe('Dieu du Tonnerre Volant -- refusée quand aucun switch ne peut avoir lieu', () => {
  const ROSTER: RosterConfig = {
    characterCardIds: ['fx-striker', 'fx-tank'],
    objectCardIds: [dieuDuTonnerreVolant.id],
    terrainCardIds: [arene.id],
  };

  it("est grisée sous Arène, qui ferme tous les switchs (forcés compris)", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 5 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const objectId = objectInstance(match, 'p1', dieuDuTonnerreVolant.id);
    expect(describeObjectUnplayable(match.state, 'p1', objectId)).toBeNull();

    await drive(match, 'p1', { kind: 'play-terrain', terrainInstanceId: terrainInstance(match, 'p1', arene.id) });
    expect(describeObjectUnplayable(match.state, 'p1', objectId)).not.toBeNull();
    const refused = match.applyAction('p1', { kind: 'play-object', objectInstanceId: objectId });
    expect(refused.ok).toBe(false);
    // La carte n'a pas été consommée.
    expect(match.state.players.p1.unplayedObjectInstanceIds).toContain(objectId);
  });
});

describe('Coup de main -- les attaques proposées sont celles que le personnage porte vraiment', () => {
  const ROSTER: RosterConfig = {
    characterCardIds: ['fx-striker', 'fx-tank'],
    objectCardIds: [coupDeMain.id],
    terrainCardIds: [],
  };

  it("n'offre que l'attaque empruntée (borrowed-attack) à un personnage du banc qui en porte une", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed: 8 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const benchId = findInstance(match, 'p1', 'fx-tank');
    // fx-tank n'a que « poke » ; on lui prête « strike » de fx-striker (Livre de Chrollo).
    match.state.players.p1.characters[benchId]!.statuses.push({
      statusId: 'borrowed-attack',
      label: 'test',
      remainingTurns: 2,
      ticksOnBench: true,
      data: { cardId: 'fx-striker', attackId: 'strike' },
    });

    let offered: string[] = [];
    await drive(
      match,
      'p1',
      { kind: 'play-object', objectInstanceId: objectInstance(match, 'p1', coupDeMain.id) },
      (choice) => {
        if (choice.spec.kind === 'select-option' && choice.spec.options.some((o) => o.key === 'strike' || o.key === 'poke')) {
          offered = choice.spec.options.map((o) => o.key);
        }
        return defaultAnswer(choice);
      }
    );
    expect(offered).toEqual(['strike']);
  });
});

describe("Muzan -- Black Blood : un seul jet d'esquive pour les dégâts et le poison", () => {
  const ROSTER: RosterConfig = { characterCardIds: [muzan.id, 'fx-tank'], objectCardIds: [], terrainCardIds: [] };

  it("n'empoisonne pas une cible qui a esquivé le coup", async () => {
    // Cible sous `evasive` (20 %) : on cherche une graine où le coup est esquivé. Sans jet
    // partagé, l'esquive réussie posait `evasion-locked` (0 %) et le poison passait ensuite
    // à coup sûr -- « esquive les dégâts mais empoisonné quand même ».
    let evadedOnce = false;
    for (let seed = 1; seed <= 80 && !evadedOnce; seed++) {
      const match = await createReadyMatch(
        { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: FOE, seed },
        { p1ActiveCardId: muzan.id, p2ActiveCardId: 'fx-tank' }
      );
      await ensureTurn(match, 'p1');
      const muzanId = findInstance(match, 'p1', muzan.id);
      const foeActiveId = match.state.players.p2.activeCharacterInstanceId!;
      match.state.players.p2.characters[foeActiveId]!.statuses.push({ statusId: 'evasive', label: 'test', remainingTurns: 5 });

      await drive(match, 'p1', { kind: 'attack', characterInstanceId: muzanId, attackId: 'black-blood' });
      // Le tour d'en face s'est ouvert dans la foulée : un poison posé a déjà tiqué (1 tour)
      // et, Muzan étant actif, Sang Maudit l'a converti en perte de HP max -- c'est cette
      // trace-là qu'on lit, le statut lui-même ayant expiré.
      const foe = match.state.players.p2.characters[foeActiveId]!;
      const poisoned = foe.currentMaxHP < foe.baseMaxHP;
      if (foe.damage > 0) {
        expect(poisoned).toBe(true); // touché : les deux passent
        continue;
      }
      evadedOnce = true;
      expect(poisoned).toBe(false); // esquivé : rien ne passe
    }
    expect(evadedOnce).toBe(true);
  });
});
