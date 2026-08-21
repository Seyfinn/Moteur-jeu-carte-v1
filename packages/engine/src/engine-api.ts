import type { CoinResult, RngState } from './rng.js';
import type { EffectContext } from './cards/types.js';
import type { ChoiceAnswer, ChoiceSpec, DealDamageOptions, EngineEvent, PlayerId, StatusInstance } from './types.js';

/**
 * Every module that needs to "call back up" into cross-cutting behaviour
 * (emit an event, ask a player to choose, cascade a KO, ...) receives this
 * interface as a parameter instead of importing the modules that implement
 * it. `match.ts` is the only file that wires up a concrete implementation,
 * which breaks what would otherwise be an import cycle between
 * zones/statuses/events/effect-context.
 */
export interface EngineApi {
  rng: RngState;

  dealDamage(targetInstanceId: string, amount: number, options?: DealDamageOptions): Promise<void>;
  applyValeurLock(targetInstanceId: string, amount: number): Promise<void>;
  heal(targetInstanceId: string, amount: number): void;
  raiseMaxHP(targetInstanceId: string, amount: number): void;
  addShield(targetInstanceId: string, amount: number): void;
  removeShield(targetInstanceId: string, amount?: number): void;
  applyStatus(targetInstanceId: string, status: StatusInstance): void;
  removeStatus(targetInstanceId: string, statusId: string): void;

  koCharacter(characterInstanceId: string): Promise<void>;
  swapBenchCharacters(forPlayer: PlayerId, ownBenchInstanceId: string, enemyBenchInstanceId: string): void;
  attachObject(objectInstanceId: string, targetCharacterInstanceId: string): void;
  destroyObject(objectInstanceId: string): void;
  extendTerrain(terrainInstanceId: string, turns: number): void;
  shortenTerrain(terrainInstanceId: string, turns: number): Promise<void>;
  switchActive(playerId: PlayerId, newActiveInstanceId: string): Promise<void>;
  cloneCharacter(ownerId: PlayerId, sourceInstanceId: string, hp: number, placement: 'active' | 'bench'): string;

  emitEvent(event: EngineEvent): Promise<void>;
  chooseFor(playerId: PlayerId, spec: ChoiceSpec): Promise<ChoiceAnswer>;
  log(message: string, data?: Record<string, unknown>): void;
  flipCoin(): CoinResult;

  /**
   * `isAttackOrAbility` gates critique/esquive (both innate and status-driven):
   * true for attacks and character/terrain abilities, false for object-card
   * effects, which are never eligible. Defaults to true.
   */
  buildEffectContext(sourceInstanceId: string, ownerId: PlayerId, event?: EngineEvent, isAttackOrAbility?: boolean): EffectContext;
}
