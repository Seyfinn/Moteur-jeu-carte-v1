#!/usr/bin/env node
/**
 * new-card -- squelette complet d'une nouvelle carte à partir du JSON de l'éditeur de cartes.
 *
 * USAGE
 *   npm run new-card -- <slug> [options]          (depuis la racine du dépôt)
 *   npm run new-card -w engine -- <slug> [options]
 *
 *   <slug>                 id de la carte (kebab-case ASCII) = nom du fichier
 *                          `<slug>.json` dans le dossier ADMIN = `cards/demo/<slug>.ts`.
 *   --json <fichier>       lire ce JSON au lieu de `<admin-dir>/<slug>.json` (le PNG est
 *                          alors cherché à côté du JSON, puis dans le dossier ADMIN).
 *   --admin-dir <dossier>  dossier des exports de l'éditeur. Défaut : `$ADMIN_CARDS_DIR`,
 *                          sinon `../ADMIN Cartes tout` (dossier PARENT du dépôt).
 *   --dry-run              affiche le fichier généré et la liste des édits, n'écrit rien.
 *   --force                réécrit `cards/demo/<slug>.ts` s'il existe déjà (les autres
 *                          édits sont idempotentes de toute façon ; le PNG n'est jamais
 *                          écrasé).
 *   --no-png               ne copie pas l'illustration.
 *   --help                 cette aide.
 *
 * CE QUE LE SCRIPT FAIT
 *   1. `packages/engine/src/cards/demo/<slug>.ts` : un stub qui COMPILE, textes verbatim,
 *      et un `TODO(scaffold)` partout où il reste de la logique à écrire à la main.
 *   2. `packages/engine/src/cards/demo/index.ts` : import, `export { ... }`,
 *      `registerCard(...)`, et l'id dans `DEMO_ROSTER` (jamais `DEMO_STARTER_DECK`).
 *      Idempotent : relancer le script ne duplique aucune ligne.
 *   3. `docs/cartes.md` : l'entrée `### ...` à sa place alphabétique dans la section du
 *      type, avec le texte imprimé et une ligne `- Moteur : TODO(scaffold)`.
 *   4. `packages/web/public/cards/<slug>.png` : copie de l'illustration si elle existe.
 *
 * MAPPING JSON (éditeur) -> CardDef (moteur)
 *   type            'personnage' -> CharacterCardDef, 'objet' -> ObjectCardDef,
 *                   'terrain' -> TerrainCardDef.
 *   nom             -> name (verbatim). Le `nom` d'une attaque/ability -> name (verbatim),
 *                   et son id = kebab-case ASCII du nom (accents/apostrophes retirés :
 *                   « Frappe à la nuque » -> 'frappe-a-la-nuque'). Collision d'ids dans la
 *                   carte : suffixe '-passive'/'-active' (ability homonyme d'une attaque,
 *                   cf. Dio Brando) ou '-2', '-3'.
 *   nomFamille      non vide -> family.
 *   hp              -> baseMaxHP (personnage seulement ; sur un objet/terrain c'est un
 *                   résidu de l'éditeur, ignoré avec un avertissement).
 *   attacks[]       (personnage) name/damage/desc :
 *                     - name vide -> ligne vide de l'éditeur, ignorée ;
 *                     - une constante `<ID>_ATK` par attaque ;
 *                     - damage numérique + desc vide -> `simpleAttack(...)` ;
 *                     - desc contenant « peut crit » (et rien d'autre) -> `mayCritAttack(...)`
 *                       (33 %, convention maison) ;
 *                     - desc non vide -> AttackDef complet : `hitActive(ctx, <ID>_ATK)`
 *                       (avec `critPercent: MAY_CRIT_PERCENT` si « peut crit » est mêlé à
 *                       un autre effet) puis `// TODO(scaffold): <desc>` ;
 *                     - damage non numérique ("30+", "-", "") -> constante à 0 +
 *                       `TODO(scaffold)`.
 *                   (objet/terrain) : résidu de l'éditeur, ignoré avec un avertissement.
 *   abilities[]     (personnage) kind 'Active' -> 'active', 'Passive' -> 'passive' ;
 *                   description verbatim ; `execute` vide + `TODO(scaffold)` ; une passive
 *                   reçoit en plus un rappel `trigger:` à choisir (liste dans CLAUDE.md).
 *                   (objet/terrain) : résidu, ignoré avec un avertissement (un
 *                   `ObjectCardDef` n'a pas d'abilities).
 *   description     (objet/terrain) -> description verbatim, sauts de ligne compris.
 *   terrainDuration (terrain) numérique -> durationTurns ; "" -> rien (durée indéfinie).
 *   linkedEquipment true -> `equipment: true` + `execute` qui fait choisir un porteur sur le
 *                   plateau (`ctx.choose({ kind: 'select-characters' })` filtré par
 *                   `getMaxAttachedObjects` / `canTargetBench`) puis `ctx.attachSelfTo`.
 *   uniqueEnabled   true -> `maxCopies: 1`.
 *   imageDataUrl, brushLayerDataUrl, couleurs, polices... : ignorés, jamais affichés.
 *
 * Aucune dépendance : Node >= 18, ESM pur, pas de build.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------------------
// Chemins
// ---------------------------------------------------------------------------------------

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(ENGINE_DIR, '..', '..');
const CARDS_DIR = path.join(ENGINE_DIR, 'src', 'cards', 'demo');
const INDEX_PATH = path.join(CARDS_DIR, 'index.ts');
const DOC_PATH = path.join(REPO_ROOT, 'docs', 'cartes.md');
const PNG_DIR = path.join(REPO_ROOT, 'packages', 'web', 'public', 'cards');
const DEFAULT_ADMIN_DIR = path.resolve(REPO_ROOT, '..', 'ADMIN Cartes tout');

const TODO = 'TODO(scaffold)';

// ---------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------

function printHelp() {
  const header = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  const start = header.findIndex((l) => l.startsWith('/**'));
  const end = header.findIndex((l) => l.startsWith(' */'));
  console.log(
    header
      .slice(start + 1, end)
      .map((l) => l.replace(/^ \* ?/, ''))
      .join('\n')
  );
}

function parseArgs(argv) {
  const opts = { slug: undefined, json: undefined, adminDir: undefined, dryRun: false, force: false, png: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--force':
        opts.force = true;
        break;
      case '--no-png':
        opts.png = false;
        break;
      case '--json':
        opts.json = argv[++i];
        if (!opts.json) fail('--json attend un chemin de fichier.');
        break;
      case '--admin-dir':
        opts.adminDir = argv[++i];
        if (!opts.adminDir) fail('--admin-dir attend un dossier.');
        break;
      default:
        if (a.startsWith('--')) fail(`Option inconnue : ${a} (voir --help).`);
        if (opts.slug) fail(`Un seul slug attendu, reçu "${opts.slug}" et "${a}".`);
        opts.slug = a;
    }
  }
  return opts;
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const warnings = [];
function warn(message) {
  warnings.push(message);
}

// ---------------------------------------------------------------------------------------
// Texte : slug, camelCase, échappement
// ---------------------------------------------------------------------------------------

/** « Frappe à la nuque » -> 'frappe-a-la-nuque' (ASCII, sans accents ni apostrophes). */
function toKebab(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[œŒ]/g, 'oe')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[ß]/g, 'ss')
    .toLowerCase()
    .replace(/['’`´]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 'izuku-de-l-academie' -> 'izukuDeLAcademie'. */
function toCamel(slug) {
  const camel = slug
    .split('-')
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join('');
  return /^[a-z_$]/i.test(camel) ? camel : `card${camel[0].toUpperCase()}${camel.slice(1)}`;
}

/** 'frappe-a-la-nuque' -> 'FRAPPE_A_LA_NUQUE'. */
function toConstName(id, suffix) {
  let name = id.toUpperCase().replace(/-/g, '_');
  if (!/^[A-Z_]/.test(name)) name = `ATK_${name}`;
  return `${name}_${suffix}`;
}

/** Sans accents ni casse, pour comparer un nom de carte à un slug. */
function normalizeForMatch(text) {
  return toKebab(text).replace(/-/g, ' ');
}

/**
 * Chaîne TypeScript : single quotes par défaut, double quotes si le texte contient une
 * apostrophe et aucun guillemet double (comme les cartes existantes). Sauts de ligne -> \n
 * (le client affiche les descriptions en `white-space: pre-line`).
 */
function tsString(text) {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n');
  const useDouble = raw.includes("'") && !raw.includes('"');
  const quote = useDouble ? '"' : "'";
  const escaped = raw
    .replace(/\\/g, '\\\\')
    .replace(new RegExp(quote, 'g'), `\\${quote}`)
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `${quote}${escaped}${quote}`;
}

/** Texte imprimé en une ligne, pour un commentaire `// TODO(scaffold): ...`. */
function oneLine(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' / ');
}

/** Découpe une longue `description:` sur la ligne suivante, comme Prettier le ferait. */
function descriptionField(indent, text) {
  const literal = tsString(text);
  const inline = `${indent}description: ${literal},`;
  if (inline.length <= 100) return inline;
  return `${indent}description:\n${indent}  ${literal},`;
}

function isNumericString(value) {
  return typeof value === 'string' ? /^\s*\d+\s*$/.test(value) : Number.isInteger(value);
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[m][n];
}

// ---------------------------------------------------------------------------------------
// Lecture du JSON de l'éditeur
// ---------------------------------------------------------------------------------------

/** Lit un export de l'éditeur SANS jamais garder (ni logger) les data URLs d'images. */
function readCardJson(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`JSON illisible : ${file}\n  ${err.message}`);
  }
  const { imageDataUrl: _img, brushLayerDataUrl: _brush, ...rest } = parsed;
  return rest;
}

function listAdminJsonFiles(adminDir) {
  if (!existsSync(adminDir) || !statSync(adminDir).isDirectory()) return [];
  return readdirSync(adminDir)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .map((f) => path.join(adminDir, f));
}

/** Quand `<slug>.json` manque : cherche par `nom` et propose les plus proches. */
function suggestCandidates(slug, adminDir) {
  const files = listAdminJsonFiles(adminDir);
  if (files.length === 0) return `Le dossier ADMIN est vide ou introuvable : ${adminDir}`;
  const wanted = normalizeForMatch(slug);
  const scored = [];
  for (const file of files) {
    let nom = '';
    try {
      nom = String(readCardJson(file).nom ?? '');
    } catch {
      continue;
    }
    const base = path.basename(file, '.json');
    const byName = normalizeForMatch(nom);
    const byFile = normalizeForMatch(base);
    // Un slug tronqué ou partiel (« gojo » pour gojo-satoru) vaut mieux qu'un nom court
    // qui n'a que deux lettres de différence : le contenu prime sur la distance d'édition.
    const contains = [byName, byFile].some((s) => s && (s.includes(wanted) || wanted.includes(s)));
    const score = contains ? 0.5 : Math.min(levenshtein(wanted, byName), levenshtein(wanted, byFile));
    scored.push({ file: base, nom, score, exact: byName === wanted || byFile === wanted });
  }
  scored.sort((a, b) => Number(b.exact) - Number(a.exact) || a.score - b.score || a.file.localeCompare(b.file));
  const top = scored.slice(0, 6);
  const lines = top.map((c) => `  - ${c.file}.json  (nom : « ${c.nom} »)${c.exact ? '  <- même nom' : ''}`);
  return `Candidats les plus proches dans ${adminDir} :\n${lines.join('\n')}\n` +
    `Relancer avec le bon slug, ou : npm run new-card -- ${slug} --json "<chemin>"`;
}

// ---------------------------------------------------------------------------------------
// JSON -> modèle intermédiaire
// ---------------------------------------------------------------------------------------

const TYPE_MAP = { personnage: 'character', objet: 'object', terrain: 'terrain' };

function parseCard(json, slug) {
  const type = TYPE_MAP[String(json.type ?? '').toLowerCase()];
  if (!type) fail(`Type de carte inconnu dans le JSON : "${json.type}" (attendu personnage | objet | terrain).`);

  const name = String(json.nom ?? '').replace(/\r\n?/g, '\n');
  if (!name.trim()) fail('Le JSON n\'a pas de `nom`.');
  if (normalizeForMatch(name) !== normalizeForMatch(slug)) {
    warn(`Le nom imprimé « ${name} » ne correspond pas au slug "${slug}" : vérifier que c'est la bonne carte.`);
  }

  const card = { type, slug, name, varName: toCamel(slug) };

  const rawAttacks = Array.isArray(json.attacks) ? json.attacks : [];
  const rawAbilities = Array.isArray(json.abilities) ? json.abilities : [];
  const realAttacks = rawAttacks.filter((a) => String(a?.name ?? '').trim() !== '');
  const realAbilities = rawAbilities.filter((a) => String(a?.name ?? '').trim() !== '');
  if (realAttacks.length !== rawAttacks.length) {
    warn(`${rawAttacks.length - realAttacks.length} ligne(s) d'attaque sans nom ignorée(s) (ligne vide de l'éditeur).`);
  }

  if (type === 'character') {
    if (!isNumericString(json.hp)) {
      warn(`\`hp\` non numérique ("${json.hp}") : baseMaxHP mis à 0 avec un ${TODO}.`);
      card.hp = 0;
      card.hpTodo = true;
    } else {
      card.hp = Number(json.hp);
    }
    card.family = String(json.nomFamille ?? '').trim();
    card.attacks = [];
    card.abilities = [];
    const usedIds = new Set();
    const claimId = (base, kindSuffix) => {
      let id = base || 'sans-nom';
      if (usedIds.has(id) && kindSuffix && !usedIds.has(`${id}-${kindSuffix}`)) {
        warn(`Id "${id}" déjà pris dans la carte : renommé "${id}-${kindSuffix}" (comme Dio Brando).`);
        id = `${id}-${kindSuffix}`;
      }
      let n = 2;
      const root = id;
      while (usedIds.has(id)) id = `${root}-${n++}`;
      if (id !== root) warn(`Id "${root}" déjà pris dans la carte : renommé "${id}".`);
      usedIds.add(id);
      return id;
    };
    for (const a of realAttacks) {
      const attackName = String(a.name).replace(/\r\n?/g, '\n');
      const desc = String(a.desc ?? '').replace(/\r\n?/g, '\n');
      const id = claimId(toKebab(attackName));
      const damageRaw = a.damage === undefined || a.damage === null ? '' : String(a.damage);
      const numeric = isNumericString(damageRaw);
      if (!numeric) warn(`Attaque « ${attackName} » : dégâts imprimés "${damageRaw}" non numériques -> baseATK 0 + ${TODO}.`);
      const mentionsCrit = /peut\s+crit/i.test(desc);
      // « Cette attaque peut crit » seul : rien d'autre à coder que le taux relevé.
      const critOnly = mentionsCrit && desc.replace(/cette\s+attaque/gi, '').replace(/peut\s+crit(ique)?s?/gi, '').replace(/[\s.!,;:()-]/g, '') === '';
      card.attacks.push({
        id,
        name: attackName,
        desc,
        damageRaw,
        baseATK: numeric ? Number(damageRaw) : 0,
        numeric,
        constName: toConstName(id, 'ATK'),
        mentionsCrit,
        critOnly,
      });
    }
    for (const a of realAbilities) {
      const abilityName = String(a.name).replace(/\r\n?/g, '\n');
      const desc = String(a.desc ?? '').replace(/\r\n?/g, '\n');
      const kindRaw = String(a.kind ?? '').toLowerCase();
      let kind = kindRaw === 'active' ? 'active' : kindRaw === 'passive' ? 'passive' : undefined;
      if (!kind) {
        warn(`Capacité « ${abilityName} » : kind "${a.kind}" inconnu -> 'passive' + ${TODO}.`);
        kind = 'passive';
      }
      const id = claimId(toKebab(abilityName), kind);
      card.abilities.push({ id, name: abilityName, desc, kind, kindUnknown: kindRaw !== 'active' && kindRaw !== 'passive' });
    }
    if (String(json.description ?? '').trim()) {
      warn('Le JSON a une `description` de carte sur un personnage : un CharacterCardDef n\'en a pas, elle est ignorée.');
    }
  } else {
    card.description = String(json.description ?? '').replace(/\r\n?/g, '\n');
    if (!card.description.trim()) warn('`description` vide : la carte n\'imprime aucun texte ?');
    if (realAttacks.length) {
      warn(`${realAttacks.length} attaque(s) résiduelle(s) d'une autre carte ignorée(s) (« ${realAttacks.map((a) => a.name).join(' », « ')} »).`);
    }
    if (realAbilities.length) {
      warn(`${realAbilities.length} capacité(s) résiduelle(s) d'une autre carte ignorée(s) (« ${realAbilities.map((a) => a.name).join(' », « ')} »).`);
    }
    if (json.hp !== undefined && json.hp !== null && json.hp !== '' && Number(json.hp) !== 0) {
      warn(`\`hp: ${json.hp}\` sur un ${type === 'object' ? 'objet' : 'terrain'} : résidu de l'éditeur, ignoré.`);
    }
    if (String(json.nomFamille ?? '').trim()) warn('`nomFamille` sur un objet/terrain : ignoré (champ réservé aux personnages).');
  }

  card.unique = json.uniqueEnabled === true;
  card.equipment = json.linkedEquipment === true;
  if (type === 'terrain') {
    const d = json.terrainDuration;
    if (isNumericString(d) && Number(d) > 0) card.durationTurns = Number(d);
    else if (String(d ?? '').trim() !== '' && String(d) !== '0') warn(`\`terrainDuration: "${d}"\` non numérique : durée laissée indéfinie.`);
    if (card.equipment) warn('`linkedEquipment` sur un terrain : ignoré.');
  } else if (type === 'character') {
    if (card.unique) warn('`uniqueEnabled` sur un personnage : ignoré (un personnage est déjà unique par nature dans un deck).');
    if (card.equipment) warn('`linkedEquipment` sur un personnage : ignoré.');
  }
  return card;
}

// ---------------------------------------------------------------------------------------
// Génération du fichier de carte
// ---------------------------------------------------------------------------------------

function generateCharacter(card) {
  const helpers = new Set();
  const constLines = [];
  const attackBlocks = [];

  for (const atk of card.attacks) {
    const todoConst = atk.numeric ? '' : ` // ${TODO}: dégâts imprimés "${atk.damageRaw}" -- fixer la vraie valeur`;
    constLines.push(`const ${atk.constName} = ${atk.baseATK};${todoConst}`);

    const plain = atk.desc.trim() === '';
    if (plain && atk.numeric) {
      helpers.add('simpleAttack');
      attackBlocks.push(`    simpleAttack(${tsString(atk.id)}, ${tsString(atk.name)}, ${atk.constName}, ''),`);
      continue;
    }
    if (atk.critOnly && atk.numeric) {
      helpers.add('mayCritAttack');
      attackBlocks.push(`    mayCritAttack(${tsString(atk.id)}, ${tsString(atk.name)}, ${atk.constName}, ${tsString(atk.desc)}),`);
      continue;
    }
    helpers.add('hitActive');
    const hitOptions = atk.mentionsCrit ? `, { critPercent: MAY_CRIT_PERCENT, critLabel: ${tsString(atk.name)} }` : '';
    if (atk.mentionsCrit) helpers.add('MAY_CRIT_PERCENT');
    const lines = [
      '    {',
      `      id: ${tsString(atk.id)},`,
      `      name: ${tsString(atk.name)},`,
      `      baseATK: ${atk.constName},`,
      descriptionField('      ', atk.desc),
      '      async execute(ctx) {',
      `        const targetId = await hitActive(ctx, ${atk.constName}${hitOptions});`,
    ];
    if (!atk.numeric) lines.push(`        // ${TODO}: dégâts imprimés "${atk.damageRaw}" -- ajuster la constante ${atk.constName} ou le calcul.`);
    if (!plain) {
      lines.push('        if (!targetId) return;');
      lines.push(`        // ${TODO}: ${oneLine(atk.desc)}`);
    } else {
      lines.push(`        // ${TODO}: pas de texte imprimé -- attaque simple une fois les dégâts fixés (simpleAttack).`);
      lines.push('        void targetId;');
    }
    lines.push('      },', '    },');
    attackBlocks.push(lines.join('\n'));
  }

  const abilityBlocks = card.abilities.map((ab) => {
    const lines = ['    {', `      id: ${tsString(ab.id)},`, `      name: ${tsString(ab.name)},`, `      kind: ${tsString(ab.kind)},`, descriptionField('      ', ab.desc)];
    if (ab.kindUnknown) lines.push(`      // ${TODO}: kind inconnu dans le JSON, 'passive' par défaut -- vérifier.`);
    if (ab.kind === 'passive') {
      lines.push(
        `      // ${TODO}: choisir le \`trigger:\` (un event ou une liste, cf. « Événements » dans CLAUDE.md :`,
        '      // onTurnStart, onTurnEnd, onBecomeActive, onAttackDeclared, beforeDamage, afterDamage,',
        '      // onCharacterKO, onSwitch, onObjectPlayed, onTerrainPlayed...) + `condition(ctx)` pour ne',
        '      // réagir qu\'au bon événement, ou la laisser purement descriptive si la mécanique vit dans',
        '      // un `modifier` (préférer un modifier pour un trait permanent et inné).'
      );
    } else {
      lines.push(`      // ${TODO}: usesPerTurn / usesPerGame / endsTurn / condition(ctx) si le texte les impose.`);
    }
    lines.push('      async execute(ctx) {', `        // ${TODO}: ${oneLine(ab.desc) || 'sans texte imprimé'}`, '        void ctx;', '      },', '    },');
    return lines.join('\n');
  });

  const imports = [`import type { CharacterCardDef } from '../types.js';`];
  if (helpers.size) imports.push(`import { ${[...helpers].sort().join(', ')} } from './shared.js';`);

  const out = [];
  out.push(...imports, '');
  if (constLines.length) out.push(...constLines, '');
  out.push(`export const ${card.varName}: CharacterCardDef = {`);
  out.push(`  type: 'character',`);
  out.push(`  id: ${tsString(card.slug)},`);
  out.push(`  name: ${tsString(card.name)},`);
  if (card.family) out.push(`  family: ${tsString(card.family)},`);
  out.push(`  baseMaxHP: ${card.hp},${card.hpTodo ? ` // ${TODO}: HP illisibles dans le JSON` : ''}`);
  out.push(attackBlocks.length ? '  attacks: [' : '  attacks: [],');
  if (attackBlocks.length) out.push(...attackBlocks, '  ],');
  out.push(abilityBlocks.length ? '  abilities: [' : '  abilities: [],');
  if (abilityBlocks.length) out.push(...abilityBlocks, '  ],');
  out.push('};', '');
  return out.join('\n');
}

function generateObject(card) {
  const out = [];
  out.push(`import type { ObjectCardDef } from '../types.js';`);
  if (card.equipment) out.push(`import { canTargetBench, getMaxAttachedObjects } from '../../queries.js';`);
  out.push('');
  out.push(`export const ${card.varName}: ObjectCardDef = {`);
  out.push(`  type: 'object',`);
  out.push(`  id: ${tsString(card.slug)},`);
  out.push(`  name: ${tsString(card.name)},`);
  if (card.equipment) out.push('  equipment: true,');
  if (card.unique) out.push('  maxCopies: 1,');
  out.push(descriptionField('  ', card.description));
  if (card.equipment) {
    out.push(
      '  unplayableReason(state, ownerId) {',
      '    const player = state.players[ownerId];',
      '    const ids = [player.activeCharacterInstanceId, ...player.benchCharacterInstanceIds].filter(',
      '      (id): id is string => id !== null',
      '    );',
      '    const hasRoom = ids.some((id) => {',
      '      const char = player.characters[id];',
      '      return !!char && char.attachedObjectInstanceIds.length < getMaxAttachedObjects(state, id);',
      '    });',
      "    if (!hasRoom) return 'Aucun de vos personnages ne peut porter un objet de plus.';",
      '    return null;',
      '  },',
      '  async execute(ctx) {',
      '    const activeAlly = ctx.getActive(ctx.ownerId);',
      '    const candidates = ctx',
      '      .getAllOnBoard(ctx.ownerId)',
      '      .filter((c) => c.attachedObjectInstanceIds.length < getMaxAttachedObjects(ctx.state, c.instanceId))',
      '      // Le propre banc du joueur reste soumis aux protections adverses (Arène).',
      '      .filter(',
      '        (c) =>',
      '          c.instanceId === activeAlly?.instanceId ||',
      '          canTargetBench(ctx.state, ctx.sourceInstanceId, c.instanceId, true).allow',
      '      );',
      '    if (candidates.length === 0) return;',
      '',
      '    const [targetId] = await ctx.choose({',
      "      kind: 'select-characters',",
      `      prompt: ${tsString(`${card.name} : choisissez le personnage à équiper`)},`,
      '      options: candidates.map((c) => c.instanceId),',
      '      min: 1,',
      '      max: 1,',
      '    });',
      '    if (!targetId) return;',
      '',
      '    ctx.attachSelfTo(targetId);',
      `    // ${TODO}: ${oneLine(card.description) || 'effet de la carte'}`,
      `    // ${TODO}: un statut posé ici doit porter \`data.objectInstanceId: ctx.sourceInstanceId\` pour`,
      '    // partir avec l\'objet (et réciproquement), sauf s\'il doit lui survivre -- cf. CLAUDE.md.',
      '  },'
    );
  } else {
    out.push(
      `  // ${TODO}: \`unplayableReason(state, ownerId)\` si la carte peut être jouée « dans le vide ».`,
      '  async execute(ctx) {',
      `    // ${TODO}: ${oneLine(card.description) || 'effet de la carte'}`,
      '    void ctx;',
      '  },'
    );
  }
  out.push('};', '');
  return out.join('\n');
}

function generateTerrain(card) {
  const out = [];
  out.push(`import type { TerrainCardDef } from '../types.js';`, '');
  if (card.durationTurns !== undefined) out.push(`const DURATION_TURNS = ${card.durationTurns};`, '');
  out.push(`export const ${card.varName}: TerrainCardDef = {`);
  out.push(`  type: 'terrain',`);
  out.push(`  id: ${tsString(card.slug)},`);
  out.push(`  name: ${tsString(card.name)},`);
  out.push(descriptionField('  ', card.description));
  if (card.durationTurns !== undefined) out.push('  durationTurns: DURATION_TURNS,');
  else out.push(`  // durationTurns absent = durée indéfinie (terrainDuration vide dans le JSON). ${TODO}: confirmer.`);
  out.push(
    `  // ${TODO}: ${oneLine(card.description) || 'effet du terrain'}`,
    `  // ${TODO}: \`abilities\` (un trigger 'onTerrainPlayed' DOIT filtrer sur son propre terrain :`,
    '  //   condition(ctx) { return ctx.event?.data[\'terrainInstanceId\'] === ctx.sourceInstanceId; })',
    '  //   et/ou `modifiers` (queries.ts). Un statut posé sans durée propre doit être levé sur',
    '  //   \'onTerrainRemoved\'.'
  );
  out.push('};', '');
  return out.join('\n');
}

function generateCardFile(card) {
  if (card.type === 'character') return generateCharacter(card);
  if (card.type === 'object') return generateObject(card);
  return generateTerrain(card);
}

// ---------------------------------------------------------------------------------------
// index.ts (idempotent)
// ---------------------------------------------------------------------------------------

function planIndexEdits(source, card) {
  const lines = source.split('\n');
  const edits = []; // { line (index où insérer AVANT), text, what }
  const { varName, slug, type } = card;

  // 1. import
  const importLine = `import { ${varName} } from './${slug}.js';`;
  if (!lines.some((l) => l.includes(`from './${slug}.js'`))) {
    let last = -1;
    lines.forEach((l, i) => {
      if (/^import .* from '\.\/.*\.js';\s*$/.test(l)) last = i;
    });
    if (last < 0) fail('index.ts : bloc d\'imports introuvable.');
    edits.push({ line: last + 1, text: importLine, what: 'import' });
  } else if (!lines.some((l) => l.includes(`{ ${varName} }`) && l.includes(`'./${slug}.js'`))) {
    warn(`index.ts importe déjà './${slug}.js' sous un autre nom : import laissé tel quel.`);
  }

  // 2. export { ... }
  const exportStart = lines.findIndex((l) => /^export \{\s*$/.test(l));
  if (exportStart < 0) fail('index.ts : bloc `export {` introuvable.');
  const exportEnd = lines.findIndex((l, i) => i > exportStart && /^\};\s*$/.test(l));
  if (exportEnd < 0) fail('index.ts : fin du bloc `export {` introuvable.');
  const exportRe = new RegExp(`^\\s*${varName},?\\s*$`);
  if (!lines.slice(exportStart + 1, exportEnd).some((l) => exportRe.test(l))) {
    edits.push({ line: exportEnd, text: `  ${varName},`, what: 'export' });
  }

  // 3. registerCard(...)
  const regStart = lines.findIndex((l) => /^export function registerDemoCards\(\)/.test(l));
  if (regStart < 0) fail('index.ts : `registerDemoCards()` introuvable.');
  const regEnd = lines.findIndex((l, i) => i > regStart && /^\}\s*$/.test(l));
  if (regEnd < 0) fail('index.ts : fin de `registerDemoCards()` introuvable.');
  const regRe = new RegExp(`^\\s*registerCard\\(${varName}\\);`);
  if (!lines.slice(regStart + 1, regEnd).some((l) => regRe.test(l))) {
    edits.push({ line: regEnd, text: `  registerCard(${varName});`, what: 'registerCard' });
  }

  // 4. DEMO_ROSTER (jamais DEMO_STARTER_DECK)
  const rosterStart = lines.findIndex((l) => /^export const DEMO_ROSTER\b/.test(l));
  if (rosterStart < 0) fail('index.ts : `DEMO_ROSTER` introuvable.');
  const rosterEnd = lines.findIndex((l, i) => i > rosterStart && /^\};\s*$/.test(l));
  if (rosterEnd < 0) fail('index.ts : fin de `DEMO_ROSTER` introuvable.');
  const key = type === 'character' ? 'characterCardIds' : type === 'object' ? 'objectCardIds' : 'terrainCardIds';
  const keyStart = lines.findIndex((l, i) => i > rosterStart && i < rosterEnd && new RegExp(`^\\s*${key}: \\[`).test(l));
  if (keyStart < 0) fail(`index.ts : \`${key}\` introuvable dans DEMO_ROSTER.`);
  if (/\]\s*,?\s*$/.test(lines[keyStart])) {
    fail(`index.ts : \`${key}\` de DEMO_ROSTER est écrit sur une seule ligne, insertion automatique impossible -- ajouter \`${varName}.id\` à la main.`);
  }
  const keyEnd = lines.findIndex((l, i) => i > keyStart && i < rosterEnd && /^\s*\],?\s*$/.test(l));
  if (keyEnd < 0) fail(`index.ts : fin du tableau \`${key}\` introuvable.`);
  const idRe = new RegExp(`^\\s*${varName}\\.id,?\\s*$`);
  if (!lines.slice(keyStart + 1, keyEnd).some((l) => idRe.test(l))) {
    const indent = (lines[keyStart + 1] ?? '    ').match(/^\s*/)[0] || '    ';
    edits.push({ line: keyEnd, text: `${indent}${varName}.id,`, what: `DEMO_ROSTER.${key}` });
  }

  return { lines, edits };
}

function applyLineEdits(lines, edits) {
  // Insertion de bas en haut pour ne pas décaler les indices suivants.
  const sorted = [...edits].sort((a, b) => b.line - a.line);
  const result = [...lines];
  for (const e of sorted) result.splice(e.line, 0, e.text);
  return result.join('\n');
}

// ---------------------------------------------------------------------------------------
// docs/cartes.md
// ---------------------------------------------------------------------------------------

function docQuote(text) {
  // Italique + guillemets français, comme les entrées existantes. Un saut de ligne du texte
  // imprimé reste un saut de ligne, mais jamais une ligne vide (elle casserait l'italique).
  const body = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join('\n');
  return `*« ${body.replace(/\n/g, '\n  ')} »*`;
}

function docHeading(card) {
  if (card.type === 'character') return `### ${card.name} — ${card.hp} HP`;
  if (card.type === 'object') {
    const tags = [];
    if (card.unique) tags.push('exemplaire unique');
    if (card.equipment) tags.push('objet à lier');
    return tags.length ? `### ${card.name} — ${tags.join(', ')}` : `### ${card.name}`;
  }
  return card.durationTurns !== undefined ? `### ${card.name} — ${card.durationTurns} tours` : `### ${card.name}`;
}

function generateDocEntry(card) {
  const out = [docHeading(card), ''];
  if (card.type === 'character') {
    for (const atk of card.attacks) {
      const dmg = atk.numeric ? `${atk.baseATK} ATK` : `dégâts imprimés « ${atk.damageRaw} » (${TODO})`;
      const text = atk.desc.trim() ? docQuote(atk.desc) : 'pas de texte.';
      out.push(`- **${atk.name}** — ${dmg}, ${text}`);
    }
    for (const ab of card.abilities) {
      out.push(`- **${ab.name}** (${ab.kind === 'active' ? 'active' : 'passive'}) — ${ab.desc.trim() ? docQuote(ab.desc) : 'pas de texte.'}`);
    }
    if (card.family) out.push(`- Famille : ${card.family}.`);
  } else {
    out.push(docQuote(card.description), '');
  }
  out.push(`- Moteur : ${TODO}`);
  return out.join('\n');
}

function planDocInsert(doc, card) {
  const lines = doc.split('\n');
  const sectionTitle = card.type === 'character' ? '## Personnages' : card.type === 'object' ? '## Objets' : '## Terrains';
  const sectionStart = lines.findIndex((l) => l.trim() === sectionTitle);
  if (sectionStart < 0) fail(`docs/cartes.md : section « ${sectionTitle} » introuvable.`);
  let sectionEnd = lines.findIndex((l, i) => i > sectionStart && /^## /.test(l));
  if (sectionEnd < 0) sectionEnd = lines.length;

  const collator = new Intl.Collator('fr', { sensitivity: 'base', ignorePunctuation: true });
  const headingName = (h) => h.replace(/^### /, '').split(/ — | - /)[0].trim();
  const headings = [];
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    if (/^### /.test(lines[i])) headings.push({ line: i, name: headingName(lines[i]) });
  }
  const already = headings.find((h) => h.name === card.name);
  if (already) return { lines, insertAt: -1, existingLine: already.line };

  let insertAt = -1;
  for (const h of headings) {
    if (collator.compare(h.name, card.name) > 0) {
      insertAt = h.line;
      break;
    }
  }
  if (insertAt < 0) {
    // Fin de section : avant le séparateur `---` / les lignes vides qui précèdent le `## ` suivant.
    insertAt = sectionEnd;
    while (insertAt > sectionStart + 1 && (lines[insertAt - 1].trim() === '' || lines[insertAt - 1].trim() === '---')) insertAt--;
  }
  return { lines, insertAt, existingLine: -1 };
}

function applyDocInsert(lines, insertAt, entry) {
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  // Une ligne vide de chaque côté, sans en doubler.
  while (before.length && before[before.length - 1].trim() === '') before.pop();
  while (after.length && after[0].trim() === '') after.shift();
  const chunk = [...before, '', ...entry.split('\n'), ''];
  if (after.length) chunk.push(...after);
  return chunk.join('\n');
}

// ---------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.slug) {
    printHelp();
    process.exit(opts.help ? 0 : 1);
  }
  const slug = opts.slug;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    fail(`Slug invalide "${slug}" : kebab-case ASCII attendu (ex. gojo-satoru, izuku-de-l-academie).`);
  }
  const adminDir = path.resolve(opts.adminDir ?? process.env.ADMIN_CARDS_DIR ?? DEFAULT_ADMIN_DIR);

  // --- Source JSON -------------------------------------------------------------------
  let jsonPath;
  if (opts.json) {
    jsonPath = path.resolve(opts.json);
    if (!existsSync(jsonPath)) fail(`JSON introuvable : ${jsonPath}`);
  } else {
    jsonPath = path.join(adminDir, `${slug}.json`);
    if (!existsSync(jsonPath)) {
      fail(`${slug}.json introuvable dans ${adminDir}\n\n${suggestCandidates(slug, adminDir)}`);
    }
  }
  const json = readCardJson(jsonPath);
  const card = parseCard(json, slug);

  // --- Cibles ---------------------------------------------------------------------------
  const cardPath = path.join(CARDS_DIR, `${slug}.ts`);
  if (existsSync(cardPath) && !opts.force) {
    fail(`${path.relative(REPO_ROOT, cardPath)} existe déjà. Relancer avec --force pour le réécrire (les autres édits sont idempotentes).`);
  }
  if (slug === 'index' || slug === 'shared') fail(`Le slug "${slug}" est réservé dans cards/demo/.`);

  const cardSource = generateCardFile(card);

  const indexSource = readFileSync(INDEX_PATH, 'utf8');
  const { lines: indexLines, edits: indexEdits } = planIndexEdits(indexSource, card);

  const docSource = readFileSync(DOC_PATH, 'utf8');
  const docEntry = generateDocEntry(card);
  const { lines: docLines, insertAt: docInsertAt, existingLine: docExisting } = planDocInsert(docSource, card);

  let pngSource;
  if (opts.png) {
    const candidates = [
      opts.json ? path.join(path.dirname(jsonPath), `${path.basename(jsonPath, path.extname(jsonPath))}.png`) : undefined,
      path.join(adminDir, `${slug}.png`),
    ].filter(Boolean);
    pngSource = candidates.find((p) => existsSync(p));
  }
  const pngDest = path.join(PNG_DIR, `${slug}.png`);

  // --- Compte rendu -------------------------------------------------------------------
  const rel = (p) => path.relative(REPO_ROOT, p).split(path.sep).join('/');
  console.log(`\n▶ ${card.name} (${card.type}) — source : ${jsonPath}`);
  if (warnings.length) {
    console.log('\n⚠ Avertissements :');
    for (const w of warnings) console.log(`  - ${w}`);
  }

  console.log('\nÉdits :');
  console.log(`  ${existsSync(cardPath) ? 'réécrit' : 'crée  '}  ${rel(cardPath)}`);
  if (indexEdits.length) {
    for (const e of indexEdits) console.log(`  insère   ${rel(INDEX_PATH)} :${e.line + 1}  ${e.text.trim()}   (${e.what})`);
  } else {
    console.log(`  inchangé ${rel(INDEX_PATH)} (déjà enregistré)`);
  }
  if (docExisting >= 0) console.log(`  inchangé ${rel(DOC_PATH)} (entrée « ${card.name} » déjà présente ligne ${docExisting + 1})`);
  else console.log(`  insère   ${rel(DOC_PATH)} :${docInsertAt + 1}  ${docHeading(card)}`);
  if (!opts.png) console.log('  ignoré   illustration (--no-png)');
  else if (!pngSource) console.log(`  ⚠ aucune illustration trouvée (${slug}.png) : le client affichera un placeholder.`);
  else if (existsSync(pngDest)) console.log(`  inchangé ${rel(pngDest)} (existe déjà, jamais écrasé)`);
  else console.log(`  copie    ${pngSource} -> ${rel(pngDest)}`);

  if (opts.dryRun) {
    console.log(`\n--- ${rel(cardPath)} (dry-run) ---\n${cardSource}--- fin ---`);
    console.log(`\n--- entrée docs/cartes.md (dry-run) ---\n${docEntry}\n--- fin ---`);
    console.log('\n(dry-run : rien n\'a été écrit)\n');
    return;
  }

  // --- Écriture -----------------------------------------------------------------------
  writeFileSync(cardPath, cardSource, 'utf8');
  if (indexEdits.length) writeFileSync(INDEX_PATH, applyLineEdits(indexLines, indexEdits), 'utf8');
  if (docExisting < 0) writeFileSync(DOC_PATH, applyDocInsert(docLines, docInsertAt, docEntry), 'utf8');
  if (opts.png && pngSource && !existsSync(pngDest)) {
    mkdirSync(PNG_DIR, { recursive: true });
    copyFileSync(pngSource, pngDest);
  }

  const todoCount = (cardSource.match(/TODO\(scaffold\)/g) ?? []).length + (docExisting < 0 ? 1 : 0);
  console.log(`\n✔ Squelette écrit. Il reste ${todoCount} ${TODO} à traiter :`);
  console.log(`  1. ${rel(cardPath)} : remplacer chaque ${TODO} par la vraie logique (execute, trigger, modifiers...).`);
  console.log(`     Les \`description\` sont le texte EXACT de la carte : ne pas y toucher (CLAUDE.md).`);
  console.log(`  2. ${rel(DOC_PATH)} : remplacer « - Moteur : ${TODO} » par ce que le moteur fait vraiment.`);
  console.log('  3. npm run build -w engine');
  console.log('  4. npm test -w engine   (card-conventions.spec.ts vérifie registre, roster, doc et HP)');
  console.log('');
}

main();
