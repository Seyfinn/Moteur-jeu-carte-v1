import { beforeAll, describe, expect, it } from 'vitest';
import { registerCard, type Match, type PlayerId, type RosterConfig } from '../src/index.js';
import { makima } from '../src/cards/demo/makima.js';
import { registerTestFixtures } from './fixtures.js';
import { createReadyMatch, drive } from './test-utils.js';

let registered = false;
beforeAll(() => {
  registerTestFixtures();
  if (!registered) {
    registered = true;
    registerCard(makima);
  }
});

async function ensureTurn(match: Match, playerId: PlayerId): Promise<void> {
  if (match.state.activePlayerId !== playerId) {
    await drive(match, match.state.activePlayerId, { kind: 'pass' });
  }
}

const ROSTER: RosterConfig = { characterCardIds: [makima.id, 'fx-striker'], objectCardIds: [], terrainCardIds: [] };
const P2_ROSTER: RosterConfig = { characterCardIds: ['fx-tank', 'fx-stunner'], objectCardIds: [], terrainCardIds: [] };

describe('Match.cancelPendingChoice (accidental ability/attack click)', () => {
  it('undoes the whole action -- log entry, ability use-count and pending choice all gone', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: P2_ROSTER, seed: 7 },
      { p1ActiveCardId: makima.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const makimaId = match.state.players.p1.activeCharacterInstanceId!;
    const logLengthBefore = match.state.log.length;

    const result = match.applyAction('p1', { kind: 'use-ability', characterInstanceId: makimaId, abilityId: 'sacrifice' });
    expect(result.ok).toBe(true);
    await match.waitForNextPause();

    const pending = match.state.pendingChoice;
    expect(pending).toBeDefined();
    expect(pending!.spec.kind).toBe('select-characters'); // Sacrifice's first prompt: who on the bench
    expect(pending!.cancellable).toBe(true);

    expect(match.cancelPendingChoice('p1')).toEqual({ ok: true });
    await match.waitForNextPause();

    expect(match.state.pendingChoice).toBeUndefined();
    expect(match.state.log.length).toBe(logLengthBefore); // the "utilise Sacrifice" entry is gone with it

    // The use was never really consumed: the ability can be triggered again right away.
    const secondAttempt = match.applyAction('p1', { kind: 'use-ability', characterInstanceId: makimaId, abilityId: 'sacrifice' });
    expect(secondAttempt.ok).toBe(true);
    await match.waitForNextPause();
    expect(match.state.pendingChoice).toBeDefined();
  });

  it('refuses a cancel from anyone other than the player who started the action', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: P2_ROSTER, seed: 7 },
      { p1ActiveCardId: makima.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const makimaId = match.state.players.p1.activeCharacterInstanceId!;

    match.applyAction('p1', { kind: 'use-ability', characterInstanceId: makimaId, abilityId: 'sacrifice' });
    await match.waitForNextPause();

    expect(match.cancelPendingChoice('p2')).toEqual({ ok: false, error: "Ce choix n'est pas le vôtre" });
    expect(match.state.pendingChoice).toBeDefined(); // untouched
  });

  it('refuses to cancel once nothing is pending any more', async () => {
    const match = await createReadyMatch(
      { p1Name: 'A', p2Name: 'B', p1Roster: ROSTER, p2Roster: P2_ROSTER, seed: 7 },
      { p1ActiveCardId: makima.id, p2ActiveCardId: 'fx-tank' }
    );
    await ensureTurn(match, 'p1');
    const result = match.cancelPendingChoice('p1');
    expect(result).toEqual({ ok: false, error: 'Aucun choix en attente' });
  });
});
