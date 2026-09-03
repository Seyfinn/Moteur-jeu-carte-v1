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
   par défaut, volontairement **plein** (6 persos / 8 objets / 3 terrains) : il doit rester
   valide au sens de `validateRoster` et complet, donc ne l'étendre qu'en remplaçant une
   carte par une autre.
   Règles de deck utiles à connaître ici (`deck.ts`) : 6 persos / 8 objets / 3 terrains,
   **1 seul exemplaire par personnage et par terrain** (ils sont uniques par nature),
   2 par objet — sauf `maxCopies: 1` déclaré sur la carte pour un objet « unique ».
   `incompatibleWith: ['autre-id']` (champ commun aux trois types, relation symétrique, à
   ne déclarer que d'un côté) interdit deux cartes dans le même deck : le deck-builder
   grise l'autre carte sans rien avoir à savoir de plus.
4. Ajouter son entrée dans [docs/cartes.md](docs/cartes.md) : le texte imprimé + ce que le
   moteur fait vraiment derrière (statuts posés, modifiers, `+1` de durée, garde-fous...).
   C'est le pendant obligatoire de la règle « texte exact » ci-dessous : tout ce que la
   description ne dit plus vit là. C'est aussi le fichier à relire avant de toucher à une
   carte existante, plutôt que d'en re-déduire le comportement.
5. Vérifier avec `npm run build -w engine` (typecheck rapide, pas de vrai `tsc -b` à la
   racine — le tsconfig racine n'est pas configuré pour ça).
6. **Pas de test unitaire par carte par défaut** — la flexibilité du moteur est déjà
   prouvée par la suite existante. N'ajouter un test que si la carte introduit un
   mécanisme réellement nouveau pour le moteur (pas juste une recombinaison de patterns
   déjà couverts).
7. **Ne pas tenter de vérification navigateur** pour l'ajout d'une carte seule (pas de
   code UI touché, et le port 5173 est généralement déjà pris par une autre session).

Objectif : une carte "normale" (mécaniques déjà vues) ne devrait nécessiter que la
lecture de ce fichier + l'écriture du fichier de carte + l'edit de `index.ts`.

## ⚠️ Les `description` sont le texte EXACT de la carte

**Source de vérité : le dossier `ADMIN Cartes tout/` à la racine.** Un `<carte>.json` par
carte, exporté par l'éditeur de cartes, avec le PNG à côté. `nom`, `hp`, `attacks[].name /
damage / desc`, `abilities[].name / desc` et `description` (objets et terrains) y sont le
texte imprimé, et c'est CE texte que le moteur doit porter, au caractère près — fautes de
frappe et sauts de ligne compris (le client les affiche, `.ins-entry-text` est en
`white-space: pre-line`). Un `desc` **vide** est une information : la carte n'imprime rien
sous cette attaque, et la fiche n'affiche alors aucun paragraphe.

Deux pièges de ces JSON, tous deux du résidu de l'éditeur, à ignorer :

- un objet ou un terrain traîne souvent un `attacks` / `abilities` recopié d'une autre
  carte (« Berserk » sur les potions, « Za Warudo ! » sur Arène). Un `ObjectCardDef` n'a de
  toute façon pas d'abilities ;
- un `damage` peut valoir `"30+"` ou `"-"` : c'est une notation d'éditeur, pas un nombre.

Règle absolue, elle prime sur toute envie de clarté : le champ `description` (carte,
attaque, ability) reprend **mot pour mot** le texte de la carte d'origine envoyée par
l'utilisateur. Pas de reformulation, pas de résumé, pas de phrase explicative ajoutée,
pas de précision entre parenthèses, pas de renvoi à une autre carte, pas de rappel de
règle du moteur. Le client affiche `description` tel quel (`web/components/cardDetails.tsx`)
— ce qui est écrit dans le fichier est exactement ce que le joueur lit.

Concrètement, quand le texte d'origine dit « Si l'ennemi touché est à 40HP ou moins, il
meurt immédiatement », c'est cette phrase-là et rien d'autre. **Interdit** d'en faire
« Inflige 60 dégâts à l'actif adverse. S'il lui reste 40 HP ou moins après le coup, il est
achevé sur le champ — sauf s'il est protégé contre la mort (Détermination). »

Où va le reste :

- Le comportement réel de la carte (statuts posés, modifiers, cas limites, interactions
  avec d'autres cartes) : dans [docs/cartes.md](docs/cartes.md), une entrée par carte. Ce
  fichier n'est pas affiché en jeu, c'est la note de travail à relire avant de toucher à
  une carte.
- Les précisions d'implémentation purement locales : en **commentaire de code**, jamais
  dans `description`.
- Une capacité qui n'existe QUE pour faire tourner le moteur (un compteur, la mémoire de la
  dernière attaque adverse, l'accroche `onTerrainPlayed` d'un terrain dont le texte est déjà
  dans sa `description`) porte **`hidden: true`** : elle fonctionne exactement pareil, mais
  la fiche d'inspection cesse de la lister — sa `description` est une phrase écrite par le
  moteur, pas le texte de la carte. Même esprit que `hidden: true` sur un statut. À ne PAS
  mettre sur une capacité `kind: 'active'` : le joueur la déclenche, il doit pouvoir la lire.
- Les mécaniques génériques (poison, burn, bleed, vulnérable, stun, désarmé, silences,
  critique, esquive) : elles sont déjà décrites pour le joueur dans le **glossaire en
  partie** (`web/components/EffectsGlossary.tsx`), inutile de les réexpliquer sur chaque
  carte.
- Si le texte d'origine est ambigu ou semble contredire le moteur, poser la question à
  l'utilisateur — ne pas « corriger » le texte tout seul.

Une valeur interpolée (`${BASE_ATK}`) reste bienvenue à condition que la phrase résultante
soit celle de la carte : elle sert à ce que le texte suive un ajustement d'équilibrage,
pas à enrichir le propos.

## API des cartes (`packages/engine/src/cards/types.ts`)

```ts
interface CharacterCardDef {
  type: 'character'; id: string; name: string; baseMaxHP: number;
  attacks: AttackDef[]; abilities: AbilityDef[]; modifiers?: ModifierDef[];
  family?: string; maxCopies?: number; incompatibleWith?: string[];
}
interface ObjectCardDef {
  type: 'object'; id: string; name: string; description: string;
  equipment?: boolean;  // objet « à lier » : voir la section Patterns
  condition?(ctx: EffectContext): boolean;
  // Refus lisible évalué sur le seul GameState (donc côté client aussi) : renvoyer une
  // phrase quand la carte n'a rien à cibler et serait gaspillée. Le serveur refuse
  // l'action avec ce message, la main grise la carte avec la même raison.
  unplayableReason?(state: GameState, ownerId: PlayerId): string | null;
  execute(ctx: EffectContext): Promise<void>; modifiers?: ModifierDef[];
  // ⚠️ PAS de champ `abilities` : un objet ne peut donc réagir à AUCUN événement (pas de
  // `trigger`). Un objet qui doit riposter, tuer ou ranimer plus tard passe forcément par
  // un statut générique que le moteur applique lui-même (cf. `damage-reflect` pour Miroir
  // de Renvoi, `linked` pour Jacob et Essau) — ou par un nouveau, à ajouter au moteur.
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
  trigger?: EventName | EventName[]; // un event, ou "n'importe lequel de ceux-ci" ; sans trigger = purement descriptive
  hidden?: boolean;    // plomberie interne : la fiche d'inspection ne la liste pas (voir plus bas)
  condition?(ctx: EffectContext): boolean;
  usableFromBench?: boolean; // défaut false
  usesPerTurn?: number; // défaut 1
  usesPerGame?: number; // défaut illimité
  endsTurn?: boolean | ((ctx: EffectContext) => boolean); // défaut FALSE, évalué APRÈS execute()
  execute(ctx: EffectContext): Promise<void>;
}
```

⚠️ `endsTurn` est le seul point commun entre `AttackDef` et `AbilityDef` où les défauts
s'opposent : une **attaque** ferme le tour sauf mention contraire, une **capacité** est
gratuite sauf mention contraire (ex : « Manipulation » de Makima, dont le texte dit
explicitement qu'elle met fin au tour).

⚠️ **Seules les abilities `kind: 'active'` sans `trigger` sont activables manuellement**
(par le joueur, via le menu "Capacité"). Une `kind: 'passive'` est soit déclenchée par un
event (`trigger`), soit purement descriptive (mécanique réelle dans un `modifier` ou dans
l'`AttackDef`) — le moteur refuse son activation manuelle et l'UI ne la propose pas.

## Événements (`trigger`)

`onGameStart onTurnStart onTurnEnd onBecomeActive onAttackDeclared beforeDamage
afterDamage onCharacterKO onCharacterRevived onCharacterEvolved onObjectPlayed onTerrainPlayed
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
| `onSwitch` | `{ newActiveInstanceId, previousActiveInstanceId?, reason: 'action' \| 'forced' }` |
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
ctx.rollChance(percent, label, {characterInstanceId?}?): boolean  // jet % annoncé (roue à l'écran)
ctx.choose({kind:'select-characters', prompt, options, min, max}): Promise<string[]>
ctx.chooseOption(prompt, options); ctx.chooseYesNo(prompt); ctx.chooseOrder(prompt, items)
// ChoiceOption = { key, label, card?: { cardId, kind } } -- avec `card`, la modale
// affiche l'illustration réelle au lieu d'un bouton de texte.

ctx.getCharacter(id) / getObject(id) / getTerrain(id)
ctx.getActive(playerId) / getBench(playerId) / getAllOnBoard(playerId) // actif+banc
ctx.isKO(characterInstanceId): boolean

ctx.dealDamage(targetId, amount, options?): Promise<void> // dégâts classiques, soignables
ctx.applyValeurLock(targetId, amount): Promise<void>      // retire du max HP, jamais soignable
ctx.heal(targetId, amount); ctx.raiseMaxHP(targetId, amount, {keepCurrentHP?}?)
ctx.addShield(targetId, amount); ctx.removeShield(targetId, amount?)
ctx.koCharacter(id); ctx.reviveCharacter(id, hp, 'active'|'bench')

ctx.applyStatus(targetId, {statusId, label, sourcePlayerId?, sourceCardInstanceId?,
                            remainingTurns?, ticksOnBench?, data?}, {skipEvasionRoll?}?)
ctx.removeStatus(targetId, statusId); ctx.rollEvasion(targetId): boolean

ctx.getEffectiveATK(characterInstanceId, baseATK): number
ctx.swapBenchCharacters(forPlayer, ownBenchId, enemyBenchId)
ctx.attachSelfTo(targetCharacterInstanceId)            // pour un ObjectCardDef
ctx.returnSelfToHand()                                 // l'objet source repart en main
ctx.destroyObject(objectInstanceId)
ctx.extendTerrain(id, turns); ctx.shortenTerrain(id, turns); ctx.destroyTerrain(id)
ctx.forceSwitch(playerId, newActiveInstanceId): Promise<void>
ctx.cloneCharacter(sourceInstanceId, hp, 'active'|'bench'): string // renvoie le nouvel instanceId
ctx.evolveCharacter(characterInstanceId, toCardId?): Promise<boolean> // cartes évolutives
ctx.createObject(cardId): string

ctx.playObjectImmediately(cardId, forPlayerId?)  // joue un objet gratuitement (hors budget)
ctx.grantExtraTurn(forPlayerId?)                // rejoue un tour complet après celui-ci
ctx.buildEffectContext(sourceInstanceId, 'attack'|'ability'|'other'): EffectContext
ctx.scheduleRevive(characterInstanceId, {turns, bonusMaxHP?, bonusATK?})
ctx.chooseOptionFor(playerId, prompt, options)  // poser la question à l'ADVERSAIRE
ctx.createObject(cardId, forPlayerId?)          // 2e param : donner la carte à l'adversaire
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
- ⚠️ `ctx.choose({kind:'select-characters'})` se joue **sur le plateau** : le client allume
  les cartes proposées, le joueur clique dessus puis valide (`web/components/Targeting.tsx`).
  Il faut donc que **toutes** les options soient des personnages posés sur la table (actif
  ou banc, n'importe quel camp). Une option hors plateau — un mort au cimetière, un
  personnage pas encore placé — fait retomber le client sur l'ancienne modale, qui reste le
  filet de sécurité : la partie n'est jamais bloquée, mais le ciblage visuel est perdu.
  Pour ranimer depuis le cimetière, passer par `ctx.chooseOption` avec un `card` par option
  (cf. `absorption-vitale.ts`).

## Économie de tour (`match.ts` / `queries.ts`)

- **Un tour = une manche, pas un tour de joueur.** Un tour de jeu couvre l'action des
  DEUX joueurs, comme aux échecs : `state.turnNumber` n'avance qu'au retour au joueur qui
  a ouvert la partie (`turn.ts`). Les durées, elles, se comptent toujours en tours de leur
  porteur (un statut ne tique qu'au début du tour de son camp) — soit exactement une fois
  par manche, donc « pendant 3 tours » sur une carte veut bien dire 3 tours au sens du
  compteur affiché. Tout ce qui est « par tour » ci-dessous reste, lui, par tour de joueur :
  chaque camp a son propre budget d'objets pendant sa propre action.
- **2 objets par tour maximum.** Le 2ᵉ est une action finale (fin de tour), sauf pour le
  second joueur lors de son tout premier tour. La limite est une requête
  (`getMaxObjectsPerTurn`) : une carte peut la modifier.
- **1 terrain par tour maximum** (`getMaxTerrainsPerTurn`). Sans ça, on pouvait
  enchaîner les poses pour re-déclencher les effets `onTerrainPlayed` en boucle.
- Poser un terrain par-dessus un autre envoie l'ancien au cimetière **et** émet
  `onTerrainRemoved` avec `reason: 'replaced'`. La durée du nouveau terrain est déjà
  posée quand cet event part, et si une réaction le détruit dans la foulée, `onTerrainPlayed`
  n'est pas émis.
- **Le Recycleur d'Objets** (`recycler.ts`) : pendant son tour, un joueur donne
  `RECYCLE_OBJECT_COST` (3) objets de sa main et en reçoit **1** tiré au hasard dans sa
  réserve d'objets (`drawPiles.objectCardIds`). Trois choses à savoir pour écrire une
  carte : recycler **ne compte pas** comme « jouer un objet » (`objectsPlayedThisTurn`
  n'est pas touché, la limite de 2 reste entière), ce n'est **pas limité par tour**, et
  ça **ne ferme jamais le tour**. Les cartes sacrifiées **ne vont pas au cimetière** :
  elles retournent dans la réserve, qui est remélangée *avant* le tirage — la carte reçue
  peut donc être une des trois. Une carte qui parcourt le cimetière ne les y trouvera pas.
  Disponible dans les trois modes : le Mode Pioche a déjà sa pile d'objets, et les modes
  standard en reçoivent une à la création du match (`dealStandardObjectReserves`, tout le
  catalogue moins la main de départ) — d'où un objet reçu qui peut sortir du deck construit.
- **Un tour bonus** (« Za Warudo ! » de Dio) : `ctx.grantExtraTurn()`. `endTurn` rouvre
  alors un tour complet pour le même joueur au lieu de passer la main, et la marque est
  consommée à ce moment-là -- une pose ne peut donc jamais en donner deux. C'est un **vrai**
  tour : poisons, brûlures et recharges tiquent une seconde fois. `state.turnNumber` ne
  bouge pas (la manche n'a pas fait le tour des deux joueurs).
- **Remplacer un personnage KO n'est PAS un switch.** Ce chemin ne passe ni par
  `zones.switchActive`, ni par `canSwitchStandard`, ni par `canSwitchAny`, et n'émet pas
  `onSwitch` (seulement `onBecomeActive` avec `reason: 'ko-replacement'`). Aucune carte ne
  doit pouvoir empêcher un camp de remettre quelqu'un au poste actif : sinon il n'a plus
  d'actif, ne peut plus rien faire, et la partie se bloque sans que personne ne gagne.
- `abilityUsesThisTurn` est remis à zéro pour **les deux camps** au début de chaque tour.
  Un passive qui réagit à une action adverse (`afterDamage`, `onCharacterKO`...) dispose
  donc bien de son quota à chaque tour de jeu, et pas seulement un tour sur deux.

## Cartes évolutives (Gon ➔ Gon Adulte, Kayn ➔ Assassin / Rhaast)

Une carte de base déclare ses formes avec **`evolvesTo`** (`string` ou `string[]`) sur sa
`CharacterCardDef`. Ce seul champ suffit à sortir les formes évoluées du jeu de sélection :
`listDeckPool()` ne les renvoie plus et `validateRoster` refuse de les mettre dans un deck --
elles **ne comptent pas dans le quota** et arrivent uniquement par l'évolution de leur base.
Le deck-builder les affiche quand même, en vignettes non sélectionnables sous la carte de
base (`DeckPoolEntry.evolutions`), pour qu'on voie où la carte mène.

La **condition** d'évolution n'est PAS déclarative : elle vit dans une passive de la carte
de base, qui appelle `ctx.evolveCharacter()` le moment venu (compteur d'attaques, kill,
seuil de PV...). Idem pour le **choix de la branche** quand il y en a plusieurs : sur Kayn,
c'est une passive `onBecomeActive` qui pose la question à son arrivée au poste actif et
range la réponse dans un statut caché, relu plus tard par la condition.

`ctx.evolveCharacter(instanceId, toCardId?)` fait l'évolution **en place** -- `toCardId` est
obligatoire dès qu'il y a plusieurs formes, et doit faire partie du `evolvesTo` de la carte
actuelle (sinon l'appel renvoie `false` sans rien faire). Ce qui est conservé, sans une
ligne à écrire côté carte, parce que c'est la **même instance** qui continue de vivre :

- **la position** (poste actif comme banc) ;
- **les dégâts déjà subis** -- d'où `PV actuels = PV Max (évolué) − dégâts subis` ;
- **tous les statuts**, buffs comme malus (poison, brûlure, stun...) ;
- **les objets équipés**, qui restent accrochés à la nouvelle forme ;
- et c'est mécaniquement **la forme évoluée qui part au cimetière**, la base n'y
  réapparaissant jamais.

Ce que le moteur fait en plus :

- **Le plafond de PV suit la nouvelle carte en gardant les modifications accumulées** : un
  `+100` de HP max encaissé avant l'évolution n'est pas perdu (`nouveau plafond =
  baseMaxHP de la forme + écart déjà acquis`). Évoluer vers un plafond plus bas que les
  dégâts déjà subis **tue sur le coup**, par le même chemin qu'un valeur lock.
- **Les compteurs d'usage des capacités sont remis à zéro** (`1×/partie`, `1×/tour`) : ils
  sont nominatifs, donc une capacité de la forme évoluée qui partagerait un id avec celle
  de la base naîtrait sinon déjà épuisée.
- L'event **`onCharacterEvolved`** est émis (`{ characterInstanceId, fromCardId, toCardId }`),
  et le journal porte `kind: 'evolve'` -- la carte évoluée est projetée en grand au centre
  du plateau, comme pour une capacité.

Évoluer ne coûte **ni le tour, ni une action**. Une forme évoluée qui déclare à son tour un
`evolvesTo` fait une chaîne ; sans rien déclarer, elle est terminale. Il n'y a pas de retour
en arrière, et une résurrection ramène bien la **forme évoluée** (même instance).

⚠️ Les **exceptions** à la règle des PV (« soigne tous ses PV en se transformant », « double
ses PV actuels ») et à la conservation des statuts se codent **à la main dans la carte**,
autour de l'appel à `evolveCharacter` -- il n'y a volontairement pas de champ déclaratif pour
ça. Comme d'habitude, le texte exact va dans `description` et le comportement réel dans
[docs/cartes.md](docs/cartes.md).

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
- **Objet « à lier » (équipement)** : deux choses vont ensemble et ne se devinent pas
  l'une l'autre — `ctx.attachSelfTo(characterInstanceId)` dans `execute` (la carte reste
  en jeu accrochée au personnage au lieu de partir au cimetière) **et** `equipment: true`
  sur la `ObjectCardDef`. Le second est purement déclaratif : c'est lui que le client lit
  pour poser le logo 🔗 sur la carte partout où elle s'affiche, la ranger dans la
  sous-catégorie « Objets à lier » du deck-builder, et dessiner la carte à côté de son
  porteur (à côté de l'actif, en pastille sur le coin au banc). Une carte qui s'attache
  sans le champ n'aurait pas de logo ; une carte qui porte le champ sans s'attacher
  mentirait au joueur.
  Le départ au cimetière avec le porteur est déjà géré par le moteur (`zones.koCharacter`),
  y compris pour un objet posé sur un personnage **adverse** : il retourne dans le
  cimetière de son propre propriétaire, pas dans celui du porteur.
- **Carte qui peut être jouée « dans le vide »** (annuler un terrain quand il n'y en a
  pas, se téléporter sans banc) : donner un `unplayableReason(state, ownerId)` à
  l'`ObjectCardDef` plutôt que de laisser `execute` faire un no-op. C'est du pur
  `GameState`, donc `match.ts` refuse l'action avec la phrase renvoyée **et** la main
  grise la carte avec exactement la même (`describeObjectUnplayable` dans `queries.ts`).
  Réserver `condition(ctx)` aux refus qui ont réellement besoin de l'`EffectContext` (leur
  message d'erreur, lui, reste générique).
- **Jet à pourcentage** (« 33% de chance de désarmer ») : `ctx.rollChance(percent, label,
  { characterInstanceId })` et **jamais** `chancePercent(ctx.state.rng, x)` en direct. La
  première tire *et* annonce le jet (`kind: 'chance-roll'`), ce qui fait tourner une roue
  de pourcentage à l'écran pour les deux joueurs, réussite comme échec ; la seconde tire en
  silence et le joueur ne voit rien. `characterInstanceId` = le personnage que la roue
  nomme (en général la cible du jet).
- **Faire choisir une carte** (cimetière, réserve, deck) : passer `card: { cardId, kind }`
  dans chaque `ChoiceOption` de `ctx.chooseOption`. La modale affiche alors les cartes
  réelles, survolables, au lieu d'une liste de noms. Sans `card`, l'option reste un bouton
  de texte -- ce qu'on veut pour une vraie alternative abstraite (« vers l'actif / vers le
  banc » de Poupée Voodoo).
- **Réserve de bouclier portée par un statut** (Mana Barrier de Blitzcrank, dont
  l'absorption est un modifier et non le bouclier natif du moteur) : stocker le montant
  dans `data.shield`. C'est la convention que lit le client pour afficher le chiffre sur
  le badge, la barre de bouclier sous les PV et le halo -- exactement comme pour
  `ctx.addShield`.
- **AoE sur tout le board adverse** : `ctx.getAllOnBoard(ctx.opponentId)` puis
  `dealDamage` sur chaque instance.
- **Fermer UNE compétence / UNE attaque précise** (le « Sacrifice » de Makima) : les statuts
  `silence-active` / `silence-passive` / `disarmed` ferment des **catégories entières**, ils ne
  savent pas viser une compétence nommée. Pour ça, un modifier qui refuse un id précis :
  `canUseAbility` reçoit `{ characterInstanceId, abilityId }` et `canAttack` reçoit
  `{ characterInstanceId, attackId? }`. ⚠️ Sur `canAttack`, ne rien refuser quand `attackId`
  est absent (la requête jauge alors le personnage en général) — sinon un sceau sur une seule
  attaque désarmerait un personnage qui en a plusieurs.
- **Bloquer un switch : trois portées, trois outils.** `canSwitchStandard` (modifier) ne
  ferme que l'**action de switch du joueur** -- un `forceSwitch` de carte passe encore
  (Manipulation de Light Yagami). Le statut `chained` et le modifier **`canSwitchAny`**
  ferment **tous** les switchs, forcés compris, parce qu'ils sont évalués dans
  `zones.switchActive`, l'unique point de passage (Arène, le scellement de Chrollo).
  `canSwitchAny` reçoit `{ playerId, outgoingInstanceId, incomingInstanceId }`, donc il sait
  aussi refuser UNE carte précise à l'entrée. Aucun des trois ne touche au remplacement
  après un KO (voir la section « Économie de tour »).
- **Rendre une action gratuite (switch)** : `doesActionEndTurn` est une requête
  permission-style à défaut ALLOW (« oui, ça ferme le tour »), et **n'est évaluée que pour
  l'action de switch** (`match.ts::runAction`). Un modifier qui vote `allow: false` rend le
  switch gratuit. ⚠️ Un modifier ne peut pas **consommer** une charge (fonction pure) : une
  carte qui offre un nombre limité de switchs gratuits garde son compteur dans le `data` de
  son instance et le décrémente sur un trigger `onSwitch`, en filtrant sur
  `event.data.reason === 'action'` — sans quoi un `forceSwitch` adverse ferait payer sa
  victime (cf. Faille dimensionnelle).
- **Rejouer/copier un objet** (« Spectre » d'Aki) : `ctx.playObjectImmediately(cardId)`.
  L'objet est créé, mis en jeu, résolu, puis part au cimetière (ou reste accroché si c'est
  un équipement) -- le cycle de vie complet d'un objet posé, mais hors du budget de 2 objets
  par tour. Ne jamais exécuter un `ObjectCardDef.execute` avec un contexte sourcé sur un
  **personnage** : un objet à lier appellerait `attachSelfTo` depuis une source qui n'est
  pas un objet.
- **Atteindre un personnage du banc** : toujours passer par `canTargetBench(state,
  sourceInstanceId, targetInstanceId, true)` avant de le désigner ou de le frapper, y
  compris pour son **propre** banc (soin, équipement, buff). C'est ce qui permet à une carte
  adverse de protéger un banc (Bouclier Ultime) ou de l'isoler (Arène). ⚠️ Le 4ᵉ paramètre
  est le défaut : `true` = « ma carte s'autorise le banc », et sans aucune voix contraire la
  requête renvoie donc `allow`. Pour tester le vote d'une carte, l'interroger avec `false`.
- **Attaquer depuis le banc** (le « Bonus » de Yumeko) : refusé pour tout le monde par
  défaut, et ouvert par un modifier `canAttackFromBench` (permission-style, défaut **deny**)
  qui vote `allow` pour son propre `sourceInstanceId`. Le reste ne change pas : l'attaquant du
  banc repasse par tous les refus ordinaires de `canAttack`, et son attaque ferme son tour
  normalement. `usableFromBench` sur une `AbilityDef` reste, lui, indépendant de ça.
- **Une passive imprimée qui surveille plusieurs sortes d'action** (« si l'ennemi utilise
  un objet… / un actif… / attaque… », Vision du Futur d'Aki) : `trigger: ['onObjectPlayed',
  'onAbilityUsed', 'onAttackDeclared']` et un `switch` sur `ctx.event.name` dans `execute`.
  Surtout **pas** une capacité par event : la carte afficherait la même ligne trois fois.
- **Attaque marquée « peut crit »** : convention maison, ça veut dire **33 %** de chance de
  critique (contre 5 % de base). S'implémente avec le statut générique `critical` et son
  `data.percent`, posé juste avant `dealDamage` et retiré juste après (cf. Levi, Killua) --
  en laissant tranquille un `critical` que le personnage porterait déjà.
- **Override d'une règle générale** (fréquence, ciblage du banc, ATK effectif, limite
  d'objets équipés...) : passer par `modifiers: ModifierDef[]` sur la carte plutôt que
  du code impératif — c'est le système que le moteur scanne automatiquement tant que la
  carte est en jeu (voir `queries.ts` et le README pour la liste des `QueryName`).
- **Taux d'esquive / de critique innés** (ex: L'Infini de Gojo, Black Flash de Todo,
  Execution de Caitlyn) : modifier `getEvasionPercent` / `getCriticalPercent` renvoyant
  `Math.max(current, MON_POURCENTAGE)`. Base : 1 % d'esquive, 1 % de critique ; le statut
  `evasive` monte l'esquive à 20 %, `critical` monte le critique à 33 % (`critical` accepte
  un `data.percent` pour un one-shot, cf. Godspeed de Killua à 100 %). Ces bases sont celles
  lues par `getEvasionPercent`/`getCriticalPercent` **avant** un modifier de carte : un taux
  inné comme celui de Gojo (`Math.max`) reste donc intact face à `evasion-locked` ci-dessous.
  ⚠️ Une carte dont le texte promet « l'effet Esquive » (L'Infini, Sharingan) ne choisit pas
  son chiffre : elle **importe** `EVASIVE_STATUS_CHANCE_PERCENT` de `statuses.ts`, pour que
  le rééquilibrage de l'esquive emporte l'innée avec lui. Un nombre recopié finit par mentir
  au texte.
- ⚠️ **Un modifier qui porte le texte d'une capacité PASSIVE doit déclarer
  `silencedByPassive: true`.** Un modifier vit tant que la carte est en jeu et ne passe
  jamais par `canUseAbility` : sans ce champ, une passive codée en modifier (L'Infini de
  Gojo, Sharingan de Kakashi) continuait de marcher sous `silence-passive` /
  `silence-ultimate`. Le moteur coupe alors le modifier tant que son porteur est silencé
  (garde dans `queries.ts::getInPlaySources`). À ne **pas** mettre sur un modifier qui
  porte le texte d'une **attaque** (le critique de Blackflash) : le silence passif ne ferme
  pas les attaques. Ignoré sur un objet/terrain, qui ne peut pas être silencé.
- **Statuts génériques reconnus par le moteur** (aucune logique à écrire côté carte,
  il suffit de les poser) :
  - `death-ward` : les dégâts classiques ne peuvent plus descendre le porteur sous 1 HP.
  - `atk-boost` / `atk-reduction` (`data.amount`), `atk-multiplier` (`data.multiplier`).
  - `bleed` (`data.stacks`) : voir le détail plus bas.
  - `damage-reflect` (`data: { percent, objectInstanceId?, negatesOriginal? }`) : renvoie
    un pourcentage du prochain coup à l'attaquant, une seule fois, puis se consomme (et
    détruit l'objet porteur s'il est indiqué). Ex : Miroir de Renvoi. ⚠️ Par défaut le
    porteur encaisse quand même le coup en entier EN PLUS du renvoi — `negatesOriginal:
    true` (Puzzle Millénaire de Yugi) fait en plus tomber ces dégâts à 0 pour lui.
  - `bench-damage-bonus` (`data.multiplier`, défaut 2) : les dégâts infligés au **banc
    adverse** par le CAMP du porteur sont multipliés — pas seulement ceux du porteur
    lui-même : le pipeline de dégâts vérifie si n'importe quel personnage du camp porte
    le statut, donc ça couvre aussi bien une attaque/capacité qu'un effet de terrain ou
    d'objet du même camp. Ex : Couteau dans le dos (posé sur tous ses personnages),
    Autel Démoniaque (terrain) en profite déjà sans rien coder de plus.
  - `poison` : son tic est infligé avec `ignoreShield` — le poison ronge le porteur, un
    bouclier ne l'arrête pas. Brûlure et saignement, eux, sont absorbés normalement.
  - `unhealable` : plus aucun `heal()` n'a d'effet sur le porteur, définitivement — y
    compris le nettoyage de bleed qu'un soin fait normalement. Jamais consommé (seule
    une résurrection, qui vide tous les statuts, y met fin) et indépendant de la survie
    de la carte qui l'a posé (contrairement à un modifier, qui cesserait d'être scanné
    si son porteur mourait). Ex : Marque de Mahito.
  - `evasion-locked` : jamais posé par une carte -- le moteur lui-même l'applique à
    quiconque esquive avec succès (`effect-context.ts::rollEvasionAnnounced`), pour
    `EVASION_LOCKOUT_TURNS` tour(s) de son propre tour (`+1`, comme un statut bloquant).
    Ramène l'esquive à 0 % avant tout modifier de carte, donc un taux inné (L'Infini de
    Gojo) n'est pas affecté. Une carte n'a jamais besoin de le poser ou de le lire.
  - `vulnerable` : le porteur subit +50% sur **chaque** instance de dégâts reçue
    (`VULNERABLE_DAMAGE_BONUS_PERCENT`), tics de poison/brûlure/saignement compris.
    L'amplification a lieu avant les réductions de dégâts des cartes, n'est jamais
    consommée par un coup, et ne s'applique pas à un coût en HP que le camp se paie à
    lui-même (`ignoreDamageReduction`).
  - `hit-bounty` (`data: { bonusMaxHP, forOwnerId? }`) : la première attaque qui touche
    réellement le porteur donne du HP max permanent à son attaquant, puis se consomme.
    Générique et toujours géré par le moteur (`effect-context.ts`), mais actuellement sans
    carte qui le pose (l'ancien terrain Coeur Acier, qui en était l'exemple, a été remplacé
    par un objet -- voir `attack-charges` ci-dessous).
  - `attack-charges` (`data: { remaining, bonusMaxHP, objectInstanceId? }`) : chacune des
    `remaining` prochaines attaques **déclarées** par le porteur (touche ou non) lui donne
    `bonusMaxHP` HP max -- PV actuels compris, un `raiseMaxHP` ordinaire, pas la version
    « sans soin » de `hit-bounty`. Consommé dans `match.ts::consumeAttackCharges`, appelé
    comme `consumeExtraAttack` sur le `case 'attack'` (donc une seule fois par attaque,
    même si elle touche plusieurs cibles). La dernière charge détruit l'objet porteur si
    `data.objectInstanceId` est fourni. Ex : Coeur Acier (objet à lier).
  - `concentration` (`data.percent`) : la prochaine attaque crit à ce pourcentage, sinon
    0 dégât + désarmé. Ex : l'objet Concentration.
  - `chained` : bloque **tout** départ du poste actif — l'action de switch standard comme
    n'importe quel `forceSwitch` de carte (le garde est dans `zones.switchActive`, seul
    point de passage commun). Le remplacement après un KO n'est pas concerné.
  - `linked` (`data.partnerInstanceId`, à poser sur les **deux**, chacun vers l'autre) :
    les deux attaquent ensemble, partagent chaque instance de dégâts, meurent ensemble, et
    seul celui qui tient le poste actif peut utiliser ses abilities (même déclarées
    `usableFromBench`). Ex : Jacob et Essau. Les quatre règles vivent dans le moteur
    (`handleAttack`, `dealDamage`, `koCharacter`, `canUseAbility`).
  - `extra-attack` (`data: { remaining, damagePercent }`) : le porteur peut attaquer
    `remaining` fois de plus ce tour au lieu de le terminer, la frappe supplémentaire
    n'infligeant que `damagePercent` % des dégâts. Ex : Attaque cloné. C'est le **seul**
    moyen de prolonger un tour après une **attaque** : `doesActionEndTurn` n'est évaluée
    que pour l'action de **switch** (voir plus bas), et un modifier — fonction pure — ne
    pourrait de toute façon pas consommer la charge qu'il lit.
  - `borrowed-attack` (`data: { cardId, attackId }`) : le porteur emprunte une attaque qui
    n'est **pas** sur sa carte, et c'est alors la **seule** qu'il puisse porter (`canAttack`
    refuse toutes les siennes). Elle s'exécute avec le contexte du porteur : son ATK effectif,
    ses buffs, sa cible en face. Ex : Livre de Chrollo.
    ⚠️ Corollaire : pour énumérer les attaques d'un personnage **en jeu**, passer par
    `queries.ts::attacksAvailableTo(state, instanceId)` (ou `findAttackFor`) et jamais par
    `getCharacterCard(...).attacks` en direct — qui raterait l'empruntée. C'est déjà le cas
    dans `match.ts`, `turn.ts` et côté client (`boardActions.tsx`, `cardDetails.tsx`).
  - `forced-attack` (`data: { targetInstanceId }`) : au début du tour de son porteur, celui-ci
    retourne les **dégâts** de son attaque (ATK effectif) sur le personnage désigné de son
    PROPRE banc, puis son tour se termine aussitôt. Ex : Manipulation de Makima. Résolu par
    `turn.ts::resolveForcedAttack` et consommé à la lecture, même si la cible a disparu
    entre-temps. Seuls les dégâts sont retournés, pas le corps de l'`execute()` de l'attaque
    (qui vise en dur l'actif d'en face). C'est le **seul** moyen de fermer le tour d'un autre
    joueur : `endsTurn` ne ferme que le tour en cours, celui de la carte qui agit.
  - `survival-vow` (`data: { ticksRemaining, damagePercent, rewardMaxHPReduction, rewardHeal,
    objectInstanceId }`) : posé par un **objet** (donc sans `trigger` possible — cf. plus
    haut), résolu entièrement par `turn.ts::resolveSurvivalVow`, appelé depuis `endTurn`
    plutôt que par le tick générique `tickStatusesAtTurnStart` — d'où l'absence volontaire de
    `remainingTurns` (le champ est utilisé par ce dernier ; `data.ticksRemaining` fait tout le
    travail à la main). Ne touche QUE l'actif du joueur dont le tour se termine : en pause
    (ni tic ni décompte, jamais reset) tant que le porteur n'est pas au poste actif, comme
    n'importe quel statut sans `ticksOnBench`. Chaque tour qualifiant inflige
    `damagePercent`% des HP max actuels du porteur (dégâts ordinaires, absorbables) ; un tic
    qui le tue annule la récompense. `ticksRemaining` à 0 et porteur toujours vivant : le vœu
    est tenu — `rewardMaxHPReduction` de Valeur Lock sur l'actif adverse du moment (déjà
    insensible au bouclier par construction) et `rewardHeal` de soin pour le porteur, puis
    l'objet équipé (`data.objectInstanceId`) est détruit, son rôle rempli. Ex : Tours compté.
  - `bounty-vow` (`data: { count, threshold, bonusATK, bonusShield, objectInstanceId }`) :
    posé par un **objet**, `data.count` compte les KO de personnages **adverses** réalisés
    par le porteur depuis l'équipement (repart de 0, ignore les kills d'avant), incrémenté
    par le moteur lui-même dans `zones.ts::resolveBountyVow` — appelé juste après
    `recordKill` dans `koCharacter`, seul endroit qui connaît déjà `killerInstanceId` (même
    principe que `crit-streak`, qui s'auto-incrémente aussi côté moteur). Un KO allié
    (ricochet, Manipulation, Jacob et Essau) ne compte pas. `count` à `threshold` : `atk-boost`
    **permanent** de `bonusATK` (indépendant de la survie de l'objet, comme `crit-streak`) et
    `bonusShield` de bouclier immédiat, puis l'objet équipé est détruit. Ex : Chasseur de prime.
  - `berserk-vow` (`data: { hpThreshold, healPercent, objectInstanceId }`) : posé par un
    **objet**, rappelé par le moteur (`zones.ts::resolveBerserkVow`) après TOUT ce qui peut
    faire bouger les HP actuels du porteur — `match.ts::dealDamage`, `applyValeurLock`, et
    juste après la pose de l'objet (pour le cas où le porteur est déjà sous la barre au
    moment même où on l'équipe). Dès que le porteur passe sous `hpThreshold` HP actuels
    **sans mourir** (revérifié à chaque appel), le vœu est tenu : remplacé par
    `buveur-de-sang` (`healPercent` repris tel quel), objet équipé détruit. Ex : Berserk.
  - `buveur-de-sang` (`data: { healPercent }`) : récompense permanente de `berserk-vow`. Le
    porteur récupère `healPercent`% des dégâts **hostiles** qu'il inflige (attaque/capacité
    avec une source résolue, comme `hit-bounty`/`crit-streak` — pas de vol de vie sur un
    ricochet allié), restaurés en direct via `hp.heal()` (`effect-context.ts::dealDamage`),
    qui contourne exprès `api.heal()` — parce que ce même statut bloque tout soin passant
    par ce canal pour son propre porteur, lifesteal compris s'il y passait (`match.ts::heal`,
    même blocage qu'`unhealable`, y compris le nettoyage de bleed). Jamais consommé.
  - `stun` `disarmed` `silence-active` `silence-passive` `silence-ultimate`
    `evasive` `critical` `burn` `poison`.

  ⚠️ **`data.objectInstanceId` lie un statut à l'objet qui l'a posé, dans les DEUX sens.**
  Quand le statut expire, le moteur détruit l'objet nommé (`statuses.ts`) ; quand l'objet
  est détruit, le moteur retire du (ex-)porteur tout statut qui le nomme
  (`zones.destroyObject`). C'est ce qui fait que « Destruction détruit tous les objets
  équipés » emporte aussi leurs effets (Crit +, Détermination, Potion force, Miroir de
  Renvoi) au lieu de les laisser tourner sur des cartes déjà au cimetière. Un état qui doit
  **survivre** à la disparition de sa carte (Poche de sang) ne doit donc PAS porter ce champ.

  Trois champs transverses utilisables sur **n'importe quel** statut :
  `ticksOnBench: true` (la durée continue de descendre au banc), `hidden: true`
  (bookkeeping interne : ni badge sur la carte, ni ligne de journal), et
  `onExpire: {…}` (statut passé au porteur quand celui-ci expire — un effet **différé**).
  `onExpire` est appliqué après la passe de décompte du tour, donc le statut posé n'est pas
  décompté à son arrivée : sa durée part du tour SUIVANT et ne demande **aucun `+1`**. C'est
  ce qui permet à Attaque cloné de ne silencer qu'à partir du tour d'après, en laissant
  libre le tour où la carte est jouée.

  ⚠️ Ajouter un statut à cette liste (nouvelle mécanique générique du moteur) veut dire
  trois choses en plus du code : l'ajouter à `BuiltinStatusId` **et** à
  `BUILTIN_STATUS_IDS`, lui donner un visuel dans `web/components/statusEffects.tsx`, et
  l'ajouter au glossaire en partie (`web/components/EffectsGlossary.tsx`) — dont chaque
  nombre affiché doit venir d'une constante exportée par le moteur, jamais d'un chiffre
  recopié.
- ⚠️ **Un trigger `onTerrainPlayed` DOIT filtrer sur son propre terrain.** L'event est
  émis pour *n'importe quel* terrain posé, y compris celui de l'adversaire, et tous les
  terrains déjà en jeu le reçoivent. Sans garde, l'effet « à la pose » se rejoue à chaque
  fois que quelqu'un pose un terrain (bug corrigé sur Autel Démoniaque, Protection Divine,
  Coeur Acier, Destruction et Absorption Vitale) :
  ```ts
  trigger: 'onTerrainPlayed',
  condition(ctx) { return ctx.event?.data['terrainInstanceId'] === ctx.sourceInstanceId; },
  ```
  Même logique pour `onTerrainRemoved` (déjà appliquée sur Coeur Acier).
- **Un terrain qui pose un statut sans durée propre doit prévoir sa levée sur
  `onTerrainRemoved`.** Le terrain peut partir autrement que par son propre décompte
  (détruit, remplacé par un autre terrain), et son tick ne tournera alors plus jamais :
  le statut resterait sur le personnage pour toute la partie (bug corrigé sur Absorption
  Vitale).
- **Coût en HP que le camp s'inflige à lui-même** (Adrénaline Ultime, Soin Sacrificiel de
  Soraka) : passer `{ ignoreShield: true, ignoreDamageReduction: true }` à `dealDamage`.
  Sans ça, le bouclier du personnage (ou n'importe quelle réduction de dégâts) absorbe le
  coût et la carte devient gratuite.
- **Buff limité au tour en cours posé sur un personnage qui peut partir au banc** :
  ajouter `ticksOnBench: true` au statut. Par défaut, les durées sont **suspendues** sur
  le banc (section 6) — un buff « pendant ce tour » posé puis mis au banc était donc figé
  et revenait intact bien plus tard (bug corrigé sur Potion force, Détermination,
  Adrénaline Ultime et Couteau dans le dos). `ticksOnBench` ne fait que décompter :
  seuls burn/poison/bleed infligent leurs dégâts au banc.
- **Recharge d'ability (« rechargement : N tours ») : `ticksOnBench: true`, toujours.**
  « N tours » veut dire N tours, pas N tours passés au poste actif : sans ce champ, un
  personnage mis de côté gèle son propre compte à rebours, et une ability faite pour être
  lancée du banc (la Traque de Chopper) ne revient jamais. Vaut aussi pour un verrou
  d'ability à durée (le Hook de Blitzcrank). La règle du `+1` ci-dessous s'applique
  toujours, et `ticksOnBench` ne change pas la cadence : un statut ne décompte que pendant
  les tours de son porteur, banc ou pas.
- **Donner des HP max sans soigner** : `ctx.raiseMaxHP(id, n, { keepCurrentHP: true })`.
  Par défaut, monter le plafond monte aussi les PV actuels d'autant (l'écart au plafond ne
  bouge pas) ; avec l'option, seuls les HP max montent. C'est ce que veut dire une carte
  qui promet des « HP max (pas de soin) », comme la prime de Coeur Acier.
- **Statut de bookkeeping interne** (compteur, mémoire de la dernière attaque adverse,
  suivi de verrou) : ajouter `hidden: true`. Le journal ne l'annonce pas et la carte
  n'affiche pas de badge pour lui — aucun changement mécanique, seulement de la
  présentation en moins (cf. Guts, Kakashi, Zoé, Ornn). À réserver aux statuts qui
  n'apprennent rien au joueur : la réserve de Mana Barrier de Blitzcrank, elle, doit
  rester visible.
- **Effet qui déplace/échange « tous les statuts »** (Inversion de la Réalité d'Aizen,
  Poupée Voodoo) : ne déplacer que des statuts que le moteur reconnaît, via
  `BUILTIN_STATUS_IDS` (`statuses.ts`). Un `statusId` inventé par une carte n'a de sens
  que pour elle : posé sur une carte qui ne le lit pas, il est purement et simplement
  détruit — ce qui annulait en silence des tours d'accumulation (Guts, Hulk, Blitzcrank).
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
  a déjà met à jour l'instance existante (source/label) au lieu d'en empiler une deuxième
  — sinon les deux tiquaient indépendamment le même tour et doublaient silencieusement les
  dégâts (bug corrigé : avant ça, une cible déjà brûlée qui se refaisait toucher par un
  burn prenait le tick de l'ancien ET du nouveau le même tour). Contrairement à bleed, pas
  de notion de stacks : la ré-application ne change jamais le montant du tick (toujours
  fixe), seulement la durée. Les deux durées ne se combinent pas pareil :
  - **burn** : les durées **s'additionnent** (2 tours de plus par coup) — c'est comme ça
    que la brûlure « stack » ;
  - **poison** : durée portée au **plus grand des deux** (jamais raccourcie, jamais
    cumulée).

## Ce que le serveur impose par-dessus le moteur

- Un choix sans réponse pendant 120 s est résolu automatiquement avec
  `defaultChoiceAnswer(spec)` (`engine/src/choices.ts`) : première sélection légale, "oui",
  ou l'ordre tel que présenté. Une carte ne doit donc jamais supposer qu'un prompt sera
  forcément répondu « intelligemment » — s'il existe un choix catastrophique, ne pas le
  mettre en première position.
- Les réponses aux prompts sont **validées à l'entrée** (`Match.answerChoice`) : une
  sélection doit faire partie des `options` proposées, respecter `min`/`max` et ne pas
  contenir de doublon ; un `order` doit être une permutation exacte des items. Une carte
  peut donc supposer que ce que lui rend `ctx.choose*` fait bien partie de ce qu'elle a
  proposé (mais pas que ce soit le choix le plus malin — cf. le timeout ci-dessus).
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
- `ticksOnBench` était déclaré dans `StatusInstance` mais **jamais lu** : seuls
  burn/poison/bleed échappaient à la suspension des durées au banc. Il est désormais
  honoré (décompte uniquement, pas de dégâts).
- Les triggers `onTerrainPlayed` se déclenchaient pour le terrain de n'importe qui.
- Une passive codée en **modifier** (esquive innée de Gojo/Kakashi) survivait au silence
  passif / ultime : c'est ce que corrige `silencedByPassive` (voir Patterns récurrents).
- Un KO tuant via valeur lock (Mahito, poison Sang Maudit) ne nommait pas son tueur :
  les passives « sur kill » le rataient.
- Les objets équipés sur un personnage d'un **autre** camp partaient dans le mauvais
  cimetière à la mort du porteur (id présent dans une zone dont le `objects` ne le
  contient pas → crash des cartes qui parcourent le cimetière).
- `dealDamage` / `heal` / `applyStatus` / `addShield` / `raiseMaxHP` ignorent désormais
  toutes une cible partie au cimetière (`removeStatus` reste autorisé, pour permettre le
  nettoyage d'une marque sur un personnage qui vient de mourir).

## Journal d'événements

`api.log(message, data)` écrit dans `state.log`, lu par le client. Le message est en
**français** et nomme les cartes/joueurs par leur nom d'affichage (`names.ts` :
`cardName(cardId)` / `playerName(state, playerId)`), jamais par un id.

**Ligne privée : `data.privateTo = <playerId>`.** `getPlayerView` retire de la vue de
l'autre camp toute entrée qui porte ce champ. C'est le seul canal pour dire quelque chose à
UN joueur — la Cible secrète tirée par le Sermet de Vengance de Gon, la carte que Caméléon
est devenue en main. Par défaut le journal est commun aux deux joueurs : une carte qui a un
secret à garder doit soit se taire, soit passer par `privateTo`.

Le client ne lit **pas** le texte : il classe chaque entrée sur `data.kind`
(`'attack' | 'use-ability' | 'play-object' | 'play-terrain' | 'damage' | 'heal' | 'ko' |
'critical' | 'evasion' | 'chance-roll' | 'status' | 'switch' | ...`) pour choisir l'icône,
la couleur et les animations de plateau. Une nouvelle entrée de journal digne d'être mise
en avant doit donc porter un `kind` ; sinon elle s'affiche en ligne neutre, ce qui est très
bien pour du détail.

Trois `kind` déclenchent une animation plein plateau, visible par **les deux** joueurs
(`web/components/gameEvents.ts`) :

- `play-object` / `play-terrain` / `use-ability` → la carte concernée est projetée en très
  grand au centre pendant ~1,7 s (`CardSpotlight`). Plusieurs cartes jouées d'affilée
  s'enchaînent au lieu de se superposer.
- `chance-roll` (et les jets d'esquive/critique portés par une carte) → une roue de
  pourcentage tourne et s'arrête sur le résultat réel (`ProcWheel`).

## Pull requests : description vide

Une PR créée sur ce dépôt n'a **pas de description** : `gh pr create --title "<titre>" --body ""`.
Pas de résumé, pas de liste de changements, pas de plan de test, et pas de footer
« 🤖 Generated with Claude Code ». La réponse à l'utilisateur est juste le lien de la PR.
