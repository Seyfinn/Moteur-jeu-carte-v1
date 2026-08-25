import { randomUUID } from './uuid.js';
import { otherPlayer, type CharacterInstance, type GameState, type PlayerId, type PlayerState, type TerrainInstance } from './types.js';
import type { EngineApi } from './engine-api.js';
import { getCharacterCard, getTerrainCard } from './cards/registry.js';
import { getLinkedPartnerId, hasStatus } from './statuses.js';
import { cardName, playerName } from './names.js';

export function findCharacterOwner(state: GameState, instanceId: string): PlayerId {
  for (const playerId of ['p1', 'p2'] as PlayerId[]) {
    if (state.players[playerId].characters[instanceId]) return playerId;
  }
  throw new Error(`Unknown character instance "${instanceId}"`);
}

/** Non-throwing variant, for optional/attribution lookups where a missing instance is fine. */
export function safeFindCharacterOwner(state: GameState, instanceId: string): PlayerId | undefined {
  for (const playerId of ['p1', 'p2'] as PlayerId[]) {
    if (state.players[playerId].characters[instanceId]) return playerId;
  }
  return undefined;
}

/** Non-throwing counterpart to findObjectOwner. */
export function safeFindObjectOwner(state: GameState, objectInstanceId: string): PlayerId | undefined {
  for (const playerId of ['p1', 'p2'] as PlayerId[]) {
    if (state.players[playerId].objects[objectInstanceId]) return playerId;
  }
  return undefined;
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
export async function koCharacter(
  state: GameState,
  characterInstanceId: string,
  api: EngineApi,
  killerInstanceId?: string
): Promise<void> {
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
    // An object doesn't have to belong to the player who owns the character it is
    // equipped on (attachObjectToCharacter explicitly supports equipping an enemy), so
    // it has to be filed through its OWN owner. Pushing it into this player's graveyard
    // left an id listed in a zone whose `objects` record doesn't contain it, which then
    // crashed anything walking that graveyard (Echange équivalent, Déchetterie...).
    const objectOwnerId = safeFindObjectOwner(state, objectInstanceId);
    if (!objectOwnerId) continue;
    moveObjectToGraveyard(state, objectOwnerId, objectInstanceId);
    const obj = state.players[objectOwnerId].objects[objectInstanceId];
    if (obj) obj.attachedToCharacterInstanceId = undefined;
  }
  char.attachedObjectInstanceIds = [];

  api.log(`${cardName(char.cardId)} est KO`, { kind: 'ko', characterInstanceId, ownerId, killerInstanceId }, ownerId);
  await api.emitEvent({
    name: 'onCharacterKO',
    playerId: ownerId,
    data: {
      characterInstanceId,
      killerInstanceId,
      killerOwnerId: killerInstanceId ? safeFindCharacterOwner(state, killerInstanceId) : undefined,
    },
  });

  // 'linked' (Jacob et Essau): a death takes both halves of the pair. Resolved BEFORE the
  // replacement prompt below, otherwise the doomed partner would be offered as the new
  // active and die the instant it took the post. Mutual recursion is cut by the
  // "already processed" guard at the top of this function: the partner's own call finds
  // this character already in the graveyard and returns immediately.
  const linkedPartnerId = getLinkedPartnerId(char);
  if (linkedPartnerId) {
    const partnerOwnerId = safeFindCharacterOwner(state, linkedPartnerId);
    const partnerPlayer = partnerOwnerId ? state.players[partnerOwnerId] : undefined;
    const partnerOnBoard =
      !!partnerPlayer &&
      (partnerPlayer.activeCharacterInstanceId === linkedPartnerId ||
        partnerPlayer.benchCharacterInstanceIds.includes(linkedPartnerId));
    if (partnerPlayer && partnerOnBoard) {
      api.log(
        `${cardName(partnerPlayer.characters[linkedPartnerId]!.cardId)} était lié à ${cardName(char.cardId)} : il meurt avec lui`,
        { kind: 'info', characterInstanceId: linkedPartnerId },
        partnerOwnerId
      );
      await koCharacter(state, linkedPartnerId, api, killerInstanceId);
    }
  }

  if (wasActive && player.activeCharacterInstanceId === null && player.benchCharacterInstanceIds.length > 0) {
    const answer = await api.chooseFor(ownerId, {
      kind: 'select-characters',
      prompt: 'Choisissez le personnage qui devient actif',
      options: [...player.benchCharacterInstanceIds],
      min: 1,
      max: 1,
    });
    // Re-read the bench: the choice suspends this function, and anything can have
    // happened in between (another KO, a forced switch, a revive filling the slot).
    if (player.activeCharacterInstanceId !== null || player.benchCharacterInstanceIds.length === 0) return;
    const chosen = answer.kind === 'select-characters' ? answer.selected[0] : undefined;
    const newActiveId =
      chosen && player.benchCharacterInstanceIds.includes(chosen) ? chosen : player.benchCharacterInstanceIds[0]!;
    const idx = player.benchCharacterInstanceIds.indexOf(newActiveId);
    if (idx !== -1) player.benchCharacterInstanceIds.splice(idx, 1);
    player.activeCharacterInstanceId = newActiveId;
    await api.emitEvent({
      name: 'onBecomeActive',
      playerId: ownerId,
      data: { characterInstanceId: newActiveId, reason: 'ko-replacement' },
    });
  }

  // Deliberately not checking the win condition here: a single effect can KO
  // several characters in a row (e.g. an AOE, or a chain of triggers), and
  // section 5's "perfect draw" rule requires seeing the *final* board state,
  // not resolving a plain loss the instant the first side hits zero. Callers
  // that own a full action's resolution call checkWinCondition once at the end.
}

/**
 * "Pheonix": counts down every delayed revive this player is waiting on, and fires the
 * ones that come due. Called from startTurn, right after the status ticks, so a revive
 * lands before its owner acts.
 *
 * Deliberately not a status: `applyStatus` refuses graveyard targets and
 * `tickStatusesAtTurnStart` never walks the graveyard, so a countdown attached to the
 * dead character could not tick at all (see PendingRevive in types.ts).
 */
export async function tickPendingRevives(state: GameState, playerId: PlayerId, api: EngineApi): Promise<void> {
  const player = state.players[playerId];
  if (player.pendingRevives.length === 0) return;

  for (const pending of [...player.pendingRevives]) {
    // Someone else already pulled this character back out (Absorption Vitale, Roi des
    // esprits...): the scheduled revive has nothing left to do and is dropped.
    if (!player.graveyardCharacterInstanceIds.includes(pending.characterInstanceId)) {
      player.pendingRevives = player.pendingRevives.filter((p) => p !== pending);
      continue;
    }

    pending.turnsRemaining -= 1;
    const char = player.characters[pending.characterInstanceId]!;
    if (pending.turnsRemaining > 0) {
      api.log(
        `${cardName(pending.sourceCardId)} : ${cardName(char.cardId)} revient dans ${pending.turnsRemaining} tour(s)`,
        { characterInstanceId: pending.characterInstanceId, turnsRemaining: pending.turnsRemaining },
        playerId
      );
      continue;
    }

    player.pendingRevives = player.pendingRevives.filter((p) => p !== pending);
    // Raise the ceiling BEFORE reviving so the character comes back at its new full HP:
    // reviveCharacter clamps the revive HP to currentMaxHP, and raiseMaxHP on a corpse is
    // a plain field bump (no heal to speak of on something at 0).
    char.currentMaxHP += pending.bonusMaxHP;
    // 'active' falls back to the bench when the slot is taken (see reviveCharacter), so a
    // player who kept fighting meanwhile never has their current active bumped out.
    await api.reviveCharacter(pending.characterInstanceId, char.currentMaxHP, 'active');
    if (pending.bonusATK > 0) {
      // After the revive, never before: reviveCharacter wipes statuses. Indefinite (no
      // remainingTurns) = permanent, which is what "50 d'attaque supplémentaire" means.
      api.applyStatus(pending.characterInstanceId, {
        statusId: 'atk-boost',
        label: `${cardName(pending.sourceCardId)} (+${pending.bonusATK} ATK)`,
        sourcePlayerId: playerId,
        data: { amount: pending.bonusATK },
      });
    }
    api.log(
      `${cardName(pending.sourceCardId)} : ${cardName(char.cardId)} renaît avec +${pending.bonusMaxHP} HP max et +${pending.bonusATK} ATK`,
      { kind: 'revive', characterInstanceId: pending.characterInstanceId },
      playerId
    );
  }
}

/** A character can leave the graveyard again -- it is then no longer counted as "dead" anywhere (section 6). */
export function reviveCharacter(state: GameState, characterInstanceId: string, hp: number, placement: 'active' | 'bench'): void {
  const ownerId = findCharacterOwner(state, characterInstanceId);
  const player = state.players[ownerId];
  const idx = player.graveyardCharacterInstanceIds.indexOf(characterInstanceId);
  if (idx === -1) throw new Error(`Character "${characterInstanceId}" is not in the graveyard`);
  player.graveyardCharacterInstanceIds.splice(idx, 1);

  const char = player.characters[characterInstanceId]!;
  // A revive at 0 (or less) would put a character back on the board already KO'd, which
  // nothing would then clean up. One HP is the floor.
  const reviveHP = Math.max(1, Math.round(hp));
  char.currentMaxHP = Math.max(char.currentMaxHP, reviveHP);
  char.damage = Math.max(0, char.currentMaxHP - reviveHP);
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
    // Same reasoning as reviveCharacter: a clone summoned at 0 HP would be born KO'd.
    currentMaxHP: Math.max(1, Math.round(hp)),
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
  // Le défensif prime sur l'offensif : 'chained' (Chaînes) bloque TOUT départ du poste
  // actif, pas seulement l'action de switch standard. Le garde vit ici, dans l'unique
  // point de passage de tous les switchs, pour qu'aucun `forceSwitch` de carte (Dieu du
  // Tonnerre Volant, Hook, Boogie Woogie, Portail Dimensionnel) ne puisse le contourner.
  // Le remplacement après un KO ne passe pas par ici : un mort n'est plus enchaîné.
  const previousActive = previousActiveId ? player.characters[previousActiveId] : undefined;
  if (previousActive && hasStatus(previousActive, 'chained')) {
    api.log(
      `${cardName(previousActive.cardId)} est enchaîné : impossible de le sortir du poste actif`,
      { kind: 'blocked', characterInstanceId: previousActiveId, reason: 'chained' },
      playerId
    );
    return;
  }
  player.benchCharacterInstanceIds.splice(benchIndex, 1);
  if (previousActiveId) player.benchCharacterInstanceIds.push(previousActiveId);
  player.activeCharacterInstanceId = newActiveInstanceId;

  api.log(
    `${playerName(state, playerId)} envoie ${cardName(player.characters[newActiveInstanceId]?.cardId ?? '')} au poste actif`,
    { kind: 'switch', newActiveInstanceId, previousActiveInstanceId: previousActiveId },
    playerId
  );
  await api.emitEvent({
    name: 'onSwitch',
    playerId,
    data: { newActiveInstanceId, previousActiveInstanceId: previousActiveId },
  });
  await api.emitEvent({
    name: 'onBecomeActive',
    playerId,
    data: { characterInstanceId: newActiveInstanceId, reason: 'switch' },
  });
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

  // Equipped objects live in their owner's `objects`/`inPlayObjectInstanceIds`. A
  // character changing sides has to bring them along, otherwise they end up orphaned
  // (still listed on the character, but unreachable from the player who now controls
  // it -- destroyObject/getInPlaySources would both silently skip them).
  moveAttachedObjects(ownChar, ownPlayer, enemyPlayer);
  moveAttachedObjects(enemyChar, enemyPlayer, ownPlayer);
}

function moveAttachedObjects(char: CharacterInstance, from: PlayerState, to: PlayerState): void {
  for (const objectInstanceId of char.attachedObjectInstanceIds) {
    const obj = from.objects[objectInstanceId];
    if (!obj) continue;
    delete from.objects[objectInstanceId];
    const idx = from.inPlayObjectInstanceIds.indexOf(objectInstanceId);
    if (idx !== -1) from.inPlayObjectInstanceIds.splice(idx, 1);
    obj.ownerId = to.id;
    to.objects[objectInstanceId] = obj;
    if (!to.inPlayObjectInstanceIds.includes(objectInstanceId)) {
      to.inPlayObjectInstanceIds.push(objectInstanceId);
    }
  }
}

/**
 * The object and the character it attaches to don't have to belong to the same player
 * (an effect can equip an enemy), so each is looked up through its own owner.
 */
export function attachObjectToCharacter(state: GameState, objectInstanceId: string, targetCharacterInstanceId: string): void {
  const charOwnerId = findCharacterOwner(state, targetCharacterInstanceId);
  const objectOwnerId = findObjectOwner(state, objectInstanceId);
  const objectPlayer = state.players[objectOwnerId];
  const obj = objectPlayer.objects[objectInstanceId]!;

  obj.attachedToCharacterInstanceId = targetCharacterInstanceId;
  const unplayedIdx = objectPlayer.unplayedObjectInstanceIds.indexOf(objectInstanceId);
  if (unplayedIdx !== -1) objectPlayer.unplayedObjectInstanceIds.splice(unplayedIdx, 1);
  if (!objectPlayer.inPlayObjectInstanceIds.includes(objectInstanceId)) {
    objectPlayer.inPlayObjectInstanceIds.push(objectInstanceId);
  }

  const char = state.players[charOwnerId].characters[targetCharacterInstanceId]!;
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
  const inPlayIdx = player.inPlayObjectInstanceIds.indexOf(objectInstanceId);
  if (inPlayIdx !== -1) player.inPlayObjectInstanceIds.splice(inPlayIdx, 1);
  // Also clear the unplayed pool: destroying a card still in hand used to leave it
  // listed there *and* in the graveyard, so it stayed playable after being destroyed.
  const unplayedIdx = player.unplayedObjectInstanceIds.indexOf(objectInstanceId);
  if (unplayedIdx !== -1) player.unplayedObjectInstanceIds.splice(unplayedIdx, 1);
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
    const attachedTo = obj.attachedToCharacterInstanceId;
    const char =
      player.characters[attachedTo] ?? state.players[otherPlayer(ownerId)].characters[attachedTo];
    if (char) {
      const idx = char.attachedObjectInstanceIds.indexOf(objectInstanceId);
      if (idx !== -1) char.attachedObjectInstanceIds.splice(idx, 1);
    }
    obj.attachedToCharacterInstanceId = undefined;
  }
  moveObjectToGraveyard(state, ownerId, objectInstanceId);
}

/**
 * Section 8: posing a new terrain sends the previous one to the graveyard -- and that
 * counts as a removal, so `onTerrainRemoved` fires for it exactly like an expiry or a
 * destruction would (otherwise a card reacting to "my terrain left play" would silently
 * miss the most common way terrains leave play).
 */
export async function moveTerrainFromPoolToActive(
  state: GameState,
  playerId: PlayerId,
  terrainInstanceId: string,
  api: EngineApi
): Promise<TerrainInstance | undefined> {
  const player = state.players[playerId];
  const idx = player.unplayedTerrainInstanceIds.indexOf(terrainInstanceId);
  if (idx === -1) throw new Error(`Terrain "${terrainInstanceId}" is not in ${playerId}'s unplayed pool`);
  player.unplayedTerrainInstanceIds.splice(idx, 1);

  let replaced: TerrainInstance | undefined;
  const replacedId = player.activeTerrainInstanceId;
  if (replacedId) {
    replaced = player.terrains[replacedId];
    removeActiveTerrain(state, playerId);
  }
  player.activeTerrainInstanceId = terrainInstanceId;
  // Stamp the duration here, *before* the replacement event: a card reacting to
  // `onTerrainRemoved` already sees the new terrain as active, and used to read
  // `remainingTurns === undefined` on it -- which every duration check in the codebase
  // interprets as "indefinite".
  const incoming = player.terrains[terrainInstanceId];
  if (incoming) incoming.remainingTurns = getTerrainCard(incoming.cardId).durationTurns;

  if (replacedId) {
    api.log(`${cardName(replaced?.cardId ?? '')} est remplacé et part au cimetière`, { kind: 'terrain-removed', terrainInstanceId: replacedId }, playerId);
    await api.emitEvent({
      name: 'onTerrainRemoved',
      playerId,
      data: { terrainInstanceId: replacedId, reason: 'replaced' },
    });
  }
  return replaced;
}

export function removeActiveTerrain(state: GameState, playerId: PlayerId): void {
  const player = state.players[playerId];
  const terrainInstanceId = player.activeTerrainInstanceId;
  if (!terrainInstanceId) return;
  if (!player.graveyardTerrainInstanceIds.includes(terrainInstanceId)) {
    player.graveyardTerrainInstanceIds.push(terrainInstanceId);
  }
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
  if (state.players[playerId].activeTerrainInstanceId !== terrainInstanceId) return;
  removeActiveTerrain(state, playerId);
  api.log(`${cardName(terrain.cardId)} expire`, { kind: 'terrain-removed', terrainInstanceId }, playerId);
  await api.emitEvent({ name: 'onTerrainRemoved', playerId, data: { terrainInstanceId, reason: 'expired' } });
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
