# Instructions pour ajouter des cartes (lire avant d'explorer le code)

Ce fichier existe pour éviter de re-explorer `types.ts` / `match.ts` / `events.ts` /
`zones.ts` / `statuses.ts` à chaque nouvelle carte. Pour l'architecture générale du
projet (packages, comment lancer le jeu...), voir [README.md](README.md).

## Workflow par défaut pour une nouvelle carte

1. L'utilisateur envoie une image de carte (nom, HP, abilities, attaque). Je la traduis
   moi-même en `CharacterCardDef`/`ObjectCardDef`/`TerrainCardDef` — pas de schéma JSON
   à remplir par l'utilisateur.
2. Nouveau fichier dans `packages/engine/src/cards/demo/<kebab-case>.ts`.
3. L'enregistrer dans `packages/engine/src/cards/demo/index.ts` : import, ajout dans le
   bloc `export { ... }`, ajout d'un `registerCard(...)` dans `registerDemoCards()`, et
   ajout de l'id dans `DEMO_ROSTER` (`characterCardIds` / `objectCardIds` /
   `terrainCardIds` selon le type).
4. Vérifier avec `npm run build -w engine` (typecheck rapide, pas de vrai `tsc -b` à la
   racine — le tsconfig racine n'est pas configuré pour ça).
5. **Pas de test unitaire par carte par défaut** — la flexibilité du moteur est déjà
   prouvée par la suite existante. N'ajouter un test que si la carte introduit un
   mécanisme réellement nouveau pour le moteur (pas juste une recombinaison de patterns
   déjà couverts).
6. **Ne pas tenter de vérification navigateur** pour l'ajout d'une carte seule (pas de
   code UI touché, et le port 5173 est généralement déjà pris par une autre session).

Objectif : une carte "normale" (mécaniques déjà vues) ne devrait nécessiter que la
lecture de ce fichier + l'écriture du fichier de carte + l'edit de `index.ts`.

## API des cartes (`packages/engine/src/cards/types.ts`)

```ts
interface CharacterCardDef {
  type: 'character'; id: string; name: string; baseMaxHP: number;
  attacks: AttackDef[]; abilities: AbilityDef[]; modifiers?: ModifierDef[];
}
interface ObjectCardDef {
  type: 'object'; id: string; name: string; description: string;
  execute(ctx: EffectContext): Promise<void>; modifiers?: ModifierDef[];
}
interface TerrainCardDef {
  type: 'terrain'; id: string; name: string; description: string;
  durationTurns?: number; // undefined = indéfini
  abilities?: AbilityDef[]; modifiers?: ModifierDef[];
}

interface AttackDef {
  id: string; name: string; baseATK: number; description: string;
  endsTurn?: boolean | ((ctx: EffectContext) => boolean); // défaut true, évalué APRÈS execute()
  execute(ctx: EffectContext): Promise<void>;
}
interface AbilityDef {
  id: string; name: string; kind: 'active' | 'passive'; description: string;
  trigger?: EventName; // les passives réagissent à un event ; sans trigger = purement descriptive
  condition?(ctx: EffectContext): boolean; // ⚠️ voir "Bug connu du moteur" ci-dessous
  usableFromBench?: boolean; // défaut false
  usesPerTurn?: number; // défaut 1
  usesPerGame?: number; // défaut illimité
  execute(ctx: EffectContext): Promise<void>;
}
```

`EventName` (pour `trigger`) : `onGameStart onTurnStart onTurnEnd onBecomeActive
onAttackDeclared beforeDamage afterDamage onCharacterKO onCharacterRevived onCoinFlip
onObjectPlayed onTerrainPlayed onTerrainRemoved onStatusApplied onStatusExpired onSwitch
onAbilityUsed`. `onCharacterKO.data.characterInstanceId` = la carte qui meurt — **pas
d'info sur qui l'a tuée**, donc pour un effet "sur kill" il faut le détecter dans
l'attaque elle-même (voir pattern plus bas), pas via ce trigger.

## `EffectContext` (ce que `execute(ctx)` peut faire)

```ts
ctx.ownerId / ctx.opponentId / ctx.sourceInstanceId / ctx.event?

ctx.log(msg, data?); ctx.flipCoin(): 'heads' | 'tails'
ctx.choose({kind:'select-characters', prompt, options, min, max}): Promise<string[]>
ctx.chooseOption(prompt, options); ctx.chooseYesNo(prompt); ctx.chooseOrder(prompt, items)

ctx.getCharacter(id) / getObject(id) / getTerrain(id)
ctx.getActive(playerId) / getBench(playerId) / getAllOnBoard(playerId) // actif+banc
ctx.isKO(characterInstanceId): boolean

ctx.dealDamage(targetId, amount): Promise<void>       // dégâts classiques, soignables
ctx.applyValeurLock(targetId, amount): Promise<void>   // retire du max HP, jamais soignable
ctx.heal(targetId, amount); ctx.raiseMaxHP(targetId, amount)

ctx.applyStatus(targetId, {statusId, label, sourcePlayerId?, sourceCardInstanceId?,
                            remainingTurns?, ticksOnBench?, data?})
ctx.removeStatus(targetId, statusId)

ctx.getEffectiveATK(characterInstanceId, baseATK): number
ctx.swapBenchCharacters(forPlayer, ownBenchId, enemyBenchId)
ctx.attachSelfTo(targetCharacterInstanceId)            // pour un ObjectCardDef
ctx.forceSwitch(playerId, newActiveInstanceId): Promise<void>
ctx.cloneCharacter(sourceInstanceId, hp, 'active'|'bench'): string // renvoie le nouvel instanceId
```

## Patterns récurrents

- **Attaque simple** : réutiliser `simpleAttack(id, name, baseATK, description)` dans
  `cards/demo/shared.ts` plutôt que réécrire le bête "inflige X à l'actif adverse".
- **Compteur persistant sur une carte** (ex: "après 3 kills...") : pas de champ dédié sur
  `CharacterInstance`. Utiliser un `status` custom avec un `data.count`, sans
  `remainingTurns` (donc jamais retiré automatiquement par `tickStatusesAtTurnStart`) :
  lire via `ctx.getCharacter(id).statuses.find(s => s.statusId === 'mon-id')`, puis pour
  incrémenter faire `removeStatus` + `applyStatus` (il n'y a pas d'API "update").
- **"Peut agir de nouveau ce tour si condition remplie pendant l'attaque"** (ex: Verocity
  de Katarina) : ne pas essayer de le faire via un `trigger` d'ability séparé (pas assez
  d'info dans l'event `onCharacterKO`, voir plus haut). Le faire directement sur
  l'`AttackDef` : un flag en closure au niveau du fichier (partagé entre `execute` et
  `endsTurn` d'une même définition d'attaque, remis à `false` en début d'`execute`,
  `endsTurn` retourne `!flag`). `match.ts` appelle `execute(ctx)` puis `endsTurn(ctx)`
  avec le même `ctx`, donc c'est sûr en asynchrone tant qu'une seule attaque n'est
  résolue à la fois (le cas normal).
- **AoE sur tout le board adverse** : `ctx.getAllOnBoard(ctx.opponentId)` puis
  `dealDamage` sur chaque instance.
- **Override d'une règle générale** (fréquence, ciblage du banc, ATK effectif, limite
  d'objets équipés...) : passer par `modifiers: ModifierDef[]` sur la carte plutôt que
  du code impératif — c'est le système que le moteur scanne automatiquement tant que la
  carte est en jeu (voir `queries.ts` et le README pour la liste des `QueryName`).

## Bug du moteur corrigé (historique, pour référence)

`match.ts` (`validateAction`) vérifie maintenant `ability.condition()` (cas `'use-ability'`)
et `attack.condition()` (cas `'attack'`, si un jour une attaque en a un) avant d'autoriser
une activation manuelle — plus seulement `events.ts` pour les abilities auto-déclenchées.
Donc "nen" de Beyond Netero et "death-lotus" de Katarina sont bien bloquées côté moteur,
pas juste par convention UI. Rien à refaire ici pour les futures cartes avec `condition`.
