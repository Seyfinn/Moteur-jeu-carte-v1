import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type CharacterInstance, type PlayerId, type RosterConfig } from '../src/index.js';
import { chasseurDePrime } from '../src/cards/demo/chasseur-de-prime.js';
import { FX_ROSTER, TINY_ROSTER, fxGlass, registerTestFixtures } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

let chasseurDePrimeRegistered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!chasseurDePrimeRegistered) {
    chasseurDePrimeRegistered = true;
    registerCard(chasseurDePrime);
  }
});

const OWNER_ROSTER: RosterConfig = {
  characterCardIds: FX_ROSTER.characterCardIds,
  objectCardIds: ['chasseur-de-prime'],
  terrainCardIds: [],
};

/** Comme TINY_ROSTER, mais avec un 3e fx-glass pour ne pas éliminer p2 en 2 KO. */
const THREE_GLASS_ROSTER: RosterConfig = {
  characterCardIds: [fxGlass.id, fxGlass.id, fxGlass.id],
  objectCardIds: [],
  terrainCardIds: [],
};

const has = (char: CharacterInstance, statusId: string) => char.statuses.some((s) => s.statusId === statusId);
const bountyCount = (char: CharacterInstance) =>
  Number(char.statuses.find((s) => s.statusId === 'bounty-vow')?.data?.['count'] ?? -1);

/**
 * "Chasseur de prime" est le 2e objet de ce lot qui a demandé un ajout moteur : le compteur
 * de KO vit dans zones.ts::resolveBountyVow (rappelé au seul endroit qui connaît déjà
 * `killerInstanceId`), sur le même principe que 'crit-streak'.
 */
describe('Chasseur de prime -- +40 ATK / +50 Shield définitifs après 2 KO ennemis', () => {
  it('récompense au 2e KO ennemi, puis détruit l’objet', async () => {
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: TINY_ROSTER, seed: 21 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-glass' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });

    const wearerId = match.state.players[owner].activeCharacterInstanceId!;
    const wearer = () => match.state.players[owner].characters[wearerId]!;

    const objectInstanceId = Object.values(match.state.players[owner].objects).find(
      (o) => o.cardId === 'chasseur-de-prime'
    )!.instanceId;
    await drive(match, owner, { kind: 'play-object', objectInstanceId }, (choice) => {
      if (choice.spec.kind !== 'select-characters') throw new Error('unexpected choice');
      return { kind: 'select-characters', selected: [wearerId] };
    });
    expect(has(wearer(), 'bounty-vow')).toBe(true);
    expect(bountyCount(wearer())).toBe(0);

    // fx-tank's "poke" (10) one-shots a 10-HP fx-glass.
    await drive(match, owner, { kind: 'attack', characterInstanceId: wearerId, attackId: 'poke' });
    expect(bountyCount(wearer())).toBe(1);
    expect(has(wearer(), 'atk-boost')).toBe(false);

    await drive(match, enemy, { kind: 'pass' });
    await drive(match, owner, { kind: 'attack', characterInstanceId: wearerId, attackId: 'poke' });

    expect(has(wearer(), 'bounty-vow')).toBe(false);
    expect(has(wearer(), 'atk-boost')).toBe(true);
    expect(wearer().statuses.find((s) => s.statusId === 'atk-boost')?.data?.['amount']).toBe(40);
    expect(wearer().shield).toBe(50);
    expect(wearer().attachedObjectInstanceIds).not.toContain(objectInstanceId);
    expect(match.state.players[owner].graveyardObjectInstanceIds).toContain(objectInstanceId);
  });

  it("ne compte pas les KO réalisés avant l'équipement de l'objet", async () => {
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: THREE_GLASS_ROSTER, seed: 22 },
      { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-glass' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });

    const wearerId = match.state.players[owner].activeCharacterInstanceId!;
    const wearer = () => match.state.players[owner].characters[wearerId]!;

    // 1er KO, avant même de porter l'objet : ne doit jamais compter dans le vœu.
    await drive(match, owner, { kind: 'attack', characterInstanceId: wearerId, attackId: 'poke' });
    await drive(match, enemy, { kind: 'pass' });

    const objectInstanceId = Object.values(match.state.players[owner].objects).find(
      (o) => o.cardId === 'chasseur-de-prime'
    )!.instanceId;
    await drive(match, owner, { kind: 'play-object', objectInstanceId }, (choice) => {
      if (choice.spec.kind !== 'select-characters') throw new Error('unexpected choice');
      return { kind: 'select-characters', selected: [wearerId] };
    });
    expect(bountyCount(wearer())).toBe(0);

    // 2e KO au total, mais 1er depuis l'équipement : ne doit PAS encore récompenser.
    await drive(match, owner, { kind: 'attack', characterInstanceId: wearerId, attackId: 'poke' });
    expect(bountyCount(wearer())).toBe(1);
    expect(has(wearer(), 'atk-boost')).toBe(false);

    await drive(match, enemy, { kind: 'pass' });
    // 3e KO au total, 2e depuis l'équipement : cette fois la récompense tombe.
    await drive(match, owner, { kind: 'attack', characterInstanceId: wearerId, attackId: 'poke' });
    expect(has(wearer(), 'bounty-vow')).toBe(false);
    expect(has(wearer(), 'atk-boost')).toBe(true);
  });
});
