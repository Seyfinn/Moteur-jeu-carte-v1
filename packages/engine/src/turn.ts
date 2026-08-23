import type { EngineApi } from './engine-api.js';
import { tickStatusesAtTurnStart } from './statuses.js';
import { checkWinCondition, tickTerrainAtTurnStart } from './zones.js';
import { otherPlayer, type GameState } from './types.js';

export async function startTurn(state: GameState, api: EngineApi): Promise<void> {
  const player = state.players[state.activePlayerId];
  player.objectsPlayedThisTurn = 0;
  player.terrainsPlayedThisTurn = 0;

  // Invariant repair: a player holding bench characters but no active one can do
  // nothing but pass forever (every action needs an active character, and the win
  // check only looks at "any character on board"). This normally can't happen -- a KO
  // pulls a replacement immediately -- but a revive onto an empty board while the
  // active slot is vacant would leave exactly that state.
  if (player.activeCharacterInstanceId === null && player.benchCharacterInstanceIds.length > 0) {
    const promoted = player.benchCharacterInstanceIds.shift()!;
    player.activeCharacterInstanceId = promoted;
    api.log(`${player.id} has no active character: ${promoted} steps up`, { characterInstanceId: promoted }, player.id);
    await api.emitEvent({
      name: 'onBecomeActive',
      playerId: player.id,
      data: { characterInstanceId: promoted, reason: 'ko-replacement' },
    });
    if (state.result) return;
  }
  const ids = [player.activeCharacterInstanceId, ...player.benchCharacterInstanceIds].filter(
    (id): id is string => id !== null
  );
  for (const id of ids) {
    const char = player.characters[id];
    if (char) char.abilityUsesThisTurn = {};
  }

  await api.emitEvent({ name: 'onTurnStart', playerId: state.activePlayerId, data: {} });
  if (state.result) return;
  await tickStatusesAtTurnStart(state, state.activePlayerId, api);
  await tickTerrainAtTurnStart(state, state.activePlayerId, api);
  checkWinCondition(state);
}

export async function endTurn(state: GameState, api: EngineApi): Promise<void> {
  const endingPlayer = state.activePlayerId;
  state.players[endingPlayer].hasHadFirstTurn = true;
  await api.emitEvent({ name: 'onTurnEnd', playerId: endingPlayer, data: {} });
  if (state.result) return;

  state.activePlayerId = otherPlayer(endingPlayer);
  state.turnNumber += 1;
  await startTurn(state, api);
}
