export * from './types.js';
export * from './rng.js';
export { getCurrentHP, isKO, dealDamage, applyValeurLock, heal, raiseMaxHP, raiseMaxHPOnly, addShield, removeShield, absorbWithShield } from './hp.js';
export {
  BUILTIN_STATUS_IDS,
  BURN_DAMAGE,
  POISON_FLAT_DAMAGE,
  POISON_PERCENT_OF_MAX_HP,
  BLEED_PERCENT_PER_STACK,
  BLEED_MAX_STACKS,
  VULNERABLE_DAMAGE_BONUS_PERCENT,
  BASE_EVASION_CHANCE_PERCENT,
  BASE_CRITICAL_CHANCE_PERCENT,
  EVASIVE_STATUS_CHANCE_PERCENT,
  CRITICAL_STATUS_CHANCE_PERCENT,
  EVASION_LOCKOUT_TURNS,
  hasStatus,
  getStatus,
  isStunned,
  isDisarmed,
  isEvasive,
  isEvasionLocked,
  isCritical,
  isVulnerable,
  getVulnerableDamageMultiplier,
  isSilencedActive,
  isSilencedPassive,
  hasDeathWard,
  getAtkReductionTotal,
  getAtkBoostTotal,
  getAtkMultiplierTotal,
  getBleedStacks,
  tickStatusesAtTurnStart,
} from './statuses.js';
export * from './queries.js';
export { checkWinCondition, findCharacterOwner } from './zones.js';
export { getPlayerView } from './view.js';
export { defaultChoiceAnswer } from './choices.js';
export { Match } from './match.js';
export type { RosterConfig, MatchConfig, PlayerAction, ActionResult } from './match.js';
export type { EngineApi } from './engine-api.js';

export type {
  CardDef,
  CharacterCardDef,
  ObjectCardDef,
  TerrainCardDef,
  AttackDef,
  AbilityDef,
  ModifierDef,
  ModifierEvalContext,
  EffectContext,
  QueryName,
  Vote,
} from './cards/types.js';
export {
  registerCard,
  getCard,
  getCharacterCard,
  getObjectCard,
  getTerrainCard,
  listCards,
  clearRegistry,
  evolutionFormsOf,
  evolvedFormIds,
  isEvolvedForm,
} from './cards/registry.js';

export * from './cards/demo/index.js';
export type { ClientMessage, ServerMessage } from './protocol.js';
export { DECK_LIMITS, evolutionEntries, listDeckPool, validateRoster } from './deck.js';
export {
  RANDOM_POOL_SIZE,
  drawRandomPool,
  drawRandomPools,
  draftIssue,
  validateDraftedRoster,
} from './draft.js';
export type { DraftPool, GameMode } from './draft.js';
export {
  DRAW_MODE_BENCH_SIZE,
  DRAW_MODE_ELIMINATIONS_TO_WIN,
  DRAW_MODE_HAND_FULL_MESSAGE,
  DRAW_MODE_MAX_CHARACTER_HAND,
  DRAW_MODE_STARTING_CHARACTERS,
} from './draw-mode.js';
export type { DeckPoolEntry, EvolutionFormEntry, RosterValidation } from './deck.js';
export {
  RECYCLE_OBJECT_COST,
  buildStandardObjectReserve,
  describeRecycleUnavailable,
  handObjectCardIds,
  recycleObjects,
} from './recycler.js';
