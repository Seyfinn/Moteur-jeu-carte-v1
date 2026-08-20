import type { CharacterInstance } from './types.js';

/**
 * HP model (section 5 of the rules): currentMaxHP can be permanently reduced
 * by "valeur lock" effects and is never restored by healing. Ordinary damage
 * only ever eats into `damage`, which heals normally, and can never push
 * `damage` below 0 or above `currentMaxHP`.
 */
export function getCurrentHP(char: CharacterInstance): number {
  return char.currentMaxHP - char.damage;
}

export function isKO(char: CharacterInstance): boolean {
  return getCurrentHP(char) <= 0;
}

/** Ordinary damage: reduces current HP only, stays healable. */
export function dealDamage(char: CharacterInstance, amount: number): void {
  if (amount <= 0) return;
  char.damage += amount;
}

/** "Valeur lock": permanently reduces max HP. Never healable. Can push HP to/below 0 (KO). */
export function applyValeurLock(char: CharacterInstance, amount: number): void {
  if (amount <= 0) return;
  char.currentMaxHP -= amount;
}

/** Restores ordinary damage only, capped so current HP never exceeds currentMaxHP. */
export function heal(char: CharacterInstance, amount: number): void {
  if (amount <= 0) return;
  char.damage = Math.max(0, char.damage - amount);
}

/** The positive counterpart to applyValeurLock -- permanently raises the HP ceiling. */
export function raiseMaxHP(char: CharacterInstance, amount: number): void {
  if (amount <= 0) return;
  char.currentMaxHP += amount;
}
