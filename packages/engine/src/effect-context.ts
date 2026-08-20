import type { EffectContext } from './cards/types.js';
import type { EngineApi } from './engine-api.js';
import { isKO } from './hp.js';
import { findCharacter, getEffectiveATK } from './queries.js';
import { otherPlayer, type EngineEvent, type GameState, type PlayerId } from './types.js';

export function buildEffectContext(
  state: GameState,
  sourceInstanceId: string,
  ownerId: PlayerId,
  api: EngineApi,
  event?: EngineEvent
): EffectContext {
  const opponentId = otherPlayer(ownerId);

  function getActive(playerId: PlayerId) {
    const p = state.players[playerId];
    return p.activeCharacterInstanceId ? p.characters[p.activeCharacterInstanceId] : undefined;
  }
  function getBench(playerId: PlayerId) {
    const p = state.players[playerId];
    return p.benchCharacterInstanceIds.map((id) => p.characters[id]!);
  }

  return {
    state,
    ownerId,
    opponentId,
    sourceInstanceId,
    event,

    log(message, data) {
      api.log(message, data);
    },
    flipCoin() {
      const result = api.flipCoin();
      api.log(`Coin flip: ${result}`, { sourceInstanceId, result });
      return result;
    },

    async choose(spec) {
      const answer = await api.chooseFor(ownerId, spec);
      if (answer.kind !== 'select-characters') throw new Error('Unexpected choice answer kind');
      return answer.selected;
    },
    async chooseOption(prompt, options) {
      const answer = await api.chooseFor(ownerId, { kind: 'select-option', prompt, options });
      if (answer.kind !== 'select-option') throw new Error('Unexpected choice answer kind');
      return answer.key;
    },
    async chooseYesNo(prompt) {
      const answer = await api.chooseFor(ownerId, { kind: 'yes-no', prompt });
      if (answer.kind !== 'yes-no') throw new Error('Unexpected choice answer kind');
      return answer.value;
    },
    async chooseOrder(prompt, items) {
      const answer = await api.chooseFor(ownerId, { kind: 'order', prompt, items });
      if (answer.kind !== 'order') throw new Error('Unexpected choice answer kind');
      return answer.orderedKeys;
    },

    getCharacter(instanceId) {
      return findCharacter(state, instanceId);
    },
    getObject(instanceId) {
      for (const pid of ['p1', 'p2'] as PlayerId[]) {
        const obj = state.players[pid].objects[instanceId];
        if (obj) return obj;
      }
      throw new Error(`Unknown object instance "${instanceId}"`);
    },
    getTerrain(instanceId) {
      for (const pid of ['p1', 'p2'] as PlayerId[]) {
        const terrain = state.players[pid].terrains[instanceId];
        if (terrain) return terrain;
      }
      throw new Error(`Unknown terrain instance "${instanceId}"`);
    },
    getActive,
    getBench,
    getAllOnBoard(playerId) {
      const active = getActive(playerId);
      const bench = getBench(playerId);
      return active ? [active, ...bench] : bench;
    },
    isKO(characterInstanceId) {
      return isKO(findCharacter(state, characterInstanceId));
    },

    async dealDamage(targetInstanceId, amount) {
      await api.dealDamage(targetInstanceId, amount);
    },
    async applyValeurLock(targetInstanceId, amount) {
      await api.applyValeurLock(targetInstanceId, amount);
    },
    heal(targetInstanceId, amount) {
      api.heal(targetInstanceId, amount);
    },
    raiseMaxHP(targetInstanceId, amount) {
      api.raiseMaxHP(targetInstanceId, amount);
    },

    applyStatus(targetInstanceId, status) {
      api.applyStatus(targetInstanceId, status);
    },
    removeStatus(targetInstanceId, statusId) {
      api.removeStatus(targetInstanceId, statusId);
    },

    getEffectiveATK(characterInstanceId, baseATK) {
      return getEffectiveATK(state, characterInstanceId, baseATK);
    },

    swapBenchCharacters(forPlayer, ownBenchInstanceId, enemyBenchInstanceId) {
      api.swapBenchCharacters(forPlayer, ownBenchInstanceId, enemyBenchInstanceId);
    },

    attachSelfTo(targetCharacterInstanceId) {
      api.attachObject(sourceInstanceId, targetCharacterInstanceId);
    },

    async forceSwitch(playerId, newActiveInstanceId) {
      await api.switchActive(playerId, newActiveInstanceId);
    },

    cloneCharacter(sourceCharInstanceId, hp, placement) {
      const cloneOwner = findCharacter(state, sourceCharInstanceId).ownerId;
      return api.cloneCharacter(cloneOwner, sourceCharInstanceId, hp, placement);
    },
  };
}
