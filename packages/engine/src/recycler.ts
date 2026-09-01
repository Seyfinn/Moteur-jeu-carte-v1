import { randomUUID } from './uuid.js';
import { getObjectCard } from './cards/registry.js';
import { buildObjectPile } from './draw-mode.js';
import { createRng, randomInt, type RngState } from './rng.js';
import { cardName, playerName } from './names.js';
import type { EngineApi } from './engine-api.js';
import type { GameState, PlayerId, PlayerState } from './types.js';

/**
 * Le Recycleur d'Objets : combien de cartes objet il faut lui donner pour en recevoir une.
 * Transversal aux trois modes de jeu (Normal, Aléatoire, Pioche).
 */
export const RECYCLE_OBJECT_COST = 3;

/** Mélange sur place avec le RNG seedé de la partie (Fisher-Yates), comme le fait la pioche. */
function shuffleInPlace(rng: RngState, ids: string[]): void {
  for (let i = ids.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
}

/**
 * Décale le seed de la partie pour donner à la réserve son **propre** flux aléatoire.
 *
 * Monter les réserves depuis `state.rng` consommerait des centaines de tirages sur le flux
 * commun, et décalerait donc TOUT ce qui vient après dans une partie à seed connu : choix de
 * mise en place, jets de critique, d'esquive... Une partie rejouée au même seed ne se
 * déroulait plus pareil, et des tests scellés sur un seed basculaient (un critique
 * supplémentaire suffisait à tuer une cible et à ouvrir un prompt de remplacement).
 * Un flux dérivé reste parfaitement déterministe et reproductible, sans rien coûter au flux
 * de la partie. La constante est le nombre d'or en 32 bits, le mélangeur habituel.
 */
function reserveRng(seed: number): RngState {
  return createRng((seed ^ 0x9e3779b9) >>> 0);
}

/**
 * La réserve d'objets d'un joueur en mode **standard** (Normal / Aléatoire), qui n'a pas de
 * pioche : tout le catalogue d'objets (chaque carte autant de fois que son `maxCopies`
 * l'autorise, comme la pile du Mode Pioche), mélangé, **moins** les exemplaires déjà servis
 * dans la main de départ.
 *
 * C'est la seule chose qui donne un sens au Recycleur hors Mode Pioche : sans elle il n'y
 * aurait rien à piocher, et l'échange ne pourrait rendre qu'une des cartes qu'on vient de
 * sacrifier. Corollaire assumé : la carte reçue peut être un objet qui n'était pas dans le
 * deck construit -- les quotas de deck (`maxCopies`, `incompatibleWith`) sont des règles de
 * **construction**, pas des règles de jeu, et ne s'appliquent pas à un tirage en partie.
 */
export function buildStandardObjectReserve(seed: number, handCardIds: readonly string[]): string[] {
  const pile = buildObjectPile(reserveRng(seed));
  for (const cardId of handCardIds) {
    const index = pile.indexOf(cardId);
    if (index !== -1) pile.splice(index, 1);
  }
  return pile;
}

/**
 * Le refus lisible du recyclage, évalué sur le seul `GameState` -- donc calculable côté
 * client aussi. Même contrat que `describeObjectUnplayable` : le serveur refuse l'action
 * avec cette phrase et l'interface grise le recycleur avec exactement la même. `null` = rien
 * à signaler.
 *
 * `selectedIds` est optionnel : sans lui, la question posée est « ce joueur peut-il recycler
 * quoi que ce soit ? » (ce que la zone du recycleur affiche en permanence) ; avec, on valide
 * en plus la sélection précise que le joueur s'apprête à envoyer.
 */
export function describeRecycleUnavailable(
  state: GameState,
  playerId: PlayerId,
  selectedIds?: readonly string[]
): string | null {
  if (state.phase !== 'main') return "La partie n'est pas en cours";
  if (state.activePlayerId !== playerId) return "Ce n'est pas votre tour";

  const player = state.players[playerId];
  if (player.unplayedObjectInstanceIds.length < RECYCLE_OBJECT_COST) {
    return `Il faut ${RECYCLE_OBJECT_COST} objets en main pour recycler`;
  }
  if (!selectedIds) return null;

  if (selectedIds.length !== RECYCLE_OBJECT_COST) {
    return `Il faut sélectionner exactement ${RECYCLE_OBJECT_COST} objets`;
  }
  if (new Set(selectedIds).size !== selectedIds.length) return 'Doublons dans la sélection';
  if (selectedIds.some((id) => !player.unplayedObjectInstanceIds.includes(id))) {
    return "Un des objets sélectionnés n'est pas dans votre main";
  }
  return null;
}

/**
 * L'échange lui-même : les `RECYCLE_OBJECT_COST` cartes quittent la main pour la réserve
 * (jamais le cimetière -- elles doivent pouvoir ressortir), la réserve est remélangée, puis
 * une carte en est tirée et rejoint la main. Dans cet ordre : la carte reçue peut donc être
 * une de celles qu'on vient de sacrifier, ce qui est aussi ce qui permet à l'échange de
 * fonctionner sur une réserve autrement vide.
 *
 * Le recyclage ne consomme ni le tour ni le budget d'objets jouables : `objectsPlayedThisTurn`
 * n'est volontairement pas touché ici, et `runAction` ne ferme pas le tour dessus.
 *
 * Renvoie le cardId reçu.
 */
export function recycleObjects(
  state: GameState,
  playerId: PlayerId,
  objectInstanceIds: readonly string[],
  api: EngineApi
): string {
  const player = state.players[playerId];
  const pile = player.drawPiles.objectCardIds;

  const sacrificed: string[] = [];
  for (const instanceId of objectInstanceIds) {
    const obj = player.objects[instanceId];
    if (!obj) continue;
    sacrificed.push(obj.cardId);
    delete player.objects[instanceId];
  }
  const removed = new Set(objectInstanceIds);
  player.unplayedObjectInstanceIds = player.unplayedObjectInstanceIds.filter((id) => !removed.has(id));

  pile.push(...sacrificed);
  shuffleInPlace(state.rng, pile);

  // `pile` contient au moins les cartes qu'on vient d'y remettre : le tirage aboutit
  // toujours. Le `!` n'est là que pour le typage.
  const drawnCardId = pile.pop()!;
  const instanceId = randomUUID();
  getObjectCard(drawnCardId); // carte inconnue = on veut l'erreur ici, pas plus tard en jeu
  player.objects[instanceId] = { instanceId, cardId: drawnCardId, ownerId: playerId };
  player.unplayedObjectInstanceIds.push(instanceId);

  // Le journal est commun aux deux camps et la main est secrète : publiquement on ne dit que
  // le geste et son coût, jamais quelles cartes sont parties ni laquelle est arrivée.
  api.log(
    `${playerName(state, playerId)} recycle ${RECYCLE_OBJECT_COST} objets et en tire un nouveau`,
    { kind: 'recycle', playerId, count: RECYCLE_OBJECT_COST },
    playerId
  );
  api.log(
    `Recycleur : ${sacrificed.map(cardName).join(', ')} → ${cardName(drawnCardId)}`,
    { kind: 'recycle', privateTo: playerId, cardId: drawnCardId },
    playerId
  );

  return drawnCardId;
}

/** Les objets d'une main, en cardIds -- ce que `buildStandardObjectReserve` doit retrancher. */
export function handObjectCardIds(player: PlayerState): string[] {
  return player.unplayedObjectInstanceIds
    .map((id) => player.objects[id]?.cardId)
    .filter((cardId): cardId is string => cardId !== undefined);
}
