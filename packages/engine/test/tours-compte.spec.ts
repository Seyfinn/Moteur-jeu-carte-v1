import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type CharacterInstance, type PlayerId, type RosterConfig } from '../src/index.js';
import { toursCompte } from '../src/cards/demo/tours-compte.js';
import { FX_ROSTER, registerTestFixtures } from './fixtures.js';
import { createReadyMatch, drive, findInstance } from './test-utils.js';

let toursCompteRegistered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!toursCompteRegistered) {
    toursCompteRegistered = true;
    registerCard(toursCompte);
  }
});

const OWNER_ROSTER: RosterConfig = {
  characterCardIds: FX_ROSTER.characterCardIds,
  objectCardIds: ['tours-compte'],
  terrainCardIds: [],
};

const has = (char: CharacterInstance, statusId: string) => char.statuses.some((s) => s.statusId === statusId);
const ticksRemaining = (char: CharacterInstance) =>
  Number(char.statuses.find((s) => s.statusId === 'survival-vow')?.data?.['ticksRemaining'] ?? -1);

/**
 * "Tours compté" est le premier objet du jeu qui a demandé un vrai ajout au moteur : un
 * ObjectCardDef ne peut réagir à aucun event de lui-même, donc le décompte "à la fin de
 * chacun de ses 3 tours" et la récompense finale sont résolus par turn.ts::resolveSurvivalVow
 * (un nouveau statut générique, `survival-vow`), pas par une logique de carte. Ce fichier
 * couvre ce mécanisme neuf, comme les autres cartes qui en ont introduit un
 * (absorption-vitale.spec.ts pour sacrifice-revive, coeur-acier.spec.ts pour attack-charges).
 */
describe('Tours compté -- compte à rebours de 3 tours au poste actif, payé ou remis à zéro', () => {
  it('tique 10% des HP max à la fin de chacun des 3 tours du porteur, puis paie la récompense', async () => {
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: FX_ROSTER, seed: 11 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-tank' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });

    const wearerId = match.state.players[owner].activeCharacterInstanceId!;
    const wearer = () => match.state.players[owner].characters[wearerId]!;
    const enemyActiveId = match.state.players[enemy].activeCharacterInstanceId!;
    const enemyActive = () => match.state.players[enemy].characters[enemyActiveId]!;
    const enemyBaseMaxHP = enemyActive().currentMaxHP;

    const objectInstanceId = Object.values(match.state.players[owner].objects).find(
      (o) => o.cardId === 'tours-compte'
    )!.instanceId;
    await drive(match, owner, { kind: 'play-object', objectInstanceId }, (choice) => {
      if (choice.spec.kind !== 'select-characters') throw new Error('unexpected choice');
      return { kind: 'select-characters', selected: [wearerId] };
    });
    expect(has(wearer(), 'survival-vow')).toBe(true);
    expect(ticksRemaining(wearer())).toBe(3);

    // Jouer l'objet ne ferme pas le tour : il faut passer nous-mêmes pour clore le tour 1.
    await drive(match, owner, { kind: 'pass' });
    expect(wearer().damage).toBe(30); // 10% de 300 HP max
    expect(ticksRemaining(wearer())).toBe(2);
    expect(enemyActive().currentMaxHP).toBe(enemyBaseMaxHP); // pas encore de récompense

    await drive(match, enemy, { kind: 'pass' });
    await drive(match, owner, { kind: 'pass' }); // tour 2
    expect(wearer().damage).toBe(60);
    expect(ticksRemaining(wearer())).toBe(1);

    await drive(match, enemy, { kind: 'pass' });
    await drive(match, owner, { kind: 'pass' }); // tour 3 : dernier tick + récompense

    // 90 de dégâts cumulés, puis +50 de la récompense : 40 net.
    expect(wearer().damage).toBe(40);
    expect(has(wearer(), 'survival-vow')).toBe(false);
    expect(wearer().attachedObjectInstanceIds).not.toContain(objectInstanceId);
    expect(match.state.players[owner].graveyardObjectInstanceIds).toContain(objectInstanceId);

    // Réduction définitive de 150 PV max sur l'actif adverse DU MOMENT.
    expect(enemyActive().currentMaxHP).toBe(enemyBaseMaxHP - 150);
    expect(enemyActive().damage).toBe(0);
  });

  it('met le décompte en pause tant que le porteur quitte le poste actif, sans jamais le réinitialiser', async () => {
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: FX_ROSTER, seed: 12 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-tank' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });

    const wearerId = match.state.players[owner].activeCharacterInstanceId!;
    const wearer = () => match.state.players[owner].characters[wearerId]!;
    const benchId = findInstance(match, owner, 'fx-striker');

    const objectInstanceId = Object.values(match.state.players[owner].objects).find(
      (o) => o.cardId === 'tours-compte'
    )!.instanceId;
    await drive(match, owner, { kind: 'play-object', objectInstanceId }, (choice) => {
      if (choice.spec.kind !== 'select-characters') throw new Error('unexpected choice');
      return { kind: 'select-characters', selected: [wearerId] };
    });

    await drive(match, owner, { kind: 'pass' }); // tour 1, actif : tick
    expect(wearer().damage).toBe(30);
    expect(ticksRemaining(wearer())).toBe(2);

    await drive(match, enemy, { kind: 'pass' });
    // Le porteur quitte le poste actif : ce switch clôt le tour, mais SANS tick (le
    // porteur n'est plus l'actif au moment où le tour se termine).
    await drive(match, owner, { kind: 'switch', newActiveInstanceId: benchId });
    expect(wearer().damage).toBe(30);
    expect(ticksRemaining(wearer())).toBe(2);

    await drive(match, enemy, { kind: 'pass' });
    // Un tour entier au banc de plus : toujours en pause, pas réinitialisé.
    await drive(match, owner, { kind: 'pass' });
    expect(wearer().damage).toBe(30);
    expect(ticksRemaining(wearer())).toBe(2);

    await drive(match, enemy, { kind: 'pass' });
    // Retour au poste actif -- ce switch clôt aussi le tour, et le porteur EST l'actif à
    // cet instant : le décompte reprend immédiatement là où il en était.
    await drive(match, owner, { kind: 'switch', newActiveInstanceId: wearerId });
    expect(wearer().damage).toBe(60);
    expect(ticksRemaining(wearer())).toBe(1);
  });

  it("n'accorde aucune récompense si le porteur meurt sur le tick final", async () => {
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: FX_ROSTER, seed: 13 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });

    const wearerId = match.state.players[owner].activeCharacterInstanceId!;
    const wearer = () => match.state.players[owner].characters[wearerId]!;
    const enemyActiveId = match.state.players[enemy].activeCharacterInstanceId!;
    const enemyActive = () => match.state.players[enemy].characters[enemyActiveId]!;
    const enemyBaseMaxHP = enemyActive().currentMaxHP;

    const objectInstanceId = Object.values(match.state.players[owner].objects).find(
      (o) => o.cardId === 'tours-compte'
    )!.instanceId;
    await drive(match, owner, { kind: 'play-object', objectInstanceId }, (choice) => {
      if (choice.spec.kind !== 'select-characters') throw new Error('unexpected choice');
      return { kind: 'select-characters', selected: [wearerId] };
    });

    await drive(match, owner, { kind: 'pass' }); // tick 1 : 10 dégâts (10% de 100 HP max)
    await drive(match, enemy, { kind: 'pass' });
    await drive(match, owner, { kind: 'pass' }); // tick 2 : 20 cumulés
    await drive(match, enemy, { kind: 'pass' });

    // Le porteur a encaissé des dégâts par ailleurs entre-temps (ex: attaques adverses) :
    // il n'a plus que 5 HP avant le 3e tick, que le tick de 10% (10 dégâts) achève.
    expect(wearer().damage).toBe(20);
    wearer().damage = 95;

    await drive(match, owner, { kind: 'pass' }); // tick 3 : fatal

    expect(match.state.players[owner].graveyardCharacterInstanceIds).toContain(wearerId);
    // L'objet part au cimetière avec son porteur mort (mécanisme générique, indépendant du
    // vœu), mais la récompense n'a PAS été payée : l'actif adverse garde tous ses PV max.
    expect(match.state.players[owner].graveyardObjectInstanceIds).toContain(objectInstanceId);
    expect(enemyActive().currentMaxHP).toBe(enemyBaseMaxHP);
  });
});
