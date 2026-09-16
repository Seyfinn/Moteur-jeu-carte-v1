import type { CharacterInstance, GameState, PlayerId, PlayerState } from '../src/index.js';
import { BLEED_MAX_STACKS, getCurrentHP } from '../src/index.js';

/**
 * Invariants structurels d'un `GameState` au repos, vérifiés par le smoke (`card-smoke.spec.ts`)
 * après chaque action acceptée -- et à chaque pause sur un choix. Aucun ne juge une règle de
 * jeu : ils disent seulement si l'état est encore cohérent avec lui-même (zones disjointes,
 * HP dans les bornes, références qui résolvent, journal propre, aucune exception avalée).
 *
 * Tout est collecté puis levé d'un bloc, pour qu'un état corrompu remonte TOUTES ses
 * incohérences avec le contexte (seed, numéro d'action, dernière action) plutôt que la
 * première seulement.
 */

const PLAYER_IDS: readonly PlayerId[] = ['p1', 'p2'];

/** Format de `crypto.randomUUID()` -- celui de tous les instanceIds du moteur (uuid.ts). */
export const INSTANCE_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export interface InvariantOptions {
  /**
   * Index du journal à partir duquel relire les entrées. Le journal ne fait que grandir :
   * un appelant qui vérifie l'état après chaque action peut ne relire que la queue au lieu
   * de re-scanner des milliers de lignes déjà validées. Défaut : tout le journal.
   */
  logFrom?: number;
}

export class InvariantViolation extends Error {
  constructor(
    readonly context: string,
    readonly violations: readonly string[]
  ) {
    super(`Invariants d'état violés (${context}) :\n  - ${violations.join('\n  - ')}`);
    this.name = 'InvariantViolation';
  }
}

/** Liste les violations sans lever -- `assertStateInvariants` est la forme habituelle. */
export function collectStateViolations(state: GameState, options: InvariantOptions = {}): string[] {
  const v: string[] = [];
  const midAction = state.pendingChoice !== undefined;

  checkTopLevel(state, v);
  checkNumbers(state, options.logFrom ?? 0, v);

  const allCharacters = new Map<string, { char: CharacterInstance; ownerId: PlayerId }>();
  const allObjects = new Map<string, PlayerId>();
  for (const playerId of PLAYER_IDS) {
    const player = state.players[playerId];
    if (!player) {
      v.push(`players.${playerId} manquant`);
      continue;
    }
    if (player.id !== playerId) v.push(`players.${playerId}.id vaut "${player.id}"`);
    for (const [key, char] of Object.entries(player.characters)) {
      if (char.instanceId !== key) v.push(`${playerId}: personnage indexé "${key}" porte l'instanceId "${char.instanceId}"`);
      if (char.ownerId !== playerId) v.push(`${playerId}: ${char.cardId} (${short(key)}) se croit à ${char.ownerId}`);
      if (allCharacters.has(key)) v.push(`personnage ${short(key)} présent chez les deux joueurs`);
      allCharacters.set(key, { char, ownerId: playerId });
    }
    for (const [key, obj] of Object.entries(player.objects)) {
      if (obj.instanceId !== key) v.push(`${playerId}: objet indexé "${key}" porte l'instanceId "${obj.instanceId}"`);
      if (obj.ownerId !== playerId) v.push(`${playerId}: objet ${obj.cardId} (${short(key)}) se croit à ${obj.ownerId}`);
      if (allObjects.has(key)) v.push(`objet ${short(key)} présent chez les deux joueurs`);
      allObjects.set(key, playerId);
    }
  }

  for (const playerId of PLAYER_IDS) {
    const player = state.players[playerId];
    if (!player) continue;
    checkCharacterZones(state, player, midAction, v);
    checkObjectZones(player, midAction, v);
    checkTerrainZones(player, v);
    for (const char of Object.values(player.characters)) checkCharacter(player, char, midAction, v);
    for (const obj of Object.values(player.objects)) {
      if (!obj.attachedToCharacterInstanceId) continue;
      const bearer = allCharacters.get(obj.attachedToCharacterInstanceId);
      if (!bearer) {
        v.push(`${playerId}: objet ${obj.cardId} attaché à un personnage inconnu (${short(obj.attachedToCharacterInstanceId)})`);
        continue;
      }
      if (!isOnBoard(state.players[bearer.ownerId], bearer.char.instanceId)) {
        v.push(`${playerId}: objet ${obj.cardId} attaché à ${bearer.char.cardId}, qui n'est plus sur le plateau`);
      }
      if (!bearer.char.attachedObjectInstanceIds.includes(obj.instanceId)) {
        v.push(`${playerId}: objet ${obj.cardId} se dit attaché à ${bearer.char.cardId}, qui ne le liste pas`);
      }
      if (!player.inPlayObjectInstanceIds.includes(obj.instanceId)) {
        v.push(`${playerId}: objet ${obj.cardId} attaché à ${bearer.char.cardId} mais absent de inPlayObjectInstanceIds`);
      }
    }
    // Réciproque : tout ce qu'un personnage dit porter doit exister et pointer vers lui.
    for (const char of Object.values(player.characters)) {
      for (const objectId of char.attachedObjectInstanceIds) {
        const ownerId = allObjects.get(objectId);
        if (!ownerId) {
          v.push(`${playerId}: ${char.cardId} porte un objet inconnu (${short(objectId)})`);
          continue;
        }
        const obj = state.players[ownerId].objects[objectId]!;
        if (obj.attachedToCharacterInstanceId !== char.instanceId) {
          v.push(`${playerId}: ${char.cardId} porte ${obj.cardId}, qui se dit attaché ailleurs (${short(obj.attachedToCharacterInstanceId ?? 'nulle part')})`);
        }
      }
      if (new Set(char.attachedObjectInstanceIds).size !== char.attachedObjectInstanceIds.length) {
        v.push(`${playerId}: ${char.cardId} liste deux fois le même objet équipé`);
      }
    }
  }

  checkPendingChoice(state, allCharacters, v);
  checkLog(state, options.logFrom ?? 0, v);
  return v;
}

export function assertStateInvariants(state: GameState, context: string, options: InvariantOptions = {}): void {
  const violations = collectStateViolations(state, options);
  if (violations.length > 0) throw new InvariantViolation(context, violations);
}

// ---------------------------------------------------------------------------

function short(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function isOnBoard(player: PlayerState, instanceId: string): boolean {
  return player.activeCharacterInstanceId === instanceId || player.benchCharacterInstanceIds.includes(instanceId);
}

function checkTopLevel(state: GameState, v: string[]): void {
  if (!PLAYER_IDS.includes(state.activePlayerId)) v.push(`activePlayerId invalide : "${String(state.activePlayerId)}"`);
  if (!PLAYER_IDS.includes(state.startingPlayerId)) v.push(`startingPlayerId invalide : "${String(state.startingPlayerId)}"`);
  if (!['setup', 'main', 'ended'].includes(state.phase)) v.push(`phase inconnue : "${String(state.phase)}"`);
  if (state.phase === 'ended' && !state.result) v.push('phase "ended" sans result');
  if (state.result && state.phase !== 'ended') v.push(`result posé alors que la phase est "${state.phase}"`);
  if (state.result?.kind === 'win' && !PLAYER_IDS.includes(state.result.winner)) v.push('result.winner invalide');
  if (state.phase !== 'setup' && !(Number.isInteger(state.turnNumber) && state.turnNumber >= 1)) {
    v.push(`turnNumber doit être un entier ≥ 1 en partie, vaut ${state.turnNumber}`);
  }
  if (state.pendingExtraTurnFor !== undefined && !PLAYER_IDS.includes(state.pendingExtraTurnFor)) {
    v.push(`pendingExtraTurnFor invalide : "${String(state.pendingExtraTurnFor)}"`);
  }
}

/** Marche récursive : aucun NaN / ±Infinity nulle part dans l'état (journal : depuis `logFrom`). */
function checkNumbers(state: GameState, logFrom: number, v: string[]): void {
  const seen = new Set<object>();
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) v.push(`nombre non fini à ${path} : ${value}`);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
  };
  for (const [key, child] of Object.entries(state)) {
    if (key === 'log') continue;
    walk(child, key);
  }
  for (let i = logFrom; i < state.log.length; i++) walk(state.log[i], `log[${i}]`);
}

function checkCharacterZones(state: GameState, player: PlayerState, midAction: boolean, v: string[]): void {
  const pid = player.id;
  const zones: Array<[string, string[]]> = [
    ['actif', player.activeCharacterInstanceId ? [player.activeCharacterInstanceId] : []],
    ['banc', player.benchCharacterInstanceIds],
    ['cimetière', player.graveyardCharacterInstanceIds],
    ['main', player.handCharacterInstanceIds],
  ];
  const placement = new Map<string, string>();
  for (const [zoneName, ids] of zones) {
    for (const id of ids) {
      if (!player.characters[id]) v.push(`${pid}: ${zoneName} référence un personnage inconnu (${short(id)})`);
      const already = placement.get(id);
      if (already) v.push(`${pid}: personnage ${short(id)} à la fois en ${already} et en ${zoneName}`);
      else placement.set(id, zoneName);
    }
  }
  // Pendant la mise en place, personne n'est encore posé : les zones se remplissent quand
  // chaque camp a choisi son actif de départ (match.ts::runSetup).
  if (state.phase !== 'setup') {
    for (const char of Object.values(player.characters)) {
      if (!placement.has(char.instanceId)) v.push(`${pid}: ${char.cardId} (${short(char.instanceId)}) n'est dans aucune zone`);
    }
  }

  // Un actif vivant par camp -- sauf partie finie, mise en place, ou action en cours (le
  // prompt de remplacement après un KO est un pendingChoice : l'actif est alors à null).
  if (state.phase !== 'main' || state.result || midAction) return;
  const activeId = player.activeCharacterInstanceId;
  if (!activeId) {
    v.push(`${pid}: aucun personnage actif (banc : ${player.benchCharacterInstanceIds.length}) hors de tout choix en attente`);
    return;
  }
  const active = player.characters[activeId];
  if (active && getCurrentHP(active) <= 0) v.push(`${pid}: l'actif ${active.cardId} est à ${getCurrentHP(active)} HP`);
}

function checkCharacter(player: PlayerState, char: CharacterInstance, midAction: boolean, v: string[]): void {
  const who = `${player.id}: ${char.cardId} (${short(char.instanceId)})`;
  const onBoard = isOnBoard(player, char.instanceId);
  const hp = getCurrentHP(char);

  if (char.damage < 0) v.push(`${who} : damage négatif (${char.damage})`);
  if (char.shield < 0) v.push(`${who} : bouclier négatif (${char.shield})`);
  if (char.currentMaxHP < 0) v.push(`${who} : HP max négatifs (${char.currentMaxHP})`);
  if (char.baseMaxHP < 1) v.push(`${who} : baseMaxHP < 1 (${char.baseMaxHP})`);
  if (onBoard) {
    // En cours d'action, un personnage peut être à 0 HP sans être encore au cimetière :
    // `dealDamage` émet `afterDamage` (qui peut poser une question) AVANT d'appeler
    // `koCharacter`. Au repos, un tel état est une fuite.
    if (!midAction && char.currentMaxHP < 1) v.push(`${who} : sur le plateau avec ${char.currentMaxHP} HP max`);
    if (!midAction && hp <= 0) v.push(`${who} : sur le plateau à ${hp} HP (devrait être au cimetière)`);
    if (hp > char.currentMaxHP) v.push(`${who} : ${hp} HP au-dessus du plafond ${char.currentMaxHP}`);
  }
  // Hors plateau : un mort peut garder des dégâts au-delà de son plafond (le KO ne les
  // remet pas à zéro), une résurrection les recalcule. Rien à exiger de plus que les bornes
  // ci-dessus -- l'appartenance à une zone est vérifiée par checkCharacterZones.

  const seenStatusIds = new Map<string, number>();
  for (const status of char.statuses) {
    const tag = `${who} statut "${status.statusId}"`;
    if (typeof status.statusId !== 'string' || status.statusId.length === 0) v.push(`${who} : statusId vide`);
    if (typeof status.label !== 'string' || status.label.length === 0) v.push(`${tag} : label vide`);
    if (status.remainingTurns !== undefined && !(status.remainingTurns >= 0)) {
      v.push(`${tag} : remainingTurns = ${status.remainingTurns}`);
    }
    if (status.sourcePlayerId !== undefined && !PLAYER_IDS.includes(status.sourcePlayerId)) {
      v.push(`${tag} : sourcePlayerId invalide "${String(status.sourcePlayerId)}"`);
    }
    if (status.statusId === 'bleed') {
      const stacks = Number(status.data?.['stacks']);
      if (!(stacks >= 1 && stacks <= BLEED_MAX_STACKS)) v.push(`${tag} : stacks = ${String(status.data?.['stacks'])} hors [1, ${BLEED_MAX_STACKS}]`);
    }
    seenStatusIds.set(status.statusId, (seenStatusIds.get(status.statusId) ?? 0) + 1);
  }
  // Le moteur fusionne exprès les réapplications de ces trois-là (statuses.ts::applyStatus) :
  // deux instances tiqueraient chacune le même tour.
  for (const merged of ['bleed', 'burn', 'poison']) {
    if ((seenStatusIds.get(merged) ?? 0) > 1) v.push(`${who} : ${seenStatusIds.get(merged)} instances de "${merged}" (doivent fusionner)`);
  }
  for (const [abilityId, uses] of Object.entries(char.abilityUsesThisTurn)) {
    if (!(Number.isInteger(uses) && uses >= 0)) v.push(`${who} : abilityUsesThisTurn[${abilityId}] = ${uses}`);
  }
  for (const [abilityId, uses] of Object.entries(char.abilityUsesThisGame)) {
    if (!(Number.isInteger(uses) && uses >= 0)) v.push(`${who} : abilityUsesThisGame[${abilityId}] = ${uses}`);
  }
}

function checkObjectZones(player: PlayerState, midAction: boolean, v: string[]): void {
  const pid = player.id;
  const zones: Array<[string, string[]]> = [
    ['main', player.unplayedObjectInstanceIds],
    ['en jeu', player.inPlayObjectInstanceIds],
    ['cimetière', player.graveyardObjectInstanceIds],
  ];
  const placement = new Map<string, string>();
  for (const [zoneName, ids] of zones) {
    for (const id of ids) {
      if (!player.objects[id]) v.push(`${pid}: objets ${zoneName} référence un objet inconnu (${short(id)})`);
      const already = placement.get(id);
      if (already) v.push(`${pid}: objet ${short(id)} à la fois ${already} et ${zoneName}`);
      else placement.set(id, zoneName);
    }
  }
  for (const obj of Object.values(player.objects)) {
    const zone = placement.get(obj.instanceId);
    if (!zone) {
      v.push(`${pid}: objet ${obj.cardId} (${short(obj.instanceId)}) n'est dans aucune zone`);
      continue;
    }
    if (obj.attachedToCharacterInstanceId && zone !== 'en jeu') {
      v.push(`${pid}: objet ${obj.cardId} attaché mais rangé "${zone}"`);
    }
    // Un objet « en jeu » sans porteur n'existe qu'en cours de résolution (une fois résolu,
    // match.ts::resolveObjectInPlay l'enterre ou il s'est accroché) : au repos, c'est une
    // fuite -- ses modifiers continueraient de s'appliquer toute la partie.
    if (zone === 'en jeu' && !obj.attachedToCharacterInstanceId && !midAction) {
      v.push(`${pid}: objet ${obj.cardId} en jeu sans être attaché à personne`);
    }
  }
}

function checkTerrainZones(player: PlayerState, v: string[]): void {
  const pid = player.id;
  const zones: Array<[string, string[]]> = [
    ['main', player.unplayedTerrainInstanceIds],
    ['actif', player.activeTerrainInstanceId ? [player.activeTerrainInstanceId] : []],
    ['cimetière', player.graveyardTerrainInstanceIds],
  ];
  const placement = new Map<string, string>();
  for (const [zoneName, ids] of zones) {
    for (const id of ids) {
      if (!player.terrains[id]) v.push(`${pid}: terrains ${zoneName} référence un terrain inconnu (${short(id)})`);
      const already = placement.get(id);
      if (already) v.push(`${pid}: terrain ${short(id)} à la fois ${already} et ${zoneName}`);
      else placement.set(id, zoneName);
    }
  }
  for (const terrain of Object.values(player.terrains)) {
    if (!placement.has(terrain.instanceId)) v.push(`${pid}: terrain ${terrain.cardId} (${short(terrain.instanceId)}) n'est dans aucune zone`);
    if (terrain.ownerId !== pid) v.push(`${pid}: terrain ${terrain.cardId} se croit à ${terrain.ownerId}`);
  }
  // Seul le terrain ACTIF a un compteur qui compte : le tick le retire dès qu'il tombe à 0,
  // donc au repos il vaut au moins 1 (ou undefined = indéfini). Un terrain au cimetière peut
  // garder un reliquat négatif (Annulation de territoire retire 3 tours d'un coup) -- même
  // résidu inoffensif que les dégâts d'un mort au-delà de son plafond.
  const active = player.activeTerrainInstanceId ? player.terrains[player.activeTerrainInstanceId] : undefined;
  if (active && active.remainingTurns !== undefined && !(active.remainingTurns >= 1)) {
    v.push(`${pid}: terrain actif ${active.cardId} à remainingTurns = ${active.remainingTurns} (devrait avoir expiré)`);
  }
}

function checkPendingChoice(
  state: GameState,
  allCharacters: ReadonlyMap<string, { char: CharacterInstance; ownerId: PlayerId }>,
  v: string[]
): void {
  const pending = state.pendingChoice;
  if (!pending) return;
  if (typeof pending.id !== 'string' || pending.id.length === 0) v.push('pendingChoice.id vide');
  if (!PLAYER_IDS.includes(pending.playerId)) v.push(`pendingChoice.playerId invalide : "${String(pending.playerId)}"`);
  const spec = pending.spec;
  if (typeof spec.prompt !== 'string' || spec.prompt.length === 0) v.push('pendingChoice : prompt vide');
  switch (spec.kind) {
    case 'select-characters': {
      if (spec.options.length === 0) v.push('pendingChoice select-characters : aucune option');
      if (!(spec.min >= 0 && spec.min <= spec.max && spec.max <= spec.options.length)) {
        v.push(`pendingChoice select-characters : min/max/options incohérents (${spec.min}/${spec.max}/${spec.options.length})`);
      }
      if (new Set(spec.options).size !== spec.options.length) v.push('pendingChoice select-characters : options en double');
      for (const id of spec.options) {
        if (!allCharacters.has(id)) v.push(`pendingChoice select-characters : option inconnue (${short(id)})`);
      }
      break;
    }
    case 'select-option': {
      if (spec.options.length === 0) v.push('pendingChoice select-option : aucune option');
      if (new Set(spec.options.map((o) => o.key)).size !== spec.options.length) v.push('pendingChoice select-option : clés en double');
      for (const o of spec.options) {
        if (typeof o.label !== 'string' || o.label.length === 0) v.push(`pendingChoice select-option : libellé vide pour "${o.key}"`);
      }
      break;
    }
    case 'order': {
      if (spec.items.length === 0) v.push('pendingChoice order : aucun élément');
      if (new Set(spec.items.map((o) => o.key)).size !== spec.items.length) v.push('pendingChoice order : clés en double');
      break;
    }
    case 'yes-no':
      break;
    default:
      v.push(`pendingChoice : kind inconnu "${String((spec as { kind: unknown }).kind)}"`);
  }
}

function checkLog(state: GameState, logFrom: number, v: string[]): void {
  for (let i = logFrom; i < state.log.length; i++) {
    const entry = state.log[i]!;
    if (typeof entry.message !== 'string' || entry.message.trim().length === 0) {
      v.push(`log[${i}] : message vide`);
      continue;
    }
    if (typeof entry.id !== 'string' || entry.id.length === 0) v.push(`log[${i}] : id vide`);
    const kind = entry.data?.['kind'];
    // Une exception dans une carte n'est jamais relancée par le moteur : `applyAction` la
    // journalise et l'action passe pour acceptée. C'est LE signal du crash d'une carte.
    if (kind === 'error') v.push(`log[${i}] : exception avalée par le moteur -- « ${entry.message} »`);
    // Plafond de profondeur des déclencheurs atteint : deux cartes qui se renvoient la balle.
    if (kind === 'trigger-depth') v.push(`log[${i}] : chaîne de déclenchements coupée -- « ${entry.message} »`);
    // Le journal nomme par nom d'affichage, jamais par instanceId (CLAUDE.md, « Journal »).
    if (INSTANCE_ID_PATTERN.test(entry.message)) v.push(`log[${i}] : instanceId brut dans le message -- « ${entry.message} »`);
  }
}
