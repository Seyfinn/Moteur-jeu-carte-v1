import type { CharacterInstance, GameState, PlayerId, StatusInstance } from './types.js';
import type { EngineApi } from './engine-api.js';

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
        const amount = Number(status.data?.['amount'] ?? 0);
        if (amount > 0) {
          api.log(`${status.statusId} inflicts ${amount} damage`, { characterInstanceId: instanceId, statusId: status.statusId });
          await api.dealDamage(instanceId, amount);
        }
      }

      if (status.remainingTurns !== undefined) {
        status.remainingTurns -= 1;
      }
    }

    char.statuses = char.statuses.filter((s) => s.remainingTurns === undefined || s.remainingTurns > 0);
  }
}
