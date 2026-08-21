import { randomUUID } from './uuid.js';
import type { CharacterInstance, GameState, PlayerId, TerrainInstance } from './types.js';
import type { EngineApi } from './engine-api.js';
import { getCharacterCard } from './cards/registry.js';

export function findCharacterOwner(state: GameState, instanceId: string): PlayerId {
  for (const playerId of ['p1', 'p2'] as PlayerId[]) {
    if (state.players[playerId].characters[instanceId]) return playerId;
  }
  throw new Error(`Unknown character instance "${instanceId}"`);
}

function countOnBoard(state: GameState, playerId: PlayerId): number {
  const player = state.players[playerId];
  const ids = [player.activeCharacterInstanceId, ...player.benchCharacterInstanceIds].filter(
    (id): id is string => id !== null
  );
  return ids.length;
}

/** Section 5: KO all 6 of a side -> that side loses; both sides simultaneously -> perfect draw. */
export function checkWinCondition(state: GameState): void {
  if (state.result) return;
  const p1Alive = countOnBoard(state, 'p1') > 0;
  const p2Alive = countOnBoard(state, 'p2') > 0;
  if (!p1Alive && !p2Alive) {
    state.result = { kind: 'draw' };
    state.phase = 'ended';
  } else if (!p1Alive) {
    state.result = { kind: 'win', winner: 'p2' };
    state.phase = 'ended';
  } else if (!p2Alive) {
    state.result = { kind: 'win', winner: 'p1' };
    state.phase = 'ended';
  }
}

/**
 * Section 5 + section 7: KO sends the character to the graveyard, cascades
 * to destroy any attached objects, and (section 2) forces an immediate free
 * replacement from the bench if the KO'd character was active.
 */
export async function koCharacter(state: GameState, characterInstanceId: string, api: EngineApi): Promise<void> {
  const ownerId = findCharacterOwner(state, characterInstanceId);
  const player = state.players[ownerId];
  const wasActive = player.activeCharacterInstanceId === characterInstanceId;
  const benchIndex = player.benchCharacterInstanceIds.indexOf(characterInstanceId);
  if (!wasActive && benchIndex === -1) return; // already processed

  if (wasActive) player.activeCharacterInstanceId = null;
  else player.benchCharacterInstanceIds.splice(benchIndex, 1);
  player.graveyardCharacterInstanceIds.push(characterInstanceId);

  const char = player.characters[characterInstanceId]!;
  for (const objectInstanceId of [...char.attachedObjectInstanceIds]) {
    const idx = player.inPlayObjectInstanceIds.indexOf(objectInstanceId);
    if (idx !== -1) player.inPlayObjectInstanceIds.splice(idx, 1);
    player.graveyardObjectInstanceIds.push(objectInstanceId);
    const obj = player.objects[objectInstanceId];
    if (obj) obj.attachedToCharacterInstanceId = undefined;
  }
  char.attachedObjectInstanceIds = [];

  api.log(`${char.cardId} is KO'd`, { characterInstanceId, ownerId });
  await api.emitEvent({ name: 'onCharacterKO', playerId: ownerId, data: { characterInstanceId } });

  if (wasActive && player.activeCharacterInstanceId === null && player.benchCharacterInstanceIds.length > 0) {
    const answer = await api.chooseFor(ownerId, {
      kind: 'select-characters',
      prompt: 'Choisissez le personnage qui devient actif',
      options: [...player.benchCharacterInstanceIds],
      min: 1,
      max: 1,
    });
    const chosen = answer.kind === 'select-characters' ? answer.selected[0] : undefined;
    const newActiveId = chosen ?? player.benchCharacterInstanceIds[0]!;
    const idx = player.benchCharacterInstanceIds.indexOf(newActiveId);
    if (idx !== -1) player.benchCharacterInstanceIds.splice(idx, 1);
    player.activeCharacterInstanceId = newActiveId;
    await api.emitEvent({ name: 'onBecomeActive', playerId: ownerId, data: { characterInstanceId: newActiveId } });
  }

  // Deliberately not checking the win condition here: a single effect can KO
  // several characters in a row (e.g. an AOE, or a chain of triggers), and
  // section 5's "perfect draw" rule requires seeing the *final* board state,
  // not resolving a plain loss the instant the first side hits zero. Callers
  // that own a full action's resolution call checkWinCondition once at the end.
}

/** A character can leave the graveyard again -- it is then no longer counted as "dead" anywhere (section 6). */
export function reviveCharacter(state: GameState, characterInstanceId: string, hp: number, placement: 'active' | 'bench'): void {
  const ownerId = findCharacterOwner(state, characterInstanceId);
  const player = state.players[ownerId];
  const idx = player.graveyardCharacterInstanceIds.indexOf(characterInstanceId);
  if (idx === -1) throw new Error(`Character "${characterInstanceId}" is not in the graveyard`);
  player.graveyardCharacterInstanceIds.splice(idx, 1);

  const char = player.characters[characterInstanceId]!;
  char.currentMaxHP = Math.max(char.currentMaxHP, hp);
  char.damage = Math.max(0, char.currentMaxHP - hp);
  char.shield = 0;
  char.statuses = [];

  if (placement === 'active' && player.activeCharacterInstanceId === null) {
    player.activeCharacterInstanceId = characterInstanceId;
  } else {
    player.benchCharacterInstanceIds.push(characterInstanceId);
  }
}

export function createCharacterClone(
  state: GameState,
  ownerId: PlayerId,
  sourceInstanceId: string,
  hp: number,
  placement: 'active' | 'bench'
): string {
  const player = state.players[ownerId];
  const source = player.characters[sourceInstanceId];
  if (!source) throw new Error(`Unknown character instance "${sourceInstanceId}"`);
  const cardDef = getCharacterCard(source.cardId);

  const instanceId = randomUUID();
  const clone: CharacterInstance = {
    instanceId,
    cardId: source.cardId,
    ownerId,
    baseMaxHP: cardDef.baseMaxHP,
    currentMaxHP: hp,
    damage: 0,
    shield: 0,
    statuses: [],
    attachedObjectInstanceIds: [],
    abilityUsesThisTurn: {},
    abilityUsesThisGame: {},
  };
  player.characters[instanceId] = clone;

  if (placement === 'active' && player.activeCharacterInstanceId === null) {
    player.activeCharacterInstanceId = instanceId;
  } else {
    player.benchCharacterInstanceIds.push(instanceId);
  }
  return instanceId;
}

export async function switchActive(state: GameState, playerId: PlayerId, newActiveInstanceId: string, api: EngineApi): Promise<void> {
  const player = state.players[playerId];
  const benchIndex = player.benchCharacterInstanceIds.indexOf(newActiveInstanceId);
  if (benchIndex === -1) throw new Error(`"${newActiveInstanceId}" is not on ${playerId}'s bench`);

  const previousActiveId = player.activeCharacterInstanceId;
  player.benchCharacterInstanceIds.splice(benchIndex, 1);
  if (previousActiveId) player.benchCharacterInstanceIds.push(previousActiveId);
  player.activeCharacterInstanceId = newActiveInstanceId;

  api.log(`${playerId} switches active character`, { newActiveInstanceId, previousActiveId });
  await api.emitEvent({ name: 'onSwitch', playerId, data: { newActiveInstanceId, previousActiveId } });
  await api.emitEvent({ name: 'onBecomeActive', playerId, data: { characterInstanceId: newActiveInstanceId } });
}

export function swapBenchCharacters(
  state: GameState,
  forPlayer: PlayerId,
  ownBenchInstanceId: string,
  enemyBenchInstanceId: string
): void {
  const enemyId = forPlayer === 'p1' ? 'p2' : 'p1';
  const ownPlayer = state.players[forPlayer];
  const enemyPlayer = state.players[enemyId];

  const ownIdx = ownPlayer.benchCharacterInstanceIds.indexOf(ownBenchInstanceId);
  const enemyIdx = enemyPlayer.benchCharacterInstanceIds.indexOf(enemyBenchInstanceId);
  if (ownIdx === -1) throw new Error(`"${ownBenchInstanceId}" is not on ${forPlayer}'s bench`);
  if (enemyIdx === -1) throw new Error(`"${enemyBenchInstanceId}" is not on ${enemyId}'s bench`);

  const ownChar = ownPlayer.characters[ownBenchInstanceId]!;
  const enemyChar = enemyPlayer.characters[enemyBenchInstanceId]!;
  ownChar.ownerId = enemyId;
  enemyChar.ownerId = forPlayer;

  delete ownPlayer.characters[ownBenchInstanceId];
  delete enemyPlayer.characters[enemyBenchInstanceId];
  ownPlayer.characters[enemyBenchInstanceId] = enemyChar;
  enemyPlayer.characters[ownBenchInstanceId] = ownChar;

  ownPlayer.benchCharacterInstanceIds[ownIdx] = enemyBenchInstanceId;
  enemyPlayer.benchCharacterInstanceIds[enemyIdx] = ownBenchInstanceId;
}

export function attachObjectToCharacter(state: GameState, objectInstanceId: string, targetCharacterInstanceId: string): void {
  const ownerId = findCharacterOwner(state, targetCharacterInstanceId);
  const player = state.players[ownerId];
  const obj = player.objects[objectInstanceId];
  if (!obj) throw new Error(`Object "${objectInstanceId}" not found for ${ownerId}`);
  obj.attachedToCharacterInstanceId = targetCharacterInstanceId;
  if (!player.inPlayObjectInstanceIds.includes(objectInstanceId)) {
    player.inPlayObjectInstanceIds.push(objectInstanceId);
  }
  const char = player.characters[targetCharacterInstanceId]!;
  if (!char.attachedObjectInstanceIds.includes(objectInstanceId)) {
    char.attachedObjectInstanceIds.push(objectInstanceId);
  }
}

export function moveObjectFromPoolToInPlay(state: GameState, playerId: PlayerId, objectInstanceId: string): void {
  const player = state.players[playerId];
  const idx = player.unplayedObjectInstanceIds.indexOf(objectInstanceId);
  if (idx === -1) throw new Error(`Object "${objectInstanceId}" is not in ${playerId}'s unplayed pool`);
  player.unplayedObjectInstanceIds.splice(idx, 1);
  player.inPlayObjectInstanceIds.push(objectInstanceId);
}

export function moveObjectToGraveyard(state: GameState, playerId: PlayerId, objectInstanceId: string): void {
  const player = state.players[playerId];
  const idx = player.inPlayObjectInstanceIds.indexOf(objectInstanceId);
  if (idx !== -1) player.inPlayObjectInstanceIds.splice(idx, 1);
  if (!player.graveyardObjectInstanceIds.includes(objectInstanceId)) {
    player.graveyardObjectInstanceIds.push(objectInstanceId);
  }
}

export function findObjectOwner(state: GameState, objectInstanceId: string): PlayerId {
  for (const playerId of ['p1', 'p2'] as PlayerId[]) {
    if (state.players[playerId].objects[objectInstanceId]) return playerId;
  }
  throw new Error(`Unknown object instance "${objectInstanceId}"`);
}

/** Destroys an in-play object regardless of owner: detaches it from its character (if equipped) and sends it to the graveyard. */
export function destroyObject(state: GameState, objectInstanceId: string): void {
  const ownerId = findObjectOwner(state, objectInstanceId);
  const player = state.players[ownerId];
  const obj = player.objects[objectInstanceId];
  if (!obj) return;
  if (obj.attachedToCharacterInstanceId) {
    const char = player.characters[obj.attachedToCharacterInstanceId];
    if (char) {
      const idx = char.attachedObjectInstanceIds.indexOf(objectInstanceId);
      if (idx !== -1) char.attachedObjectInstanceIds.splice(idx, 1);
    }
    obj.attachedToCharacterInstanceId = undefined;
  }
  moveObjectToGraveyard(state, ownerId, objectInstanceId);
}

/** Section 8: posing a new terrain sends the previous one to the graveyard. */
export function moveTerrainFromPoolToActive(state: GameState, playerId: PlayerId, terrainInstanceId: string): TerrainInstance | undefined {
  const player = state.players[playerId];
  const idx = player.unplayedTerrainInstanceIds.indexOf(terrainInstanceId);
  if (idx === -1) throw new Error(`Terrain "${terrainInstanceId}" is not in ${playerId}'s unplayed pool`);
  player.unplayedTerrainInstanceIds.splice(idx, 1);

  let replaced: TerrainInstance | undefined;
  if (player.activeTerrainInstanceId) {
    replaced = player.terrains[player.activeTerrainInstanceId];
    player.graveyardTerrainInstanceIds.push(player.activeTerrainInstanceId);
  }
  player.activeTerrainInstanceId = terrainInstanceId;
  return replaced;
}

export function removeActiveTerrain(state: GameState, playerId: PlayerId): void {
  const player = state.players[playerId];
  if (!player.activeTerrainInstanceId) return;
  player.graveyardTerrainInstanceIds.push(player.activeTerrainInstanceId);
  player.activeTerrainInstanceId = null;
}

async function expireTerrainIfDepleted(
  state: GameState,
  playerId: PlayerId,
  terrainInstanceId: string,
  terrain: TerrainInstance,
  api: EngineApi
): Promise<void> {
  if (terrain.remainingTurns === undefined || terrain.remainingTurns > 0) return;
  removeActiveTerrain(state, playerId);
  api.log(`Terrain expires`, { terrainInstanceId });
  await api.emitEvent({ name: 'onTerrainRemoved', playerId, data: { terrainInstanceId } });
}

/**
 * Mirrors tickStatusesAtTurnStart (statuses.ts): a terrain with a defined
 * durationTurns counts down only during its owner's own turns, and is
 * removed (graveyard + onTerrainRemoved) once it hits 0. A terrain with no
 * durationTurns (undefined) never ticks -- it stays until replaced/removed.
 */
export async function tickTerrainAtTurnStart(state: GameState, playerId: PlayerId, api: EngineApi): Promise<void> {
  const player = state.players[playerId];
  const terrainInstanceId = player.activeTerrainInstanceId;
  if (!terrainInstanceId) return;
  const terrain = player.terrains[terrainInstanceId];
  if (!terrain || terrain.remainingTurns === undefined) return;

  terrain.remainingTurns -= 1;
  await expireTerrainIfDepleted(state, playerId, terrainInstanceId, terrain, api);
}

export function findTerrainOwner(state: GameState, terrainInstanceId: string): PlayerId {
  for (const playerId of ['p1', 'p2'] as PlayerId[]) {
    if (state.players[playerId].terrains[terrainInstanceId]) return playerId;
  }
  throw new Error(`Unknown terrain instance "${terrainInstanceId}"`);
}

/**
 * Adds `turns` to a currently-active terrain's remaining duration (own or
 * opponent's). No-op on an indefinite terrain (no durationTurns declared) or
 * on a terrain that isn't the active one for its owner anymore.
 */
export function extendTerrainDuration(state: GameState, terrainInstanceId: string, turns: number): void {
  const playerId = findTerrainOwner(state, terrainInstanceId);
  const player = state.players[playerId];
  if (player.activeTerrainInstanceId !== terrainInstanceId) return;
  const terrain = player.terrains[terrainInstanceId]!;
  if (terrain.remainingTurns === undefined) return;
  terrain.remainingTurns += turns;
}

/**
 * Removes `turns` from a currently-active terrain's remaining duration (own
 * or opponent's), expiring it immediately (graveyard + onTerrainRemoved) if
 * this brings it to 0 or below -- same outcome as running out the clock
 * naturally via tickTerrainAtTurnStart. No-op on an indefinite terrain or on
 * a terrain that isn't the active one for its owner anymore.
 */
export async function shortenTerrainDuration(
  state: GameState,
  terrainInstanceId: string,
  turns: number,
  api: EngineApi
): Promise<void> {
  const playerId = findTerrainOwner(state, terrainInstanceId);
  const player = state.players[playerId];
  if (player.activeTerrainInstanceId !== terrainInstanceId) return;
  const terrain = player.terrains[terrainInstanceId]!;
  if (terrain.remainingTurns === undefined) return;
  terrain.remainingTurns -= turns;
  await expireTerrainIfDepleted(state, playerId, terrainInstanceId, terrain, api);
}
