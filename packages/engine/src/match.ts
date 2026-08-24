import { createRng, flipCoin as rngFlipCoin } from './rng.js';
import { randomUUID } from './uuid.js';
import { defaultChoiceAnswer } from './choices.js';
import { otherPlayer } from './types.js';
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
import {
  canAttack,
  canPlayObject,
  canPlayTerrain,
  canSwitchStandard,
  canUseAbility,
  describeDenials,
  describeObjectUnplayable,
  evaluatePermission,
  evaluateTransform,
  findCharacter,
  getMaxAttachedObjects,
} from './queries.js';
import { endTurn, startTurn } from './turn.js';
import { getPlayerView } from './view.js';
import { cardName, playerName } from './names.js';

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
    terrainsPlayedThisTurn: 0,
    hasHadFirstTurn: false,
    revealsOpponentUnplayedCards: false,
  };
}

/**
 * Answers arrive from the network: `kind` matching the prompt is not enough, the payload
 * itself is untrusted. Without this, a malformed (or hostile) answer put arbitrary
 * strings straight into card effects -- most of which then call `findCharacter`, which
 * throws, aborting the action *mid-resolution* and leaving the board in a half-applied
 * state (e.g. Absorption Vitale having already KO'd its target but never reviving).
 * Returns an error message, or null when the answer is well-formed.
 */
function validateChoiceAnswer(spec: ChoiceSpec, answer: ChoiceAnswer): string | null {
  const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((v) => typeof v === 'string');

  switch (spec.kind) {
    case 'select-characters': {
      if (answer.kind !== 'select-characters' || !isStringArray(answer.selected)) {
        return 'Réponse malformée : liste de personnages attendue';
      }
      if (new Set(answer.selected).size !== answer.selected.length) return 'Réponse malformée : doublons dans la sélection';
      if (answer.selected.some((id) => !spec.options.includes(id))) return 'Réponse malformée : personnage non proposé';
      if (answer.selected.length < spec.min || answer.selected.length > spec.max) {
        return `Réponse malformée : entre ${spec.min} et ${spec.max} personnage(s) attendu(s)`;
      }
      return null;
    }
    case 'select-option': {
      if (answer.kind !== 'select-option' || typeof answer.key !== 'string') return 'Réponse malformée : option attendue';
      if (!spec.options.some((o) => o.key === answer.key)) return 'Réponse malformée : option non proposée';
      return null;
    }
    case 'yes-no':
      return answer.kind === 'yes-no' && typeof answer.value === 'boolean' ? null : 'Réponse malformée : oui/non attendu';
    case 'order': {
      if (answer.kind !== 'order' || !isStringArray(answer.orderedKeys)) return 'Réponse malformée : ordre attendu';
      // A permutation, nothing else: emitEvent repairs partial answers, but accepting a
      // wrong-length or duplicate-laden one here just hides a broken client.
      const keys = spec.items.map((i) => i.key);
      if (answer.orderedKeys.length !== keys.length) return "Réponse malformée : l'ordre doit lister tous les éléments";
      if (new Set(answer.orderedKeys).size !== answer.orderedKeys.length) return 'Réponse malformée : doublons dans l’ordre';
      if (answer.orderedKeys.some((k) => !keys.includes(k))) return 'Réponse malformée : élément inconnu dans l’ordre';
      return null;
    }
  }
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
    // Le tirage se voit à l'écran (roue des joueurs) ; le journal n'en garde que le
    // résultat, sans le « pile ou face » qui n'a plus de contrepartie visuelle.
    match.api.log(`${playerName(state, startingPlayerId)} commence la partie`, { kind: 'initiative', startingPlayerId }, startingPlayerId);

    match.inFlight = match
      .runSetup()
      .catch((err) => {
        match.api.log(`Erreur pendant la mise en place : ${(err as Error).message}`, { kind: 'error', error: String(err) });
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
      // Un abandon pendant la mise en place a déjà clos la partie : reprendre la suite
      // remettrait `phase` sur 'main' et rouvrirait le plateau aux actions.
      if (state.result) return;
      const chosenId = answer.kind === 'select-characters' ? answer.selected[0] : undefined;
      const activeId = chosenId ?? options[0]!;
      player.activeCharacterInstanceId = activeId;
      player.benchCharacterInstanceIds = options.filter((optId) => optId !== activeId);
    }

    state.phase = 'main';
    state.turnNumber = 1;
    state.activePlayerId = state.startingPlayerId;

    // Emitted once both starting actives are on the board and before the very first
    // turn starts, so a card whose effect is meant to be live "from the start of the
    // game" (an innate esquive, a permanent aura...) has a reliable hook instead of
    // having to lazily self-initialise inside its first attack/turn trigger.
    await this.api.emitEvent({ name: 'onGameStart', data: {} });
    if (state.result) return;
    for (const playerId of ['p1', 'p2'] as PlayerId[]) {
      const activeId = state.players[playerId].activeCharacterInstanceId;
      if (!activeId) continue;
      await this.api.emitEvent({
        name: 'onBecomeActive',
        playerId,
        data: { characterInstanceId: activeId, reason: 'setup' },
      });
      if (state.result) return;
    }

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
    if (state.phase !== 'main') return { ok: false, error: "La partie n'est pas en cours" };
    if (state.pendingChoice) return { ok: false, error: 'Un choix est en attente de réponse' };
    if (this.inFlight) return { ok: false, error: 'Une autre action est en cours de résolution' };
    if (playerId !== state.activePlayerId) return { ok: false, error: "Ce n'est pas votre tour" };

    const validation = this.validateAction(playerId, action);
    if (!validation.ok) return validation;

    this.inFlight = this.runAction(playerId, action)
      .catch((err) => {
        this.api.log(`Erreur pendant l'action : ${(err as Error).message}`, { kind: 'error', error: String(err) });
      })
      .finally(() => {
        this.inFlight = null;
        this.notify();
      });
    return { ok: true };
  }

  /**
   * Abandon. Volontairement hors de `applyAction` : celui-ci commence par exiger que ce
   * soit votre tour et qu'aucun choix ne soit en attente, alors que renoncer doit rester
   * possible à tout moment -- c'est justement pendant le tour de l'autre qu'on décide de
   * quitter une partie.
   */
  forfeit(playerId: PlayerId): ActionResult {
    const state = this.state;
    if (state.result) return { ok: false, error: 'La partie est déjà terminée' };

    const winner = otherPlayer(playerId);
    state.result = { kind: 'win', winner, reason: 'forfeit' };
    state.phase = 'ended';
    this.api.log(`${playerName(state, playerId)} abandonne la partie`, { kind: 'forfeit', winner }, playerId);

    // Un choix encore ouvert n'aura plus jamais de réponse : le libérer avec la réponse
    // neutre plutôt que d'abandonner son resolver, sinon l'action en cours reste
    // suspendue pour toujours et le serveur garde un minuteur armé sur un prompt que
    // plus personne ne voit. Tous les points de reprise du moteur testent `state.result`,
    // donc la suite de l'effet ne peut plus changer l'issue.
    const pending = state.pendingChoice;
    if (pending) {
      const resolve = this.resolvers.get(pending.id);
      this.resolvers.delete(pending.id);
      state.pendingChoice = undefined;
      resolve?.(defaultChoiceAnswer(pending.spec));
    }

    this.notify();
    return { ok: true };
  }

  answerChoice(playerId: PlayerId, choiceId: string, answer: ChoiceAnswer): ActionResult {
    const pending = this.state.pendingChoice;
    if (!pending) return { ok: false, error: 'Aucun choix en attente' };
    if (pending.id !== choiceId) return { ok: false, error: 'Ce choix a déjà été remplacé' };
    if (pending.playerId !== playerId) return { ok: false, error: "Ce choix n'est pas le vôtre" };
    if (answer.kind !== pending.spec.kind) return { ok: false, error: 'Réponse incompatible avec le choix demandé' };
    const shapeError = validateChoiceAnswer(pending.spec, answer);
    if (shapeError) return { ok: false, error: shapeError };
    const resolve = this.resolvers.get(choiceId);
    if (!resolve) return { ok: false, error: 'Choix déjà répondu' };
    this.resolvers.delete(choiceId);
    this.state.pendingChoice = undefined;
    resolve(answer);
    this.notify();
    return { ok: true };
  }

  private requestChoice(playerId: PlayerId, spec: ChoiceSpec): Promise<ChoiceAnswer> {
    // The protocol carries exactly one pending choice. Overwriting a live one would
    // strand its resolver and hang the match forever, so fail loudly instead: a card
    // must await its prompts one at a time, never in parallel.
    if (this.state.pendingChoice) {
      throw new Error('A choice is already pending -- card effects must await prompts sequentially');
    }
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
          return { ok: false, error: "Cet objet n'est pas disponible" };
        }
        const permission = canPlayObject(state, playerId);
        if (!permission.allow) {
          return { ok: false, error: `Impossible de jouer un objet : ${describeDenials(permission.votes)}` };
        }
        const obj = player.objects[action.objectInstanceId];
        const def = obj ? getObjectCard(obj.cardId) : undefined;
        // Refus lisible propre à la carte, avant tout le reste : jouer une carte qui n'a
        // rien à cibler la consumerait dans le vide (cf. Annulation de territoire sans
        // terrain sur la table).
        const unplayable = describeObjectUnplayable(state, playerId, action.objectInstanceId);
        if (unplayable) return { ok: false, error: `${def?.name ?? 'Cette carte'} : ${unplayable}` };
        if (def?.condition) {
          const ctx = this.api.buildEffectContext(action.objectInstanceId, playerId, undefined, 'other');
          if (!def.condition(ctx)) {
            return { ok: false, error: `Conditions non remplies pour ${def.name}` };
          }
        }
        return { ok: true };
      }
      case 'play-terrain': {
        if (!player.unplayedTerrainInstanceIds.includes(action.terrainInstanceId)) {
          return { ok: false, error: "Ce terrain n'est pas disponible" };
        }
        const permission = canPlayTerrain(state, playerId);
        if (!permission.allow) {
          return { ok: false, error: `Impossible de poser un terrain : ${describeDenials(permission.votes)}` };
        }
        return { ok: true };
      }
      case 'use-ability': {
        const char = player.characters[action.characterInstanceId];
        if (!char) return { ok: false, error: 'Personnage inconnu' };
        const def = getCharacterCard(char.cardId);
        const ability = def.abilities.find((a) => a.id === action.abilityId);
        if (!ability) return { ok: false, error: 'Capacité inconnue' };
        // Only `kind: 'active'` abilities are player-activated. A passive either reacts to
        // an event (`trigger`) or is purely descriptive text for a mechanic implemented in
        // a modifier/attack -- "using" one would burn a use and log an activation for an
        // empty execute().
        if (ability.trigger) return { ok: false, error: 'Cette capacité se déclenche automatiquement' };
        if (ability.kind !== 'active') return { ok: false, error: 'Cette capacité est passive' };
        const permission = canUseAbility(state, action.characterInstanceId, ability);
        if (!permission.allow) {
          return { ok: false, error: `${ability.name} inutilisable : ${describeDenials(permission.votes)}` };
        }
        if (ability.condition) {
          const ctx = this.api.buildEffectContext(action.characterInstanceId, playerId);
          if (!ability.condition(ctx)) {
            return { ok: false, error: `Conditions non remplies pour ${ability.name}` };
          }
        }
        return { ok: true };
      }
      case 'attack': {
        if (player.activeCharacterInstanceId !== action.characterInstanceId) {
          return { ok: false, error: 'Seul le personnage actif peut attaquer' };
        }
        const char = player.characters[action.characterInstanceId];
        if (!char) return { ok: false, error: 'Personnage inconnu' };
        const def = getCharacterCard(char.cardId);
        const attack = def.attacks.find((a) => a.id === action.attackId);
        if (!attack) return { ok: false, error: 'Attaque inconnue' };
        const permission = canAttack(state, action.characterInstanceId);
        if (!permission.allow) {
          return { ok: false, error: `Impossible d'attaquer : ${describeDenials(permission.votes)}` };
        }
        if (attack.condition) {
          const ctx = this.api.buildEffectContext(action.characterInstanceId, playerId);
          if (!attack.condition(ctx)) {
            return { ok: false, error: `Conditions non remplies pour ${attack.name}` };
          }
        }
        return { ok: true };
      }
      case 'switch': {
        if (!player.benchCharacterInstanceIds.includes(action.newActiveInstanceId)) {
          return { ok: false, error: "Cette cible n'est pas sur le banc" };
        }
        if (!player.activeCharacterInstanceId) return { ok: false, error: 'Aucun personnage actif' };
        const permission = canSwitchStandard(state, player.activeCharacterInstanceId);
        if (!permission.allow) {
          return { ok: false, error: `Switch impossible : ${describeDenials(permission.votes)}` };
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
        this.api.log(`${playerName(state, playerId)} passe son tour`, { kind: 'pass' }, playerId);
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

    this.api.log(`${playerName(state, playerId)} joue l'objet ${def.name}`, { kind: 'play-object', objectInstanceId, cardId: def.id }, playerId);
    await this.api.emitEvent({ name: 'onObjectPlayed', playerId, data: { objectInstanceId } });

    const ctx = this.api.buildEffectContext(objectInstanceId, playerId, undefined, 'other'); // object effect, not an attack/ability
    try {
      await def.execute(ctx);
    } finally {
      // A one-shot object always leaves play, including when its effect threw -- left in
      // `inPlayObjectInstanceIds` it would keep contributing its modifiers for the rest
      // of the game.
      if (!obj.attachedToCharacterInstanceId) {
        zones.moveObjectToGraveyard(state, playerId, objectInstanceId);
      }
    }

    // Section 3: playing a second object in a turn is a *final* action. The second
    // player gets one free pass on their very first turn to make up for the initiative
    // -- scoped to the second object exactly, so the exception can't be re-claimed by a
    // third, fourth... object (the per-turn cap in validateAction backs this up).
    const isSecondPlayerFirstTurnException =
      player.objectsPlayedThisTurn === 2 && playerId !== state.startingPlayerId && !player.hasHadFirstTurn;
    return isSecondObject && !isSecondPlayerFirstTurnException;
  }

  private async handlePlayTerrain(playerId: PlayerId, terrainInstanceId: string): Promise<void> {
    const state = this.state;
    // moveTerrainFromPoolToActive already stamps the new terrain's duration before it
    // announces the replaced one, so a card reacting to `onTerrainRemoved` never sees
    // the incoming terrain with an undefined (= "indefinite") duration.
    await zones.moveTerrainFromPoolToActive(state, playerId, terrainInstanceId, this.api);
    const terrain = state.players[playerId].terrains[terrainInstanceId]!;
    const def = getTerrainCard(terrain.cardId);
    state.players[playerId].terrainsPlayedThisTurn += 1;
    this.api.log(`${playerName(state, playerId)} pose le terrain ${def.name}`, { kind: 'play-terrain', terrainInstanceId, cardId: def.id }, playerId);
    // A reaction to the replacement could already have destroyed what we just posed;
    // firing its on-play effects afterwards would be announcing an arrival that no
    // longer holds.
    if (state.players[playerId].activeTerrainInstanceId !== terrainInstanceId) return;
    await this.api.emitEvent({ name: 'onTerrainPlayed', playerId, data: { terrainInstanceId } });
  }

  private async handleUseAbility(playerId: PlayerId, characterInstanceId: string, abilityId: string): Promise<void> {
    const state = this.state;
    const char = state.players[playerId].characters[characterInstanceId]!;
    const def = getCharacterCard(char.cardId);
    const ability = def.abilities.find((a) => a.id === abilityId)!;
    recordAbilityUse(char, abilityId);
    this.api.log(`${cardName(char.cardId)} utilise ${ability.name}`, { kind: 'use-ability', characterInstanceId, abilityId }, playerId);
    const ctx = this.api.buildEffectContext(characterInstanceId, playerId);
    await ability.execute(ctx);
    await this.api.emitEvent({ name: 'onAbilityUsed', playerId, data: { characterInstanceId, abilityId } });
  }

  private async handleAttack(playerId: PlayerId, characterInstanceId: string, attackId: string): Promise<boolean> {
    const state = this.state;
    const char = state.players[playerId].characters[characterInstanceId]!;
    const def = getCharacterCard(char.cardId);
    const attack = def.attacks.find((a) => a.id === attackId)!;

    this.api.log(`${cardName(char.cardId)} attaque avec ${attack.name}`, { kind: 'attack', characterInstanceId, attackId }, playerId);
    await this.api.emitEvent({ name: 'onAttackDeclared', playerId, data: { characterInstanceId, attackId } });
    if (state.result) return true;

    const ctx = this.api.buildEffectContext(characterInstanceId, playerId, undefined, 'attack');
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
        // A character already in the graveyard is out of the game: further damage
        // instances aimed at it (a lingering AoE loop, a status tick resolved after a
        // KO, a chain of triggers) must be no-ops rather than piling damage onto a
        // corpse and re-emitting afterDamage/onCharacterKO for it.
        if (!api.isOnBoard(targetInstanceId)) return;
        const target = findCharacter(state, targetInstanceId);
        const attribution = {
          sourceInstanceId: options?.attackerInstanceId,
          sourceOwnerId: options?.attackerInstanceId
            ? zones.safeFindCharacterOwner(state, options.attackerInstanceId)
            : undefined,
          damageSource: options?.source,
        };

        const damageQuery = {
          targetInstanceId,
          source: options?.source,
          attackerInstanceId: options?.attackerInstanceId,
          attackerOwnerId: options?.attackerOwnerId,
        };
        // "Vulnérable" amplifies on the receiving side, before any card's reduction, so a
        // flat/percent damage reduction still applies to the real incoming number. Left out
        // of the `ignoreDamageReduction` path, which is how a character pays an HP cost to
        // itself -- see getVulnerableDamageMultiplier.
        const amplified = options?.ignoreDamageReduction
          ? amount
          : Math.round(amount * statusesMod.getVulnerableDamageMultiplier(target));
        const reduced = options?.ignoreDamageReduction
          ? amplified
          : evaluateTransform(state, 'getIncomingDamageAmount', damageQuery, amplified);
        let finalAmount = Math.max(0, reduced);

        let shieldAbsorbed = 0;
        const shieldPermission = evaluatePermission(state, 'canShieldAbsorb', { targetInstanceId }, true);
        if (!options?.ignoreShield && shieldPermission.allow) {
          shieldAbsorbed = hp.absorbWithShield(target, finalAmount);
          finalAmount -= shieldAbsorbed;
          if (shieldAbsorbed > 0) {
            api.log(`Le bouclier de ${cardName(target.cardId)} absorbe ${shieldAbsorbed} dégâts`, {
              kind: 'shield-absorb',
              targetInstanceId,
              absorbed: shieldAbsorbed,
              shieldRemaining: target.shield,
            });
          }
        }

        if (statusesMod.hasDeathWard(target)) {
          finalAmount = Math.min(finalAmount, Math.max(0, hp.getCurrentHP(target) - 1));
        }

        hp.dealDamage(target, finalAmount);
        api.log(`${cardName(target.cardId)} subit ${finalAmount} dégâts`, { kind: 'damage', targetInstanceId, amount: finalAmount });
        await api.emitEvent({
          name: 'afterDamage',
          data: { targetInstanceId, amount: finalAmount, shieldAbsorbed, ...attribution },
        });
        if (hp.isKO(target)) await api.koCharacter(targetInstanceId, options?.attackerInstanceId);
      },

      async applyValeurLock(targetInstanceId, amount, options) {
        if (!api.isOnBoard(targetInstanceId)) return;
        const target = findCharacter(state, targetInstanceId);
        const reduced = evaluateTransform(
          state,
          'getIncomingValeurLockAmount',
          { targetInstanceId, attackerInstanceId: options?.attackerInstanceId, attackerOwnerId: options?.attackerOwnerId },
          amount
        );
        const finalAmount = Math.max(0, reduced);
        hp.applyValeurLock(target, finalAmount);
        api.log(`${cardName(target.cardId)} perd ${finalAmount} HP max (valeur lock)`, {
          kind: 'valeur-lock',
          targetInstanceId,
          amount: finalAmount,
        });
        // Same attribution as ordinary damage: a valeur-lock kill (Mahito's Paume
        // Transfiguratrice, a Sang Maudit poison tick) has to name its killer too,
        // otherwise every "on kill" passive silently misses it.
        if (hp.isKO(target)) await api.koCharacter(targetInstanceId, options?.attackerInstanceId);
      },

      poisonTicksAsValeurLock(targetInstanceId) {
        return evaluatePermission(state, 'poisonTicksAsValeurLock', { targetInstanceId }, false).allow;
      },

      heal(targetInstanceId, amount) {
        if (!api.isOnBoard(targetInstanceId)) return;
        const target = findCharacter(state, targetInstanceId);
        const boosted = evaluateTransform(state, 'getIncomingHealAmount', { targetInstanceId }, amount);
        const finalAmount = Math.max(0, boosted);
        if (finalAmount <= 0) return;
        // Report what was actually restored, not what was requested: healing a character
        // that is already (nearly) full otherwise logs a number nothing on the board matches.
        const restored = Math.min(finalAmount, target.damage);
        hp.heal(target, finalAmount);
        // A heal that restores nothing (the target is already full) still counts as a
        // heal for bleed, but logging "récupère 0 HP" is pure noise on the board.
        if (restored > 0) {
          api.log(`${cardName(target.cardId)} récupère ${restored} HP`, { kind: 'heal', targetInstanceId, amount: restored, requested: finalAmount });
        }
        if (statusesMod.hasStatus(target, 'bleed')) {
          statusesMod.removeStatus(target, 'bleed');
          api.log(`Le saignement de ${cardName(target.cardId)} est stoppé par le soin`, { kind: 'heal', targetInstanceId });
        }
      },

      raiseMaxHP(targetInstanceId, amount) {
        if (!api.isOnBoard(targetInstanceId)) return;
        const target = findCharacter(state, targetInstanceId);
        hp.raiseMaxHP(target, amount);
        api.log(`${cardName(target.cardId)} gagne +${amount} HP max`, { kind: 'max-hp', targetInstanceId, amount });
      },

      addShield(targetInstanceId, amount) {
        if (!api.isOnBoard(targetInstanceId)) return;
        const target = findCharacter(state, targetInstanceId);
        hp.addShield(target, amount);
        api.log(`${cardName(target.cardId)} gagne ${amount} de bouclier`, { kind: 'shield', targetInstanceId, amount, shield: target.shield });
      },

      removeShield(targetInstanceId, amount) {
        if (!api.isOnBoard(targetInstanceId)) return;
        const target = findCharacter(state, targetInstanceId);
        hp.removeShield(target, amount);
        const lost = amount === undefined ? 'tout son bouclier' : amount + ' de bouclier';
        api.log(`${cardName(target.cardId)} perd ${lost}`, { kind: 'shield', targetInstanceId, amount: amount ?? 'all', shield: target.shield });
      },

      applyStatus(targetInstanceId, status) {
        // Same rule as dealDamage/heal: a character in the graveyard is out of the game.
        // Buffing or debuffing a corpse only ever produced ghost badges on the graveyard
        // thumbnails (a revive wipes statuses anyway).
        if (!api.isOnBoard(targetInstanceId)) return;
        const target = findCharacter(state, targetInstanceId);
        statusesMod.applyStatus(target, status);
        // A card's private bookkeeping status is not an event anyone wants to read about.
        if (status.hidden) return;
        api.log(`${cardName(target.cardId)} : ${status.label || status.statusId}`, { kind: 'status', targetInstanceId, statusId: status.statusId });
      },

      removeStatus(targetInstanceId, statusId) {
        // Deliberately NOT board-gated: cleaning a status off a character that just died
        // (Coeur Acier's mark, Absorption Vitale's seal) has to keep working.
        const target = zones.safeFindCharacterOwner(state, targetInstanceId)
          ? findCharacter(state, targetInstanceId)
          : undefined;
        if (target) statusesMod.removeStatus(target, statusId);
      },

      async koCharacter(characterInstanceId, killerInstanceId) {
        await zones.koCharacter(state, characterInstanceId, api, killerInstanceId);
      },

      async reviveCharacter(characterInstanceId, hp, placement) {
        const ownerId = zones.findCharacterOwner(state, characterInstanceId);
        zones.reviveCharacter(state, characterInstanceId, hp, placement);
        api.log(`${cardName(findCharacter(state, characterInstanceId).cardId)} revient en jeu avec ${hp} HP`, { kind: 'revive', characterInstanceId, hp, placement });
        await api.emitEvent({ name: 'onCharacterRevived', playerId: ownerId, data: { characterInstanceId } });
      },

      swapBenchCharacters(forPlayer, ownBenchInstanceId, enemyBenchInstanceId) {
        zones.swapBenchCharacters(state, forPlayer, ownBenchInstanceId, enemyBenchInstanceId);
      },

      attachObject(objectInstanceId, targetCharacterInstanceId) {
        const target = findCharacter(state, targetCharacterInstanceId);
        const max = getMaxAttachedObjects(state, targetCharacterInstanceId);
        if (target.attachedObjectInstanceIds.length >= max) {
          api.log(`Équipement impossible : ${cardName(target.cardId)} porte déjà le maximum d'objets`, {
            kind: 'info',
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
        api.log(`${cardName(obj?.cardId ?? '')} est détruit`, { kind: 'destroy-object', objectInstanceId, ownerId: owner });
      },

      extendTerrain(terrainInstanceId, turns) {
        const owner = zones.findTerrainOwner(state, terrainInstanceId);
        const terrain = state.players[owner].terrains[terrainInstanceId];
        zones.extendTerrainDuration(state, terrainInstanceId, turns);
        api.log(`${cardName(terrain?.cardId ?? '')} : durée prolongée de ${turns} tour(s)`, { kind: 'terrain-duration', terrainInstanceId, turns, remainingTurns: terrain?.remainingTurns });
      },

      async shortenTerrain(terrainInstanceId, turns) {
        const owner = zones.findTerrainOwner(state, terrainInstanceId);
        const terrain = state.players[owner].terrains[terrainInstanceId];
        const cardId = terrain?.cardId;
        await zones.shortenTerrainDuration(state, terrainInstanceId, turns, api);
        api.log(`${cardName(cardId ?? '')} : durée réduite de ${turns} tour(s)`, { kind: 'terrain-duration', terrainInstanceId, turns, remainingTurns: terrain?.remainingTurns });
      },

      async destroyTerrain(terrainInstanceId) {
        const owner = zones.findTerrainOwner(state, terrainInstanceId);
        const player = state.players[owner];
        if (player.activeTerrainInstanceId !== terrainInstanceId) return;
        const cardId = player.terrains[terrainInstanceId]?.cardId;
        zones.removeActiveTerrain(state, owner);
        api.log(`${cardName(cardId ?? '')} est détruit`, { kind: 'terrain-removed', terrainInstanceId }, owner);
        await api.emitEvent({ name: 'onTerrainRemoved', playerId: owner, data: { terrainInstanceId, reason: 'destroyed' } });
      },

      async switchActive(playerId, newActiveInstanceId) {
        await zones.switchActive(state, playerId, newActiveInstanceId, api);
      },

      cloneCharacter(ownerId, sourceInstanceId, hpAmount, placement) {
        return zones.createCharacterClone(state, ownerId, sourceInstanceId, hpAmount, placement);
      },

      createObject(ownerId, cardId) {
        const instanceId = randomUUID();
        const player = state.players[ownerId];
        player.objects[instanceId] = { instanceId, cardId, ownerId };
        player.unplayedObjectInstanceIds.push(instanceId);
        api.log(`${playerName(state, ownerId)} récupère une nouvelle carte objet`, { kind: 'gain-object', instanceId, cardId }, ownerId);
        return instanceId;
      },

      async emitEvent(event) {
        await emitEvent(state, event, api);
      },

      async chooseFor(playerId, spec) {
        return self.requestChoice(playerId, spec);
      },

      log(message, data, playerId) {
        state.log.push({ id: randomUUID(), turnNumber: state.turnNumber, message, data, playerId });
      },

      flipCoin() {
        return rngFlipCoin(state.rng);
      },

      isOnBoard(characterInstanceId) {
        for (const playerId of ['p1', 'p2'] as PlayerId[]) {
          const player = state.players[playerId];
          if (player.activeCharacterInstanceId === characterInstanceId) return true;
          if (player.benchCharacterInstanceIds.includes(characterInstanceId)) return true;
        }
        return false;
      },

      buildEffectContext(sourceInstanceId, ownerId, event, damageSource) {
        return buildEffectContext(state, sourceInstanceId, ownerId, api, event, damageSource);
      },
    };
    return api;
  }
}
