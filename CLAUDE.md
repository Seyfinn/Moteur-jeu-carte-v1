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
   ⚠️ `DEMO_ROSTER` est le **pool complet** de cartes (pour le deck-builder), pas un deck
   légal. Ne pas y toucher les limites. `DEMO_STARTER_DECK` juste au-dessus est le deck
   par défaut (6 persos / 6 objets / 2 terrains, ≤2 exemplaires) : il doit rester valide
   au sens de `validateRoster`, ne l'étendre qu'en remplaçant une carte par une autre.
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
  family?: string; maxCopies?: number;
}
interface ObjectCardDef {
  type: 'object'; id: string; name: string; description: string;
  condition?(ctx: EffectContext): boolean;
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
  condition?(ctx: EffectContext): boolean;
  execute(ctx: EffectContext): Promise<void>;
}
interface AbilityDef {
  id: string; name: string; kind: 'active' | 'passive'; description: string;
  trigger?: EventName; // les passives réagissent à un event ; sans trigger = purement descriptive
  condition?(ctx: EffectContext): boolean;
  usableFromBench?: boolean; // défaut false
  usesPerTurn?: number; // défaut 1
  usesPerGame?: number; // défaut illimité
  execute(ctx: EffectContext): Promise<void>;
}
```

⚠️ **Seules les abilities `kind: 'active'` sans `trigger` sont activables manuellement**
(par le joueur, via le menu "Capacité"). Une `kind: 'passive'` est soit déclenchée par un
event (`trigger`), soit purement descriptive (mécanique réelle dans un `modifier` ou dans
l'`AttackDef`) — le moteur refuse son activation manuelle et l'UI ne la propose pas.

## Événements (`trigger`)

`onGameStart onTurnStart onTurnEnd onBecomeActive onAttackDeclared beforeDamage
afterDamage onCharacterKO onCharacterRevived onObjectPlayed onTerrainPlayed
onTerrainRemoved onStatusExpired onSwitch onAbilityUsed`.

Payloads utiles (voir `EventPayloads` dans `types.ts` pour la liste complète) :

| Event | `ctx.event.data` |
| --- | --- |
| `onGameStart` | *(vide)* — émis une fois, actifs de départ en place, avant le tour 1 |
| `onBecomeActive` | `{ characterInstanceId, reason: 'setup' \| 'switch' \| 'ko-replacement' }` |
| `onAttackDeclared` | `{ characterInstanceId, attackId }` |
| `afterDamage` | `{ targetInstanceId, amount, shieldAbsorbed, sourceInstanceId?, sourceOwnerId?, damageSource? }` |
| `onCharacterKO` | `{ characterInstanceId, killerInstanceId?, killerOwnerId? }` |
| `onTerrainRemoved` | `{ terrainInstanceId, reason: 'expired' \| 'replaced' \| 'destroyed' }` |
| `onSwitch` | `{ newActiveInstanceId, previousActiveInstanceId? }` |
| `onAbilityUsed` | `{ characterInstanceId, abilityId }` |

Points importants :

- **`onGameStart` est bien émis** (dans `runSetup`, après l'assignation des actifs de
  départ et avant `startTurn`). Un effet « actif dès le début de partie » n'a donc plus
  besoin d'init paresseuse. Cela dit, pour un trait **permanent et inné** (esquive/crit
  innés, aura), préférer un `modifier` : il est réévalué en continu tant que la carte est
  en jeu, donc il survit à une résurrection (qui vide les statuts), s'applique aux clones
  et aux Métamorphes, et ne peut pas être volé/dissipé comme un statut.
- `onBecomeActive` est aussi émis pour les actifs de départ, avec `reason: 'setup'` — une
  carte qui ne doit réagir qu'à un vrai switch doit exclure ce cas (cf. `killua.ts`).
- **`onCharacterKO` nomme le tueur** (`killerInstanceId`) dès que le moteur peut
  l'attribuer (dégâts via `ctx.dealDamage`, ou `ctx.koCharacter` depuis un personnage).
  Un effet « sur kill » peut donc être un vrai passive à trigger (cf. `caitlyn.ts`).
- Une carte qui réagit à sa **propre** disparition (`onCharacterKO` pour le personnage qui
  meurt, `onTerrainRemoved` pour le terrain qui part) est retrouvée explicitement par
  `events.ts` même si elle n'est plus en jeu. Pour un personnage, il faut
  `usableFromBench: true` (il n'est plus l'actif au moment de l'event).
- `onStatusApplied` et `onCoinFlip` sont déclarés mais **jamais émis** (`applyStatus` /
  `flipCoin` sont synchrones côté `EffectContext`) — ne pas construire de carte dessus.
- Les chaînes de triggers sont **plafonnées à 24 niveaux** de profondeur : deux cartes qui
  se renvoient la balle indéfiniment sont coupées avec une entrée de journal au lieu de
  faire exploser la pile.

## `EffectContext` (ce que `execute(ctx)` peut faire)

```ts
ctx.ownerId / ctx.opponentId / ctx.sourceInstanceId / ctx.event?
ctx.scratch                       // bloc-notes propre à CETTE exécution (voir patterns)

ctx.log(msg, data?); ctx.flipCoin(): 'heads' | 'tails'
ctx.choose({kind:'select-characters', prompt, options, min, max}): Promise<string[]>
ctx.chooseOption(prompt, options); ctx.chooseYesNo(prompt); ctx.chooseOrder(prompt, items)

ctx.getCharacter(id) / getObject(id) / getTerrain(id)
ctx.getActive(playerId) / getBench(playerId) / getAllOnBoard(playerId) // actif+banc
ctx.isKO(characterInstanceId): boolean

ctx.dealDamage(targetId, amount, options?): Promise<void> // dégâts classiques, soignables
ctx.applyValeurLock(targetId, amount): Promise<void>      // retire du max HP, jamais soignable
ctx.heal(targetId, amount); ctx.raiseMaxHP(targetId, amount)
ctx.addShield(targetId, amount); ctx.removeShield(targetId, amount?)
ctx.koCharacter(id); ctx.reviveCharacter(id, hp, 'active'|'bench')

ctx.applyStatus(targetId, {statusId, label, sourcePlayerId?, sourceCardInstanceId?,
                            remainingTurns?, ticksOnBench?, data?}, {skipEvasionRoll?}?)
ctx.removeStatus(targetId, statusId); ctx.rollEvasion(targetId): boolean

ctx.getEffectiveATK(characterInstanceId, baseATK): number
ctx.swapBenchCharacters(forPlayer, ownBenchId, enemyBenchId)
ctx.attachSelfTo(targetCharacterInstanceId)            // pour un ObjectCardDef
ctx.destroyObject(objectInstanceId)
ctx.extendTerrain(id, turns); ctx.shortenTerrain(id, turns); ctx.destroyTerrain(id)
ctx.forceSwitch(playerId, newActiveInstanceId): Promise<void>
ctx.cloneCharacter(sourceInstanceId, hp, 'active'|'bench'): string // renvoie le nouvel instanceId
ctx.createObject(cardId): string
```

Garde-fous appliqués automatiquement, inutile de les re-coder par carte :

- **Esquive / critique ne se jouent qu'entre camps adverses.** Un effet qui vise un
  personnage de son propre camp (soin, verrou de terrain sur son propre actif, buff)
  n'est jamais « esquivé » par son propre joueur.
- **Un personnage parti au cimetière est hors-jeu** : `dealDamage`, `applyValeurLock` et
  `heal` qui le visent sont des no-ops (pas de dégâts sur un cadavre, pas de second
  `onCharacterKO`). Idem pour les tics de statuts : dès qu'un tic tue le porteur, les
  statuts restants ne tiquent plus ce tour-là.
- **Une seule question à la fois.** `ctx.choose*` doit être `await` séquentiellement ;
  lancer deux prompts en parallèle (`Promise.all`) lève une erreur explicite.
- ⚠️ `ctx.choose({kind:'select-characters'})` ne sait afficher que des **personnages**
  côté client. Pour faire choisir un objet/terrain (réserve, cimetière...), utiliser
  `ctx.chooseOption` (cf. `echange-equivalent.ts`).

## Économie de tour (`match.ts` / `queries.ts`)

- **2 objets par tour maximum.** Le 2ᵉ est une action finale (fin de tour), sauf pour le
  second joueur lors de son tout premier tour. La limite est une requête
  (`getMaxObjectsPerTurn`) : une carte peut la modifier.
- **1 terrain par tour maximum** (`getMaxTerrainsPerTurn`). Sans ça, on pouvait
  enchaîner les poses pour re-déclencher les effets `onTerrainPlayed` en boucle.
- Poser un terrain par-dessus un autre envoie l'ancien au cimetière **et** émet
  `onTerrainRemoved` avec `reason: 'replaced'`.

## Patterns récurrents

- **Attaque simple** : réutiliser `simpleAttack(id, name, baseATK, description)` dans
  `cards/demo/shared.ts` plutôt que réécrire le bête "inflige X à l'actif adverse".
- **Compteur persistant sur une carte** (ex: "après 3 kills...") : pas de champ dédié sur
  `CharacterInstance`. Utiliser un `status` custom avec un `data.count`, sans
  `remainingTurns` (donc jamais retiré automatiquement par `tickStatusesAtTurnStart`) :
  lire via `ctx.getCharacter(id).statuses.find(s => s.statusId === 'mon-id')`, puis pour
  incrémenter faire `removeStatus` + `applyStatus` (il n'y a pas d'API "update").
- **"Peut agir de nouveau ce tour si condition remplie pendant l'attaque"** (ex: Voracity
  de Katarina) : le faire directement sur l'`AttackDef`, via **`ctx.scratch`**.
  `match.ts` appelle `execute(ctx)` puis `endsTurn(ctx)` avec le même `ctx`, donc
  `execute` écrit `ctx.scratch['ma-cle'] = true` et `endsTurn(ctx)` retourne
  `!ctx.scratch['ma-cle']`. **Ne jamais utiliser une variable au niveau du module** pour
  ça : un serveur héberge plusieurs parties en parallèle et elles se marcheraient dessus.
- **AoE sur tout le board adverse** : `ctx.getAllOnBoard(ctx.opponentId)` puis
  `dealDamage` sur chaque instance.
- **Override d'une règle générale** (fréquence, ciblage du banc, ATK effectif, limite
  d'objets équipés...) : passer par `modifiers: ModifierDef[]` sur la carte plutôt que
  du code impératif — c'est le système que le moteur scanne automatiquement tant que la
  carte est en jeu (voir `queries.ts` et le README pour la liste des `QueryName`).
- **Taux d'esquive / de critique innés** (ex: L'Infini de Gojo, Black Flash de Todo,
  Execution de Caitlyn) : modifier `getEvasionPercent` / `getCriticalPercent` renvoyant
  `Math.max(current, MON_POURCENTAGE)`. Base : 5 % d'esquive, 2 % de critique ; les
  statuts `evasive`/`critical` montent la base à 33 % (`critical` accepte un
  `data.percent` pour un one-shot, cf. Godspeed de Killua à 100 %).
- **Statuts génériques reconnus par le moteur** (aucune logique à écrire côté carte,
  il suffit de les poser) :
  - `death-ward` : les dégâts classiques ne peuvent plus descendre le porteur sous 1 HP.
  - `atk-boost` / `atk-reduction` (`data.amount`), `atk-multiplier` (`data.multiplier`).
  - `bleed` (`data.stacks`) : voir le détail plus bas.
  - `damage-reflect` (`data: { percent, objectInstanceId? }`) : renvoie un pourcentage
    du prochain coup à l'attaquant, une seule fois, puis se consomme (et détruit l'objet
    porteur s'il est indiqué). Ex : Miroir de Renvoi.
  - `bench-damage-bonus` (`data.multiplier`, défaut 2) : les dégâts du porteur contre le
    **banc adverse** sont multipliés. Ex : Couteau dans le dos.
  - `hit-bounty` (`data: { bonusMaxHP, forOwnerId? }`) : la première attaque qui touche
    réellement le porteur donne du HP max permanent à son attaquant, puis se consomme.
    Ex : la marque chargée de Coeur Acier.
  - `concentration` (`data.percent`) : la prochaine attaque crit à ce pourcentage, sinon
    0 dégât + désarmé. Ex : l'objet Concentration.
  - `stun` `disarmed` `chained` `silence-active` `silence-passive` `silence-ultimate`
    `evasive` `critical` `burn` `poison`.
- **Redirection de dégâts** (ex: Hypnose Absolue d'Aizen) : modifier
  `getDamageRedirectPercent` renvoyant un pourcentage pour son propre `sourceInstanceId`.
  Le moteur tire le dé et demande au camp visé quel personnage du banc encaisse.
- **Bleed** : statut générique reconnu par le moteur (comme `death-ward`/`atk-boost`),
  pas de logique par carte. Poser avec
  `ctx.applyStatus(targetId, {statusId: 'bleed', label, data: {stacks: N}})` — `N`
  stacks par défaut si `data.stacks` absent = 1. Ré-appliquer pendant que bleed est déjà
  présent ADDITIONNE les stacks (jusqu'à 10 max) au lieu de créer une deuxième instance ;
  c'est géré automatiquement dans `statuses.ts::applyStatus`, rien à faire côté carte. Au
  début du PROCHAIN tour du porteur (tick toujours actif même sur banc, comme
  poison/burn), inflige `10% * stacks` des HP max en dégâts (donc 100% à 10 stacks) puis
  le statut est consommé (retiré), qu'il ait fait des dégâts ou non — ce n'est pas un
  compte à rebours comme les autres statuts à `remainingTurns`. N'importe quel `heal()`
  sur le porteur (même 1 point) retire bleed immédiatement, avant même d'atteindre le
  tick — géré dans `match.ts`'s `heal` handler, rien à faire côté carte non plus. Pas de
  champ `remainingTurns` à passer.
- **Poison/Burn et ré-application** : comme bleed, poser poison/burn sur une cible qui en
  a déjà rafraîchit l'instance existante (source/label mis à jour, `remainingTurns` porté
  au plus grand des deux) au lieu d'en empiler une deuxième — sinon les deux tiquaient
  indépendamment le même tour et doublaient silencieusement les dégâts (bug corrigé :
  avant ça, une cible déjà brûlée qui se refaisait toucher par un burn prenait le tick de
  l'ancien ET du nouveau le même tour). Contrairement à bleed, pas de notion de stacks :
  la ré-application ne change pas le montant du tick (toujours fixe), seulement la durée.

## Ce que le serveur impose par-dessus le moteur

- Un choix sans réponse pendant 120 s est résolu automatiquement avec
  `defaultChoiceAnswer(spec)` (`engine/src/choices.ts`) : première sélection légale, "oui",
  ou l'ordre tel que présenté. Une carte ne doit donc jamais supposer qu'un prompt sera
  forcément répondu « intelligemment » — s'il existe un choix catastrophique, ne pas le
  mettre en première position.
- `ctx.dealDamage` renseigne `attackerOwnerId` (le camp dont l'effet vient) en plus de
  `attackerInstanceId`. Une carte défensive peut donc distinguer un coup adverse d'un coût
  que son propre camp paie — c'est ce qui empêche Bouclier Ultime de rendre gratuits les
  coûts en HP de son propre possesseur.

## Durées de statuts : le `+1` (piège classique)

`tickStatusesAtTurnStart` **décrémente puis filtre**, au tout début du tour du porteur,
avant qu'il ne puisse agir. Donc :

- Statut **bloquant** (stun, désarmé, silence, chained, cooldown) : `remainingTurns` doit
  valoir `nombre_de_tours_voulu + 1`, sinon il est retiré avant d'avoir pu bloquer quoi
  que ce soit.
- Statut **qui tique** (poison, burn) : il inflige ses dégâts tant qu'il est présent, donc
  `remainingTurns` = nombre de tics voulus, **sans** `+1`.

## Bugs du moteur corrigés (historique, pour référence)

- `validateAction` vérifie `ability.condition()` / `attack.condition()` avant d'autoriser
  une activation manuelle — plus seulement `events.ts` pour les auto-déclenchées.
- Les réponses d'ordre de résolution (`kind: 'order'`) sont validées comme permutations :
  une réponse malformée ne peut plus faire jouer deux fois le même passive ni en sauter un.
- L'éligibilité de chaque passive est **revérifiée juste avant son exécution** : une carte
  tuée/réduite au silence par une réaction précédente du même event ne se déclenche plus.
