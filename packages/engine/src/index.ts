export * from './types.js';
export * from './rng.js';
export { getCurrentHP, isKO, dealDamage, applyValeurLock, heal, raiseMaxHP, addShield, removeShield, absorbWithShield } from './hp.js';
export {
  BUILTIN_STATUS_IDS,
  hasStatus,
  getStatus,
  isStunned,
  isDisarmed,
  isEvasive,
  isCritical,
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
} from './cards/registry.js';

export * from './cards/demo/index.js';
export type { ClientMessage, ServerMessage } from './protocol.js';
export { DECK_LIMITS, listDeckPool, validateRoster } from './deck.js';
export type { DeckPoolEntry, RosterValidation } from './deck.js';
