import { beforeAll, describe, expect, it } from 'vitest';
import { registerDemoCards, type PlayerId, type RosterConfig } from '../src/index.js';
import { createReadyMatch, drive, findInstance } from './test-utils.js';

beforeAll(() => {
  registerDemoCards();
});

const ROSTER: RosterConfig = {
  characterCardIds: ['chopper', 'gojo-satoru'],
  objectCardIds: [],
  terrainCardIds: [],
};

/**
 * « Rechargement : N tours » compte des tours, pas des tours passés au poste actif. Sans
 * `ticksOnBench` sur le statut de recharge, un personnage mis de côté gelait son propre
 * compte à rebours -- et une ability faite pour être utilisée depuis le banc (la Traque de
 * Chopper) ne revenait jamais.
 */
describe('recharge d\'ability au banc', () => {
  it('décompte la recharge de Traque pendant que Chopper reste au banc', async () => {
    const owner: PlayerId = 'p1';
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: ROSTER, seed: 21 },
      { p1ActiveCardId: 'gojo-satoru', p2ActiveCardId: 'gojo-satoru' }
    );
    if (match.state.activePlayerId !== owner) await drive(match, match.state.activePlayerId, { kind: 'pass' });

    const chopperId = findInstance(match, owner, 'chopper');
    expect(match.state.players[owner].benchCharacterInstanceIds).toContain(chopperId);

    await drive(match, owner, { kind: 'use-ability', characterInstanceId: chopperId, abilityId: 'traque' });

    const cooldown = () =>
      match.state.players[owner].characters[chopperId]!.statuses.find((s) => s.statusId === 'chopper-traque-cooldown');
    // 6 tours de rechargement + 1 : le statut est posé pendant le tour de son porteur, donc
    // le tic du début de ce même tour est déjà passé (cf. CLAUDE.md).
    expect(cooldown()?.remainingTurns).toBe(7);

    const passRound = async () => {
      await drive(match, match.state.activePlayerId, { kind: 'pass' });
      await drive(match, match.state.activePlayerId, { kind: 'pass' });
    };

    await passRound();
    expect(match.state.players[owner].benchCharacterInstanceIds).toContain(chopperId);
    expect(cooldown()?.remainingTurns).toBe(6);

    for (let i = 0; i < 5; i++) await passRound();
    expect(cooldown()?.remainingTurns).toBe(1);

    await passRound();
    expect(cooldown()).toBeUndefined();
    // Toujours au banc : la recharge s'est bien faite sans jamais passer par le poste actif.
    expect(match.state.players[owner].benchCharacterInstanceIds).toContain(chopperId);
  });
});
