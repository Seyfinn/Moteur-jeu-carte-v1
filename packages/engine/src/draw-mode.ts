import { randomUUID } from './uuid.js';
import { getCharacterCard, getObjectCard, getTerrainCard } from './cards/registry.js';
import { listDeckPool } from './deck.js';
import { randomInt, type RngState } from './rng.js';
import { cardName, playerName } from './names.js';
import type { EngineApi } from './engine-api.js';
import {
  DRAW_CYCLE,
  type CharacterInstance,
  type DrawKind,
  type GameState,
  type PlayerId,
  type PlayerState,
} from './types.js';

/** Nombre d'éliminations adverses qui donne la victoire. */
export const DRAW_MODE_ELIMINATIONS_TO_WIN = 7;
/** Personnages en jeu au départ : 1 actif + 2 au banc. */
export const DRAW_MODE_STARTING_CHARACTERS = 3;
/** Le banc vise toujours ce nombre de personnages ; au-delà, ils vont en Main Personnage. */
export const DRAW_MODE_BENCH_SIZE = 2;
/**
 * Plafond de la Main Personnage. Il ne compte QUE les cartes en main : les 3 personnages
 * déjà sur le plateau (1 actif + 2 au banc) n'entrent pas dedans.
 */
export const DRAW_MODE_MAX_CHARACTER_HAND = 5;
/** Le message montré au joueur quand la pioche est sautée pour cause de main pleine. */
export const DRAW_MODE_HAND_FULL_MESSAGE = 'vous avez atteint la limite de carte personnage par main';

/** Mélange une copie de `ids` avec le RNG seedé de la partie (Fisher-Yates). */
function shuffled(rng: RngState, ids: readonly string[]): string[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Les cartes tirables d'un type. Part de `listDeckPool()`, ce qui **exclut les formes
 * évoluées** : elles n'arrivent en jeu que par l'évolution de leur base.
 */
function drawableCardIds(type: 'character' | 'object' | 'terrain'): string[] {
  return listDeckPool()
    .filter((entry) => entry.type === type)
    .map((entry) => entry.id);
}

/**
 * La pile personnage d'un joueur : **tout** le catalogue, mélangé. C'est ce qui garantit la
 * règle « tous les personnages doivent être tirés avant qu'un doublon ne réapparaisse » --
 * il n'y a tout simplement pas de doublon dans la pile.
 */
export function buildCharacterPile(rng: RngState): string[] {
  return shuffled(rng, drawableCardIds('character'));
}

/**
 * La pile objet d'un joueur : chaque carte y figure autant de fois que son `maxCopies`
 * l'autorise (« objets uniques ou autorisés en doublons »), le tout mélangé.
 */
export function buildObjectPile(rng: RngState): string[] {
  const ids: string[] = [];
  for (const entry of listDeckPool()) {
    if (entry.type !== 'object') continue;
    for (let i = 0; i < entry.maxCopies; i++) ids.push(entry.id);
  }
  return shuffled(rng, ids);
}

/** La pile de terrains, **commune** aux deux joueurs : un seul exemplaire de chaque. */
export function buildSharedTerrainPile(rng: RngState): string[] {
  return shuffled(rng, drawableCardIds('terrain'));
}

/** Crée l'instance d'un personnage, sans la poser nulle part. */
export function instantiateCharacter(ownerId: PlayerId, cardId: string): CharacterInstance {
  const def = getCharacterCard(cardId);
  return {
    instanceId: randomUUID(),
    cardId,
    ownerId,
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

/**
 * Recycle un cimetière en nouvelle pile : « quand une pile est vide, on récupère le
 * cimetière correspondant, on le mélange, et ça forme la nouvelle pile ». Les instances
 * recyclées quittent le cimetière -- une carte ne peut pas être à la fois dans la pile et
 * au cimetière -- et repartiront neuves quand elles seront repiochées.
 *
 * Renvoie les cardIds récupérés (vide si le cimetière l'était).
 */
function recycleGraveyard(player: PlayerState, kind: 'character' | 'object' | 'terrain'): string[] {
  if (kind === 'character') {
    const ids = player.graveyardCharacterInstanceIds;
    const cardIds = ids.map((id) => player.characters[id]?.cardId).filter((c): c is string => !!c);
    for (const id of ids) delete player.characters[id];
    player.graveyardCharacterInstanceIds = [];
    return cardIds;
  }
  if (kind === 'object') {
    const ids = player.graveyardObjectInstanceIds;
    const cardIds = ids.map((id) => player.objects[id]?.cardId).filter((c): c is string => !!c);
    for (const id of ids) delete player.objects[id];
    player.graveyardObjectInstanceIds = [];
    return cardIds;
  }
  const ids = player.graveyardTerrainInstanceIds;
  const cardIds = ids.map((id) => player.terrains[id]?.cardId).filter((c): c is string => !!c);
  for (const id of ids) delete player.terrains[id];
  player.graveyardTerrainInstanceIds = [];
  return cardIds;
}

/** Retire le sommet d'une pile, en la regarnissant depuis le cimetière si elle est vide. */
function takeFromPile(state: GameState, playerId: PlayerId, kind: DrawKind): string | undefined {
  const player = state.players[playerId];
  const pile =
    kind === 'terrain'
      ? state.sharedTerrainPile
      : kind === 'character'
        ? player.drawPiles.characterCardIds
        : player.drawPiles.objectCardIds;

  if (pile.length === 0) {
    // La pile de terrains étant commune, c'est aussi le cas de son recyclage : on ramasse
    // les défausses des DEUX camps.
    const recycled =
      kind === 'terrain'
        ? [...recycleGraveyard(state.players.p1, 'terrain'), ...recycleGraveyard(state.players.p2, 'terrain')]
        : recycleGraveyard(player, kind);
    if (recycled.length === 0) return undefined; // rien à mélanger : la pioche est sautée
    pile.push(...shuffled(state.rng, recycled));
  }
  return pile.pop();
}

/**
 * Place un personnage fraîchement arrivé : au banc s'il reste une place, sinon en Main
 * Personnage. Point de passage unique de la pioche et du recyclage de la main.
 */
function placeDrawnCharacter(player: PlayerState, char: CharacterInstance): 'bench' | 'hand' {
  player.characters[char.instanceId] = char;
  if (player.benchCharacterInstanceIds.length < DRAW_MODE_BENCH_SIZE) {
    player.benchCharacterInstanceIds.push(char.instanceId);
    return 'bench';
  }
  player.handCharacterInstanceIds.push(char.instanceId);
  return 'hand';
}

/**
 * « Si une place est libre sur le banc, un personnage en main doit immédiatement occuper ce
 * slot vacant. » Appelé après tout ce qui peut vider une place : KO, switch, promotion.
 * Le joueur choisit lequel dès qu'il a le choix.
 */
export async function refillBenchFromHand(state: GameState, playerId: PlayerId, api: EngineApi): Promise<void> {
  if (state.mode !== 'draw') return;
  const player = state.players[playerId];

  while (
    player.benchCharacterInstanceIds.length < DRAW_MODE_BENCH_SIZE &&
    player.handCharacterInstanceIds.length > 0
  ) {
    let chosenId = player.handCharacterInstanceIds[0]!;
    if (player.handCharacterInstanceIds.length > 1) {
      const answer = await api.chooseFor(playerId, {
        kind: 'select-option',
        prompt: 'Choisissez le personnage qui rejoint votre banc',
        options: player.handCharacterInstanceIds.map((id) => ({
          key: id,
          label: cardName(player.characters[id]?.cardId ?? ''),
          card: { cardId: player.characters[id]?.cardId ?? '', kind: 'character' as const },
        })),
      });
      const key = answer.kind === 'select-option' ? answer.key : undefined;
      if (key && player.handCharacterInstanceIds.includes(key)) chosenId = key;
    }

    player.handCharacterInstanceIds = player.handCharacterInstanceIds.filter((id) => id !== chosenId);
    player.benchCharacterInstanceIds.push(chosenId);
    api.log(`${cardName(player.characters[chosenId]?.cardId ?? '')} rejoint le banc`, {
      kind: 'info',
      characterInstanceId: chosenId,
    }, playerId);
  }
}

/**
 * « Secours » : le poste actif vient de se vider et il ne reste RIEN -- ni banc, ni Main
 * Personnage. Le joueur pioche alors un personnage hors cycle et le pose directement au
 * poste actif, pour que le match continue. C'est ce qui remplace la défaite par plateau
 * vide, désactivée dans ce mode.
 *
 * Renvoie l'instanceId promu, ou undefined si même la pile est à sec.
 */
export async function rescueDraw(state: GameState, playerId: PlayerId, api: EngineApi): Promise<string | undefined> {
  const player = state.players[playerId];
  const cardId = takeFromPile(state, playerId, 'character');
  if (!cardId) return undefined;

  const char = instantiateCharacter(playerId, cardId);
  player.characters[char.instanceId] = char;
  player.activeCharacterInstanceId = char.instanceId;
  api.log(`${playerName(state, playerId)} n'a plus personne : ${cardName(cardId)} arrive en secours`, {
    kind: 'info',
    characterInstanceId: char.instanceId,
    cardId,
  }, playerId);
  await api.emitEvent({
    name: 'onBecomeActive',
    playerId,
    data: { characterInstanceId: char.instanceId, reason: 'ko-replacement' },
  });
  return char.instanceId;
}

/**
 * La pioche de fin de tour : exactement une carte, du type que dicte le compteur personnel
 * du joueur (objet -> terrain -> personnage). Le compteur avance dans tous les cas, y
 * compris quand la pioche est sautée faute de carte : le tour a consommé son tirage.
 */
export async function drawAtEndOfTurn(state: GameState, playerId: PlayerId, api: EngineApi): Promise<void> {
  if (state.mode !== 'draw') return;
  const player = state.players[playerId];
  const kind = DRAW_CYCLE[player.drawCycleIndex % DRAW_CYCLE.length]!;
  player.drawCycleIndex = (player.drawCycleIndex + 1) % DRAW_CYCLE.length;

  // Main Personnage pleine : on ne pioche rien du tout ce tour-ci -- et surtout on ne
  // touche pas à la pile, la carte doit rester dessus pour le prochain cycle.
  // (Le banc est forcément plein dans ce cas : dès qu'une place s'y libère,
  // `refillBenchFromHand` y fait descendre une carte de la main.)
  if (
    kind === 'character' &&
    player.benchCharacterInstanceIds.length >= DRAW_MODE_BENCH_SIZE &&
    player.handCharacterInstanceIds.length >= DRAW_MODE_MAX_CHARACTER_HAND
  ) {
    api.log(
      `${playerName(state, playerId)} ne pioche pas : ${DRAW_MODE_HAND_FULL_MESSAGE}`,
      { kind: 'info', reason: 'character-hand-full', playerMessage: DRAW_MODE_HAND_FULL_MESSAGE },
      playerId
    );
    return;
  }

  const cardId = takeFromPile(state, playerId, kind);
  if (!cardId) {
    api.log(`${playerName(state, playerId)} ne peut rien piocher (pile ${kind} épuisée)`, { kind: 'info' }, playerId);
    return;
  }

  if (kind === 'object') {
    const instanceId = randomUUID();
    getObjectCard(cardId);
    player.objects[instanceId] = { instanceId, cardId, ownerId: playerId };
    player.unplayedObjectInstanceIds.push(instanceId);
    api.log(`${playerName(state, playerId)} pioche un objet`, { kind: 'info' }, playerId);
    return;
  }

  if (kind === 'terrain') {
    const instanceId = randomUUID();
    getTerrainCard(cardId);
    player.terrains[instanceId] = { instanceId, cardId, ownerId: playerId };
    player.unplayedTerrainInstanceIds.push(instanceId);
    api.log(`${playerName(state, playerId)} pioche un terrain`, { kind: 'info' }, playerId);
    return;
  }

  const char = instantiateCharacter(playerId, cardId);
  const where = placeDrawnCharacter(player, char);
  // ⚠️ Le journal est commun aux deux joueurs : nommer la carte ne va que si elle est
  // publique. Au banc elle l'est ; en Main Personnage elle est secrète (getPlayerView la
  // caviarde), et l'annoncer ici la révélerait à l'adversaire malgré tout.
  if (where === 'bench') {
    api.log(
      `${playerName(state, playerId)} pioche ${cardName(cardId)} et l'envoie au banc`,
      { kind: 'info', characterInstanceId: char.instanceId, cardId },
      playerId
    );
  } else {
    api.log(
      `${playerName(state, playerId)} pioche un personnage (banc plein : il rejoint la main)`,
      { kind: 'info' },
      playerId
    );
  }
}

/** Mode Pioche : l'adversaire de ce joueur a-t-il atteint les 7 éliminations ? */
export function hasReachedEliminationGoal(player: PlayerState): boolean {
  return player.charactersLost >= DRAW_MODE_ELIMINATIONS_TO_WIN;
}
