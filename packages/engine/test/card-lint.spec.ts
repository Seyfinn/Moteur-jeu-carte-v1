import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listCards,
  registerDemoCards,
  type AbilityDef,
  type AttackDef,
  type CardDef,
  type CharacterCardDef,
  type ModifierDef,
} from '../src/index.js';

/**
 * Lint du CATALOGUE : les pièges classiques d'une nouvelle carte, attrapés sans test par carte.
 *
 * Complète `card-conventions.spec.ts` (registre, DEMO_ROSTER, entrée de doc, HP de la doc,
 * ids en double...) sur deux axes que celui-ci laisse volontairement de côté :
 *
 * 1. **Le texte imprimé** (section A) : les `description`/`name`/HP/ATK du moteur sont
 *    comparés au caractère près aux JSON du dossier `ADMIN Cartes tout/` (dossier PARENT du
 *    dépôt, cf. CLAUDE.md « Les description sont le texte EXACT de la carte »). Ce dossier
 *    n'existe pas en CI : toute la section est alors sautée, jamais en échec.
 * 2. **Les pièges d'écriture listés dans CLAUDE.md** (section B) : `equipment` sans
 *    `attachSelfTo`, `onTerrainPlayed` sans garde, état au niveau module, `chancePercent`
 *    en direct, le `+1` des statuts bloquants, `TODO(scaffold)` oublié, doc incomplète...
 *
 * Chaque test liste TOUTES ses violations d'un coup et son message dit quoi corriger. Les
 * allowlists (`KNOWN_DRIFTS`, `KNOWN_DOC_GAPS`, `ALLOWED_*`) sont des décisions explicites,
 * une raison par entrée -- et une entrée devenue inutile fait échouer la suite, pour qu'elles
 * ne s'empilent pas.
 */
beforeAll(() => {
  registerDemoCards();
});

// ---------------------------------------------------------------------------
// Chemins et accès au catalogue
// ---------------------------------------------------------------------------

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..', '..');
const DEMO_DIR = path.resolve(REPO_ROOT, 'packages', 'engine', 'src', 'cards', 'demo');
const DOC_PATH = path.resolve(REPO_ROOT, 'docs', 'cartes.md');
const ADMIN_DIR = process.env['ADMIN_CARDS_DIR'] ?? path.resolve(REPO_ROOT, '..', 'ADMIN Cartes tout');
const ADMIN_AVAILABLE = existsSync(ADMIN_DIR);

/** Les cartes de démo seules : les fixtures de test (`fx-*`) n'ont ni fichier ni JSON. */
function demoCards(): CardDef[] {
  return listCards().filter((c) => !c.id.startsWith('fx-'));
}

function demoCharacters(): CharacterCardDef[] {
  return demoCards().filter((c): c is CharacterCardDef => c.type === 'character');
}

/** Capacités déclarées par une carte (personnage ou terrain ; un objet n'en a pas). */
function abilitiesOf(card: CardDef): AbilityDef[] {
  if (card.type === 'character') return card.abilities;
  if (card.type === 'terrain') return card.abilities ?? [];
  return [];
}

/** Capacités imprimées : `hidden: true` est de la plomberie moteur, jamais du texte de carte. */
function printedAbilitiesOf(card: CardDef): AbilityDef[] {
  return abilitiesOf(card).filter((a) => !a.hidden);
}

/** Toutes les fonctions d'une carte dont le source est intéressant à relire. */
function executeSourcesOf(card: CardDef): { where: string; source: string }[] {
  const out: { where: string; source: string }[] = [];
  if (card.type === 'character') {
    for (const a of card.attacks) out.push({ where: 'attaque ' + a.id, source: a.execute.toString() });
  }
  if (card.type === 'object') out.push({ where: 'execute', source: card.execute.toString() });
  for (const a of abilitiesOf(card)) out.push({ where: 'capacité ' + a.id, source: a.execute.toString() });
  return out;
}

interface CardSourceFile {
  id: string;
  file: string;
  /** Source sans commentaires : un pattern cité dans un commentaire n'est pas une violation. */
  code: string;
}

/** Retire les commentaires `/* *\/` et `//` (approximation suffisante pour du lint par regex). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

let sourceFilesCache: CardSourceFile[] | undefined;
/** Un fichier = une carte (`index.ts` est le registre, `shared.ts` un helper à part). */
function cardSourceFiles(): CardSourceFile[] {
  if (!sourceFilesCache) {
    sourceFilesCache = readdirSync(DEMO_DIR)
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && f !== 'shared.ts')
      .map((f) => {
        const raw = readFileSync(path.join(DEMO_DIR, f), 'utf8');
        return { id: f.slice(0, -'.ts'.length), file: 'cards/demo/' + f, code: stripComments(raw) };
      });
  }
  return sourceFilesCache;
}

/** Fenêtre de texte entre `opener` et sa parenthèse fermante équilibrée, pour chaque occurrence. */
function callWindows(source: string, opener: string): string[] {
  const out: string[] = [];
  let i = 0;
  while ((i = source.indexOf(opener, i)) !== -1) {
    let j = i + opener.length;
    let depth = 1;
    for (; j < source.length && depth > 0; j++) {
      if (source[j] === '(') depth++;
      else if (source[j] === ')') depth--;
    }
    out.push(source.slice(i + opener.length, j - 1));
    i = j;
  }
  return out;
}

/** Retire un bloc `key: { ... }` (accolades équilibrées) d'un objet littéral en texte. */
function stripNestedObject(source: string, key: string): string {
  const k = source.indexOf(key);
  if (k === -1) return source;
  const open = source.indexOf('{', k);
  if (open === -1) return source;
  let j = open + 1;
  let depth = 1;
  for (; j < source.length && depth > 0; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}') depth--;
  }
  return source.slice(0, k) + source.slice(j);
}

/** Message d'échec commun : la liste des violations, puis où lire la règle. */
function report(intro: string, violations: string[], rule: string): string {
  return `${intro}\n  - ${violations.join('\n  - ')}\nRègle : ${rule} (CLAUDE.md).`;
}

// ---------------------------------------------------------------------------
// A. Texte exact vs JSON de l'éditeur (`ADMIN Cartes tout/`)
// ---------------------------------------------------------------------------

/** Ce que l'éditeur de cartes exporte (les champs qu'on lit ; le reste est de la mise en page). */
interface AdminCardJson {
  type?: 'personnage' | 'objet' | 'terrain';
  nom?: string;
  hp?: number | string;
  terrainDuration?: string;
  abilities?: { kind?: string; name?: string; desc?: string }[];
  attacks?: { name?: string; damage?: string; desc?: string }[];
  description?: string;
  linkedEquipment?: boolean;
  uniqueEnabled?: boolean;
}

/** Fichier JSON dont le nom ne suit pas l'id de la carte moteur. */
const JSON_FILE_ALIASES: Record<string, string> = {
  'crit-plus': 'crit',
};

/** JSON sans carte moteur, connus et assumés (tableau « Écarts connus » de docs/cartes.md). */
const JSON_WITHOUT_ENGINE_CARD = new Set(['brise-bouclier', 'potion', 'chopper (1)']);

/** JSON qui existe mais n'est qu'un brouillon vide : comparer n'aurait aucun sens. */
const JSON_DRAFTS = new Set(['bakugo']);

interface KnownDrift {
  cardId: string;
  /** Clé du champ telle que produite par `compareWithJson` (voir les `field` ci-dessous). */
  field: string;
  reason: string;
}

/**
 * Écarts NUMÉRIQUES ou STRUCTURELS entre le code et le JSON, relevés et laissés en l'état :
 * les résoudre est un choix d'équilibrage ou de design, pas une correction de texte. Un écart
 * de texte pur (typo, ponctuation, saut de ligne) n'a rien à faire ici : le JSON fait foi, on
 * corrige le code.
 */
const KNOWN_DRIFTS: KnownDrift[] = [
  {
    cardId: 'zoe',
    field: 'abilities.order',
    reason: 'le code déclare Portail Dimensionnel puis Spell Thief, la carte imprime l\'inverse',
  },
  {
    cardId: 'sion',
    field: 'abilities.order',
    reason: 'le code déclare Essence vitale puis Guerrier mourant, la carte imprime l\'inverse',
  },
  {
    cardId: 'chrollo-lucilfer',
    field: 'ability[Actif volé].missing-in-json',
    reason: "l'actif emprunté à la victime n'est pas imprimé sur la carte ; une capacité active ne peut pas être `hidden`",
  },
  {
    cardId: 'yumeko',
    field: 'ability[Bonus].kind',
    reason: 'imprimée « Active », codée passive (le droit d\'attaquer du banc est un modifier canAttackFromBench)',
  },
  {
    cardId: 'deidara',
    field: 'ability[Détonation : Katsu !].name',
    reason: 'espace de tête dans le nom côté JSON (résidu d\'éditeur) -- à corriger dans le JSON, pas dans le code',
  },
  {
    cardId: 'soma',
    field: 'attack[Couteau de Chef].name',
    reason: 'espace de tête dans le nom côté JSON (résidu d\'éditeur) -- à corriger dans le JSON, pas dans le code',
  },
  {
    cardId: 'soma',
    field: 'ability[Menu Surprise].name',
    reason: 'espace de tête dans le nom côté JSON (résidu d\'éditeur) -- à corriger dans le JSON, pas dans le code',
  },
];

interface Drift {
  cardId: string;
  field: string;
  detail: string;
}

/** La seule normalisation tolérée : fins de ligne Windows, et espaces de FIN de chaîne. */
function normText(s: string | undefined): string {
  return (s ?? '').replace(/\r\n/g, '\n').replace(/\s+$/u, '');
}

/** Clé d'appariement d'un membre (attaque/capacité) : un espace ou une majuscule de trop ne doit pas désapparier. */
function pairKey(name: string | undefined): string {
  return normText(name).trim().toLowerCase();
}

function isNumeric(s: unknown): s is string {
  return typeof s === 'string' && /^\d+$/.test(s.trim());
}

let adminCache: Map<string, AdminCardJson> | undefined;
/** Tous les JSON du dossier ADMIN, indexés par nom de fichier sans extension. */
function adminJsons(): Map<string, AdminCardJson> {
  if (!adminCache) {
    adminCache = new Map();
    if (ADMIN_AVAILABLE) {
      for (const f of readdirSync(ADMIN_DIR).filter((f) => f.endsWith('.json'))) {
        adminCache.set(f.slice(0, -'.json'.length), JSON.parse(readFileSync(path.join(ADMIN_DIR, f), 'utf8')) as AdminCardJson);
      }
    }
  }
  return adminCache;
}

function adminJsonFor(card: CardDef): AdminCardJson | undefined {
  const key = JSON_FILE_ALIASES[card.id] ?? card.id;
  if (JSON_DRAFTS.has(key)) return undefined;
  return adminJsons().get(key);
}

/**
 * Apparie les membres du code et du JSON par nom (clé souple), puis les restes par position
 * -- pour qu'un membre renommé ressorte comme UN écart de nom et non deux « absent ». Une
 * séquence de noms différente ressort à part comme un écart d'ordre.
 */
function pairMembers<C extends { name: string }, J extends { name?: string }>(
  code: C[],
  json: J[]
): { pairs: [C, J][]; onlyCode: C[]; onlyJson: J[]; sameOrder: boolean } {
  const pairs: [C, J][] = [];
  const remainingJson = [...json];
  const onlyCode: C[] = [];
  for (const c of code) {
    const k = remainingJson.findIndex((j) => pairKey(j.name) === pairKey(c.name));
    if (k === -1) onlyCode.push(c);
    else pairs.push([c, remainingJson.splice(k, 1)[0]!]);
  }
  const leftovers = Math.min(onlyCode.length, remainingJson.length);
  for (let i = 0; i < leftovers; i++) pairs.push([onlyCode[i]!, remainingJson[i]!]);
  const onlyJson = remainingJson.slice(leftovers);
  // Même ordre relatif des membres appariés des deux côtés (un membre renommé ou absent
  // d'un côté n'est pas un problème d'ordre, il est déjà signalé pour lui-même).
  const jsonIndexes = [...pairs].sort(([a], [b]) => code.indexOf(a) - code.indexOf(b)).map(([, j]) => json.indexOf(j));
  const sameOrder = jsonIndexes.every((idx, i) => i === 0 || idx > jsonIndexes[i - 1]!);
  return { pairs, onlyCode: onlyCode.slice(leftovers), onlyJson, sameOrder };
}

function show(s: string | undefined): string {
  return JSON.stringify(s ?? '');
}

/** Tous les écarts d'une carte vis-à-vis de son JSON, avec une clé `field` stable par écart. */
function compareWithJson(card: CardDef, json: AdminCardJson): Drift[] {
  const drifts: Drift[] = [];
  const push = (field: string, detail: string) => drifts.push({ cardId: card.id, field, detail });

  if (normText(card.name) !== normText(json.nom)) push('name', `code=${show(card.name)} json=${show(json.nom)}`);

  if (card.type === 'character') {
    if (card.baseMaxHP !== Number(json.hp)) push('hp', `baseMaxHP=${card.baseMaxHP} json hp=${String(json.hp)}`);

    // Attaques : une attaque au nom vide est une ligne vide de l'éditeur.
    const jsonAttacks = (json.attacks ?? []).filter((a) => normText(a.name).trim() !== '');
    const attacks = pairMembers(card.attacks, jsonAttacks);
    for (const a of attacks.onlyCode) push(`attack[${a.name}].missing-in-json`, `l'attaque ${show(a.name)} du code n'est pas sur la carte`);
    for (const a of attacks.onlyJson) push(`attack[${a.name ?? ''}].missing-in-code`, `l'attaque ${show(a.name)} de la carte n'existe pas dans le code`);
    if (!attacks.sameOrder) {
      push('attacks.order', `code=[${card.attacks.map((a) => a.name).join(' | ')}] json=[${jsonAttacks.map((a) => a.name).join(' | ')}]`);
    }
    for (const [c, j] of attacks.pairs) {
      const key = `attack[${c.name}]`;
      if (normText(c.name) !== normText(j.name)) push(key + '.name', `code=${show(c.name)} json=${show(j.name)}`);
      if (normText(c.description) !== normText(j.desc)) push(key + '.desc', `code=${show(c.description)} json=${show(j.desc)}`);
      // « 30+ », « - » ou vide : notation d'éditeur, pas un nombre à vérifier.
      if (isNumeric(j.damage) && Number(j.damage) !== c.baseATK) push(key + '.damage', `baseATK=${c.baseATK} json damage=${j.damage}`);
    }
  }

  // Capacités : uniquement celles des personnages (les `abilities` d'un objet ou d'un terrain
  // sont un résidu d'éditeur recopié d'une autre carte).
  if (card.type === 'character') {
    const jsonAbilities = (json.abilities ?? []).filter((a) => normText(a.name).trim() !== '');
    const abilities = pairMembers(printedAbilitiesOf(card), jsonAbilities);
    for (const a of abilities.onlyCode) push(`ability[${a.name}].missing-in-json`, `la capacité ${show(a.name)} du code n'est pas sur la carte (ni \`hidden\`)`);
    for (const a of abilities.onlyJson) push(`ability[${a.name ?? ''}].missing-in-code`, `la capacité ${show(a.name)} de la carte n'existe pas dans le code`);
    if (!abilities.sameOrder) {
      push('abilities.order', `code=[${printedAbilitiesOf(card).map((a) => a.name).join(' | ')}] json=[${jsonAbilities.map((a) => a.name).join(' | ')}]`);
    }
    for (const [c, j] of abilities.pairs) {
      const key = `ability[${c.name}]`;
      if (normText(c.name) !== normText(j.name)) push(key + '.name', `code=${show(c.name)} json=${show(j.name)}`);
      if (normText(c.description) !== normText(j.desc)) push(key + '.desc', `code=${show(c.description)} json=${show(j.desc)}`);
      const jsonKind = (j.kind ?? '').trim().toLowerCase();
      if (jsonKind && jsonKind !== c.kind) push(key + '.kind', `code=${c.kind} json=${j.kind}`);
    }
  }

  if (card.type === 'object' || card.type === 'terrain') {
    if (normText(card.description) !== normText(json.description)) {
      push('description', `code=${show(card.description)} json=${show(json.description)}`);
    }
    // Les deux drapeaux n'existent que dans les exports récents de l'éditeur : absents du
    // JSON, ils ne disent rien.
    if ('linkedEquipment' in json) {
      const equipment = card.type === 'object' && card.equipment === true;
      if (equipment !== Boolean(json.linkedEquipment)) push('equipment', `equipment=${equipment} json linkedEquipment=${String(json.linkedEquipment)}`);
    }
    if ('uniqueEnabled' in json) {
      const unique = card.maxCopies === 1;
      if (unique !== Boolean(json.uniqueEnabled)) push('unique', `maxCopies=${String(card.maxCopies)} json uniqueEnabled=${String(json.uniqueEnabled)}`);
    }
    if (card.type === 'terrain' && isNumeric(json.terrainDuration) && Number(json.terrainDuration) !== card.durationTurns) {
      push('duration', `durationTurns=${String(card.durationTurns)} json terrainDuration=${json.terrainDuration}`);
    }
  }

  return drifts;
}

let driftsCache: Drift[] | undefined;
function allDrifts(): Drift[] {
  if (!driftsCache) {
    driftsCache = demoCards().flatMap((card) => {
      const json = adminJsonFor(card);
      return json ? compareWithJson(card, json) : [];
    });
  }
  return driftsCache;
}

function isKnownDrift(d: Drift): boolean {
  return KNOWN_DRIFTS.some((k) => k.cardId === d.cardId && k.field === d.field);
}

/** Les écarts d'une catégorie qui ne sont PAS allowlistés, formatés pour le message d'échec. */
function unexpectedDrifts(fieldMatches: (field: string) => boolean): string[] {
  return allDrifts()
    .filter((d) => fieldMatches(d.field) && !isKnownDrift(d))
    .map((d) => `${d.cardId} · ${d.field} : ${d.detail}`);
}

const TEXT_RULE =
  "écart de TEXTE (typo, espace, ponctuation, saut de ligne) : le JSON fait foi, corriger le code ; écart de NOMBRE ou de STRUCTURE (HP, dégâts, durée, equipment/unique, membre absent d'un côté, ordre) : décision d'équilibrage, à consigner dans KNOWN_DRIFTS avec sa raison. Section « Les description sont le texte EXACT de la carte »";

describe.skipIf(!ADMIN_AVAILABLE)(`A. texte imprimé -- le code suit les JSON de ${ADMIN_DIR}`, () => {
  it('nom et HP', () => {
    const bad = unexpectedDrifts((f) => f === 'name' || f === 'hp');
    expect(bad, report('nom ou HP différents du JSON de la carte :', bad, TEXT_RULE)).toEqual([]);
  });

  it('attaques : mêmes noms, même texte au caractère près, mêmes dégâts', () => {
    const bad = unexpectedDrifts((f) => f.startsWith('attack'));
    expect(bad, report('attaques différentes du JSON de la carte :', bad, TEXT_RULE)).toEqual([]);
  });

  it('capacités imprimées : mêmes noms, même texte, même nature (Active/Passive)', () => {
    const bad = unexpectedDrifts((f) => f.startsWith('abilit'));
    expect(
      bad,
      report(
        'capacités différentes du JSON de la carte (les capacités `hidden: true` sont ignorées) :',
        bad,
        TEXT_RULE + ' ; une capacité de plomberie doit porter `hidden: true`'
      )
    ).toEqual([]);
  });

  it('objets et terrains : description, objet à lier, exemplaire unique, durée', () => {
    const bad = unexpectedDrifts((f) => ['description', 'equipment', 'unique', 'duration'].includes(f));
    expect(bad, report('objets/terrains différents du JSON de la carte :', bad, TEXT_RULE)).toEqual([]);
  });

  it('KNOWN_DRIFTS ne garde que des écarts encore réels', () => {
    const drifts = allDrifts();
    const stale = KNOWN_DRIFTS.filter((k) => !drifts.some((d) => d.cardId === k.cardId && d.field === k.field)).map(
      (k) => `${k.cardId} · ${k.field} (${k.reason})`
    );
    expect(stale, report("entrées de KNOWN_DRIFTS qui ne correspondent plus à aucun écart -- à retirer :", stale, 'une allowlist ne documente que des écarts réels')).toEqual([]);
  });

  it('couverture : chaque carte moteur a son JSON, chaque JSON a sa carte (hors écarts connus)', () => {
    const problems: string[] = [];
    const engineIds = new Set(demoCards().map((c) => c.id));
    for (const card of demoCards()) {
      const key = JSON_FILE_ALIASES[card.id] ?? card.id;
      if (JSON_DRAFTS.has(key)) continue;
      if (!adminJsons().has(key)) problems.push(`${card.id} : aucun ${key}.json dans le dossier ADMIN (exporter la carte, ou ajouter un alias dans JSON_FILE_ALIASES)`);
    }
    const aliased = new Set(Object.values(JSON_FILE_ALIASES));
    for (const key of adminJsons().keys()) {
      if (engineIds.has(key) || aliased.has(key) || JSON_WITHOUT_ENGINE_CARD.has(key) || JSON_DRAFTS.has(key)) continue;
      problems.push(`${key}.json : aucune carte moteur ne porte cet id (carte à écrire, ou à ajouter à JSON_WITHOUT_ENGINE_CARD)`);
    }
    for (const key of JSON_WITHOUT_ENGINE_CARD) {
      if (engineIds.has(key)) problems.push(`${key} : listé dans JSON_WITHOUT_ENGINE_CARD alors que la carte moteur existe -- retirer l'entrée`);
      if (!adminJsons().has(key)) problems.push(`${key} : listé dans JSON_WITHOUT_ENGINE_CARD mais le JSON n'existe plus -- retirer l'entrée`);
    }
    expect(problems, report('correspondance carte moteur <-> JSON incomplète :', problems, 'un JSON par carte dans ADMIN Cartes tout/')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B. Pièges d'écriture de CLAUDE.md (indépendants du dossier ADMIN)
// ---------------------------------------------------------------------------

describe('B. pièges de CLAUDE.md -- objets à lier', () => {
  it('`equipment: true` et `ctx.attachSelfTo(...)` vont toujours ensemble', () => {
    const problems: string[] = [];
    const files = new Map(cardSourceFiles().map((f) => [f.id, f]));
    for (const card of demoCards()) {
      if (card.type !== 'object') continue;
      const attaches = files.get(card.id)?.code.includes('attachSelfTo(') ?? false;
      const declared = card.equipment === true;
      if (attaches && !declared) problems.push(`${card.id} : appelle attachSelfTo mais ne déclare pas \`equipment: true\` (pas de logo 🔗, mauvaise catégorie du deck-builder)`);
      if (declared && !attaches) problems.push(`${card.id} : déclare \`equipment: true\` mais n'appelle jamais attachSelfTo (la carte mentirait au joueur)`);
    }
    expect(problems, report('objets à lier incohérents :', problems, 'Patterns récurrents > « Objet à lier (équipement) »')).toEqual([]);
  });
});

describe('B. pièges de CLAUDE.md -- terrains', () => {
  it("un trigger `onTerrainPlayed` / `onTerrainRemoved` d'un terrain filtre sur son propre terrain", () => {
    const problems: string[] = [];
    for (const card of demoCards()) {
      if (card.type !== 'terrain') continue;
      for (const ability of abilitiesOf(card)) {
        const triggers = ([] as string[]).concat(ability.trigger ?? []);
        if (!triggers.some((t) => t === 'onTerrainPlayed' || t === 'onTerrainRemoved')) continue;
        const cond = ability.condition?.toString() ?? '';
        if (!cond.includes('terrainInstanceId') || !cond.includes('sourceInstanceId')) {
          problems.push(`${card.id}/${ability.id} (${triggers.join(', ')}) : pas de condition \`event.data.terrainInstanceId === ctx.sourceInstanceId\``);
        }
      }
    }
    expect(
      problems,
      report("triggers de terrain sans garde « c'est bien mon terrain » (l'effet se rejouerait à chaque terrain posé par n'importe qui) :", problems, 'Patterns récurrents > « Un trigger onTerrainPlayed DOIT filtrer sur son propre terrain »')
    ).toEqual([]);
  });
});

describe('B. pièges de CLAUDE.md -- source des fichiers de carte', () => {
  it('aucun état mutable au niveau module (un serveur héberge plusieurs parties)', () => {
    const problems: string[] = [];
    for (const f of cardSourceFiles()) {
      const lines = f.code.split('\n');
      lines.forEach((line, idx) => {
        const where = `${f.file}:${idx + 1}`;
        if (/^(export\s+)?(let|var)\s/.test(line)) {
          problems.push(`${where} : \`${line.trim()}\` -- variable de module réassignable`);
          return;
        }
        const collection = line.match(/^(?:export\s+)?const\s+(\w+)\s*(?::[^=]+)?=\s*new\s+(Map|Set)\b[^(]*\(([^)]*)\)/);
        if (collection) {
          const [, name, kind, args] = collection;
          const mutated = new RegExp(`\\b${name}\\.(add|set|delete|clear)\\(`).test(f.code);
          if (args!.trim() === '' || mutated) {
            problems.push(`${where} : \`${line.trim()}\` -- ${kind} de module ${mutated ? 'muté dans le fichier' : 'vide, donc accumulateur'}`);
          }
          return;
        }
        if (/^(?:export\s+)?const\s+\w+\s*(?::[^=]+)?=\s*(\[\]|\{\})\s*;?\s*$/.test(line)) {
          problems.push(`${where} : \`${line.trim()}\` -- tableau/objet vide de module, donc accumulateur`);
        }
      });
    }
    expect(
      problems,
      report("état au niveau module dans un fichier de carte (à ranger dans un statut, `ctx.scratch` ou le `data` de l'instance) :", problems, 'Patterns récurrents > « Ne jamais utiliser une variable au niveau du module »')
    ).toEqual([]);
  });

  it('les jets à pourcentage passent par `ctx.rollChance`, jamais par `chancePercent` en direct', () => {
    const problems = cardSourceFiles()
      .filter((f) => f.code.includes('chancePercent('))
      .map((f) => `${f.file} : appelle chancePercent(...) -- le jet est silencieux, aucune roue à l'écran`);
    expect(problems, report('jets silencieux :', problems, 'Patterns récurrents > « Jet à pourcentage »')).toEqual([]);
  });

  it('chaque `ctx.rollChance` nomme le personnage de la roue (`{ characterInstanceId }`)', () => {
    const problems: string[] = [];
    for (const f of cardSourceFiles()) {
      for (const args of callWindows(f.code, 'rollChance(')) {
        if (!args.includes('characterInstanceId')) {
          problems.push(`${f.file} : rollChance(${args.replace(/\s+/g, ' ').trim().slice(0, 80)}) -- 3ᵉ argument { characterInstanceId } absent`);
        }
      }
    }
    expect(problems, report('roues de pourcentage anonymes :', problems, 'Journal d\'événements > chance-roll, « un jet annoncé sans ce champ est un jet dont le joueur ne saura pas de qui il parle »')).toEqual([]);
  });

  it('jamais deux prompts en parallèle (`Promise.all` autour d\'un `ctx.choose*`)', () => {
    const problems: string[] = [];
    for (const f of cardSourceFiles()) {
      for (const args of callWindows(f.code, 'Promise.all(')) {
        if (/\.choose(Option|OptionFor|YesNo|Order)?\(/.test(args)) problems.push(`${f.file} : Promise.all englobant un ctx.choose* -- le moteur n'accepte qu'une question à la fois`);
      }
    }
    expect(problems, report('prompts parallèles :', problems, 'EffectContext > « Une seule question à la fois »')).toEqual([]);
  });

  /**
   * `getCharacterCard(x).attacks` rate une attaque empruntée (`borrowed-attack`) : pour un
   * personnage EN JEU, passer par `attacksAvailableTo` / `findAttackFor` (queries.ts). Lire
   * les attaques IMPRIMÉES d'une carte reste légitime -- c'est ce que font les entrées ici.
   */
  const ALLOWED_PRINTED_ATTACK_LOOKUPS: Record<string, string> = {
    'chrollo-lucilfer': "retrouve par id l'attaque VOLÉE sur la carte imprimée de la victime -- le vol porte sur ce qui est imprimé",
    'livre-de-chrollo': "l'offre est tirée dans tout le catalogue (`listCards`), la carte n'est pas forcément en jeu",
  };

  it("`getCharacterCard(...).attacks` n'est pas utilisé pour énumérer les attaques d'un personnage en jeu", () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const f of cardSourceFiles()) {
      if (!/getCharacterCard\([^()]*\)\.attacks\b/.test(f.code)) continue;
      seen.add(f.id);
      if (!(f.id in ALLOWED_PRINTED_ATTACK_LOOKUPS)) {
        problems.push(`${f.file} : getCharacterCard(...).attacks -- utiliser attacksAvailableTo/findAttackFor (queries.ts), ou allowlister ici si la carte lit bien des attaques imprimées`);
      }
    }
    for (const id of Object.keys(ALLOWED_PRINTED_ATTACK_LOOKUPS)) {
      if (!seen.has(id)) problems.push(`${id} : allowlisté dans ALLOWED_PRINTED_ATTACK_LOOKUPS mais ne fait plus l'appel -- retirer l'entrée`);
    }
    expect(problems, report("énumération d'attaques qui raterait une attaque empruntée :", problems, 'Statuts génériques > `borrowed-attack`, « Corollaire »')).toEqual([]);
  });

  it('aucun `TODO(scaffold)` ne traîne dans les fichiers de carte ni dans docs/cartes.md', () => {
    const problems: string[] = [];
    for (const f of readdirSync(DEMO_DIR).filter((f) => f.endsWith('.ts'))) {
      const raw = readFileSync(path.join(DEMO_DIR, f), 'utf8');
      const count = raw.split('TODO(scaffold)').length - 1;
      if (count > 0) problems.push(`cards/demo/${f} : ${count} TODO(scaffold)`);
    }
    const docCount = readFileSync(DOC_PATH, 'utf8').split('TODO(scaffold)').length - 1;
    if (docCount > 0) problems.push(`docs/cartes.md : ${docCount} TODO(scaffold)`);
    expect(problems, report('stubs de scaffold non remplis :', problems, 'Workflow par défaut pour une nouvelle carte')).toEqual([]);
  });
});

describe('B. pièges de CLAUDE.md -- définitions de carte', () => {
  it("une capacité `kind: 'active'` n'a pas de `trigger` (un actif est déclenché par le joueur)", () => {
    const problems = demoCards().flatMap((card) =>
      abilitiesOf(card)
        .filter((a) => a.kind === 'active' && a.trigger)
        .map((a) => `${card.id}/${a.id} : kind 'active' avec trigger ${JSON.stringify(a.trigger)} -- un actif déclenché par un event doit être 'passive'`)
    );
    expect(problems, report('actifs à trigger :', problems, 'API des cartes, « Seules les abilities kind: active sans trigger sont activables manuellement »')).toEqual([]);
  });

  it('un modifier ne mute rien (fonction pure : il ne peut pas consommer une charge)', () => {
    const problems: string[] = [];
    const mutation = /(ctx\.state\.[\w.\[\]'"]+\s*(=[^=]|\+=|-=|\+\+|--)|\.push\(|\.splice\(|applyStatus\(|removeStatus\(|delete\s+ctx\.state)/;
    for (const card of demoCards()) {
      for (const [i, mod] of (card.modifiers ?? []).entries()) {
        const m = mod as ModifierDef;
        const sources = [m.vote, m.transform, m.isActive].map((fn) => fn?.toString() ?? '');
        if (sources.some((s) => mutation.test(s))) {
          problems.push(`${card.id} · modifiers[${i}] (${m.query}) : mutation dans vote/transform/isActive -- déplacer la consommation dans un trigger (onSwitch, afterDamage...)`);
        }
      }
    }
    expect(problems, report('modifiers impurs :', problems, 'Patterns récurrents > « Rendre une action gratuite », « un modifier ne peut pas consommer une charge »')).toEqual([]);
  });

  /** Statuts qui BLOQUENT une action : décrémentés puis filtrés au début du tour du porteur, avant qu'il agisse. */
  const BLOCKING_STATUS_IDS = new Set(['stun', 'disarmed', 'silence-active', 'silence-passive', 'silence-ultimate', 'chained']);

  it('un statut bloquant posé sur un adversaire porte au moins `remainingTurns: 2` (le `+1`)', () => {
    const problems: string[] = [];
    for (const card of demoCards()) {
      for (const { where, source } of executeSourcesOf(card)) {
        for (const args of callWindows(source, 'applyStatus(')) {
          // `onExpire` est appliqué APRÈS la passe de décompte : sa durée ne demande aucun +1.
          const body = stripNestedObject(args, 'onExpire');
          const statusId = body.match(/statusId:\s*['"]([\w-]+)['"]/)?.[1];
          const remaining = body.match(/remainingTurns:\s*(\d+)\b/)?.[1];
          if (!statusId || !BLOCKING_STATUS_IDS.has(statusId) || remaining !== '1') continue;
          // Posé sur SOI-MÊME pendant son propre tour (« ne peut pas attaquer ce round »), le
          // statut couvre bien le reste du tour : le tick n'arrive qu'au tour suivant.
          const target = body.split(',')[0] ?? '';
          if (target.includes('sourceInstanceId')) continue;
          problems.push(`${card.id} · ${where} : applyStatus(${target.trim()}, { statusId: '${statusId}', remainingTurns: 1 }) -- retiré au début du tour de la cible, avant d'avoir bloqué quoi que ce soit`);
        }
      }
    }
    expect(problems, report('statuts bloquants à durée 1 :', problems, 'Durées de statuts : le `+1`')).toEqual([]);
  });

  /** Tournures qui trahissent une annotation ajoutée au texte imprimé. */
  const ANNOTATION_PATTERN = /\(voir |\(cf\.|\bNB\s*:|\bNote\s*:/i;

  it("aucune `description` ne porte d'annotation ajoutée (« (voir », « (cf. », « NB : », « Note : »)", () => {
    const problems: string[] = [];
    for (const card of demoCards()) {
      const json = ADMIN_AVAILABLE ? adminJsonFor(card) : undefined;
      const printed = new Set<string>();
      if (json) {
        for (const a of json.attacks ?? []) printed.add(normText(a.desc));
        for (const a of json.abilities ?? []) printed.add(normText(a.desc));
        printed.add(normText(json.description));
      }
      const texts: [string, string][] = [];
      if (card.type === 'character') for (const a of card.attacks) texts.push(['attaque ' + a.id, a.description]);
      else texts.push(['description', card.description]);
      for (const a of printedAbilitiesOf(card)) texts.push(['capacité ' + a.id, a.description]);
      for (const [where, text] of texts) {
        // Si la carte imprime elle-même cette parenthèse, ce n'est pas une annotation.
        if (!ANNOTATION_PATTERN.test(text) || printed.has(normText(text))) continue;
        problems.push(`${card.id} · ${where} : ${show(text)}`);
      }
    }
    expect(problems, report('annotations dans un texte de carte (le comportement réel va dans docs/cartes.md ou en commentaire) :', problems, '« Les description sont le texte EXACT de la carte »')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B12. docs/cartes.md mentionne chaque attaque et chaque capacité imprimée
// ---------------------------------------------------------------------------

interface KnownDocGap {
  cardId: string;
  member: string;
  reason: string;
}

/** Noms que la doc écrit autrement que le code (ancienne orthographe) -- à réaligner dans docs/cartes.md, pas ici. */
const KNOWN_DOC_GAPS: KnownDocGap[] = [
  { cardId: 'sion', member: 'Guerrier mourant', reason: 'la doc écrit « Guerrier mourrant »' },
  { cardId: 'sukuna', member: 'Extension de territoire', reason: 'la doc écrit « Extention de territoire »' },
  { cardId: 'gon', member: 'Serment de Vengeance', reason: 'la doc a gardé la coquille « Sermet de Vengance », corrigée depuis sur la carte' },
  { cardId: 'gon-adulte', member: 'Serment de Vengeance', reason: 'la doc a gardé la coquille « Sermet de Vengance », corrigée depuis sur la carte' },
];

/** Comparaison indulgente pour une note de travail : accents, casse et espaces multiples ne comptent pas. */
function looseText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

describe('B. docs/cartes.md -- chaque attaque et capacité imprimée est documentée', () => {
  const doc = () => readFileSync(DOC_PATH, 'utf8');
  /** Corps de chaque section `### Titre`, jusqu'au `###` suivant. */
  const sections = () => {
    const text = doc();
    const heads = [...text.matchAll(/^### (.+)$/gm)].map((m) => ({ title: m[1]!.trim(), start: m.index! }));
    return heads.map((h, i) => ({ title: h.title, body: text.slice(h.start, heads[i + 1]?.start ?? text.length) }));
  };
  const sectionFor = (name: string) =>
    sections().find((s) => s.title === name || s.title.startsWith(name + ' —') || s.title.startsWith(name + ' -'));

  it('la section de chaque personnage nomme toutes ses attaques et capacités non `hidden`', () => {
    const gaps: { cardId: string; member: string }[] = [];
    for (const card of demoCharacters()) {
      const section = sectionFor(card.name);
      if (!section) continue; // déjà signalé par card-conventions.spec.ts
      const body = looseText(section.body);
      const members: (AttackDef | AbilityDef)[] = [...card.attacks, ...printedAbilitiesOf(card)];
      for (const m of members) {
        if (!body.includes(looseText(m.name))) gaps.push({ cardId: card.id, member: m.name });
      }
    }
    const isKnown = (g: { cardId: string; member: string }) => KNOWN_DOC_GAPS.some((k) => k.cardId === g.cardId && k.member === g.member);
    const problems = gaps.filter((g) => !isKnown(g)).map((g) => `${g.cardId} : « ${g.member} » absent de la section « ${sectionFor(demoCharacters().find((c) => c.id === g.cardId)!.name)!.title} »`);
    const stale = KNOWN_DOC_GAPS.filter((k) => !gaps.some((g) => g.cardId === k.cardId && g.member === k.member)).map(
      (k) => `${k.cardId} · ${k.member} : entrée de KNOWN_DOC_GAPS devenue inutile (${k.reason}) -- à retirer`
    );
    expect(
      [...problems, ...stale],
      report("membres non documentés dans docs/cartes.md (une ligne par attaque/capacité, avec le texte imprimé et ce que fait le moteur) :", [...problems, ...stale], 'Workflow par défaut, étape 4')
    ).toEqual([]);
  });
});
