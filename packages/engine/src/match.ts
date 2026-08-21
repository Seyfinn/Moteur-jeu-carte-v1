import { createRng, flipCoin as rngFlipCoin } from './rng.js';
import { randomUUID } from './uuid.js';
import type {
  ChoiceAnswer,
  ChoiceSpec,
  CharacterInstance,
  GameState,
  ObjectInstance,
  PlayerId,
  PlayerState,
  TerrainInstance,
} from './types.js';
import type { EngineApi } from './engine-api.js';
import { getCharacterCard, getObjectCard, getTerrainCard } from './cards/registry.js';
import { buildEffectContext } from './effect-context.js';
import { emitEvent } from './events.js';
import { recordAbilityUse } from './abilities.js';
import * as hp from './hp.js';
import * as statusesMod from './statuses.js';
import * as zones from './zones.js';
import { canAttack, canPlayObject, canSwitchStandard, canUseAbility, evaluateTransform, findCharacter, getMaxAttachedObjects } from './queries.js';
import { endTurn, startTurn } from './turn.js';
import { getPlayerView } from './view.js';

export interface RosterConfig {
  characterCardIds: string[];
  objectCardIds: string[];
  terrainCardIds: string[];
}

export interface MatchConfig {
  p1Name: string;
  p2Name: string;
  p1Roster: RosterConfig;
  p2Roster: RosterConfig;
  seed?: number;
}

export type PlayerAction =
  | { kind: 'play-object'; objectInstanceId: string }
  | { kind: 'play-terrain'; terrainInstanceId: string }
  | { kind: 'use-ability'; characterInstanceId: string; abilityId: string }
  | { kind: 'attack'; characterInstanceId: string; attackId: string }
  | { kind: 'switch'; newActiveInstanceId: string }
  | { kind: 'pass' };

export type ActionResult = { ok: true } | { ok: false; error: string };

function createPlayerState(id: PlayerId, displayName: string, roster: RosterConfig): PlayerState {
  const characters: Record<string, CharacterInstance> = {};
  for (const cardId of roster.characterCardIds) {
    const def = getCharacterCard(cardId);
    const instanceId = randomUUID();
    characters[instanceId] = {
      instanceId,
      cardId,
      ownerId: id,
      baseMaxHP: def.baseMaxHP,
      currentMaxHP: def.baseMaxHP,
      damage: 0,
      shield: 0,
      statuses: [],
      attachedObjectInstanceIds: [],
      abilityUsesThisTurn: {},
      abilityUsesThisGame: {},
    };
  }

  const objects: Record<string, ObjectInstance> = {};
  const unplayedObjectInstanceIds: string[] = [];
  for (const cardId of roster.objectCardIds) {
    getObjectCard(cardId);
    const instanceId = randomUUID();
    objects[instanceId] = { instanceId, cardId, ownerId: id };
    unplayedObjectInstanceIds.push(instanceId);
  }

  const terrains: Record<string, TerrainInstance> = {};
  const unplayedTerrainInstanceIds: string[] = [];
  for (const cardId of roster.terrainCardIds) {
    getTerrainCard(cardId);
    const instanceId = randomUUID();
    terrains[instanceId] = { instanceId, cardId, ownerId: id };
    unplayedTerrainInstanceIds.push(instanceId);
  }

  return {
    id,
    displayName,
    characters,
    activeCharacterInstanceId: null,
    benchCharacterInstanceIds: [],
    graveyardCharacterInstanceIds: [],
    objects,
    unplayedObjectInstanceIds,
    inPlayObjectInstanceIds: [],
    graveyardObjectInstanceIds: [],
    terrains,
    unplayedTerrainInstanceIds,
    activeTerrainInstanceId: null,
    graveyardTerrainInstanceIds: [],
    objectsPlayedThisTurn: 0,
    hasHadFirstTurn: false,
  };
}

export class Match {
  readonly state: GameState;
  private resolvers = new Map<string, (answer: ChoiceAnswer) => void>();
  private listeners = new Set<() => void>();
  private inFlight: Promise<void> | null = null;
  private api: EngineApi;

  private constructor(state: GameState) {
    this.state = state;
    this.api = this.buildApi();
  }

  /**
   * Synchronous on purpose: setup (each player picking a starting active
   * character) runs through the exact same pendingChoice/answerChoice flow
   * as every other action, tracked via `inFlight` -- so a caller can only
   * ever drive the match through `applyAction`/`answerChoice` +
   * `waitForNextPause`, whether it's mid-setup or mid-game.
   */
  static create(config: MatchConfig): Match {
    const seed = config.seed ?? Math.floor(Math.random() * 2 ** 31);
    const state: GameState = {
      id: randomUUID(),
      players: {
        p1: createPlayerState('p1', config.p1Name, config.p1Roster),
        p2: createPlayerState('p2', config.p2Name, config.p2Roster),
      },
      startingPlayerId: 'p1',
      activePlayerId: 'p1',
      turnNumber: 0,
      phase: 'setup',
      rng: createRng(seed),
      log: [],
    };
    const match = new Match(state);

    const startingPlayerId: PlayerId = rngFlipCoin(state.rng) === 'heads' ? 'p1' : 'p2';
    state.startingPlayerId = startingPlayerId;
    match.api.log(`Coin flip for initiative: ${startingPlayerId} starts`, { startingPlayerId });

    match.inFlight = match
      .runSetup()
      .catch((err) => {
        match.api.log(`Setup error: ${(err as Error).message}`, { error: String(err) });
      })
      .finally(() => {
        match.inFlight = null;
        match.notify();
      });
    return match;
  }

  private async runSetup(): Promise<void> {
    const state = this.state;
    for (const playerId of ['p1', 'p2'] as PlayerId[]) {
      const player = state.players[playerId];
      const options = Object.keys(player.characters);
      const answer = await this.requestChoice(playerId, {
        kind: 'select-characters',
        prompt: 'Choisissez votre personnage actif de départ',
        options,
        min: 1,
        max: 1,
      });
      const chosenId = answer.kind === 'select-characters' ? answer.selected[0] : undefined;
      const activeId = chosenId ?? options[0]!;
      player.activeCharacterInstanceId = activeId;
      player.benchCharacterInstanceIds = options.filter((optId) => optId !== activeId);
    }

    state.phase = 'main';
    state.turnNumber = 1;
    state.activePlayerId = state.startingPlayerId;
    await startTurn(state, this.api);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * Resolves at the next observable pause point: either a new choice appears
   * (`state.pendingChoice` gets set, answer it and call this again) or the
   * in-flight action fully completes (`state.pendingChoice` stays undefined
   * and no action is running any more).
   */
  async waitForNextPause(): Promise<void> {
    if (this.state.pendingChoice || !this.inFlight) return;
    await new Promise<void>((resolve) => {
      const unsub = this.onChange(() => {
        if (this.state.pendingChoice || !this.inFlight) {
          unsub();
          resolve();
        }
      });
    });
  }

  getView(forPlayerId: PlayerId): GameState {
    return getPlayerView(this.state, forPlayerId);
  }

  applyAction(playerId: PlayerId, action: PlayerAction): ActionResult {
    const state = this.state;
    if (state.phase !== 'main') return { ok: false, error: 'Game is not in progress' };
    if (state.pendingChoice) return { ok: false, error: 'A choice is pending; call answerChoice' };
    if (this.inFlight) return { ok: false, error: 'Another action is already resolving' };
    if (playerId !== state.activePlayerId) return { ok: false, error: "It is not this player's turn" };

    const validation = this.validateAction(playerId, action);
    if (!validation.ok) return validation;

    this.inFlight = this.runAction(playerId, action)
      .catch((err) => {
        this.api.log(`Action error: ${(err as Error).message}`, { error: String(err) });
      })
      .finally(() => {
        this.inFlight = null;
        this.notify();
      });
    return { ok: true };
  }

  answerChoice(playerId: PlayerId, choiceId: string, answer: ChoiceAnswer): ActionResult {
    const pending = this.state.pendingChoice;
    if (!pending) return { ok: false, error: 'No pending choice' };
    if (pending.id !== choiceId) return { ok: false, error: 'Choice id mismatch' };
    if (pending.playerId !== playerId) return { ok: false, error: 'Not your choice to answer' };
    if (answer.kind !== pending.spec.kind) return { ok: false, error: 'Answer kind mismatch' };
    const resolve = this.resolvers.get(choiceId);
    if (!resolve) return { ok: false, error: 'Choice already answered' };
    this.resolvers.delete(choiceId);
    this.state.pendingChoice = undefined;
    resolve(answer);
    this.notify();
    return { ok: true };
  }

  private requestChoice(playerId: PlayerId, spec: ChoiceSpec): Promise<ChoiceAnswer> {
    const id = randomUUID();
    this.state.pendingChoice = { id, playerId, spec };
    this.notify();
    return new Promise((resolve) => {
      this.resolvers.set(id, resolve);
    });
  }

  private validateAction(playerId: PlayerId, action: PlayerAction): ActionResult {
    const state = this.state;
    const player = state.players[playerId];
    switch (action.kind) {
      case 'play-object': {
        if (!player.unplayedObjectInstanceIds.includes(action.objectInstanceId)) {
          return { ok: false, error: 'Object not available to play' };
        }
        const permission = canPlayObject(state, playerId);
        if (!permission.allow) {
          return { ok: false, error: `Cannot play object (${permission.votes.map((v) => v.source).join(', ')})` };
        }
        return { ok: true };
      }
      case 'play-terrain': {
        if (!player.unplayedTerrainInstanceIds.includes(action.terrainInstanceId)) {
          return { ok: false, error: 'Terrain not available to play' };
        }
        return { ok: true };
      }
      case 'use-ability': {
        const char = player.characters[action.characterInstanceId];
        if (!char) return { ok: false, error: 'Unknown character' };
        const def = getCharacterCard(char.cardId);
        const ability = def.abilities.find((a) => a.id === action.abilityId);
        if (!ability) return { ok: false, error: 'Unknown ability' };
        if (ability.trigger) return { ok: false, error: 'This ability triggers automatically' };
        const permission = canUseAbility(state, action.characterInstanceId, ability);
        if (!permission.allow) {
          return { ok: false, error: `Ability not usable (${permission.votes.map((v) => v.source).join(', ')})` };
        }
        if (ability.condition) {
          const ctx = this.api.buildEffectContext(action.characterInstanceId, playerId);
          if (!ability.condition(ctx)) {
            return { ok: false, error: `Ability condition not met (${ability.name})` };
          }
        }
        return { ok: true };
      }
      case 'attack': {
        if (player.activeCharacterInstanceId !== action.characterInstanceId) {
          return { ok: false, error: 'Only the active character can attack' };
        }
        const char = player.characters[action.characterInstanceId];
        if (!char) return { ok: false, error: 'Unknown character' };
        const def = getCharacterCard(char.cardId);
        const attack = def.attacks.find((a) => a.id === action.attackId);
        if (!attack) return { ok: false, error: 'Unknown attack' };
        const permission = canAttack(state, action.characterInstanceId);
        if (!permission.allow) {
          return { ok: false, error: `Cannot attack (${permission.votes.map((v) => v.source).join(', ')})` };
        }
        if (attack.condition) {
          const ctx = this.api.buildEffectContext(action.characterInstanceId, playerId);
          if (!attack.condition(ctx)) {
            return { ok: false, error: `Attack condition not met (${attack.name})` };
          }
        }
        return { ok: true };
      }
      case 'switch': {
        if (!player.benchCharacterInstanceIds.includes(action.newActiveInstanceId)) {
          return { ok: false, error: 'Target is not on the bench' };
        }
        if (!player.activeCharacterInstanceId) return { ok: false, error: 'No active character to switch from' };
        const permission = canSwitchStandard(state, player.activeCharacterInstanceId);
        if (!permission.allow) {
          return { ok: false, error: `Cannot switch (${permission.votes.map((v) => v.source).join(', ')})` };
        }
        return { ok: true };
      }
      case 'pass':
        return { ok: true };
    }
  }

  private async runAction(playerId: PlayerId, action: PlayerAction): Promise<void> {
    const state = this.state;
    let endsTurn = false;

    switch (action.kind) {
      case 'play-object':
        endsTurn = await this.handlePlayObject(playerId, action.objectInstanceId);
        break;
      case 'play-terrain':
        await this.handlePlayTerrain(playerId, action.terrainInstanceId);
        break;
      case 'use-ability':
        await this.handleUseAbility(playerId, action.characterInstanceId, action.abilityId);
        break;
      case 'attack':
        endsTurn = await this.handleAttack(playerId, action.characterInstanceId, action.attackId);
        break;
      case 'switch':
        await zones.switchActive(state, playerId, action.newActiveInstanceId, this.api);
        endsTurn = true;
        break;
      case 'pass':
        this.api.log(`${playerId} passes`, {});
        endsTurn = true;
        break;
    }

    zones.checkWinCondition(state);
    if (state.result) return;
    if (endsTurn) await endTurn(state, this.api);
  }

  private async handlePlayObject(playerId: PlayerId, objectInstanceId: string): Promise<boolean> {
    const state = this.state;
    const player = state.players[playerId];
    const obj = player.objects[objectInstanceId]!;
    const def = getObjectCard(obj.cardId);

    const isSecondObject = player.objectsPlayedThisTurn >= 1;
    zones.moveObjectFromPoolToInPlay(state, playerId, objectInstanceId);
    player.objectsPlayedThisTurn += 1;

    this.api.log(`${playerId} plays object ${def.name}`, { objectInstanceId, cardId: def.id });
    await this.api.emitEvent({ name: 'onObjectPlayed', playerId, data: { objectInstanceId } });

    const ctx = this.api.buildEffectContext(objectInstanceId, playerId, undefined, false); // object effect, not an attack/ability
    await def.execute(ctx);

    if (!obj.attachedToCharacterInstanceId) {
      zones.moveObjectToGraveyard(state, playerId, objectInstanceId);
    }

    const isSecondPlayerFirstTurnException =
      isSecondObject && playerId !== state.startingPlayerId && !player.hasHadFirstTurn;
    return isSecondObject && !isSecondPlayerFirstTurnException;
  }

  private async handlePlayTerrain(playerId: PlayerId, terrainInstanceId: string): Promise<void> {
    const state = this.state;
    zones.moveTerrainFromPoolToActive(state, playerId, terrainInstanceId);
    const terrain = state.players[playerId].terrains[terrainInstanceId]!;
    const def = getTerrainCard(terrain.cardId);
    terrain.remainingTurns = def.durationTurns;
    this.api.log(`${playerId} plays terrain ${def.name}`, { terrainInstanceId });
    await this.api.emitEvent({ name: 'onTerrainPlayed', playerId, data: { terrainInstanceId } });
  }

  private async handleUseAbility(playerId: PlayerId, characterInstanceId: string, abilityId: string): Promise<void> {
    const state = this.state;
    const char = state.players[playerId].characters[characterInstanceId]!;
    const def = getCharacterCard(char.cardId);
    const ability = def.abilities.find((a) => a.id === abilityId)!;
    recordAbilityUse(char, abilityId);
    this.api.log(`${playerId} uses ability ${ability.name}`, { characterInstanceId, abilityId });
    const ctx = this.api.buildEffectContext(characterInstanceId, playerId);
    await ability.execute(ctx);
    await this.api.emitEvent({ name: 'onAbilityUsed', playerId, data: { characterInstanceId, abilityId } });
  }

  private async handleAttack(playerId: PlayerId, characterInstanceId: string, attackId: string): Promise<boolean> {
    const state = this.state;
    const char = state.players[playerId].characters[characterInstanceId]!;
    const def = getCharacterCard(char.cardId);
    const attack = def.attacks.find((a) => a.id === attackId)!;

    this.api.log(`${playerId} attacks with ${attack.name}`, { characterInstanceId, attackId });
    await this.api.emitEvent({ name: 'onAttackDeclared', playerId, data: { characterInstanceId, attackId } });
    if (state.result) return true;

    const ctx = this.api.buildEffectContext(characterInstanceId, playerId);
    await attack.execute(ctx);

    if (state.result) return true;
    if (typeof attack.endsTurn === 'function') return attack.endsTurn(ctx);
    return attack.endsTurn ?? true;
  }

  private buildApi(): EngineApi {
    const state = this.state;
    const self = this;
    const api: EngineApi = {
      rng: state.rng,

      async dealDamage(targetInstanceId, amount, options) {
        const target = findCharacter(state, targetInstanceId);
        const reduced = evaluateTransform(state, 'getIncomingDamageAmount', { targetInstanceId, source: options?.source }, amount);
        let finalAmount = Math.max(0, reduced);

        let shieldAbsorbed = 0;
        if (!options?.ignoreShield) {
          shieldAbsorbed = hp.absorbWithShield(target, finalAmount);
          finalAmount -= shieldAbsorbed;
          if (shieldAbsorbed > 0) {
            api.log(`${target.cardId}'s shield absorbs ${shieldAbsorbed} damage`, {
              targetInstanceId,
              absorbed: shieldAbsorbed,
              shieldRemaining: target.shield,
            });
          }
        }

        hp.dealDamage(target, finalAmount);
        api.log(`${target.cardId} takes ${finalAmount} damage`, { targetInstanceId, amount: finalAmount });
        await api.emitEvent({ name: 'afterDamage', data: { targetInstanceId, amount: finalAmount, shieldAbsorbed } });
        if (hp.isKO(target)) await api.koCharacter(targetInstanceId);
      },

      async applyValeurLock(targetInstanceId, amount) {
        const target = findCharacter(state, targetInstanceId);
        const reduced = evaluateTransform(state, 'getIncomingValeurLockAmount', { targetInstanceId }, amount);
        const finalAmount = Math.max(0, reduced);
        hp.applyValeurLock(target, finalAmount);
        api.log(`${target.cardId} loses ${finalAmount} max HP (valeur lock)`, { targetInstanceId, amount: finalAmount });
        if (hp.isKO(target)) await api.koCharacter(targetInstanceId);
      },

      heal(targetInstanceId, amount) {
        const target = findCharacter(state, targetInstanceId);
        const boosted = evaluateTransform(state, 'getIncomingHealAmount', { targetInstanceId }, amount);
        const finalAmount = Math.max(0, boosted);
        hp.heal(target, finalAmount);
        api.log(`${target.cardId} heals ${finalAmount}`, { targetInstanceId, amount: finalAmount });
      },

      raiseMaxHP(targetInstanceId, amount) {
        const target = findCharacter(state, targetInstanceId);
        hp.raiseMaxHP(target, amount);
        api.log(`${target.cardId} gains +${amount} max HP`, { targetInstanceId, amount });
      },

      addShield(targetInstanceId, amount) {
        const target = findCharacter(state, targetInstanceId);
        hp.addShield(target, amount);
        api.log(`${target.cardId} gains ${amount} shield`, { targetInstanceId, amount, shield: target.shield });
      },

      removeShield(targetInstanceId, amount) {
        const target = findCharacter(state, targetInstanceId);
        hp.removeShield(target, amount);
        api.log(`${target.cardId} loses shield`, { targetInstanceId, amount: amount ?? 'all', shield: target.shield });
      },

      applyStatus(targetInstanceId, status) {
        const target = findCharacter(state, targetInstanceId);
        statusesMod.applyStatus(target, status);
        api.log(`${target.cardId} gains status ${status.statusId}`, { targetInstanceId, statusId: status.statusId });
      },

      removeStatus(targetInstanceId, statusId) {
        const target = findCharacter(state, targetInstanceId);
        statusesMod.removeStatus(target, statusId);
      },

      async koCharacter(characterInstanceId) {
        await zones.koCharacter(state, characterInstanceId, api);
      },

      swapBenchCharacters(forPlayer, ownBenchInstanceId, enemyBenchInstanceId) {
        zones.swapBenchCharacters(state, forPlayer, ownBenchInstanceId, enemyBenchInstanceId);
      },

      attachObject(objectInstanceId, targetCharacterInstanceId) {
        const target = findCharacter(state, targetCharacterInstanceId);
        const max = getMaxAttachedObjects(state, targetCharacterInstanceId);
        if (target.attachedObjectInstanceIds.length >= max) {
          api.log(`Cannot attach object: ${target.cardId} already has the max number of attached objects`, {
            targetCharacterInstanceId,
          });
          return;
        }
        zones.attachObjectToCharacter(state, objectInstanceId, targetCharacterInstanceId);
      },

      destroyObject(objectInstanceId) {
        const owner = zones.findObjectOwner(state, objectInstanceId);
        const obj = state.players[owner].objects[objectInstanceId];
        zones.destroyObject(state, objectInstanceId);
        api.log(`${obj?.cardId} is destroyed`, { objectInstanceId, ownerId: owner });
      },

      extendTerrain(terrainInstanceId, turns) {
        const owner = zones.findTerrainOwner(state, terrainInstanceId);
        const terrain = state.players[owner].terrains[terrainInstanceId];
        zones.extendTerrainDuration(state, terrainInstanceId, turns);
        api.log(`${terrain?.cardId}'s duration is extended by ${turns} turn(s)`, { terrainInstanceId, turns, remainingTurns: terrain?.remainingTurns });
      },

      async shortenTerrain(terrainInstanceId, turns) {
        const owner = zones.findTerrainOwner(state, terrainInstanceId);
        const terrain = state.players[owner].terrains[terrainInstanceId];
        const cardId = terrain?.cardId;
        await zones.shortenTerrainDuration(state, terrainInstanceId, turns, api);
        api.log(`${cardId}'s duration is shortened by ${turns} turn(s)`, { terrainInstanceId, turns, remainingTurns: terrain?.remainingTurns });
      },

      async switchActive(playerId, newActiveInstanceId) {
        await zones.switchActive(state, playerId, newActiveInstanceId, api);
      },

      cloneCharacter(ownerId, sourceInstanceId, hpAmount, placement) {
        return zones.createCharacterClone(state, ownerId, sourceInstanceId, hpAmount, placement);
      },

      async emitEvent(event) {
        await emitEvent(state, event, api);
      },

      async chooseFor(playerId, spec) {
        return self.requestChoice(playerId, spec);
      },

      log(message, data) {
        state.log.push({ id: randomUUID(), turnNumber: state.turnNumber, message, data });
      },

      flipCoin() {
        return rngFlipCoin(state.rng);
      },

      buildEffectContext(sourceInstanceId, ownerId, event, isAttackOrAbility) {
        return buildEffectContext(state, sourceInstanceId, ownerId, api, event, isAttackOrAbility);
      },
    };
    return api;
  }
}
