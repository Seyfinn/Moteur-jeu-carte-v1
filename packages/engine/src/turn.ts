import type { EngineApi } from './engine-api.js';
import { tickStatusesAtTurnStart } from './statuses.js';
import { checkWinCondition, tickTerrainAtTurnStart } from './zones.js';
import { otherPlayer, type GameState, type PlayerId } from './types.js';
import { cardName } from './names.js';

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
    api.log(
      `${player.displayName} n'a plus de personnage actif : ${cardName(player.characters[promoted]?.cardId ?? '')} prend sa place`,
      { kind: 'switch', characterInstanceId: promoted },
      player.id
    );
    await api.emitEvent({
      name: 'onBecomeActive',
      playerId: player.id,
      data: { characterInstanceId: promoted, reason: 'ko-replacement' },
    });
    if (state.result) return;
  }
  // Per-turn ability budgets are refreshed for BOTH sides, not just the player whose
  // turn is starting. An active ability is only ever usable on its owner's own turn, so
  // this changes nothing for those -- but a *passive* reacting to an opponent's action
  // (afterDamage, onCharacterKO...) used to be silently blocked by the use it had
  // already spent during its own last turn, since its counter only reset two turns later.
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const side = state.players[pid];
    const ids = [side.activeCharacterInstanceId, ...side.benchCharacterInstanceIds].filter(
      (id): id is string => id !== null
    );
    for (const id of ids) {
      const char = side.characters[id];
      if (char) char.abilityUsesThisTurn = {};
    }
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
  // Un tour de jeu, c'est un tour pour les DEUX joueurs (comme aux échecs) : le compteur
  // n'avance qu'en revenant à celui qui ouvre la manche. Les durées, elles, se comptent
  // toujours en tours de leur porteur -- soit exactement une fois par manche, donc « 3
  // tours » sur une carte veut bien dire 3 tours au sens du compteur affiché.
  if (state.activePlayerId === state.startingPlayerId) state.turnNumber += 1;
  await startTurn(state, api);
}
