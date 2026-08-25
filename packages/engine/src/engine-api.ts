import type { CoinResult, RngState } from './rng.js';
import type { EffectContext } from './cards/types.js';
import type {
  ChoiceAnswer,
  ChoiceSpec,
  DealDamageOptions,
  EngineEvent,
  PlayerId,
  RaiseMaxHPOptions,
  StatusInstance,
} from './types.js';

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
  applyValeurLock(targetInstanceId: string, amount: number, options?: DealDamageOptions): Promise<void>;
  /** Lets a card's modifier (query 'poisonTicksAsValeurLock') redirect a poison tick into an unhealable max-HP loss instead of ordinary damage -- checked fresh at every tick. */
  poisonTicksAsValeurLock(targetInstanceId: string): boolean;
  heal(targetInstanceId: string, amount: number): void;
  raiseMaxHP(targetInstanceId: string, amount: number, options?: RaiseMaxHPOptions): void;
  addShield(targetInstanceId: string, amount: number): void;
  removeShield(targetInstanceId: string, amount?: number): void;
  applyStatus(targetInstanceId: string, status: StatusInstance): void;
  removeStatus(targetInstanceId: string, statusId: string): void;

  /** `killerInstanceId` is forwarded to the onCharacterKO payload when the kill can be attributed. */
  koCharacter(characterInstanceId: string, killerInstanceId?: string): Promise<void>;
  /** Pulls a character back out of its own graveyard, at `hp` (clamped to its current ceiling), statuses/shield cleared, placed active or bench. Emits onCharacterRevived. */
  reviveCharacter(characterInstanceId: string, hp: number, placement: 'active' | 'bench'): Promise<void>;
  swapBenchCharacters(forPlayer: PlayerId, ownBenchInstanceId: string, enemyBenchInstanceId: string): void;
  attachObject(objectInstanceId: string, targetCharacterInstanceId: string): void;
  destroyObject(objectInstanceId: string): void;
  extendTerrain(terrainInstanceId: string, turns: number): void;
  shortenTerrain(terrainInstanceId: string, turns: number): Promise<void>;
  destroyTerrain(terrainInstanceId: string): Promise<void>;
  switchActive(playerId: PlayerId, newActiveInstanceId: string): Promise<void>;
  cloneCharacter(ownerId: PlayerId, sourceInstanceId: string, hp: number, placement: 'active' | 'bench'): string;
  /** Creates a brand-new object instance of `cardId` for `ownerId`, added straight to their unplayed pool. Returns the new instance id. */
  createObject(ownerId: PlayerId, cardId: string): string;

  emitEvent(event: EngineEvent): Promise<void>;
  chooseFor(playerId: PlayerId, spec: ChoiceSpec): Promise<ChoiceAnswer>;
  log(message: string, data?: Record<string, unknown>, playerId?: PlayerId): void;
  flipCoin(): CoinResult;

  /** True once a character has left the board (graveyard) -- guards effects from hitting a corpse. */
  isOnBoard(characterInstanceId: string): boolean;

  /**
   * `damageSource` gates critique/esquive (both innate and status-driven) --
   * 'other' (object-card effects) is never eligible, 'attack'/'ability' both
   * are. It also lets dealDamage distinguish a literal attack from an
   * ability's damage for attack-only effects (e.g. "Concentration"'s
   * one-shot crit-or-nothing gamble). Defaults to 'ability'.
   */
  buildEffectContext(
    sourceInstanceId: string,
    ownerId: PlayerId,
    event?: EngineEvent,
    damageSource?: 'attack' | 'ability' | 'other'
  ): EffectContext;
}
