import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type CharacterInstance, type PlayerId, type RosterConfig } from '../src/index.js';
import { coeurAcier } from '../src/cards/demo/coeur-acier.js';
import { FX_ROSTER, registerTestFixtures } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

let coeurAcierRegistered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!coeurAcierRegistered) {
    coeurAcierRegistered = true;
    registerCard(coeurAcier);
  }
});

const OWNER_ROSTER: RosterConfig = {
  characterCardIds: FX_ROSTER.characterCardIds,
  objectCardIds: [],
  terrainCardIds: ['coeur-acier'],
};

const has = (char: CharacterInstance, statusId: string) => char.statuses.some((s) => s.statusId === statusId);

/**
 * Deux bugs de la carte, plus la marque visible qui les rend lisibles en jeu :
 * la prime rendait aussi les PV perdus (« pas de soin » dit pourtant la carte), et la
 * marque se rechargeait toute seule au tour suivant, payant la prime encore et encore.
 */
describe('Coeur acier -- prime en HP max, puis remise à zéro de la marque', () => {
  it('marque, charge, paie sans soigner, puis repart d\'une marque neuve', async () => {
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: FX_ROSTER, seed: 7 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });

    const attackerId = match.state.players[owner].activeCharacterInstanceId!;
    const targetId = match.state.players[enemy].activeCharacterInstanceId!;
    const attacker = () => match.state.players[owner].characters[attackerId]!;
    const target = () => match.state.players[enemy].characters[targetId]!;
    const baseMaxHP = attacker().currentMaxHP;

    // L'attaquant est blessé : c'est ce qui permet de voir si la prime le soigne au passage.
    attacker().damage = 40;

    // Pose : la marque est posée et VISIBLE, mais pas encore chargée.
    const terrainInstanceId = Object.values(match.state.players[owner].terrains).find(
      (t) => t.cardId === 'coeur-acier'
    )!.instanceId;
    await drive(match, owner, { kind: 'play-terrain', terrainInstanceId });
    expect(has(target(), 'coeur-acier-mark')).toBe(true);
    expect(has(target(), 'hit-bounty')).toBe(false);

    // Tour suivant du poseur : même cible, la marque se charge (et l'icône change).
    await drive(match, owner, { kind: 'pass' });
    await drive(match, enemy, { kind: 'pass' });
    expect(has(target(), 'hit-bounty')).toBe(true);
    expect(has(target(), 'coeur-acier-mark')).toBe(false);

    // L'attaque encaisse la prime : +150 HP max, et PAS un PV rendu.
    await drive(match, owner, { kind: 'attack', characterInstanceId: attackerId, attackId: 'strike' });
    expect(attacker().currentMaxHP).toBe(baseMaxHP + 150);
    expect(attacker().currentMaxHP - attacker().damage).toBe(baseMaxHP - 40);
    expect(has(target(), 'hit-bounty')).toBe(false);

    // Tour suivant : la marque repart de zéro au lieu de se recharger dans la foulée.
    await drive(match, enemy, { kind: 'pass' });
    expect(has(target(), 'coeur-acier-mark')).toBe(true);
    expect(has(target(), 'hit-bounty')).toBe(false);

    // Et une deuxième attaque dans ce même tour ne rapporte donc rien de plus.
    await drive(match, owner, { kind: 'attack', characterInstanceId: attackerId, attackId: 'strike' });
    expect(attacker().currentMaxHP).toBe(baseMaxHP + 150);

    // Il faut bien attendre un tour de plus pour que la marque se recharge.
    await drive(match, enemy, { kind: 'pass' });
    expect(has(target(), 'hit-bounty')).toBe(true);
  });

  it('déplace la marque quand l\'adversaire change d\'actif', async () => {
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: FX_ROSTER, seed: 8 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });

    const firstTargetId = match.state.players[enemy].activeCharacterInstanceId!;
    const terrainInstanceId = Object.values(match.state.players[owner].terrains).find(
      (t) => t.cardId === 'coeur-acier'
    )!.instanceId;
    await drive(match, owner, { kind: 'play-terrain', terrainInstanceId });
    await drive(match, owner, { kind: 'pass' });

    const newActiveInstanceId = match.state.players[enemy].benchCharacterInstanceIds[0]!;
    await drive(match, enemy, { kind: 'switch', newActiveInstanceId });

    expect(match.state.players[enemy].characters[firstTargetId]!.statuses).toEqual([]);
    expect(has(match.state.players[enemy].characters[newActiveInstanceId]!, 'coeur-acier-mark')).toBe(true);
  });
});
