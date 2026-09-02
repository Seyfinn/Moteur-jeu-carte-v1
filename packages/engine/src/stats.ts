import type { CharacterStats, GameState } from './types.js';

/**
 * Statistiques de combat accumulées côté moteur pour chaque personnage (des DEUX camps,
 * sous une seule map à plat -- les instanceId sont uniques dans toute la partie). Alimentées
 * au fil de l'eau depuis les points de passage uniques des dégâts/soins/bouclier/KO
 * (`match.ts::buildApi`, `zones.ts::koCharacter`, `effect-context.ts`), jamais recalculées :
 * lues telles quelles par le client pour le tableau de fin de partie.
 */
export function emptyCharacterStats(): CharacterStats {
  return {
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    shieldGained: 0,
    shieldBroken: 0,
    evasions: 0,
    crits: 0,
    kills: 0,
  };
}

/** Zero-value singleton for a character with no recorded stats yet -- safe to read, never mutated. */
const EMPTY_STATS: CharacterStats = emptyCharacterStats();

/** Pure read: never creates an entry, so it's safe to call from client-side rendering code too. */
export function getCharacterStats(state: GameState, characterInstanceId: string): CharacterStats {
  return state.characterStats[characterInstanceId] ?? EMPTY_STATS;
}

function getOrCreateStats(state: GameState, characterInstanceId: string): CharacterStats {
  let stats = state.characterStats[characterInstanceId];
  if (!stats) {
    stats = emptyCharacterStats();
    state.characterStats[characterInstanceId] = stats;
  }
  return stats;
}

export function recordDamageDealt(state: GameState, characterInstanceId: string | undefined, amount: number): void {
  if (!characterInstanceId || amount <= 0) return;
  getOrCreateStats(state, characterInstanceId).damageDealt += amount;
}

export function recordDamageTaken(state: GameState, characterInstanceId: string, amount: number): void {
  if (amount <= 0) return;
  getOrCreateStats(state, characterInstanceId).damageTaken += amount;
}

export function recordHealingDone(state: GameState, characterInstanceId: string | undefined, amount: number): void {
  if (!characterInstanceId || amount <= 0) return;
  getOrCreateStats(state, characterInstanceId).healingDone += amount;
}

export function recordShieldGained(state: GameState, characterInstanceId: string, amount: number): void {
  if (amount <= 0) return;
  getOrCreateStats(state, characterInstanceId).shieldGained += amount;
}

export function recordShieldBroken(state: GameState, characterInstanceId: string, amount: number): void {
  if (amount <= 0) return;
  getOrCreateStats(state, characterInstanceId).shieldBroken += amount;
}

export function recordEvasion(state: GameState, characterInstanceId: string): void {
  getOrCreateStats(state, characterInstanceId).evasions += 1;
}

export function recordCrit(state: GameState, characterInstanceId: string): void {
  getOrCreateStats(state, characterInstanceId).crits += 1;
}

export function recordKill(state: GameState, characterInstanceId: string | undefined): void {
  if (!characterInstanceId) return;
  getOrCreateStats(state, characterInstanceId).kills += 1;
}
