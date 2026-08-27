import { beforeAll, describe, expect, it } from 'vitest';
import {
  attacksAvailableTo,
  canAttack,
  getCharacterCard,
  registerDemoCards,
  type PlayerId,
  type RosterConfig,
} from '../src/index.js';
import { createReadyMatch, defaultAnswer, drive, findInstance, type AutoAnswerFn } from './test-utils.js';
import type { Match } from '../src/match.js';

beforeAll(() => {
  registerDemoCards();
});

function terrainInstance(match: Match, playerId: PlayerId, cardId: string): string {
  const player = match.state.players[playerId];
  const found = player.unplayedTerrainInstanceIds.find((id) => player.terrains[id]?.cardId === cardId);
  if (!found) throw new Error(`No unplayed "${cardId}" for ${playerId}`);
  return found;
}

/**
 * « Faille dimensionnelle » est la première carte à se servir de `doesActionEndTurn`, que
 * `match.ts::runAction` ne consultait jusqu'ici pour aucune action. Le compteur, lui, ne
 * peut pas vivre dans le modifier (fonction pure) : c'est le trigger `onSwitch` de la
 * carte qui le décrémente, et seulement pour un switch demandé par le joueur.
 */
describe('Faille dimensionnelle -- le switch qui ne ferme pas le tour', () => {
  const ROSTER: RosterConfig = {
    characterCardIds: ['levi', 'gojo-satoru'],
    objectCardIds: [],
    terrainCardIds: ['faille-dimensionnelle'],
  };

  it('offre 2 switchs gratuits par camp, puis referme le tour au troisième', async () => {
    const owner: PlayerId = 'p1';
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: ROSTER, seed: 7 },
      { p1ActiveCardId: 'levi', p2ActiveCardId: 'levi' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, match.state.activePlayerId, { kind: 'pass' });

    // Poser un terrain ne ferme pas le tour : la Faille est donc utilisable dans la foulée.
    await drive(match, owner, {
      kind: 'play-terrain',
      terrainInstanceId: terrainInstance(match, owner, 'faille-dimensionnelle'),
    });
    expect(match.state.activePlayerId).toBe(owner);

    const benched = () => match.state.players[owner].benchCharacterInstanceIds[0]!;

    // 1er switch gratuit : la main reste au même joueur.
    await drive(match, owner, { kind: 'switch', newActiveInstanceId: benched() });
    expect(match.state.activePlayerId).toBe(owner);
    expect(match.state.players[owner].characters[match.state.players[owner].activeCharacterInstanceId!]!.cardId).toBe(
      'gojo-satoru'
    );

    // 2e switch gratuit : idem, et la dernière charge part avec.
    await drive(match, owner, { kind: 'switch', newActiveInstanceId: benched() });
    expect(match.state.activePlayerId).toBe(owner);

    // 3e switch : plus de charge, le tour se referme comme d'habitude.
    await drive(match, owner, { kind: 'switch', newActiveInstanceId: benched() });
    expect(match.state.activePlayerId).not.toBe(owner);
  });

  it("ne facture pas au possesseur les charges dépensées par l'adversaire", async () => {
    const owner: PlayerId = 'p1';
    const other: PlayerId = 'p2';
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: ROSTER, seed: 11 },
      { p1ActiveCardId: 'levi', p2ActiveCardId: 'levi' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, match.state.activePlayerId, { kind: 'pass' });

    const terrainId = terrainInstance(match, owner, 'faille-dimensionnelle');
    await drive(match, owner, { kind: 'play-terrain', terrainInstanceId: terrainId });
    // Le possesseur brûle ses deux charges...
    await drive(match, owner, {
      kind: 'switch',
      newActiveInstanceId: match.state.players[owner].benchCharacterInstanceIds[0]!,
    });
    await drive(match, owner, {
      kind: 'switch',
      newActiveInstanceId: match.state.players[owner].benchCharacterInstanceIds[0]!,
    });
    await drive(match, owner, { kind: 'pass' });

    // ... l'adversaire garde les siennes, comptées séparément.
    expect(match.state.activePlayerId).toBe(other);
    await drive(match, other, {
      kind: 'switch',
      newActiveInstanceId: match.state.players[other].benchCharacterInstanceIds[0]!,
    });
    expect(match.state.activePlayerId).toBe(other);

    const data = match.state.players[owner].terrains[terrainId]!.data!;
    expect(data[owner]).toBe(0);
    expect(data[other]).toBe(1);
  });
});

/**
 * 'borrowed-attack' : statut générique du moteur, prêté par « Livre de Chrollo ». Le premier
 * test pose le statut à la main pour vérifier le contrat du moteur sur une attaque connue
 * (le terrain, lui, tire au hasard) ; le second fait tourner la vraie carte de bout en bout.
 */
describe("borrowed-attack -- l'attaque prêtée par une autre carte", () => {
  const ROSTER: RosterConfig = {
    characterCardIds: ['levi', 'gojo-satoru'],
    objectCardIds: [],
    terrainCardIds: [],
  };

  it("s'ajoute aux attaques du porteur, ferme les siennes, et frappe avec SON ATK", async () => {
    const owner: PlayerId = 'p1';
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: ROSTER, seed: 3 },
      { p1ActiveCardId: 'levi', p2ActiveCardId: 'levi' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, match.state.activePlayerId, { kind: 'pass' });

    const leviId = findInstance(match, owner, 'levi');
    // Une attaque d'une carte qui n'est dans aucun des deux decks : c'est bien tout le jeu
    // qui est empruntable, pas seulement ce qui est sur la table.
    const lender = getCharacterCard('izuku-de-l-academie');
    const borrowed = lender.attacks.find((a) => a.id === 'texas-smash')!;

    match.state.players[owner].characters[leviId]!.statuses.push({
      statusId: 'borrowed-attack',
      label: `Livre de Chrollo : ${borrowed.name}`,
      remainingTurns: 2,
      ticksOnBench: true,
      data: { cardId: lender.id, attackId: borrowed.id },
    });

    // L'empruntée est là, en plus des siennes...
    const available = attacksAvailableTo(match.state, leviId).map((a) => a.id);
    expect(available).toContain(borrowed.id);
    // ... mais elle est la seule que le moteur autorise.
    for (const own of getCharacterCard('levi').attacks) {
      expect(canAttack(match.state, leviId, own.id).allow).toBe(false);
    }
    expect(canAttack(match.state, leviId, borrowed.id).allow).toBe(true);

    const enemy = match.state.players['p2'];
    const enemyActiveId = enemy.activeCharacterInstanceId!;
    const before = enemy.characters[enemyActiveId]!.damage;

    await drive(match, owner, { kind: 'attack', characterInstanceId: leviId, attackId: borrowed.id });
    expect(enemy.characters[enemyActiveId]!.damage - before).toBe(borrowed.baseATK);
  });

  it('prête pour un tour exactement, puis rend ses attaques au porteur', async () => {
    const owner: PlayerId = 'p1';
    const LIVRE_ROSTER: RosterConfig = {
      characterCardIds: ['levi', 'gojo-satoru'],
      objectCardIds: [],
      terrainCardIds: ['livre-de-chrollo'],
    };
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: LIVRE_ROSTER, p2Roster: LIVRE_ROSTER, seed: 5 },
      { p1ActiveCardId: 'levi', p2ActiveCardId: 'levi' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, match.state.activePlayerId, { kind: 'pass' });

    // Le possesseur accepte la première offre qu'on lui fait et refuse toutes les suivantes ;
    // l'adversaire referme toujours le livre, pour ne pas polluer ce qu'on observe ici.
    let ownerOffers = 0;
    const answer: AutoAnswerFn = (choice) => {
      if (choice.spec.kind !== 'select-option') return defaultAnswer(choice);
      const accept = choice.playerId === owner && ownerOffers++ === 0;
      return { kind: 'select-option', key: accept ? 'accepter' : 'refuser' };
    };

    await drive(match, owner, {
      kind: 'play-terrain',
      terrainInstanceId: terrainInstance(match, owner, 'livre-de-chrollo'),
    }, answer);

    const leviId = findInstance(match, owner, 'levi');
    const loanOn = () =>
      match.state.players[owner].characters[leviId]!.statuses.find((s) => s.statusId === 'borrowed-attack');
    // Le livre s'ouvre dès sa pose : le poseur est servi pour le tour en cours, sans quoi
    // il aurait posé un terrain dont il ne verrait rien avant deux tours.
    const loan = loanOn();
    expect(loan).toBeDefined();
    const borrowedId = String(loan!.data!['attackId']);
    expect(attacksAvailableTo(match.state, leviId).map((a) => a.id)).toContain(borrowedId);
    expect(canAttack(match.state, leviId, borrowedId).allow).toBe(true);
    // « Il ne pourra que utiliser cette attaque pendant ce tour ».
    for (const own of getCharacterCard('levi').attacks) {
      if (own.id === borrowedId) continue;
      expect(canAttack(match.state, leviId, own.id).allow).toBe(false);
    }

    // Un tour de jeu complet plus tard, le prêt est retombé et Levi retrouve sa carte.
    await drive(match, owner, { kind: 'pass' }, answer);
    await drive(match, match.state.activePlayerId, { kind: 'pass' }, answer);

    expect(match.state.activePlayerId).toBe(owner);
    expect(loanOn()).toBeUndefined();
    for (const own of getCharacterCard('levi').attacks) {
      expect(canAttack(match.state, leviId, own.id).allow).toBe(true);
    }
  });
});
