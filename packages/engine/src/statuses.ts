import type { CharacterInstance, GameState, PlayerId, StatusInstance } from './types.js';
import type { EngineApi } from './engine-api.js';
import { chancePercent } from './rng.js';

/** Fixed damage-per-tick formulas -- not customizable via a status's `data`. */
const BURN_DAMAGE = 50;
const POISON_FLAT_DAMAGE = 10;
const POISON_PERCENT_OF_MAX_HP = 0.1;

/** Innate rates every character has on their attacks/abilities, with no status required. */
const BASE_EVASION_CHANCE_PERCENT = 5;
const BASE_CRITICAL_CHANCE_PERCENT = 2;
/** Rates while the 'evasive'/'critical' status is present -- replaces the base rate, doesn't stack with it. */
const EVASIVE_STATUS_CHANCE_PERCENT = 33;
const CRITICAL_STATUS_CHANCE_PERCENT = 33;

export function hasStatus(char: CharacterInstance, statusId: string): boolean {
  return char.statuses.some((s) => s.statusId === statusId);
}

export function getStatus(char: CharacterInstance, statusId: string): StatusInstance | undefined {
  return char.statuses.find((s) => s.statusId === statusId);
}

export function isStunned(char: CharacterInstance): boolean {
  return hasStatus(char, 'stun');
}

export function isDisarmed(char: CharacterInstance): boolean {
  return hasStatus(char, 'disarmed');
}

export function isEvasive(char: CharacterInstance): boolean {
  return hasStatus(char, 'evasive');
}

export function isCritical(char: CharacterInstance): boolean {
  return hasStatus(char, 'critical');
}

/**
 * Esquive: every character has a base 5% chance to fully negate an incoming
 * attack/ability (damage or status application), no status required. The
 * 'evasive' status raises that to 33% while it's present (it replaces the
 * base rate rather than stacking with it). Never consumed on a successful roll.
 */
export function rollEvasion(state: GameState, char: CharacterInstance): boolean {
  const percent = isEvasive(char) ? EVASIVE_STATUS_CHANCE_PERCENT : BASE_EVASION_CHANCE_PERCENT;
  return chancePercent(state.rng, percent);
}

/**
 * Critique: every character has a base 2% chance for an attack/ability they
 * deal damage with to double. The 'critical' status raises that to 33% while
 * it's present (replaces the base rate, doesn't stack with it) -- unless the
 * status carries its own `data.percent` (e.g. Caitlyn's "Execution" granting
 * herself a custom rate instead of the generic 33%), in which case that value
 * is used instead.
 */
export function rollCritical(state: GameState, char: CharacterInstance): boolean {
  const status = char.statuses.find((s) => s.statusId === 'critical');
  const percent = status ? Number(status.data?.['percent'] ?? CRITICAL_STATUS_CHANCE_PERCENT) : BASE_CRITICAL_CHANCE_PERCENT;
  return chancePercent(state.rng, percent);
}

export function isSilencedActive(char: CharacterInstance): boolean {
  return hasStatus(char, 'silence-active') || hasStatus(char, 'silence-ultimate');
}

export function isSilencedPassive(char: CharacterInstance): boolean {
  return hasStatus(char, 'silence-passive') || hasStatus(char, 'silence-ultimate');
}

export function getAtkReductionTotal(char: CharacterInstance): number {
  return char.statuses
    .filter((s) => s.statusId === 'atk-reduction')
    .reduce((sum, s) => sum + Number(s.data?.['amount'] ?? 0), 0);
}

/** Symmetric counterpart to getAtkReductionTotal: sums every active "atk-boost" status's { amount }. */
export function getAtkBoostTotal(char: CharacterInstance): number {
  return char.statuses
    .filter((s) => s.statusId === 'atk-boost')
    .reduce((sum, s) => sum + Number(s.data?.['amount'] ?? 0), 0);
}

export function applyStatus(char: CharacterInstance, status: StatusInstance): void {
  char.statuses.push(status);
}

export function removeStatus(char: CharacterInstance, statusId: string): void {
  char.statuses = char.statuses.filter((s) => s.statusId !== statusId);
}

/**
 * Section 6: durations count down only during the AFFECTED player's own
 * turns. They're suspended while the bearer sits on the bench, except
 * Poison/Burn which always tick (and deal their damage) at the start of the
 * affected player's turn regardless of bench/active.
 */
export async function tickStatusesAtTurnStart(state: GameState, playerId: PlayerId, api: EngineApi): Promise<void> {
  const player = state.players[playerId];
  const allInstanceIds = [player.activeCharacterInstanceId, ...player.benchCharacterInstanceIds].filter(
    (id): id is string => id !== null
  );

  for (const instanceId of allInstanceIds) {
    const char = player.characters[instanceId];
    if (!char) continue;
    const isActive = instanceId === player.activeCharacterInstanceId;

    for (const status of [...char.statuses]) {
      const tickAlwaysOnBench = status.statusId === 'burn' || status.statusId === 'poison';
      if (!isActive && !tickAlwaysOnBench) continue; // suspended while benched

      if (tickAlwaysOnBench) {
        const amount =
          status.statusId === 'burn' ? BURN_DAMAGE : POISON_FLAT_DAMAGE + Math.round(char.currentMaxHP * POISON_PERCENT_OF_MAX_HP);
        if (amount > 0) {
          api.log(`${status.statusId} inflicts ${amount} damage`, { characterInstanceId: instanceId, statusId: status.statusId, amount });
          await api.dealDamage(instanceId, amount, { source: status.statusId });
        }
      }

      if (status.remainingTurns !== undefined) {
        status.remainingTurns -= 1;
      }
    }

    char.statuses = char.statuses.filter((s) => s.remainingTurns === undefined || s.remainingTurns > 0);
  }
}
