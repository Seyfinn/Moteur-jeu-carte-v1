import type { EngineApi } from './engine-api.js';
import { tickStatusesAtTurnStart } from './statuses.js';
import { checkWinCondition } from './zones.js';
import { otherPlayer, type GameState } from './types.js';

export async function startTurn(state: GameState, api: EngineApi): Promise<void> {
  const player = state.players[state.activePlayerId];
  player.objectsPlayedThisTurn = 0;
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
