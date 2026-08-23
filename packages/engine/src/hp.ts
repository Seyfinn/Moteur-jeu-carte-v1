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

/**
 * "Valeur lock": permanently reduces max HP. Never healable. Can push HP to/below 0 (KO).
 * Floored at 0 so the ceiling never goes negative -- a negative ceiling has no extra
 * mechanical meaning (the bearer is already KO at 0) but leaks into every "x / y HP"
 * readout and into any modifier doing arithmetic on currentMaxHP.
 */
export function applyValeurLock(char: CharacterInstance, amount: number): void {
  if (amount <= 0) return;
  char.currentMaxHP = Math.max(0, char.currentMaxHP - amount);
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

/** Adds shield points, stacking on top of any shield already present. */
export function addShield(char: CharacterInstance, amount: number): void {
  if (amount <= 0) return;
  char.shield += amount;
}

/** Strips shield points directly (not via damage). `amount` undefined clears it entirely. */
export function removeShield(char: CharacterInstance, amount?: number): void {
  if (amount === undefined) {
    char.shield = 0;
    return;
  }
  if (amount <= 0) return;
  char.shield = Math.max(0, char.shield - amount);
}

/** Consumes up to `amount` of the character's shield, returning how much was absorbed. */
export function absorbWithShield(char: CharacterInstance, amount: number): number {
  if (amount <= 0 || char.shield <= 0) return 0;
  const absorbed = Math.min(char.shield, amount);
  char.shield -= absorbed;
  return absorbed;
}
