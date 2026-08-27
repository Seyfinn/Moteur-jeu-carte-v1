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
  objectCardIds: ['coeur-acier'],
  terrainCardIds: [],
};

const has = (char: CharacterInstance, statusId: string) => char.statuses.some((s) => s.statusId === statusId);

/**
 * Nouvelle mouture de Coeur acier (objet à lier, plus terrain) : les 3 prochaines
 * attaques du porteur lui rapportent +35 HP max, PV actuels compris (contrairement à
 * l'ancienne prime "hit-bounty" qui ne touchait pas au HP actuels).
 */
describe('Coeur acier -- 3 charges de +35 HP max sur les propres attaques du porteur', () => {
  it('accorde +35 HP max (PV compris) sur chacune des 3 prochaines attaques, puis plus rien', async () => {
    const owner: PlayerId = 'p1';
    const enemy: PlayerId = 'p2';
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: OWNER_ROSTER, p2Roster: FX_ROSTER, seed: 7 },
      { p1ActiveCardId: 'fx-striker', p2ActiveCardId: 'fx-tank' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, enemy, { kind: 'pass' });

    const attackerId = match.state.players[owner].activeCharacterInstanceId!;
    const attacker = () => match.state.players[owner].characters[attackerId]!;
    const baseMaxHP = attacker().currentMaxHP;

    // L'attaquant est blessé : le buff doit remonter les PV actuels avec le plafond
    // (contrairement à l'ancienne prime "sans soin").
    attacker().damage = 40;

    const objectInstanceId = Object.values(match.state.players[owner].objects).find(
      (o) => o.cardId === 'coeur-acier'
    )!.instanceId;
    await drive(match, owner, { kind: 'play-object', objectInstanceId }, (choice) => {
      if (choice.spec.kind !== 'select-characters') throw new Error('unexpected choice');
      return { kind: 'select-characters', selected: [attackerId] };
    });
    expect(has(attacker(), 'attack-charges')).toBe(true);

    // Jouer l'objet ne ferme pas le tour : l'attaque qui suit est bien la première des 3.
    await drive(match, owner, { kind: 'attack', characterInstanceId: attackerId, attackId: 'strike' });
    expect(attacker().currentMaxHP).toBe(baseMaxHP + 35);
    expect(attacker().currentMaxHP - attacker().damage).toBe(baseMaxHP - 40 + 35);
    expect(has(attacker(), 'attack-charges')).toBe(true);

    await drive(match, enemy, { kind: 'pass' });
    await drive(match, owner, { kind: 'attack', characterInstanceId: attackerId, attackId: 'strike' });
    expect(attacker().currentMaxHP).toBe(baseMaxHP + 70);
    expect(has(attacker(), 'attack-charges')).toBe(true);

    // Troisième et dernière charge : le statut ET l'objet (équipé) disparaissent.
    await drive(match, enemy, { kind: 'pass' });
    await drive(match, owner, { kind: 'attack', characterInstanceId: attackerId, attackId: 'strike' });
    expect(attacker().currentMaxHP).toBe(baseMaxHP + 105);
    expect(has(attacker(), 'attack-charges')).toBe(false);
    expect(attacker().attachedObjectInstanceIds).not.toContain(objectInstanceId);
    expect(match.state.players[owner].graveyardObjectInstanceIds).toContain(objectInstanceId);

    // Une 4e attaque, sans charge restante, ne rapporte plus rien.
    await drive(match, enemy, { kind: 'pass' });
    await drive(match, owner, { kind: 'attack', characterInstanceId: attackerId, attackId: 'strike' });
    expect(attacker().currentMaxHP).toBe(baseMaxHP + 105);
  });
});
