import { beforeAll, describe, expect, it } from 'vitest';
import { getCharacterCard, memberConditionHolds, registerDemoCards, type RosterConfig } from '../src/index.js';
import { createReadyMatch, findInstance } from './test-utils.js';

/**
 * `memberConditionHolds` est ce qui permet à la main de griser une attaque/capacité fermée
 * par son seul `condition()`. Ni `canAttack` ni `canUseAbility` ne la voient : sans elle,
 * le panneau de commandes proposait les quatre cycles d'Escanor et le serveur répondait
 * « Conditions non remplies » à trois clics sur quatre.
 */
beforeAll(() => {
  registerDemoCards();
});

const ESCANOR_ROSTER: RosterConfig = {
  characterCardIds: ['escanor', 'guts'],
  objectCardIds: [],
  terrainCardIds: [],
};

describe('évaluation à blanc des conditions (memberConditionHolds)', () => {
  it("n'ouvre qu'une seule des quatre attaques d'Escanor à la fois", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ESCANOR_ROSTER, p2Roster: ESCANOR_ROSTER, seed: 3 },
      { p1ActiveCardId: 'escanor', p2ActiveCardId: 'guts' }
    );
    const escanor = findInstance(match, 'p1', 'escanor');
    const attacks = getCharacterCard('escanor').attacks;
    expect(attacks.length).toBe(4);

    const open = attacks.filter((a) => memberConditionHolds(match.state, escanor, a));
    // Le passive `Énergie solaire` a posé le cycle 1 sur `onGameStart`.
    expect(open.map((a) => a.id)).toEqual(['cycle-1-aube']);
  });

  it('suit le cycle quand celui-ci avance', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ESCANOR_ROSTER, p2Roster: ESCANOR_ROSTER, seed: 3 },
      { p1ActiveCardId: 'escanor', p2ActiveCardId: 'guts' }
    );
    const escanorId = findInstance(match, 'p1', 'escanor');
    const escanor = match.state.players.p1.characters[escanorId]!;
    const cycle = escanor.statuses.find((s) => s.statusId === 'escanor-cycle')!;
    cycle.data = { cycle: 4 };

    const open = getCharacterCard('escanor')
      .attacks.filter((a) => memberConditionHolds(match.state, escanorId, a))
      .map((a) => a.id);
    expect(open).toEqual(['cycle-4-soleil']);
  });

  it("répond « autorisé » pour un membre sans condition, et pour une condition qui casse", async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ESCANOR_ROSTER, p2Roster: ESCANOR_ROSTER, seed: 3 },
      { p1ActiveCardId: 'escanor', p2ActiveCardId: 'guts' }
    );
    const escanor = findInstance(match, 'p1', 'escanor');

    expect(memberConditionHolds(match.state, escanor, {})).toBe(true);
    // Le contexte est en lecture seule : une condition qui tenterait de muter l'état lève,
    // et l'appelant retombe sur « autorisé » -- c'est le serveur qui tranchera pour de bon.
    const before = structuredClone(match.state.players.p1.characters[escanor]);
    expect(
      memberConditionHolds(match.state, escanor, {
        condition(ctx) {
          ctx.applyStatus(ctx.sourceInstanceId, { statusId: 'stun', label: 'triche' });
          return false;
        },
      })
    ).toBe(true);
    expect(match.state.players.p1.characters[escanor]).toEqual(before);
  });
});
