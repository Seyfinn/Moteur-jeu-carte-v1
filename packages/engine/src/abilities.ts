import type { CharacterInstance } from './types.js';

export function recordAbilityUse(char: CharacterInstance, abilityId: string): void {
  char.abilityUsesThisTurn[abilityId] = (char.abilityUsesThisTurn[abilityId] ?? 0) + 1;
  char.abilityUsesThisGame[abilityId] = (char.abilityUsesThisGame[abilityId] ?? 0) + 1;
}
