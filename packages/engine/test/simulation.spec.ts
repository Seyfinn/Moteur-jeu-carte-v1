import { describe, expect, it } from 'vitest';
import {
  DEMO_ROSTER,
  getCharacterCard,
  registerDemoCards,
  type Match,
  type PlayerAction,
  type PlayerId,
} from '../src/index.js';
import { createReadyMatch, settle } from './test-utils.js';

function candidateActions(match: Match, playerId: PlayerId): PlayerAction[] {
  const player = match.state.players[playerId];
  const actions: PlayerAction[] = [];
  const activeId = player.activeCharacterInstanceId;

  if (activeId) {
    const def = getCharacterCard(player.characters[activeId]!.cardId);
    for (const attack of def.attacks) {
      actions.push({ kind: 'attack', characterInstanceId: activeId, attackId: attack.id });
    }
    for (const ability of def.abilities) {
      if (!ability.trigger) actions.push({ kind: 'use-ability', characterInstanceId: activeId, abilityId: ability.id });
    }
  }
  for (const objectInstanceId of player.unplayedObjectInstanceIds) {
    actions.push({ kind: 'play-object', objectInstanceId });
  }
  for (const terrainInstanceId of player.unplayedTerrainInstanceIds) {
    actions.push({ kind: 'play-terrain', terrainInstanceId });
  }
  for (const newActiveInstanceId of player.benchCharacterInstanceIds) {
    actions.push({ kind: 'switch', newActiveInstanceId });
  }
  actions.push({ kind: 'pass' });
  return actions;
}

/** Small deterministic PRNG local to the simulation harness (independent of the engine's own RNG). */
function makeShuffler(seed: number) {
  let s = seed || 1;
  return function shuffle<T>(items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const j = s % (i + 1);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  };
}

async function playRandomGame(seed: number, actionCap: number): Promise<Match> {
  const match = await createReadyMatch({
    p1Name: 'Bot1',
    p2Name: 'Bot2',
    p1Roster: DEMO_ROSTER,
    p2Roster: DEMO_ROSTER,
    seed,
  });
  const shuffle = makeShuffler(seed + 1);

  for (let i = 0; i < actionCap && !match.state.result; i++) {
    const playerId = match.state.activePlayerId;
    const candidates = shuffle(candidateActions(match, playerId));

    let applied = false;
    for (const action of candidates) {
      const result = match.applyAction(playerId, action);
      if (result.ok) {
        applied = true;
        break;
      }
    }
    if (!applied) break; // 'pass' is always among the candidates and should always succeed
    await settle(match);
  }
  return match;
}

describe('Bot-vs-bot simulation (stability smoke test)', () => {
  it('plays many randomized full games against the demo roster without crashing or corrupting state', async () => {
    registerDemoCards();

    for (let seed = 1000; seed < 1015; seed++) {
      const match = await playRandomGame(seed, 400);

      for (const playerId of ['p1', 'p2'] as PlayerId[]) {
        const player = match.state.players[playerId];
        const rosterSize = DEMO_ROSTER.characterCardIds.length;
        const onBoard = (player.activeCharacterInstanceId ? 1 : 0) + player.benchCharacterInstanceIds.length;
        const total = onBoard + player.graveyardCharacterInstanceIds.length;
        // Characters can be created (Batman's clone) but never destroyed outright,
        // so the total in play + graveyard should never fall below the starting roster.
        expect(total).toBeGreaterThanOrEqual(rosterSize);

        for (const char of Object.values(player.characters)) {
          expect(char.currentMaxHP).toBeGreaterThan(-100000);
          expect(Number.isFinite(char.damage)).toBe(true);
        }
      }

      if (match.state.result?.kind === 'win') {
        expect(['p1', 'p2']).toContain(match.state.result.winner);
      }
    }
  }, 30000);
});
