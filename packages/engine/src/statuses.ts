import type { CharacterInstance, GameState, PlayerId, StatusInstance } from './types.js';
import type { EngineApi } from './engine-api.js';

/** Fixed damage-per-tick formulas -- not customizable via a status's `data`. */
const BURN_DAMAGE = 50;
const POISON_FLAT_DAMAGE = 10;
const POISON_PERCENT_OF_MAX_HP = 0.1;
const BLEED_PERCENT_PER_STACK = 0.1;
const BLEED_MAX_STACKS = 10;

/** Innate rates every character has on their attacks/abilities, with no status required. */
export const BASE_EVASION_CHANCE_PERCENT = 5;
export const BASE_CRITICAL_CHANCE_PERCENT = 2;
/** Rates while the 'evasive'/'critical' status is present -- replaces the base rate, doesn't stack with it. */
export const EVASIVE_STATUS_CHANCE_PERCENT = 33;
export const CRITICAL_STATUS_CHANCE_PERCENT = 33;

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
 * "Death ward": while present, ordinary damage (dealDamage, not Valeur Lock)
 * can never bring the bearer's current HP below 1. Checked directly in
 * match.ts's dealDamage handler -- like atk-boost/atk-reduction, this is a
 * generic engine-recognized status rather than a per-card modifier, since a
 * one-shot object card's own `modifiers` stop being scanned the instant it
 * leaves play (see match.ts::handlePlayObject).
 */
export function hasDeathWard(char: CharacterInstance): boolean {
  return hasStatus(char, 'death-ward');
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

/** Multiplicative counterpart to atk-boost/atk-reduction (e.g. Adrénaline Ultime's x2) -- stacks multiplicatively, defaults to 1 (no-op) with none present. Applied after the additive boost/reduction total in getEffectiveATK. */
export function getAtkMultiplierTotal(char: CharacterInstance): number {
  return char.statuses
    .filter((s) => s.statusId === 'atk-multiplier')
    .reduce((product, s) => product * Number(s.data?.['multiplier'] ?? 1), 1);
}

/**
 * Bleed: a generic engine-recognized status (like death-ward/atk-boost) rather
 * than per-card logic. Applying it while one is already present adds stacks
 * (capped at BLEED_MAX_STACKS) instead of pushing a second entry, unlike
 * poison/burn which allow independent stacked instances. It deals its
 * stack-scaled damage once, at the start of the bearer's NEXT turn (always
 * ticks, even benched -- see tickStatusesAtTurnStart), then is consumed
 * (removed) regardless of whether it dealt damage. Any `heal()` call on the
 * bearer cures it immediately (see match.ts's `heal` handler), before it ever
 * gets to tick.
 */
export function getBleedStacks(char: CharacterInstance): number {
  return Number(getStatus(char, 'bleed')?.data?.['stacks'] ?? 0);
}

export function applyStatus(char: CharacterInstance, status: StatusInstance): void {
  if (status.statusId === 'bleed') {
    const incoming = Math.max(1, Math.round(Number(status.data?.['stacks'] ?? 1)));
    const existing = getStatus(char, 'bleed');
    if (existing) {
      const current = Number(existing.data?.['stacks'] ?? 1);
      existing.data = { ...existing.data, stacks: Math.min(BLEED_MAX_STACKS, current + incoming) };
      return;
    }
    char.statuses.push({ ...status, data: { ...status.data, stacks: Math.min(BLEED_MAX_STACKS, incoming) } });
    return;
  }
  char.statuses.push(status);
}

export function removeStatus(char: CharacterInstance, statusId: string): void {
  char.statuses = char.statuses.filter((s) => s.statusId !== statusId);
}

/**
 * Section 6: durations count down only during the AFFECTED player's own
 * turns. They're suspended while the bearer sits on the bench, except
 * Poison/Burn/Bleed which always tick (and deal their damage) at the start of
 * the affected player's turn regardless of bench/active.
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
    let bledThisTurn = false;

    for (const status of [...char.statuses]) {
      // A tick can KO the bearer (burn finishing off a low-HP character) -- once it has
      // left the board, the remaining statuses must not keep hitting the corpse or
      // counting down. Re-checked every iteration since ticks resolve asynchronously.
      if (!api.isOnBoard(instanceId)) break;
      // Another effect resolved during an awaited tick may have removed this status
      // (a heal curing bleed, a cleanse); don't tick or decrement a status that is
      // no longer on the character.
      if (!char.statuses.includes(status)) continue;

      const tickAlwaysOnBench = status.statusId === 'burn' || status.statusId === 'poison' || status.statusId === 'bleed';
      if (!isActive && !tickAlwaysOnBench) continue; // suspended while benched

      if (tickAlwaysOnBench) {
        let amount: number;
        if (status.statusId === 'burn') amount = BURN_DAMAGE;
        else if (status.statusId === 'poison') amount = POISON_FLAT_DAMAGE + Math.round(char.currentMaxHP * POISON_PERCENT_OF_MAX_HP);
        else amount = Math.round(char.currentMaxHP * BLEED_PERCENT_PER_STACK * Number(status.data?.['stacks'] ?? 1));

        if (amount > 0) {
          // Poison only: a card's modifier (e.g. Muzan's "Sang Maudit") can redirect
          // this specific tick into an unhealable max-HP loss instead -- re-checked
          // fresh every tick, so it only applies for whichever ticks currently
          // qualify (see cards/demo/muzan.ts).
          if (status.statusId === 'poison' && api.poisonTicksAsValeurLock(instanceId)) {
            api.log(`poison (Sang Maudit) reduces max HP by ${amount}`, { characterInstanceId: instanceId, statusId: status.statusId, amount });
            await api.applyValeurLock(instanceId, amount);
          } else {
            api.log(`${status.statusId} inflicts ${amount} damage`, { characterInstanceId: instanceId, statusId: status.statusId, amount });
            await api.dealDamage(instanceId, amount, { source: status.statusId });
          }
        }

        // Bleed is a one-shot delayed hit, not a countdown: it's consumed the
        // instant it ticks, regardless of remainingTurns (it has none).
        if (status.statusId === 'bleed') bledThisTurn = true;
      }

      if (status.remainingTurns !== undefined) {
        status.remainingTurns -= 1;
      }
    }

    const expired = char.statuses.filter((s) => s.remainingTurns !== undefined && s.remainingTurns <= 0);
    char.statuses = char.statuses.filter((s) => s.remainingTurns === undefined || s.remainingTurns > 0);
    if (bledThisTurn) removeStatus(char, 'bleed');

    for (const status of expired) {
      await api.emitEvent({
        name: 'onStatusExpired',
        playerId,
        data: { characterInstanceId: instanceId, statusId: status.statusId },
      });
    }
  }
}
