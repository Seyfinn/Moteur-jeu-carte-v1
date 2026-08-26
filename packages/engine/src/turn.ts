import type { EngineApi } from './engine-api.js';
import { getStatus, removeStatus, tickStatusesAtTurnStart } from './statuses.js';
import { checkWinCondition, tickPendingRevives, tickTerrainAtTurnStart } from './zones.js';
import { otherPlayer, type GameState, type PlayerId } from './types.js';
import { cardName, playerName } from './names.js';
import { getCharacterCard } from './cards/registry.js';
import { canAttack, getEffectiveATK } from './queries.js';
import { drawAtEndOfTurn, refillBenchFromHand } from './draw-mode.js';

/**
 * 'forced-attack' ("Manipulation" de Makima) : l'actif manipulé frappe un personnage de
 * son PROPRE banc, puis son tour s'arrête là. Résolu ici plutôt que par un passive de
 * Makima parce que rien, côté carte, ne peut agir pendant le tour d'en face ni fermer le
 * tour d'un autre joueur -- c'est la même raison qui met 'chained' ou 'linked' dans le
 * moteur (cf. CLAUDE.md).
 *
 * Le statut est consommé dès qu'il est lu, quoi qu'il arrive ensuite : une manipulation
 * dont la cible est morte entre-temps est perdue, elle ne reste pas armée pour plus tard.
 * Renvoie true quand le tour du porteur doit se terminer immédiatement.
 */
async function resolveForcedAttack(state: GameState, api: EngineApi): Promise<boolean> {
  const player = state.players[state.activePlayerId];
  const activeId = player.activeCharacterInstanceId;
  const active = activeId ? player.characters[activeId] : undefined;
  if (!activeId || !active) return false;

  const forced = getStatus(active, 'forced-attack');
  if (!forced) return false;
  removeStatus(active, 'forced-attack');

  const targetInstanceId = String(forced.data?.['targetInstanceId'] ?? '');
  // La cible doit toujours être sur le banc de ce camp : morte, promue actif ou partie
  // ailleurs entre-temps, il n'y a plus personne à frapper et le tour reprend son cours.
  if (!player.benchCharacterInstanceIds.includes(targetInstanceId)) return false;

  const attacks = getCharacterCard(active.cardId).attacks.filter((a) => canAttack(state, activeId, a.id).allow);
  if (attacks.length === 0) return false;

  let chosen = attacks[0]!;
  if (attacks.length > 1) {
    const answer = await api.chooseFor(player.id, {
      kind: 'select-option',
      prompt: `${cardName(active.cardId)} est manipulé : choisissez l'attaque qu'il porte sur son propre banc`,
      options: attacks.map((a) => ({ key: a.id, label: `${a.name} (${a.baseATK} ATK)` })),
    });
    const key = answer.kind === 'select-option' ? answer.key : undefined;
    chosen = attacks.find((a) => a.id === key) ?? chosen;
  }

  const target = player.characters[targetInstanceId]!;
  api.log(
    `${cardName(active.cardId)}, manipulé, retourne ${chosen.name} contre ${cardName(target.cardId)}`,
    { kind: 'attack', characterInstanceId: activeId, attackId: chosen.id, targetInstanceId },
    player.id
  );
  // Seuls les dégâts de l'attaque sont retournés, pas le corps de son `execute()` : celui-ci
  // vise en dur l'actif d'en face (poison, statuts, effets annexes) et le faire tourner sur
  // un allié le ferait mentir. La valeur est bien l'ATK *effectif* -- buffs et malus compris.
  const amount = getEffectiveATK(state, activeId, chosen.baseATK);
  await api.dealDamage(targetInstanceId, amount, { attackerInstanceId: activeId, attackerOwnerId: player.id });
  if (state.result) return false;

  api.log(`${playerName(state, player.id)} perd son tour : ${cardName(active.cardId)} était manipulé`, { kind: 'pass' }, player.id);
  return true;
}

export async function startTurn(state: GameState, api: EngineApi): Promise<void> {
  const player = state.players[state.activePlayerId];
  player.objectsPlayedThisTurn = 0;
  player.terrainsPlayedThisTurn = 0;

  // Invariant repair: a player holding bench characters but no active one can do
  // nothing but pass forever (every action needs an active character, and the win
  // check only looks at "any character on board"). This normally can't happen -- a KO
  // pulls a replacement immediately -- but a revive onto an empty board while the
  // active slot is vacant would leave exactly that state.
  if (player.activeCharacterInstanceId === null && player.benchCharacterInstanceIds.length > 0) {
    const promoted = player.benchCharacterInstanceIds.shift()!;
    player.activeCharacterInstanceId = promoted;
    api.log(
      `${player.displayName} n'a plus de personnage actif : ${cardName(player.characters[promoted]?.cardId ?? '')} prend sa place`,
      { kind: 'switch', characterInstanceId: promoted },
      player.id
    );
    await api.emitEvent({
      name: 'onBecomeActive',
      playerId: player.id,
      data: { characterInstanceId: promoted, reason: 'ko-replacement' },
    });
    if (state.result) return;
  }
  // Per-turn ability budgets are refreshed for BOTH sides, not just the player whose
  // turn is starting. An active ability is only ever usable on its owner's own turn, so
  // this changes nothing for those -- but a *passive* reacting to an opponent's action
  // (afterDamage, onCharacterKO...) used to be silently blocked by the use it had
  // already spent during its own last turn, since its counter only reset two turns later.
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const side = state.players[pid];
    const ids = [side.activeCharacterInstanceId, ...side.benchCharacterInstanceIds].filter(
      (id): id is string => id !== null
    );
    for (const id of ids) {
      const char = side.characters[id];
      if (char) char.abilityUsesThisTurn = {};
    }
  }

  await api.emitEvent({ name: 'onTurnStart', playerId: state.activePlayerId, data: {} });
  if (state.result) return;
  await tickStatusesAtTurnStart(state, state.activePlayerId, api);
  await tickTerrainAtTurnStart(state, state.activePlayerId, api);
  // After the status ticks so a character coming back this turn ("Pheonix") lands before
  // its owner acts, and isn't immediately hit by the ticks of a body it no longer has.
  await tickPendingRevives(state, state.activePlayerId, api);
  checkWinCondition(state);
  if (state.result) return;

  // En dernier, juste avant de rendre la main au joueur : le tour qui commence peut être
  // aussitôt refermé. Pas de ping-pong possible, le statut est consommé à la lecture, donc
  // le `startTurn` d'en face ne retrouvera rien à résoudre.
  if (await resolveForcedAttack(state, api)) {
    checkWinCondition(state);
    if (state.result) return;
    await endTurn(state, api);
  }
}

export async function endTurn(state: GameState, api: EngineApi): Promise<void> {
  const endingPlayer = state.activePlayerId;
  state.players[endingPlayer].hasHadFirstTurn = true;
  await api.emitEvent({ name: 'onTurnEnd', playerId: endingPlayer, data: {} });
  if (state.result) return;

  // Mode Pioche : « à la toute fin du tour », donc après les effets de fin de tour et
  // avant que la main ne change de camp. Un personnage pioché peut compléter le banc, d'où
  // le rattrapage juste derrière.
  await drawAtEndOfTurn(state, endingPlayer, api);
  await refillBenchFromHand(state, endingPlayer, api);
  checkWinCondition(state);
  if (state.result) return;

  // "Za Warudo !" : le même joueur rouvre un tour complet au lieu de passer la main. La
  // marque est consommée AVANT de relancer `startTurn`, donc une seule pose ne peut jamais
  // donner deux tours bonus. `turnNumber` ne bouge pas : la manche n'a pas fait le tour des
  // deux joueurs, et les durées de statuts se comptent en tours de leur porteur -- le tour
  // bonus en est un vrai, il les fait donc tiquer une seconde fois, ce qui est voulu.
  if (state.pendingExtraTurnFor === endingPlayer) {
    state.pendingExtraTurnFor = undefined;
    api.log(`${playerName(state, endingPlayer)} rejoue immédiatement un second tour`, { kind: 'info' }, endingPlayer);
    await startTurn(state, api);
    return;
  }

  state.activePlayerId = otherPlayer(endingPlayer);
  // Un tour de jeu, c'est un tour pour les DEUX joueurs (comme aux échecs) : le compteur
  // n'avance qu'en revenant à celui qui ouvre la manche. Les durées, elles, se comptent
  // toujours en tours de leur porteur -- soit exactement une fois par manche, donc « 3
  // tours » sur une carte veut bien dire 3 tours au sens du compteur affiché.
  if (state.activePlayerId === state.startingPlayerId) state.turnNumber += 1;
  await startTurn(state, api);
}
