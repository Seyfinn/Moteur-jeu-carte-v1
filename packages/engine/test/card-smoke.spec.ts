import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  DECK_LIMITS,
  DEMO_ROSTER,
  Match,
  RECYCLE_OBJECT_COST,
  attacksAvailableTo,
  defaultChoiceAnswer,
  getCard,
  getCharacterCard,
  getTerrainCard,
  registerDemoCards,
  validateRoster,
  type ChoiceAnswer,
  type GameState,
  type MatchConfig,
  type PendingChoice,
  type PlayerAction,
  type PlayerId,
  type RosterConfig,
} from '../src/index.js';
import { registerTestFixtures } from './fixtures.js';
import { createReadyMatch } from './test-utils.js';
import { assertStateInvariants, collectStateViolations, InvariantViolation } from './invariants.js';

/**
 * Filet de sécurité RUNTIME générique : chaque carte du catalogue est jouée dans une vraie
 * partie (partie A), puis des parties complètes tirées au hasard -- mais seedées -- sont
 * jouées jusqu'au bout (partie B). Après CHAQUE action acceptée, et à chaque pause sur un
 * choix, `assertStateInvariants` relit l'état entier (test/invariants.ts).
 *
 * Ce qui compte comme un échec : une exception (y compris celle qu'`applyAction` avale et
 * journalise en `kind: 'error'`), un `settle` qui n'en finit plus de répondre à des choix,
 * un invariant cassé (zones incohérentes, HP hors bornes, NaN, actif manquant...). Une
 * action REFUSÉE par `applyAction` n'est pas un échec : c'est le comportement attendu d'une
 * action illégale, et le harnais en essaie beaucoup.
 *
 * Aucune carte n'est nommée ici : tout est généré depuis `DEMO_ROSTER`, donc une nouvelle
 * carte est couverte sans rien écrire. Pour une carte qui demande un montage précis, le
 * test dédié reste le bon outil -- ce fichier attrape les crashs et les blocages, pas les
 * erreurs de règles.
 *
 * Rejouer un cas précis :
 *   npx vitest run test/card-smoke.spec.ts -t "gojo-satoru"        (une carte, partie A)
 *   SMOKE_SEEDS=7 npx vitest run test/card-smoke.spec.ts -t "fuzz"  (une partie, partie B)
 *   SMOKE_GAMES=200 npx vitest run test/card-smoke.spec.ts           (plus de parties)
 * Le message d'échec porte toujours le seed, les rosters et l'historique des actions.
 */

// ---------------------------------------------------------------------------
// Échecs connus : une carte listée ici est SKIPPÉE explicitement (pas avalée en silence).
// À vider au fil des corrections. `seed` absent = tous les seeds du scénario.
// ---------------------------------------------------------------------------

interface KnownSmokeFailure {
  cardId: string;
  scenario: 'character' | 'object' | 'terrain' | 'fuzz';
  seed?: number;
  reason: string;
}

const KNOWN_SMOKE_FAILURES: readonly KnownSmokeFailure[] = [];

function knownFailure(cardId: string, scenario: KnownSmokeFailure['scenario'], seed?: number): KnownSmokeFailure | undefined {
  return KNOWN_SMOKE_FAILURES.find(
    (k) => k.cardId === cardId && k.scenario === scenario && (k.seed === undefined || k.seed === seed)
  );
}

// ---------------------------------------------------------------------------
// RNG déterministe (mulberry32) : aucun Math.random, aucune horloge, nulle part.
// ---------------------------------------------------------------------------

class SmokeRng {
  private a: number;
  constructor(seed: number) {
    this.a = (seed * 0x9e3779b1) >>> 0 || 1;
  }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick() sur une liste vide');
    return items[this.int(items.length)]!;
  }
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, count);
  }
}

// ---------------------------------------------------------------------------
// Politiques de réponse aux choix.
// ---------------------------------------------------------------------------

type Answerer = (choice: PendingChoice) => ChoiceAnswer;

/** Ce que fait le serveur quand personne ne répond : première option, « non », ordre tel quel. */
const defaultAnswerer: Answerer = (choice) => defaultChoiceAnswer(choice.spec);

/** L'autre bout du spectre : dernière option, sélection maximale, « oui », ordre inversé. */
const lastOptionAnswerer: Answerer = (choice) => {
  const spec = choice.spec;
  switch (spec.kind) {
    case 'select-characters':
      return { kind: 'select-characters', selected: spec.options.slice(Math.max(0, spec.options.length - spec.max)) };
    case 'select-option':
      return { kind: 'select-option', key: spec.options[spec.options.length - 1]?.key ?? '' };
    case 'yes-no':
      return { kind: 'yes-no', value: true };
    case 'order':
      return { kind: 'order', orderedKeys: spec.items.map((i) => i.key).reverse() };
  }
};

/** Une réponse légale tirée au sort (seedée) : autant de branches que possible. */
function randomAnswerer(rng: SmokeRng): Answerer {
  return (choice) => {
    const spec = choice.spec;
    switch (spec.kind) {
      case 'select-characters': {
        const count = spec.min + rng.int(spec.max - spec.min + 1);
        return { kind: 'select-characters', selected: rng.sample(spec.options, count) };
      }
      case 'select-option':
        return { kind: 'select-option', key: rng.pick(spec.options).key };
      case 'yes-no':
        return { kind: 'yes-no', value: rng.bool() };
      case 'order':
        return { kind: 'order', orderedKeys: rng.shuffle(spec.items).map((i) => i.key) };
    }
  };
}

/** Les trois seeds de la partie A, chacun avec sa politique de réponse. */
const CARD_SEEDS: ReadonlyArray<{ seed: number; answerer: (rng: SmokeRng) => Answerer }> = [
  { seed: 1, answerer: () => defaultAnswerer },
  { seed: 2, answerer: () => lastOptionAnswerer },
  { seed: 3, answerer: (rng) => randomAnswerer(rng) },
];

// ---------------------------------------------------------------------------
// Pilote : applique des actions, répond aux choix, vérifie les invariants à chaque pause.
// ---------------------------------------------------------------------------

const PASS: PlayerAction = { kind: 'pass' };

/** `SMOKE_DEBUG=1` : imprime l'historique de chaque scénario (pour vérifier ce que le filet couvre vraiment). */
const SMOKE_DEBUG = Boolean(process.env['SMOKE_DEBUG']);

function debugReport(d: SmokeDriver | undefined): void {
  if (!SMOKE_DEBUG || !d) return;
  const outcome = d.state.result ? `terminée (${JSON.stringify(d.state.result)})` : `tour ${d.state.turnNumber}`;
  const graveyards = (['p1', 'p2'] as PlayerId[])
    .map((pid) => `${pid} cimetière : [${d.state.players[pid].graveyardCharacterInstanceIds.map((id) => d.state.players[pid].characters[id]?.cardId).join(', ')}]`)
    .join(' ; ');
  console.info(`[smoke] ${d.label} : ${d.accepted} actions, ${outcome}, ${graveyards}\n  ${d.history.join('\n  ')}`);
}

class SmokeDriver {
  readonly history: string[] = [];
  accepted = 0;
  private logCursor = 0;

  constructor(
    readonly match: Match,
    readonly label: string,
    private readonly answerer: Answerer
  ) {}

  get state(): GameState {
    return this.match.state;
  }

  get over(): boolean {
    return this.state.result !== undefined;
  }

  context(tag?: string): string {
    const last = this.history[this.history.length - 1] ?? '(aucune action)';
    return `${this.label} | action #${this.accepted} | dernière : ${last}${tag ? ` | ${tag}` : ''}`;
  }

  /** Vérifie les invariants sur la queue du journal depuis la dernière vérification. */
  check(tag?: string): void {
    assertStateInvariants(this.state, this.context(tag), { logFrom: this.logCursor });
    this.logCursor = this.state.log.length;
  }

  /** Comme `settle()` de test-utils, avec les invariants relus à chaque pause sur un choix. */
  async settle(): Promise<void> {
    await this.match.waitForNextPause();
    let guard = 0;
    while (this.state.pendingChoice) {
      if (++guard > 300) {
        throw new Error(`${this.context()} : plus de 300 choix d'affilée sur une seule action -- boucle de prompts probable`);
      }
      this.check(`pause sur un choix (« ${this.state.pendingChoice.spec.prompt} »)`);
      const choice = this.state.pendingChoice;
      const answer = this.answerer(choice);
      const res = this.match.answerChoice(choice.playerId, choice.id, answer);
      if (!res.ok) {
        throw new Error(`${this.context()} : réponse refusée (${res.error}) -- ${JSON.stringify(answer)} pour ${JSON.stringify(choice.spec)}`);
      }
      await this.match.waitForNextPause();
    }
    this.check();
  }

  /** `false` si `applyAction` refuse (comportement normal d'une action illégale), `true` sinon. */
  async tryAction(playerId: PlayerId, action: PlayerAction): Promise<boolean> {
    if (this.over) return false;
    // Décrite AVANT d'agir : le recyclage retire ses objets de la main dès l'appel.
    const described = `${playerId} ${this.describe(playerId, action)}`;
    const res = this.match.applyAction(playerId, action);
    if (!res.ok) return false;
    this.accepted += 1;
    this.history.push(described);
    await this.settle();
    return true;
  }

  /** Action dont le refus serait lui-même une anomalie du scénario. */
  async act(playerId: PlayerId, action: PlayerAction): Promise<void> {
    if (this.over) return;
    const described = `${playerId} ${this.describe(playerId, action)}`;
    const res = this.match.applyAction(playerId, action);
    if (!res.ok) throw new Error(`${this.context()} : action de script refusée (${described}) -- ${res.error}`);
    this.accepted += 1;
    this.history.push(described);
    await this.settle();
  }

  /** Passe tant que ce n'est pas le tour de `playerId` (borné : la partie peut finir avant). */
  async ensureTurn(playerId: PlayerId): Promise<boolean> {
    for (let i = 0; i < 4 && !this.over; i++) {
      if (this.state.activePlayerId === playerId) return true;
      if (!(await this.tryAction(this.state.activePlayerId, PASS))) return false;
    }
    return !this.over && this.state.activePlayerId === playerId;
  }

  private describe(playerId: PlayerId, action: PlayerAction): string {
    const player = this.state.players[playerId];
    switch (action.kind) {
      case 'attack':
        return `attack ${player.characters[action.characterInstanceId]?.cardId ?? '?'}/${action.attackId}`;
      case 'use-ability':
        return `use-ability ${player.characters[action.characterInstanceId]?.cardId ?? '?'}/${action.abilityId}`;
      case 'play-object':
        return `play-object ${player.objects[action.objectInstanceId]?.cardId ?? '?'}`;
      case 'play-terrain':
        return `play-terrain ${player.terrains[action.terrainInstanceId]?.cardId ?? '?'}`;
      case 'switch':
        return `switch -> ${player.characters[action.newActiveInstanceId]?.cardId ?? '?'}`;
      case 'recycle-objects':
        return `recycle-objects [${action.objectInstanceIds.map((id) => player.objects[id]?.cardId ?? '?').join(', ')}]`;
      case 'pass':
        return 'pass';
    }
  }
}

/** Toute erreur remonte avec le seed, les rosters et l'historique : reproductible telle quelle. */
function enrich(err: unknown, header: string, config: MatchConfig, driver: SmokeDriver | undefined): Error {
  const base = err instanceof Error ? err : new Error(String(err));
  const rosters = `p1 = ${JSON.stringify(config.p1Roster)}\n  p2 = ${JSON.stringify(config.p2Roster)}`;
  const history = driver ? driver.history.map((h, i) => `  ${String(i + 1).padStart(3)}. ${h}`).join('\n') : '  (aucune)';
  const wrapped = new Error(`${header}\n${base.message}\n\nRosters :\n  ${rosters}\n\nActions acceptées (${driver?.accepted ?? 0}) :\n${history}`);
  wrapped.stack = base.stack;
  if (base instanceof InvariantViolation) wrapped.name = 'InvariantViolation';
  return wrapped;
}

async function readyDriver(
  label: string,
  config: MatchConfig,
  answerer: Answerer,
  actives: { p1ActiveCardId?: string; p2ActiveCardId?: string }
): Promise<SmokeDriver> {
  const match = await createReadyMatch(config, actives);
  const driver = new SmokeDriver(match, label, answerer);
  driver.check('après la mise en place');
  return driver;
}

// ---------------------------------------------------------------------------
// Petits comportements réutilisés par les scénarios.
// ---------------------------------------------------------------------------

function onBoardIds(state: GameState, playerId: PlayerId): string[] {
  const p = state.players[playerId];
  return [p.activeCharacterInstanceId, ...p.benchCharacterInstanceIds].filter((id): id is string => id !== null);
}

function isOnBoard(state: GameState, playerId: PlayerId, instanceId: string): boolean {
  return onBoardIds(state, playerId).includes(instanceId);
}

function manualAbilityIds(state: GameState, playerId: PlayerId, instanceId: string): string[] {
  const char = state.players[playerId].characters[instanceId];
  if (!char) return [];
  return getCharacterCard(char.cardId)
    .abilities.filter((a) => a.kind === 'active' && !a.trigger)
    .map((a) => a.id);
}

/**
 * Le tour d'un camp de fixtures : parfois une capacité (buff, stun sur la carte testée),
 * puis la première attaque acceptée de son actif, sinon il passe.
 */
async function fixtureTurn(d: SmokeDriver, playerId: PlayerId, rng: SmokeRng): Promise<void> {
  if (d.over || d.state.activePlayerId !== playerId) return;
  const activeId = d.state.players[playerId].activeCharacterInstanceId;
  if (activeId && rng.bool(0.3)) {
    for (const abilityId of manualAbilityIds(d.state, playerId, activeId)) {
      await d.tryAction(playerId, { kind: 'use-ability', characterInstanceId: activeId, abilityId });
    }
  }
  if (d.over || d.state.activePlayerId !== playerId) return;
  if (activeId && isOnBoard(d.state, playerId, activeId)) {
    for (const attack of attacksAvailableTo(d.state, activeId)) {
      if (await d.tryAction(playerId, { kind: 'attack', characterInstanceId: activeId, attackId: attack.id })) return;
    }
  }
  if (!d.over && d.state.activePlayerId === playerId) await d.tryAction(playerId, PASS);
}

/**
 * Met un personnage à 1 HP sans bouclier -- le prochain coup de fixture le tue par le
 * pipeline de dégâts normal (afterDamage, onCharacterKO avec tueur, remplacement). Le seul
 * endroit où le harnais touche l'état à la main ; les invariants restent vrais.
 */
function bringToOneHP(state: GameState, playerId: PlayerId, instanceId: string): void {
  const char = state.players[playerId].characters[instanceId];
  if (!char || !isOnBoard(state, playerId, instanceId) || char.currentMaxHP < 2) return;
  char.damage = char.currentMaxHP - 1;
  char.shield = 0;
}

// ---------------------------------------------------------------------------
// Partie A.1 -- chaque personnage, isolément.
// ---------------------------------------------------------------------------

const ALLY_FIXTURES = ['fx-tank', 'fx-glass'] as const;
/**
 * Le camp d'en face : assez de PV (1 010) pour qu'une carte forte ne finisse pas la partie
 * avant les phases de passes et de mort ; un stunner pour tester la carte sous stun ; un
 * fragile (10 HP) pour qu'une AoE tue quelqu'un au banc. Les doublons sont légaux ici :
 * seul `validateRoster` impose l'unicité, pas `Match.create`.
 */
const FOE_ROSTER: RosterConfig = {
  characterCardIds: ['fx-tank', 'fx-stunner', 'fx-tank', 'fx-glass', 'fx-tank'],
  objectCardIds: [],
  terrainCardIds: [],
};

function characterRoster(cardId: string): RosterConfig {
  return { characterCardIds: [cardId, ...ALLY_FIXTURES], objectCardIds: [], terrainCardIds: [] };
}

/**
 * Le tour de la carte testée : chaque capacité active pas encore essayée (gratuites), puis
 * une attaque pas encore essayée -- ou n'importe laquelle si toutes l'ont déjà été. La fiche
 * est relue à chaque tour : une carte qui évolue ou se transforme change de kit en route.
 */
async function testedCardTurn(d: SmokeDriver, cardInstanceId: string, done: { attacks: Set<string>; abilities: Set<string> }): Promise<void> {
  if (d.over || d.state.activePlayerId !== 'p1') return;
  const me = d.state.players.p1;
  if (!isOnBoard(d.state, 'p1', cardInstanceId)) {
    await d.tryAction('p1', PASS);
    return;
  }
  const isActive = me.activeCharacterInstanceId === cardInstanceId;
  for (const abilityId of manualAbilityIds(d.state, 'p1', cardInstanceId)) {
    if (done.abilities.has(abilityId)) continue;
    if (await d.tryAction('p1', { kind: 'use-ability', characterInstanceId: cardInstanceId, abilityId })) done.abilities.add(abilityId);
    if (d.over || d.state.activePlayerId !== 'p1') return;
  }
  if (!isOnBoard(d.state, 'p1', cardInstanceId)) {
    await d.tryAction('p1', PASS);
    return;
  }
  if (!isActive && me.activeCharacterInstanceId !== cardInstanceId) {
    // La carte est au banc (elle y a été renvoyée, ou c'est la variante « départ au banc »).
    for (const attack of attacksAvailableTo(d.state, cardInstanceId)) {
      if (await d.tryAction('p1', { kind: 'attack', characterInstanceId: cardInstanceId, attackId: attack.id })) return;
    }
    if (await d.tryAction('p1', { kind: 'switch', newActiveInstanceId: cardInstanceId })) return;
    await d.tryAction('p1', PASS);
    return;
  }
  const attacks = attacksAvailableTo(d.state, cardInstanceId);
  for (const attack of attacks) {
    if (done.attacks.has(attack.id)) continue;
    if (await d.tryAction('p1', { kind: 'attack', characterInstanceId: cardInstanceId, attackId: attack.id })) {
      done.attacks.add(attack.id);
      return;
    }
  }
  for (const attack of attacks) {
    if (await d.tryAction('p1', { kind: 'attack', characterInstanceId: cardInstanceId, attackId: attack.id })) return;
  }
  if (!d.over && d.state.activePlayerId === 'p1') await d.tryAction('p1', PASS);
}

async function runCharacterScenario(cardId: string, seed: number, answerer: (rng: SmokeRng) => Answerer, startOnBench: boolean): Promise<void> {
  const rng = new SmokeRng(seed * 7919 + (startOnBench ? 1 : 0));
  const config: MatchConfig = { p1Name: 'A', p2Name: 'B', p1Roster: characterRoster(cardId), p2Roster: FOE_ROSTER, seed };
  const label = `personnage ${cardId} | seed ${seed} | ${startOnBench ? 'départ au banc' : 'départ actif'}`;
  let d: SmokeDriver | undefined;
  try {
    d = await readyDriver(label, config, answerer(rng), { p1ActiveCardId: startOnBench ? 'fx-tank' : cardId, p2ActiveCardId: 'fx-tank' });
    const cardInstanceId = Object.values(d.state.players.p1.characters).find((c) => c.cardId === cardId)!.instanceId;
    const done = { attacks: new Set<string>(), abilities: new Set<string>() };

    // (d) Variante banc : capacités utilisables du banc, attaque depuis le banc, puis switch
    // (onSwitch + onBecomeActive reason 'switch').
    if (startOnBench) {
      await d.ensureTurn('p1');
      await testedCardTurn(d, cardInstanceId, done);
    }

    // (a)+(b) Toutes les attaques, toutes les capacités, avec les fixtures qui ripostent.
    for (let i = 0; i < 14 && !d.over; i++) {
      if (d.state.activePlayerId === 'p1') await testedCardTurn(d, cardInstanceId, done);
      else await fixtureTurn(d, 'p2', rng);
    }

    // (c) Six tours passés : onTurnStart/onTurnEnd, tics, recharges, expirations.
    for (let i = 0; i < 6 && !d.over; i++) await d.tryAction(d.state.activePlayerId, PASS);

    // La carte encaisse le coup fatal : afterDamage, onCharacterKO sur elle-même (avec
    // tueur), remplacement, puis deux tours pour ce qu'elle laisse derrière elle.
    for (let i = 0; i < 6 && !d.over; i++) {
      const me = d.state.players.p1;
      if (!isOnBoard(d.state, 'p1', cardInstanceId)) break;
      if (d.state.activePlayerId === 'p1') {
        if (me.activeCharacterInstanceId !== cardInstanceId) {
          if (!(await d.tryAction('p1', { kind: 'switch', newActiveInstanceId: cardInstanceId }))) await d.tryAction('p1', PASS);
        } else {
          await d.tryAction('p1', PASS);
        }
      } else {
        if (me.activeCharacterInstanceId === cardInstanceId) bringToOneHP(d.state, 'p1', cardInstanceId);
        await fixtureTurn(d, 'p2', rng);
      }
    }
    for (let i = 0; i < 4 && !d.over; i++) await d.tryAction(d.state.activePlayerId, PASS);
  } catch (err) {
    throw enrich(err, `[smoke] ${label}`, config, d);
  }
  debugReport(d);
}

// ---------------------------------------------------------------------------
// Partie A.2 -- chaque objet.
// ---------------------------------------------------------------------------

const neverPlayedObjects = new Map<string, Set<string>>();

function objectRosters(cardId: string): { me: RosterConfig; foe: RosterConfig } {
  return {
    me: { characterCardIds: ['fx-tank', 'fx-stunner', 'fx-glass'], objectCardIds: [cardId, 'fx-heal-object'], terrainCardIds: [] },
    foe: { characterCardIds: ['fx-tank', 'fx-stunner'], objectCardIds: ['fx-heal-object'], terrainCardIds: ['fx-aura-terrain'] },
  };
}

function firstHandInstance(state: GameState, playerId: PlayerId, cardId: string, kind: 'object' | 'terrain'): string | undefined {
  const p = state.players[playerId];
  if (kind === 'object') return p.unplayedObjectInstanceIds.find((id) => p.objects[id]?.cardId === cardId);
  return p.unplayedTerrainInstanceIds.find((id) => p.terrains[id]?.cardId === cardId);
}

/**
 * Renvoie `true` si l'objet a fini par être joué. `fromBeat` retarde la première tentative :
 * seed 1 essaie dès la main de départ (scénario 1), les autres seulement une fois le plateau
 * abîmé (scénario 2 : actif adverse touché, allié blessé au banc, mort au cimetière, terrain
 * adverse et objets dans les deux cimetières).
 */
async function runObjectScenario(cardId: string, seed: number, answerer: (rng: SmokeRng) => Answerer, fromBeat: number): Promise<{ played: boolean; refusals: string[] }> {
  const rng = new SmokeRng(seed * 104729 + 17);
  const { me, foe } = objectRosters(cardId);
  const config: MatchConfig = { p1Name: 'A', p2Name: 'B', p1Roster: me, p2Roster: foe, seed };
  const label = `objet ${cardId} | seed ${seed}`;
  const refusals = new Set<string>();
  let d: SmokeDriver | undefined;
  let played = false;
  let beat = 0;

  const attempt = async (): Promise<void> => {
    if (played || !d || d.over || beat++ < fromBeat) return;
    if (d.state.activePlayerId !== 'p1') return;
    const objectInstanceId = firstHandInstance(d.state, 'p1', cardId, 'object');
    if (!objectInstanceId) return;
    const res = d.match.applyAction('p1', { kind: 'play-object', objectInstanceId });
    if (!res.ok) {
      refusals.add(res.error);
      return;
    }
    d.accepted += 1;
    d.history.push(`p1 play-object ${cardId}`);
    await d.settle();
    played = true;
  };
  const playFixture = async (playerId: PlayerId, fixtureCardId: string, kind: 'object' | 'terrain'): Promise<void> => {
    if (!d || d.over || d.state.activePlayerId !== playerId) return;
    const id = firstHandInstance(d.state, playerId, fixtureCardId, kind);
    if (!id) return;
    await d.tryAction(playerId, kind === 'object' ? { kind: 'play-object', objectInstanceId: id } : { kind: 'play-terrain', terrainInstanceId: id });
  };
  const attackWithActive = async (playerId: PlayerId): Promise<void> => {
    if (!d || d.over || d.state.activePlayerId !== playerId) return;
    const activeId = d.state.players[playerId].activeCharacterInstanceId;
    if (!activeId) return;
    for (const attack of attacksAvailableTo(d.state, activeId)) {
      if (await d.tryAction(playerId, { kind: 'attack', characterInstanceId: activeId, attackId: attack.id })) return;
    }
    await d.tryAction(playerId, PASS);
  };

  try {
    d = await readyDriver(label, config, answerer(rng), { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-tank' });

    // Beat 0 : main de départ, premier tour de p1.
    await d.ensureTurn('p1');
    await attempt();
    await attackWithActive('p1');
    // p2 : terrain adverse en jeu, un objet au cimetière adverse, un coup sur l'actif de p1.
    await playFixture('p2', 'fx-aura-terrain', 'terrain');
    await playFixture('p2', 'fx-heal-object', 'object');
    await attackWithActive('p2');
    // Beat 1 : actif adverse abîmé, actif de p1 abîmé.
    await attempt();
    await playFixture('p1', 'fx-heal-object', 'object');
    if (!d.over && d.state.activePlayerId === 'p1') {
      const glassId = Object.values(d.state.players.p1.characters).find((c) => c.cardId === 'fx-glass')?.instanceId;
      if (!glassId || !(await d.tryAction('p1', { kind: 'switch', newActiveInstanceId: glassId }))) await attackWithActive('p1');
    }
    // p2 tue fx-glass (10 HP) : un mort au cimetière de p1, un allié abîmé au banc.
    await attackWithActive('p2');
    // Beats 2..7 : tentative à chaque tour de p1, échange de coups entre-temps.
    for (let i = 0; i < 6 && !d.over && !played; i++) {
      await d.ensureTurn('p1');
      await attempt();
      if (played) break;
      await attackWithActive('p1');
      await attackWithActive('p2');
    }
    if (played) {
      // L'effet vit : quelques tours de coups et de passes, puis le porteur éventuel meurt
      // (l'objet équipé doit partir au cimetière avec lui).
      for (let i = 0; i < 4 && !d.over; i++) await attackWithActive(d.state.activePlayerId);
      for (let i = 0; i < 4 && !d.over; i++) await d.tryAction(d.state.activePlayerId, PASS);
      await d.ensureTurn('p2');
      const victim = d.state.players.p1.activeCharacterInstanceId;
      if (victim) bringToOneHP(d.state, 'p1', victim);
      await attackWithActive('p2');
      for (let i = 0; i < 4 && !d.over; i++) await d.tryAction(d.state.activePlayerId, PASS);
    }
  } catch (err) {
    throw enrich(err, `[smoke] ${label}`, config, d);
  }
  debugReport(d);
  return { played, refusals: [...refusals] };
}

// ---------------------------------------------------------------------------
// Partie A.3 -- chaque terrain.
// ---------------------------------------------------------------------------

function terrainRosters(cardId: string): { me: RosterConfig; foe: RosterConfig } {
  return {
    me: { characterCardIds: ['fx-tank', 'fx-stunner', 'fx-glass'], objectCardIds: ['fx-heal-object'], terrainCardIds: [cardId, 'fx-aura-terrain'] },
    foe: { characterCardIds: ['fx-tank', 'fx-stunner'], objectCardIds: [], terrainCardIds: ['fx-aura-terrain'] },
  };
}

async function runTerrainScenario(cardId: string, seed: number, answerer: (rng: SmokeRng) => Answerer): Promise<void> {
  const rng = new SmokeRng(seed * 15485863 + 5);
  const { me, foe } = terrainRosters(cardId);
  const config: MatchConfig = { p1Name: 'A', p2Name: 'B', p1Roster: me, p2Roster: foe, seed };
  const label = `terrain ${cardId} | seed ${seed}`;
  const rounds = 2 * (getTerrainCard(cardId).durationTurns ?? 4) + 2;
  let d: SmokeDriver | undefined;
  try {
    d = await readyDriver(label, config, answerer(rng), { p1ActiveCardId: 'fx-tank', p2ActiveCardId: 'fx-tank' });
    await d.ensureTurn('p1');
    const terrainInstanceId = firstHandInstance(d.state, 'p1', cardId, 'terrain')!;
    await d.act('p1', { kind: 'play-terrain', terrainInstanceId });

    for (let round = 0; round < rounds && !d.over; round++) {
      // p1 : un soin au 2e tour (terrains de soin), sinon l'attaque de l'actif.
      if (round === 1) {
        const heal = firstHandInstance(d.state, 'p1', 'fx-heal-object', 'object');
        if (heal) await d.tryAction('p1', { kind: 'play-object', objectInstanceId: heal });
      }
      await fixtureTurn(d, 'p1', rng);
      // p2 : pose son propre terrain au 2e tour (onTerrainPlayed d'un terrain ADVERSE --
      // le filtre « mon propre terrain » est là pour ça), sinon attaque.
      if (round === 1) {
        const other = firstHandInstance(d.state, 'p2', 'fx-aura-terrain', 'terrain');
        if (other) await d.tryAction('p2', { kind: 'play-terrain', terrainInstanceId: other });
      }
      await fixtureTurn(d, 'p2', rng);
    }

    // Un second terrain par-dessus : onTerrainRemoved reason 'replaced' s'il tient encore.
    if (await d.ensureTurn('p1')) {
      const second = firstHandInstance(d.state, 'p1', 'fx-aura-terrain', 'terrain');
      if (second) await d.tryAction('p1', { kind: 'play-terrain', terrainInstanceId: second });
    }
    for (let i = 0; i < 4 && !d.over; i++) await fixtureTurn(d, d.state.activePlayerId, rng);
  } catch (err) {
    throw enrich(err, `[smoke] ${label}`, config, d);
  }
  debugReport(d);
}

// ---------------------------------------------------------------------------
// Partie B -- fuzz de parties complètes sur rosters légaux tirés de DEMO_ROSTER.
// ---------------------------------------------------------------------------

const FUZZ_MAX_ACTIONS = 120;
/** ~30 ms la partie sur ce poste : 40 parties tiennent largement dans le budget de la suite. */
const FUZZ_DEFAULT_GAMES = 40;

function fuzzSeeds(): number[] {
  const explicit = process.env['SMOKE_SEEDS'];
  if (explicit) {
    return explicit
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
  }
  const games = Number(process.env['SMOKE_GAMES'] ?? FUZZ_DEFAULT_GAMES);
  const count = Number.isInteger(games) && games > 0 ? games : FUZZ_DEFAULT_GAMES;
  return Array.from({ length: count }, (_, i) => i + 1);
}

function drawLegalRoster(rng: SmokeRng): RosterConfig {
  for (let attempt = 0; attempt < 500; attempt++) {
    const objectCardIds: string[] = [];
    const copies = new Map<string, number>();
    let guard = 0;
    while (objectCardIds.length < DECK_LIMITS.object && guard++ < 1000) {
      const id = rng.pick(DEMO_ROSTER.objectCardIds);
      const max = getCard(id).maxCopies ?? DECK_LIMITS.maxCopiesPerCard;
      if ((copies.get(id) ?? 0) >= max) continue;
      copies.set(id, (copies.get(id) ?? 0) + 1);
      objectCardIds.push(id);
    }
    const roster: RosterConfig = {
      characterCardIds: rng.sample(DEMO_ROSTER.characterCardIds, DECK_LIMITS.character),
      objectCardIds,
      terrainCardIds: rng.sample(DEMO_ROSTER.terrainCardIds, DECK_LIMITS.terrain),
    };
    if (validateRoster(roster).ok) return roster;
  }
  throw new Error('drawLegalRoster : impossible de tirer un roster légal en 500 essais');
}

/**
 * Poids relatifs des actions candidates. Sans eux, cinq personnages au banc font cinq
 * candidats `switch` contre une ou deux attaques : les parties tournaient en rond sans
 * jamais tuer personne. Les attaques restent l'action la plus probable, pour que le fuzz
 * atteigne KO, remplacements, cimetières pleins et fins de partie.
 */
const ACTION_WEIGHTS: Record<PlayerAction['kind'], number> = {
  attack: 6,
  'use-ability': 3,
  'play-object': 3,
  'play-terrain': 2,
  switch: 1,
  'recycle-objects': 1,
  pass: 0,
};

/** Toutes les actions qu'un joueur pourrait tenter maintenant, en ordre aléatoire pondéré. `pass` reste le dernier recours. */
function candidateActions(state: GameState, playerId: PlayerId, rng: SmokeRng): PlayerAction[] {
  const p = state.players[playerId];
  const actions: PlayerAction[] = [];
  for (const id of onBoardIds(state, playerId)) {
    // Y compris depuis le banc : refusé pour tout le monde sauf une carte qui l'ouvre (canAttackFromBench).
    for (const attack of attacksAvailableTo(state, id)) actions.push({ kind: 'attack', characterInstanceId: id, attackId: attack.id });
    for (const abilityId of manualAbilityIds(state, playerId, id)) actions.push({ kind: 'use-ability', characterInstanceId: id, abilityId });
  }
  for (const objectInstanceId of p.unplayedObjectInstanceIds) actions.push({ kind: 'play-object', objectInstanceId });
  for (const terrainInstanceId of p.unplayedTerrainInstanceIds) actions.push({ kind: 'play-terrain', terrainInstanceId });
  for (const newActiveInstanceId of p.benchCharacterInstanceIds) actions.push({ kind: 'switch', newActiveInstanceId });
  if (p.unplayedObjectInstanceIds.length >= RECYCLE_OBJECT_COST) {
    actions.push({ kind: 'recycle-objects', objectInstanceIds: rng.sample(p.unplayedObjectInstanceIds, RECYCLE_OBJECT_COST) });
  }
  // Tirage pondéré sans remise (Efraimidis-Spirakis) : clé = u^(1/poids), tri décroissant.
  return actions
    .map((action) => ({ action, key: Math.pow(rng.next(), 1 / ACTION_WEIGHTS[action.kind]) }))
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.action);
}

async function runFuzzGame(seed: number): Promise<void> {
  const rng = new SmokeRng(seed * 2654435761 + 97);
  const config: MatchConfig = { p1Name: 'A', p2Name: 'B', p1Roster: drawLegalRoster(rng), p2Roster: drawLegalRoster(rng), seed };
  const label = `fuzz seed ${seed}`;
  let d: SmokeDriver | undefined;
  try {
    const match = Match.create(config);
    d = new SmokeDriver(match, label, randomAnswerer(rng));
    await d.settle(); // mise en place : chaque camp choisit son actif de départ (réponse aléatoire)
    let stalls = 0;
    while (!d.over && d.accepted < FUZZ_MAX_ACTIONS) {
      const playerId = d.state.activePlayerId;
      let acted = false;
      for (const action of candidateActions(d.state, playerId, rng)) {
        if (await d.tryAction(playerId, action)) {
          acted = true;
          break;
        }
      }
      if (!acted) {
        if (!(await d.tryAction(playerId, PASS))) {
          if (++stalls > 3) throw new Error(`${d.context()} : ${playerId} ne peut même plus passer (${JSON.stringify(match.applyAction(playerId, PASS))})`);
        }
      }
    }
  } catch (err) {
    throw enrich(err, `[smoke] ${label}`, config, d);
  }
  debugReport(d);
}

// ---------------------------------------------------------------------------
// Les suites.
// ---------------------------------------------------------------------------

beforeAll(() => {
  registerTestFixtures();
  registerDemoCards();
});

describe('test/invariants.ts -- le vérificateur lui-même', () => {
  it("ne lève pas sur une partie saine tout juste mise en place", async () => {
    const config: MatchConfig = { p1Name: 'A', p2Name: 'B', p1Roster: characterRoster('fx-striker'), p2Roster: FOE_ROSTER, seed: 42 };
    const match = await createReadyMatch(config);
    assertStateInvariants(match.state, 'partie saine');
  });

  it('lève, en nommant chaque incohérence, sur un état volontairement cassé', async () => {
    const config: MatchConfig = { p1Name: 'A', p2Name: 'B', p1Roster: characterRoster('fx-striker'), p2Roster: FOE_ROSTER, seed: 42 };
    const match = await createReadyMatch(config);
    const state = match.state;
    const p1 = state.players.p1;
    const activeId = p1.activeCharacterInstanceId!;
    const active = p1.characters[activeId]!;
    const benchId = p1.benchCharacterInstanceIds[0]!;

    p1.benchCharacterInstanceIds.push(activeId); // actif aussi au banc
    p1.graveyardCharacterInstanceIds.push(benchId); // banc aussi au cimetière
    active.damage = active.currentMaxHP; // 0 HP sur le plateau
    active.shield = Number.NaN; // NaN
    active.statuses.push({ statusId: 'bleed', label: 'x', data: { stacks: 11 } });
    active.statuses.push({ statusId: 'stun', label: '', remainingTurns: -1 });
    active.attachedObjectInstanceIds.push('11111111-2222-4333-8444-555555555555'); // objet inconnu
    state.players.p2.unplayedObjectInstanceIds.push('deadbeef-0000-4000-8000-000000000000'); // objet inconnu
    state.log.push({ id: 'x', turnNumber: 1, message: `Unknown character instance "${activeId}"`, data: { kind: 'error' } });
    state.log.push({ id: 'y', turnNumber: 1, message: '' });

    const violations = collectStateViolations(state);
    const expectFound = (fragment: string) => {
      if (!violations.some((v) => v.includes(fragment))) {
        throw new Error(`violation attendue contenant « ${fragment} », obtenu :\n  - ${violations.join('\n  - ')}`);
      }
    };
    expectFound('à la fois en actif et en banc');
    expectFound('à la fois en banc et en cimetière');
    expectFound('sur le plateau à 0 HP');
    expectFound('nombre non fini');
    expectFound('stacks = 11');
    expectFound('label vide');
    expectFound('remainingTurns = -1');
    expectFound('porte un objet inconnu');
    expectFound('référence un objet inconnu');
    expectFound('exception avalée');
    expectFound('instanceId brut');
    expectFound('message vide');

    let thrown: unknown;
    try {
      assertStateInvariants(state, 'état cassé');
    } catch (err) {
      thrown = err;
    }
    if (!(thrown instanceof InvariantViolation)) throw new Error('assertStateInvariants aurait dû lever InvariantViolation');
    if (!thrown.message.includes('état cassé')) throw new Error('le contexte doit figurer dans le message');
  });
});

describe('smoke A.1 -- chaque personnage du catalogue joue une vraie partie', () => {
  const cases = DEMO_ROSTER.characterCardIds.flatMap((cardId) =>
    CARD_SEEDS.map(({ seed, answerer }) => ({ cardId, seed, answerer }))
  );
  it.each(cases)('$cardId (seed $seed)', async ({ cardId, seed, answerer }) => {
    const known = knownFailure(cardId, 'character', seed);
    if (known) {
      console.info(`[smoke] ${cardId} seed ${seed} skippé (KNOWN_SMOKE_FAILURES) : ${known.reason}`);
      return;
    }
    await runCharacterScenario(cardId, seed, answerer, false);
    await runCharacterScenario(cardId, seed, answerer, true);
  }, 20_000);
});

describe('smoke A.2 -- chaque objet du catalogue est joué (ou signalé comme jamais joué)', () => {
  const cases = DEMO_ROSTER.objectCardIds.flatMap((cardId) =>
    CARD_SEEDS.map(({ seed, answerer }) => ({ cardId, seed, answerer }))
  );
  it.each(cases)('$cardId (seed $seed)', async ({ cardId, seed, answerer }) => {
    const known = knownFailure(cardId, 'object', seed);
    if (known) {
      console.info(`[smoke] ${cardId} seed ${seed} skippé (KNOWN_SMOKE_FAILURES) : ${known.reason}`);
      return;
    }
    const { played, refusals } = await runObjectScenario(cardId, seed, answerer, seed === 1 ? 0 : 2);
    if (!played) {
      const set = neverPlayedObjects.get(cardId) ?? new Set<string>();
      for (const r of refusals) set.add(r);
      neverPlayedObjects.set(cardId, set);
    } else {
      neverPlayedObjects.set(cardId, new Set(['__played__']));
    }
  }, 20_000);

  afterAll(() => {
    const never = [...neverPlayedObjects].filter(([, refusals]) => !refusals.has('__played__'));
    if (never.length === 0) return;
    const lines = never.map(([cardId, refusals]) => `  - ${cardId} : ${[...refusals].join(' / ') || 'aucune raison remontée'}`);
    console.info(`[smoke] objets jamais joués par le smoke (${never.length}) -- hors filet, à couvrir par un test dédié si besoin :\n${lines.join('\n')}`);
  });
});

describe('smoke A.3 -- chaque terrain du catalogue est posé, expire ou est remplacé', () => {
  const cases = DEMO_ROSTER.terrainCardIds.flatMap((cardId) =>
    CARD_SEEDS.map(({ seed, answerer }) => ({ cardId, seed, answerer }))
  );
  it.each(cases)('$cardId (seed $seed)', async ({ cardId, seed, answerer }) => {
    const known = knownFailure(cardId, 'terrain', seed);
    if (known) {
      console.info(`[smoke] ${cardId} seed ${seed} skippé (KNOWN_SMOKE_FAILURES) : ${known.reason}`);
      return;
    }
    await runTerrainScenario(cardId, seed, answerer);
  }, 20_000);
});

describe('smoke B -- parties complètes aléatoires (seedées) sur rosters légaux', () => {
  it.each(fuzzSeeds().map((seed) => ({ seed })))('fuzz seed $seed', async ({ seed }) => {
    const known = KNOWN_SMOKE_FAILURES.find((k) => k.scenario === 'fuzz' && k.seed === seed);
    if (known) {
      console.info(`[smoke] fuzz seed ${seed} skippé (KNOWN_SMOKE_FAILURES, ${known.cardId}) : ${known.reason}`);
      return;
    }
    await runFuzzGame(seed);
  }, 30_000);
});
