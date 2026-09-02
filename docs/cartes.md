# Référence des cartes — texte imprimé vs. comportement réel

⚠️ **Ce fichier n'est PAS affiché en jeu.** C'est la note de travail de Claude.

Le champ `description` d'une carte est le **texte exact de la carte** (voir la règle dans
[CLAUDE.md](../CLAUDE.md)) : rien n'y est ajouté, expliqué ni résumé. Tout ce que ce texte
ne dit pas mais que le moteur fait quand même est consigné ici, sous « Moteur ».

À tenir à jour à chaque carte ajoutée ou modifiée : une entrée par carte, avec le texte
imprimé et les faits mécaniques. Le tableau de valeurs vient des constantes en tête de
chaque fichier `packages/engine/src/cards/demo/<carte>.ts`.

Rappels transverses qui valent pour **toutes** les cartes, et qu'aucune n'a donc à répéter :

- Base 1 % d'esquive et 1 % de critique (x2) sur toute attaque/ability hostile ; le statut
  `evasive` monte l'esquive à **20 %**, le statut `critical` monte le critique à **33 %**
  (constantes `EVASIVE_STATUS_CHANCE_PERCENT` / `CRITICAL_STATUS_CHANCE_PERCENT`). Une
  esquive **innée** promise par une carte (L'Infini, Sharingan) vaut le taux de l'effet
  Esquive, donc 20 % : elle lit la constante, elle ne recopie pas un nombre. Esquive et
  critique ne se jouent qu'entre camps adverses (jamais sur un soin ou un coût que le camp
  se paie).
- Poison = 10 HP + 10 % des HP max par tour, **et il traverse le bouclier** (`ignoreShield`,
  contrairement à Burn et Bleed qui y sont absorbés) ; Burn = 50 HP par tour ; Bleed = 10 % des HP
  max par stack, une seule fois, puis consommé ; Vulnérable = +50 % de dégâts subis. Ces
  tics ne sont ni esquivables ni critiques. Tout cela est déjà expliqué au joueur par le
  glossaire en partie (`web/components/EffectsGlossary.tsx`).
- Une cible partie au cimetière est hors-jeu : dégâts, valeur lock et soins qui la visent
  sont des no-ops.
- Un tour de jeu couvre l'action des **deux** joueurs (comme aux échecs) : le compteur de
  tours n'avance qu'une fois les deux passés. Une durée de carte se compte en tours de son
  porteur, soit une fois par manche — « pendant 3 tours » = 3 tours au sens du compteur.
- 2 objets et 1 terrain par tour maximum ; le 2ᵉ objet termine le tour. Ces budgets-là sont
  bien par tour de joueur : chacun a le sien pendant sa propre action.
- Une recharge d'ability (« rechargement : N tours ») descend **aussi au banc** : le statut
  de cooldown porte `ticksOnBench: true`. « N tours » veut dire N tours, pas N tours passés
  au poste actif.
- Construction de deck (`deck.ts`) : 6 personnages / 8 objets / 3 terrains au maximum.
  **Personnages et terrains sont uniques** (un seul exemplaire chacun) ; seuls les objets se
  prennent en double, sauf ceux qui déclarent leur propre `maxCopies`. Une carte peut aussi
  en exclure une autre du même deck (`incompatibleWith`, relation symétrique) : c'est le cas
  de Chopper et Soraka.

---

## Personnages

### Aizen — 300 HP

- **Hado #90** (70 ATK) — *« Inflige 70 dégâts à l'actif adverse en traversant tous les
  boucliers et toutes les réductions de dégâts. »*
  - Moteur : `dealDamage` avec `ignoreShield` + `ignoreDamageReduction`. Le `death-ward`
    de Détermination reste opposable (il est vérifié après les réductions), tout comme
    l'esquive.
- **Hypnose Absolue** (passive) — *« Quand Aizen est attaqué (attaque ou ability adverse),
  40 % de chance que les dégâts soient entièrement redirigés vers un personnage du banc
  allié, désigné par le joueur d'Aizen. »*
  - Moteur : modifier `getDamageRedirectPercent`. Le moteur tire le dé et demande au camp
    d'Aizen quel personnage du banc encaisse ; sans banc vivant, pas de redirection.
- **Inversion de la Réalité** (active) — *« Échange les altérations d'Aizen (buffs comme
  malus) avec celles du personnage actif adverse. »*
  - Moteur : seuls les statuts de `BUILTIN_STATUS_IDS` sont échangés. Les compteurs privés
    d'une carte (Guts, Hulk, Blitzcrank…) restent chez leur propriétaire — les déplacer
    reviendrait à les détruire. Bouclier, HP et ATK de base ne bougent pas.

### Akali — 260 HP

- **Kunaï** (70 ATK) — *« Inflige 70 dégâts à l'actif adverse. »*
- **Shroud** (active, 1×/partie) — *« Akali lance son nuage de fumée, lui accordant esquive
  pendant 5 tours. Utilisable une seule fois par partie. »* → statut `evasive`, 33 %.
  - Moteur : `usesPerGame: 1`. La limite n'était pas écrite sur la carte d'origine, elle a
    été ajoutée au texte imprimé en même temps que le passage de 3 à 5 tours.
- **Perfect Execution** (passive) — *« Si après une attaque de Akali, l'ennemi touché est à
  20HP ou moins, il meurt immédiatement. »*
  - Moteur : exécuté dans l'`AttackDef` de Kunaï, via `ctx.koCharacter` — donc hors du
    pipeline de dégâts. La carte teste elle-même `hasDeathWard` avant d'achever :
    Détermination protège bien contre l'exécution. Une esquive l'empêche aussi (pas de
    dégâts = seuil jamais atteint).

### Aki — 240 HP

- **Sabre d'Obsidienne** — 55 ATK, pas de texte. Consomme le bonus de Vision du Futur, qu'il
  ait touché ou non.
- **Vision du Futur** (passive) — *« Si l'ennemi utilise un Objet : +40 dégâts sur la
  prochaine attaque d'Aki.\nS'il utilise un Actif : Aki va stun au prochain tour.\nS'il
  effectue une Atk : Gagne 20 HP »*
  → **Une seule passive imprimée pour trois events** : `onObjectPlayed`, `onAbilityUsed`,
  `onAttackDeclared`, tous filtrés sur le camp adverse. **Uniquement depuis le poste actif**
  (pas de `usableFromBench`) : Aki au banc ne lit plus le jeu. En revanche elle réagit autant
  de fois que l'adversaire enchaîne d'actions dans un tour.
  - **Objet** : +40 **cumulables** (2 objets = +80) sur un statut `aki-vision-bonus` sans
    durée — il tient jusqu'à la prochaine attaque d'Aki, qui le dépense. Passe par un
    modifier `getEffectiveATK`, donc buffs et malus s'appliquent au total.
  - **Actif** : Aki **inflige** un stun à l'actif adverse (`remainingTurns: 2`, le +1 des
    statuts bloquants posés sur l'ennemi). Attention : une capacité adverse qui neutralise
    Aki au passage (stun, silence passif) l'empêche de riposter — le moteur revérifie
    l'éligibilité d'une passive juste avant de l'exécuter.
  - **Atk** : un simple `heal(20)`. Le plafond de PV **ne bouge pas** : Aki déjà à pleine
    vie ne gagne rien, et le soin est plafonné aux dégâts réellement subis. `onAttackDeclared`
    part avant que le coup ne soit résolu, donc le soin arrive avant les dégâts de l'attaque
    adverse.
  → **Ajout moteur** : `AbilityDef.trigger` accepte désormais une **liste** d'events.
  Sans ça il aurait fallu trois capacités séparées, donc la même ligne imprimée trois fois
  sur la carte.
- **Spectre** (active) — *« Vole le dernier Objet utilisé par l'adversaire et l'applique
  immédiatement »*
  → Vision du Futur retient au passage le `cardId` du dernier objet adverse posé
  (`aki-spectre-memoire`, caché). Spectre en joue une **copie** pour le compte d'Aki :
  l'exemplaire adverse, déjà parti au cimetière, n'est pas touché — Aki vole l'usage, pas
  la carte. **Un objet volé ne se revole pas** : la mémoire est marquée consommée et
  Spectre reste grisée jusqu'à ce que l'adversaire pose une **nouvelle** carte objet.
  → **Ajout moteur** : `ctx.playObjectImmediately(cardId)` — crée l'objet, le met en jeu,
  résout son effet, puis l'envoie au cimetière (ou le laisse accroché si c'est un
  équipement), **sans** consommer le budget de 2 objets par tour. Le cycle de vie est
  partagé avec la pose normale (`Match.resolveObjectInPlay`), pour qu'un objet joué par
  ricochet ne puisse pas rester coincé en jeu.

### Bakugo — 250 HP

- **Explosion** (60 ATK) — *« Inflige 60 dégâts à l'actif adverse. »*
- **Sueur Nitroglycérine** (passive) — *« Si le personnage actif adverse subit déjà l'effet
  Burn, les attaques de Bakugo infligent +70 dégâts supplémentaires. »*
  - Moteur : modifier `getEffectiveATK`, réévalué à chaque coup. Le bonus tombe dès que la
    brûlure expire.

### Black Panther — 360 HP

- **Griffes** (30 ATK) — *« 40% de chance d'infliger vulnérable pendant 1 tour. »*
  - Moteur : première carte du pool à poser `vulnerable`. `remainingTurns = 1 + 1` : posé sur
    l'ennemi pendant le tour de Black Panther, il serait sinon retiré au tout début du tour
    adverse, donc avant que Black Panther ait pu frapper une cible réellement vulnérable
    (même `+1` que le Silence de Zoé ou le Désarmement de Sion).
  - Moteur : le jet de 40 % n'a lieu que si le coup a réellement entamé la cible (même
    convention que Sion/Killua/Chopper) — une esquive annule donc aussi le vulnérable.
- **Energie Cinétique** (active, 1×/partie) — *« Black Panther stock 40% des dégâts qu'il
  reçoit. Peut relacher cette énergie stocké à l'ennemi actif. Utilisable une fois. »*
  - Moteur : « Utilisable une fois » porte sur la **libération seule** (`usesPerGame: 1`).
    Le stockage, lui, tourne en permanence dès le début de partie et ne s'arrête jamais.
  - Moteur : découpé en **deux** `AbilityDef`. « Energie Cinétique » doit rester activable
    manuellement (`kind: 'active'` sans `trigger`), alors que l'accumulation réagit à
    `afterDamage` — les deux ne peuvent pas cohabiter dans la même ability. Le second bloc
    (« Energie Cinétique (réserve) ») apparaît donc dans le détail de carte, comme les
    « mémoires » de Zoé et Kakashi ou le « Dévoreur » de Chainsaw Man.
  - Moteur : la réserve est stockée dans `data.stored` d'un statut **visible** (le montant
    est écrit dans le label) — le joueur doit voir ce qu'il a en banque. Pas de
    `remainingTurns` : elle n'expire pas, elle attend sa libération.
  - Moteur : ce qui est capitalisé est le **brut du coup tel qu'il l'a atteint**, soit
    `amount + shieldAbsorbed` — la réserve monte donc même quand un bouclier absorbe tout.
    Une réduction de dégâts en amont (Bouclier Ultime), elle, diminue bien ce brut : ce
    coup-là ne l'a jamais atteint. Compte aussi les tics de poison/brûlure/saignement et les
    coups encaissés au banc (`usableFromBench: true`).
  - Moteur : la `condition()` interdit de lancer la libération avec une réserve vide, pour
    ne pas gâcher l'unique utilisation de la partie.

### Blitzcrank — 250 HP

- **Poing d'acier** (50 ATK) — *« Inflige 50 dégâts à l'actif adverse. »*
- **Mana Barrier** (passive, `afterDamage`, banc, 1×/partie) — *« Si Blitzcrank tombe sous
  50HP, il gagne un bouclier absorbant 150 points de dégâts, mais Hook est verrouillé
  pendant 2 tours. Ne se déclenche qu'une seule fois par partie. »*
  - Moteur : la réserve n'est **pas** le champ `shield` natif mais un statut propre
    (`blitzcrank-mana-barrier-shield`, volontairement **visible**) consommé par un modifier
    `getIncomingDamageAmount`. Conséquence : Voleur de bouclier n'a aucune prise dessus. Le
    verrou de Hook est le statut `blitzcrank-hook-locked`, avec `ticksOnBench: true` (même
    règle que les recharges d'ability : Mana Barrier se déclenche justement depuis le banc).
  - La réserve restante vit dans `data.shield`, la convention que le client lit pour
    afficher le chiffre sur le badge, la barre de bouclier sous les PV et le halo : à
    l'écran, elle se lit donc exactement comme un bouclier natif, tout en restant
    intouchable par Voleur de bouclier.
- **Hook** (active, 1×/partie) — *« Une fois par partie, ramène un personnage ennemi du banc
  sur le poste actif. »* → `forceSwitch` sur le camp adverse.

### Caitlyn — 200 HP

- **Headshot** (125 ATK) — *« Inflige 125 dégâts à l'actif adverse. »*
- **Execution** (passive, `onCharacterKO`, banc) — *« Caitlyn a une chance de critique innée
  de 33% sur ses attaques. Si elle tue un ennemi, cette chance passe à 50% pour le reste de
  la partie. »*
  - Moteur : les 33 % de base viennent d'un modifier `getCriticalPercent` (permanent, survit
    à une résurrection) ; le passage à 50 % est mémorisé par un statut caché posé sur
    `onCharacterKO` quand `killerInstanceId` est Caitlyn.

### Chainsaw Man — 280 HP

- **Chainsaw** (50 ATK) — *« Applique 2 bleed. »*
  - Moteur : pas de "%" sur la carte, donc pas de chance séparée -- un seul jet
    d'esquive partagé pour les dégâts et le bleed (`ctx.rollEvasion` puis
    `skipEvasionRoll` sur les deux, même pattern que Lacération de Sukuna).
- **Mangeur de démons** (active) — *« Supprime une carte objet aléatoire de l'ennemi.
  Utilisable 1 fois et 1 fois de plus par personnage tué par Chainsaw Man. »*
  - Moteur : cible la **réserve non jouée** de l'adversaire (pas les objets équipés en
    jeu), un exemplaire au hasard (`randomInt(ctx.state.rng, ...)`, jamais `Math.random`)
    envoyé directement à son cimetière -- récupérable plus tard par un effet comme
    Déchetterie.
  - Moteur : `usesPerGame` déclaré à 1, augmenté en permanence de +1 par kill attribué à
    Chainsaw Man via un modifier `getAbilityUsesPerGame`, alimenté par un compteur caché
    (`Dévoreur (compteur)`, second passive sur `onCharacterKO`) -- même schéma que Berserk
    de Guts / Execution de Caitlyn, mais séparé en deux `AbilityDef` puisque Mangeur de
    démons doit rester activable manuellement (`kind: 'active'` sans `trigger`) alors que
    le comptage réagit à un event.
  - ⚠️ Angle mort assumé : seuls les kills où Chainsaw Man est le tueur **direct**
    comptent (attribution portée par `ctx.dealDamage`). Un ennemi achevé par le tic du
    bleed posé par Chainsaw ne compte pas : les tics de statuts (poison/burn/bleed)
    n'attribuent pas de tueur (voir `tickStatusesAtTurnStart`, `statuses.ts`).

### Chrollo Lucilfer — 225 HP

- **Dague de Ben** — 45 ATK, pas de texte. **Tant qu'un livre est ouvert, cette entrée
  d'attaque EST l'attaque volée** : elle délègue à l'`execute` de la victime, qui calcule
  son propre ATK depuis sa propre base et garde tous ses effets annexes (poison, silence,
  ciblage du banc…). ⚠️ **Corollaire assumé** : le bouton du panneau continue d'afficher
  « Dague de Ben — 45 ATK ». Un modifier `getEffectiveATK` qui corrigerait l'affichage
  fausserait le calcul de l'attaque déléguée (elle repartirait d'une base déjà décalée). Le
  journal, lui, annonce le vrai nom à chaque coup.
- **Double Face : Annulation** (active) — *« Condition : L'adversaire doit avoir au moins un
  autre personnage en vie. […] »*
  → Un seul livre à la fois : l'ability est grisée tant qu'une carte est scellée (règle
  confirmée par l'auteur). Grisée aussi sans banc adverse — il faut quelqu'un pour prendre
  le poste que la victime libère.
  → **Chrollo choisit ce qu'il vole** quand la carte en offre plusieurs (Levi a 2 attaques,
  Roi des esprits 3) ; seuls les actifs manuellement activables sont volables. **L'adversaire
  choisit** qui monte au poste actif : c'est son équipe.
  → Le sceau (`chrollo-scellement`) est posé **avant** le switch, sinon le garde
  `canSwitchAny` ne verrait rien et la victime pourrait être remontée dans la foulée.
- **Actif volé** (active) — entrée supplémentaire, pas sur la carte imprimée : les capacités
  d'un personnage sont déclarées en dur, il n'y a pas moyen d'en greffer une à chaud sur
  « Double Face ». Sa description reprend mot pour mot la phrase de la carte qui annonce ce
  vol, et elle n'est activable que quand un livre est ouvert. Relancée avec **Chrollo pour
  source** (même principe que le Spell Thief de Zoé).
- **Contrainte** (passive, `onTurnStart`) — le troisième paragraphe de Double Face, que la
  carte imprimée intitule elle-même « Contrainte ». Entrée séparée obligatoire : une
  capacité activable ne peut pas, en plus, réagir à un event.
  → `Math.floor(25 % des PV actuels)`, **sans plancher à 1 : la saignée ne peut jamais tuer
  Chrollo** (en dessous de 4 PV elle ne retire plus rien). Payée avec
  `ignoreShield` + `ignoreDamageReduction` — c'est un coût que Chrollo se paie à lui-même,
  un bouclier ne doit pas le rendre gratuit.
- **« il ne peut plus agir »** — trois modifiers sur la victime scellée : `canUseAbility`
  (aucune capacité, active comme passive à trigger), `canAttack` (au cas où un effet la
  ramènerait au poste actif) et `canSwitchAny` (elle ne peut pas revenir par un switch,
  forcé compris). ⚠️ **Le remplacement après un KO reste possible** : si l'adversaire n'a
  plus que des scellés, l'un d'eux prend quand même le poste — sans quoi la partie se
  bloquerait.
- **Fermeture du Livre** (active) — retire le sceau et la marque. La marque est retirée dans
  tous les cas, même si la victime est morte entre-temps : c'est elle qui porte la saignée et
  l'attaque volée. Un livre dont la victime part au cimetière se referme d'ailleurs tout
  seul (les lecteurs vérifient qu'elle est encore sur le plateau).

### Chopper — 250 HP — incompatible avec Soraka

- Deck : l'incompatibilité avec [Soraka](#soraka--160-hp--incompatible-avec-chopper) est
  déclarée sur la carte de celle-ci et symétrisée par le moteur — ne pas la re-déclarer ici,
  sous peine d'avoir deux sources de vérité pour la même règle. (L'exemplaire unique, lui,
  n'est plus propre à la carte : tous les personnages le sont.)
- **Heavy Point** (60 ATK) — *« Inflige 60 dégâts à l'actif adverse. Si les dégâts passent,
  33% de chance d'appliquer Poison pendant 1 tour. »*
  - Moteur : le jet de poison n'a lieu que si le coup n'a pas été esquivé.
- **Traque** (active, utilisable du banc) — *« Soigne un personnage allié au choix (actif ou
  banc) de 70 HP même depuis le banc utilisable une fois tout les 6 tours. »*
  - Moteur : le rechargement est un statut de cooldown à `remainingTurns = 6 + 1` (posé sur
    soi pendant son propre tour), pas un `usesPerGame`. Il porte `ticksOnBench: true` : la
    recharge descend même quand Chopper reste au banc — c'est bien là que la Traque se joue,
    et sans ce champ elle ne revenait jamais.

### Deidara — 240 HP

- **Argile Explosive C1** (60 ATK) — *« applique le statut Bombe d'Argile à la cible. (Une
  seule cible peut porter ce statut à la fois). »*
  - Moteur : statut custom `deidara-bombe-argile` (`data.stacks`), posé seulement si les
    dégâts passent (esquive = pas de bombe posée). Stacke jusqu'à 3 sur la même cible
    (plafond confirmé avec l'utilisateur — la carte ne décrit que 3 paliers de dégâts). Si
    un AUTRE ennemi porte déjà la bombe, elle se **déplace** sur la nouvelle cible touchée :
    l'ancien porteur perd le statut et tous ses stacks (confirmé avec l'utilisateur).
- **Détonation : Katsu !** (active, utilisable du banc) — *« Deidara fait exploser le
  personnage adverse qui porte le statut Bombe d'Argile. […] Si la cible est sur le poste
  actif : […] inflige 50 dégâts pour une bombe, 80 pour 2 bombes, 120 pour 3 bombes. Si la
  cible est sur le banc : inflige 40 dégâts à la cible ET 20 dégâts à tous ses alliés. »*
  - Moteur : cible auto-détectée (l'unique porteur adverse de la bombe, pas de prompt de
    ciblage) ; `condition` refuse l'activation si personne ne la porte. Le statut est retiré
    dès la détonation, quelle que soit la branche. Branche banc : dégâts fixes (pas de mise
    à l'échelle avec les stacks), splash sur tous les autres personnages adverses (actif
    compris).

### Dio Brando — 200 HP

- **Chair Vampirique** (attaque) — 50 ATK, *« 50% d'appliquer Silence Passif 1 tour »* →
  jet annoncé à 50 %, puis `silence-passive` avec `remainingTurns: 2` (le +1 des statuts
  bloquants posés sur l'ennemi).
- **Chair Vampirique** (passive, `afterDamage`) — *« Dio récupère en PV 30% des défâts qu'il
  inflige avec ses attaques. »*
  → 30 % de `amount + shieldAbsorbed` : **le bouclier encaissé compte comme des dégâts
  réellement infligés** (règle confirmée par l'auteur) — Dio se nourrit du coup porté, pas
  de ce qui a fini par passer les protections. Se déclenche sur chaque instance de dégâts
  dont il est la source, plusieurs fois par tour si besoin (attaque supplémentaire,
  partenaire lié), et depuis le banc. Dio n'a aucune capacité qui inflige des dégâts, donc
  « avec ses attaques » est vrai sans filtrage supplémentaire.
- **Za Warudo !** (active, 1×/partie) — *« Tu rejoues un second tour complet d'affilée une
  fois ce tour terminé pendant le tour arrêté, les dégâts de Dio sont réduit de 50%
  Utilisable 1x »*
  → **Ajout moteur** : `ctx.grantExtraTurn()` pose `state.pendingExtraTurnFor`, que `endTurn`
  consomme pour rouvrir un tour au même joueur au lieu de passer la main. Consommée **avant**
  de relancer `startTurn`, donc une seule pose ne peut jamais donner deux tours bonus.
  → Le tour bonus est un **vrai** tour : poisons, brûlures, saignements et recharges tiquent
  une seconde fois (règle confirmée par l'auteur). `turnNumber` ne bouge pas — la manche n'a
  pas fait le tour des deux joueurs.
  → Concrètement : **le joueur de Dio joue deux tours d'affilée et l'adversaire saute le
  sien**. Le premier (celui où la capacité est lancée) est un tour **normal, à 100 % des
  dégâts** ; c'est le **second**, le « tour arrêté », qui porte les contreparties.
  → Le -50 % pèse sur **toute l'équipe de Dio**, pas seulement sur lui : statut générique
  `atk-multiplier` (`multiplier: 0.5`), avec `ticksOnBench` (cinq des six porteurs sont au
  banc, où les durées seraient sinon suspendues).
  → Le **décalage d'un tour** passe par un `onExpire` : la capacité pose un marqueur caché
  (`dio-za-warudo-imminent`, `remainingTurns: 1`) qui expire au tout début du tour bonus et
  pose le malus à ce moment-là. Comme `onExpire` s'applique **après** la passe de décompte,
  le malus n'est pas décompté à son arrivée : il vit exactement le tour arrêté et disparaît
  au tick d'ouverture du tour suivant de Dio. Un `atk-multiplier` posé directement pénalisait
  au contraire la **fin du tour de lancement** (bug corrigé).
  → **Aucun switch pendant le tour arrêté**, dans aucun camp et switchs forcés compris :
  marqueur `dio-temps-arrete` sur Dio (même décalage d'un tour, même `ticksOnBench`) lu par
  un modifier **`canSwitchAny`** — la seule portée évaluée dans `zones.switchActive`, donc
  la seule qui ferme aussi un `forceSwitch` de carte. Porté par Dio seul et pas par les
  douze personnages : les statuts de l'adversaire ne tiquent que pendant SES tours, or il
  n'en joue aucun entre les deux tours de Dio — un marqueur posé sur lui expirerait pendant
  son tour normal d'après. Le **remplacement d'un personnage KO** reste ouvert (ce n'est pas
  un switch), sans quoi un camp pourrait se retrouver sans actif et bloquer la partie. Si
  Dio meurt pendant le tour arrêté, le verrou tombe avec lui (le modifier ne vit que tant
  que la carte est en jeu) ; le -50 %, lui, est porté par chaque personnage et tient.

### Escanor — 340 HP

- **Énergie solaire** (passive, `onGameStart` + `onAttackDeclared`, banc) — *« Escanor
  commence la partie au cycle 1, et ne peut que utiliser l'attaque correspondant à son
  cycle actuel. Attaquer fait augmenter le cycle actuel de 1. »*
  → Le cycle est un compteur persistant (statut caché-mais-visible `escanor-cycle`,
  `data.cycle`, sans `remainingTurns` donc jamais retiré tout seul), posé à 1 sur
  `onGameStart` (utile s'il démarre au banc) et incrémenté sur chaque `onAttackDeclared`
  qui le concerne. Chacune des quatre attaques a son propre `condition()` qui la
  restreint au cycle correspondant — c'est ce mécanisme, pas un modifier `canAttack`, qui
  empêche de lancer une attaque hors cycle.
  → Le cycle 4 (Soleil) fait exception : au lieu d'incrémenter, l'event handler détecte
  son id d'attaque et repose directement le compteur à 1 (« Retourne au cycle 1 après
  avoir attaqué avec Soleil »).
- **Cycle 1 - Aube** (attaque, cycle 1) — 20 ATK, pas de texte imprimé.
- **Cycle 2 - Aura Solaire** (attaque, cycle 2) — 20 ATK, *« Annule 50 % des dégâts
  subits pendant un tour. »*
  → Pose un statut propre (`escanor-aura-solaire`, `remainingTurns: 1`, `ticksOnBench`)
  lu par un modifier `getIncomingDamageAmount` du personnage qui divise par deux tout
  dégât entrant tant qu'il est présent (même schéma que le bouclier de Blitzcrank, mais en
  pourcentage plutôt qu'en réserve fixe). N'affecte pas la Valeur Lock (le texte ne parle
  que de « dégâts »).
- **Cycle 3 - Vague Solaire** (attaque, cycle 3) — 15 ATK, *« Inflige 15 dégâts à
  l'ensemble du banc adverse. »*
  → ⚠️ Écart texte/moteur confirmé par l'auteur : touche aussi l'actif adverse, en plus de
  tout le banc. Le texte imprimé, lui, ne mentionne que le banc.
  → ⚠️ Les deux moitiés n'ont pas le même montant : l'actif encaisse l'**ATK effectif**
  (`ctx.getEffectiveATK`, donc buffs et malus d'attaque compris), le banc encaisse les
  **15 dégâts imprimés**, secs. C'est voulu : un boost d'attaque ne doit pas démultiplier
  une AoE de banc.
- **Cycle 4 - Soleil** (attaque, cycle 4) — 150 ATK, *« Retourne au cycle 1 après avoir
  attaqué avec Soleil »* → remise à 1 gérée par Énergie solaire (voir plus haut), pas dans
  l'`execute()` de l'attaque elle-même.
- **Orgueil absolu** (active) — *« Réussite (45 %) : Augmente d'un cycle / Échec (45 %) :
  Recule d'un cycle. S'il est déjà au cycle 1, ne peut pas infliger de dégâts ce tour. /
  Orgueil Ultime (10 %) : Passe au cycle 4 directement. »*
  → Ne ferme pas le tour (défaut moteur, rien dans le texte ne dit le contraire) :
  Escanor peut donc enchaîner avec une attaque du nouveau cycle dans la foulée.
  → ⚠️ Le moteur n'a pas de roue à trois issues : implémenté par deux `ctx.rollChance`
  successifs (confirmé par l'auteur) — d'abord 10 % pour Orgueil Ultime, puis, seulement
  en cas d'échec de ce premier jet, 50 % pour Réussite (50 % de 90 % restants = 45 %
  global, donc les probabilités globales 45/45/10 sont exactes). Deux roues de % sont
  donc affichées à l'écran au lieu d'une seule.
  → Cycle 4 déjà atteint + Réussite : reste au cycle 4, aucun autre effet (confirmé par
  l'auteur — pas de comportement symétrique au cas du cycle 1).
  → Distribution vérifiée sur 300 parties (une utilisation chacune, depuis le cycle 1) :
  46,3 % de montée, 9,3 % d'Orgueil Ultime, 44,3 % d'échec — conforme au 45/45/10 imprimé.
  ⚠️ Vu du joueur, « le cycle a monté » couvre **deux** issues (Réussite ET Orgueil Ultime
  depuis le cycle 3), soit 55 % : cinq montées d'affilée arrivent une fois sur vingt.
  → Cycle 1 déjà atteint + Échec : pas de décrément (resterait sous 1), remplacé par le
  statut générique `disarmed` pendant 1 tour (retiré avant son tour suivant, donc actif
  seulement pour le reste du tour en cours).

### Guts — 250 HP

- **Coup d'épée** (50 ATK) — *« Se soigne de 25. »*
  - Moteur : texte carte sur l'effet secondaire seulement (même convention que Soraka) —
    l'ATK 50 affiché inflige les dégâts, implicite. Inflige puis se soigne de 25,
    inconditionnellement (le soin n'est pas subordonné à ce que le coup touche).
- **Berserk** (passive, `afterDamage`, banc) — *« Tous les 100 HP que Guts perd au cours de
  la partie, "Coup d'épée" inflige 50 dégâts supplémentaires de façon permanente. »*
  - Moteur : compteur cumulé dans un statut caché (`data.count`) qui ne redescend jamais,
    même après un soin ; le bonus lui-même passe par un modifier `getEffectiveATK`. Le
    compteur est privé à la carte : il ne peut pas être volé par Aizen ou la Poupée Voodoo.

### Gojo Satoru — 190 HP

- **Blackflash** (55 ATK) — *« Inflige 55 dégâts à l'actif adverse. 33% de chance de
  critique. »* → modifier `getCriticalPercent` (au lieu des 2 % de base).
- **L'Infini** (passive) — *« Gojo bénéficie en permanence de l'effet Esquive, qu'il soit
  actif ou au banc. »*
  - Moteur : modifier `getEvasionPercent` au taux de l'effet Esquive
    (`EVASIVE_STATUS_CHANCE_PERCENT`, 20 %), pas un statut `evasive`. Donc il tient dès le
    premier coup de la partie, survit à une résurrection, et ne peut être ni dissipé ni
    volé. La constante est lue, pas recopiée : rééquilibrer l'esquive emporte l'innée avec
    elle, comme le promet le texte (« l'effet Esquive »).
  - Le modifier porte `silencedByPassive: true` : c'est une **passive imprimée**, donc un
    `silence-passive` ou un `silence-ultimate` sur Gojo la coupe et le ramène au 1 %
    d'esquive de base. Sans ce champ, un modifier ne passe jamais par `canUseAbility` et la
    passive survivait au silence (bug corrigé). Le modifier `getCriticalPercent`, lui, porte
    le texte d'une **attaque** (Blackflash) : le silence passif ne le touche pas.
- **Extension du Territoire** (active, 1×/partie) — *« Inflige Stun au personnage actif
  adverse pendant son prochain tour. Utilisable une seule fois par partie. »*
  - Moteur : statut `stun` à `remainingTurns = 2` (le `+1` des statuts bloquants).

### Gon — 80 HP — carte évolutive (Gon Adulte)

- **La Pierre** (40 ATK, pas de texte) — description implicite.
- **Sermet de Vengance** (passive, `['onGameStart', 'onTurnStart', 'onCharacterKO']`) —
  *« Au début de la partie, une carte adverse est secrètement désignée comme Cible (révélée
  au Tour 10 à l'adversaire). Si la Cible est éliminée, Gon évolue en Gon Adulte et soigne
  tous ses PV. »*
  - Moteur : **une seule** capacité imprimée qui surveille trois moments, avec un `switch`
    sur `ctx.event.name` — une capacité par event afficherait trois fois la même ligne sur
    la carte. `usableFromBench: true` et `usesPerTurn: Infinity` : Gon peut très bien être
    au banc à la désignation, au tour 10, ou quand la Cible meurt.
  - **Désignation** (`onGameStart`) : **personne ne choisit**. Le moteur tire la Cible au
    sort (`pickRandom(ctx.state.rng, ...)`) parmi les personnages adverses (actif + banc
    soumis à `canTargetBench`). Aucune question n'est posée : la mise en place ne s'arrête
    pas dessus.
  - **Le secret.** La mémoire est un statut `hidden` — ni badge, ni ligne — porté par
    **Gon lui-même** (`gon-cible-record`, `data.targetInstanceId`). Sur la victime, il
    aurait disparu avec elle au cimetière, exactement au moment où il faut le relire.
    Le camp de Gon, lui, apprend sa Cible **tout de suite** : une ligne de journal
    `data.privateTo = ctx.ownerId`, que `getPlayerView` retire de la vue de l'adversaire
    (c'est la seule carte du jeu à se servir de ce canal privé, avec Caméléon).
  - **Révélation** (`onTurnStart`, `state.turnNumber >= 10`) : pose alors un statut bien
    visible `gon-cible` (« Cible de Gon ») sur la victime, avec `skipEvasionRoll` — une
    désignation ne s'esquive pas — plus une ligne de journal. `>=` et pas `===`, pour qu'un
    Gon arrivé plus tard (Mode Pioche) ne rate pas définitivement la manche 10. Sautée si
    la Cible est déjà morte.
  - **Élimination** (`onCharacterKO`) : **n'importe quelle** mort de la Cible déclenche
    l'évolution — Gon, un allié, un poison, un tic de brûlure, ou même une carte de
    l'adversaire. Le tueur n'est jamais consulté.
  - *« soigne tous ses PV »* : le plafond est déjà celui de Gon Adulte (300) quand le soin
    part, donc Gon ressort systématiquement à 300/300 — 80 PV de base plus 220 gagnés au
    passage. C'est un vrai `heal`, il retire donc `bleed`.
  - Après l'évolution la carte est `gon-adulte`, qui ne déclare plus cette passive : les
    branches « révélation » et « élimination » s'éteignent d'elles-mêmes, sans garde à
    écrire. La mémoire cachée est quand même nettoyée avant l'appel.
- Deck : seul `gon` est dans `DEMO_ROSTER`. `gon-adulte` est enregistrée pour que
  `evolveCharacter` la trouve, mais `evolvesTo` la sort du pool et du quota.

### Gon Adulte — 300 HP — forme évoluée de Gon (jamais en deck)

- **Jajanken Ultime** (115 ATK, pas de texte) — description implicite. La plus grosse
  attaque du pool.
- **Sermet de Vengance** (passive, `onTurnEnd`) — *« Contrat de Mort : Gon Adulte subit 30
  dégâts auto-infligés à la fin de chacun de ses tours »*
  - Moteur : `ctx.event?.playerId === ctx.ownerId` (fin de **son** tour, pas de celui d'en
    face), et **`usableFromBench` volontairement absent** — `canUseAbility` exige alors le
    poste actif, donc **le contrat cesse de saigner dès qu'il se replie au banc**. Le repli
    est la vraie échappatoire de la carte.
  - Les 30 dégâts passent avec `{ ignoreShield: true, ignoreDamageReduction: true }` : coût
    que le camp se paie à lui-même, un bouclier ne doit pas le rendre gratuit. Ils peuvent
    le tuer.
  - Même nom imprimé que la passive de la carte de base, mais un id distinct
    (`contrat-de-mort`) — de toute façon `evolveCharacter` remet les compteurs d'usage à
    zéro, donc un id partagé n'aurait pas été un piège ici.
- **Téléportation** (active, 1×/partie, depuis le banc) — *« Peut passer du banc au terrain
  (utilisable 1x) depuis le banc »*
  - Moteur : `usableFromBench: true`, `usesPerGame: 1`, `forceSwitch(ownerId, soi-même)`.
    La `condition` refuse l'activation s'il tient déjà le poste actif.
  - `endsTurn` laissé au défaut des capacités (**false**) : il monte gratuitement et peut
    enchaîner Jajanken Ultime dans le même tour. En contrepartie, monter au front rallume
    le Contrat de Mort dès la fin de ce tour-là.

### Hulk — 500 HP

- **Smash** (30 ATK) — *« Inflige 30 dégâts à l'actif adverse. »*
- **Enervement** (passive, `afterDamage`, banc) — *« Chaque fois que Hulk subit une instance
  de dégâts (actif ou banc), il s'énerve et gagne 30 dégâts d'attaque de façon
  permanente. »*
  - Moteur : même montage que Berserk (compteur caché + `getEffectiveATK`). Compte les
    *instances* de dégâts, pas les points : un tic de brûlure vaut autant qu'une grosse
    attaque.

### Itachi — 210 HP

- **Katon (Boule de Feu)** (40 ATK) — *« A 60% d'appliquer Burn pendant un tour »*
  - Moteur : jet de brûlure seulement si les dégâts passent (comme Heavy Point de Chopper).
- **Sharingan** (passive, purement descriptive) — *« Bénéficie de l'effet esquive »*
  - Moteur : modifier `getEvasionPercent` (`Math.max(current, EVASIVE_STATUS_CHANCE_PERCENT)`),
    exactement le montage de Kakashi / L'Infini de Gojo, avec `silencedByPassive: true`.
- **Illusion des Corbeaux** (passive, `onAttackDeclared` + `onAbilityUsed`) — *« Des plumes
  s'accumulent sur les personnages adverses (max 5) : […] 3 plumes : Est réduit au Silence
  Ultime pendant un tour. 5 plumes (Tsukuyomi) : est Stun pendant 1 tour, puis toutes ses
  plumes sont consommées. »*

  ⚠️ **Trois points confirmés avec l'utilisateur avant implémentation**, le texte imprimé
  étant ambigu :

  - **Pas de `usableFromBench`** : la surveillance (attaque sur Itachi = +1 plume, capacité
    active adverse = +3 plumes, quelle que soit sa cible) ne tourne que quand **Itachi
    lui-même est actif** (comme Aki / Vision du Futur), pas en permanence comme
    Guts/Hulk/Kakashi.
  - **Silence Ultime à 3 plumes ne se redéclenche pas en boucle** : il ne s'applique qu'au
    moment précis où le compteur franchit 3 depuis un état < 3. Rester à 3-4 plumes ensuite
    ne fait plus rien tant que 5 n'est pas atteint.
  - **Priorité à Tsukuyomi si un seul gain franchit les deux seuils d'un coup** (ex : 2 → 5
    via une capacité active) : seul le stun + reset se déclenche, le palier 3 plumes est
    ignoré dans ce cas précis.

  Moteur : compteur porté par un statut custom `itachi-corbeaux-plumes` (`data.count`), par
  personnage adverse (pas un pool partagé) — retiré entièrement (pas remis à 0) par
  Tsukuyomi. `onAttackDeclared` et `onAbilityUsed` partagent le même champ
  `event.data.characterInstanceId`, donc une seule ability couvre les deux gains ; le gain
  "capacité active" n'exige pas que la cible de la capacité soit Itachi (le payload de
  l'event ne porte pas cette information).

### Izuku de l'Académie — 280 HP

- **Texas Smash** (60 ATK) — *« Inflige 60 dégâts à l'actif adverse. »*
  - La carte d'origine n'imprime aucun texte sous cette attaque : c'est la phrase standard
    des attaques simples du pool (Kirigiri, Guts, Mundo, Kakashi…), pas un ajout d'effet.
- **Nouvel Alter** (active) — *« Izuku utilise son alter pour infliger 60 dégâts en plus ce
  round, mais il se blesse aussi de 80hp. »*
  - Moteur : `atk-boost` de +60 avec `remainingTurns: 1` et `ticksOnBench: true`. Posé sur
    soi pendant son propre tour, le premier tick n'a lieu qu'au tour suivant d'Izuku — la
    valeur `1` couvre donc exactement « ce round », comme Potion force. `ticksOnBench` évite
    qu'un passage au banc juste après ne gèle le buff et le ramène intact bien plus tard.
  - Moteur : les 80 HP passent par `dealDamage` avec `ignoreShield` + `ignoreDamageReduction`
    — sinon un bouclier sur Izuku absorberait la blessure et l'alter deviendrait gratuit.
  - Moteur : **aucune limite de partie** (la carte n'en écrit pas) : le défaut du moteur
    d'une utilisation par tour s'applique, et le vrai frein reste le coût en HP.
  - Moteur : **pas** de garde-fou anti-suicide, contrairement au Soin Sacrificiel de Soraka :
    Izuku a le droit de se tuer avec son propre alter (choix assumé).

### Kakashi — 250 HP

- **Raikiri** (60 ATK) — *« Inflige 60 dégâts à l'actif adverse. »*
- **Sharingan** (passive) — *« Kakashi bénéficie en permanence de l'effet Esquive, qu'il
  soit actif ou au banc. »* → même montage que L'Infini (modifier `getEvasionPercent` +
  `silencedByPassive: true`, donc coupé par un silence passif / ultime).
- **Copie de Technique (mémoire)** (passive, `onAttackDeclared`, banc) — mémorise la dernière
  attaque adverse dans un statut caché. Purement interne, aucune action pour le joueur.
- **Copie de Technique** (active, 1×/partie) — *« Rejoue immédiatement la dernière attaque
  utilisée par l'adversaire, mais lancée par Kakashi. Utilisation unique. »*
  - Moteur : l'attaque est réexécutée avec Kakashi comme source. Une attaque adossée à un
    compteur propre à son porteur d'origine (Berserk, Enervement) rend donc moins.

### Katarina — 240 HP

- **Shunpo** (65 ATK, `endsTurn` dynamique) — *« Inflige 65 dégâts à l'actif adverse. Si des
  dégâts passent, 33% de chance de désarmer la cible pendant 1 tour. »*
- **Voracity** (passive) — *« Si Katarina tue un personnage ennemi avec Shunpo, elle peut
  immédiatement attaquer de nouveau ce tour. »*
  - Moteur : pas un vrai passive déclenché — c'est l'`AttackDef` qui écrit dans `ctx.scratch`
    et `endsTurn(ctx)` qui relit ce drapeau. Vaut pour une relance, pas une chaîne infinie.

### Kayn — 240 HP — carte évolutive (Rhaast / Kayn assassin)

- **Faux** (40 ATK, pas de texte) — description implicite.
- **Faux du Darkin** (passive, purement descriptive) — *« Après 3 attaques, kayn de
  transforme immédiatement, selon la voie qu'il a choisi. Double ses hp actuels lors de la
  transformation. »*
  - Moteur : le compteur et la transformation vivent dans l'`AttackDef`, pas dans un
    trigger. Il n'existe pas d'event « après attaque », et le 3ᵉ coup doit être porté par
    Kayn (40 ATK) avant que la forme évoluée n'arrive — un `onAttackDeclared` aurait fait
    frapper la forme évoluée dès le 3ᵉ coup.
  - Le compteur est un statut caché `kayn-faux-count` (`data.count`) **sans**
    `remainingTurns` : jamais retiré par la passe de décompte, il survit aux allers-retours
    au banc. Les 3 attaques n'ont pas à être consécutives, et une attaque esquivée compte
    quand même (c'est le coup porté qui est compté, pas le coup qui touche).
  - **« Double ses hp actuels » = un soin, plafonné aux PV max.** Les trois formes sont à
    240 PV max, donc la transformation soigne exactement les PV restants : un Kayn à 200 PV
    ressort à 240/240, un Kayn à 80 PV à 160/240. Le plafond ne monte jamais au-dessus de
    240 (au-delà de ce que d'autres cartes lui auraient déjà ajouté, cf. la conservation
    de l'écart de PV max par `evolveCharacter`).
  - Ce soin est un vrai `heal` : il retire donc `bleed`, comme n'importe quel soin.
- **Eveil du Darkin** (passive, `onBecomeActive`) — *« Dès que Kayn est posé, le joueur
  décide si Kayn choisi la voie de Rhaast ou la voie de l'assassin. »*
  - Moteur : il n'existe pas d'event « personnage posé » (tout le monde est en jeu dès le
    départ), donc la question part à l'**arrivée au poste actif**, actif de départ compris
    (`reason: 'setup'`). Elle est posée **une seule fois** : la réponse est rangée dans le
    statut caché `kayn-darkin-path` (`data.cardId`), et la `condition` de la passive refuse
    de la reposer tant que ce statut est là. Kayn ne peut donc pas changer d'avis en
    repassant par le banc.
  - Le choix est annoncé dans le journal (les deux camps le voient) ; le statut, lui, est
    `hidden` — un badge en plus n'apprendrait rien.
  - La modale affiche les **illustrations** de Rhaast et de Kayn assassin (`card` sur chaque
    `ChoiceOption`), pas deux boutons de texte.
  - Filet de sécurité : si Kayn arrivait sous `silence-passive` / `silence-ultimate`, la
    question n'est pas posée à ce moment-là — elle l'est alors au 3ᵉ coup, juste avant la
    transformation, plutôt que de bloquer l'évolution pour le reste de la partie.
- Deck : seul `kayn` est dans `DEMO_ROSTER`. Les deux formes sont enregistrées
  (`registerCard`) pour que `evolveCharacter` les trouve, mais `evolvesTo` les sort du pool
  et du quota — le deck-builder les montre en vignettes non sélectionnables sous Kayn.

### Kayn assassin — 240 HP — forme évoluée de Kayn (jamais en deck)

- **Faux Bleu** (60 ATK, pas de texte) — description implicite.
- **Disciple de l'ombre** (passive, purement descriptive) — *« Les attaques de kayn
  infligent 25% des hp max en dégâts bonus. »*
  - Moteur : **25 % des PV max de la CIBLE** (`currentMaxHP`, donc après un éventuel valeur
    lock), pas de Kayn. Contre un 240 PV, Faux Bleu tape 60 + 60 = 120.
  - Le bonus est **fondu dans la même instance de dégâts** que l'attaque : un bouclier
    l'absorbe d'un bloc, une esquive annule le tout, un critique multiplie l'ensemble.
  - Pas de modifier `getEffectiveATK` : cette requête ne connaît que l'attaquant, jamais la
    cible. Le bonus est donc calculé dans l'`AttackDef`, avec un garde explicite
    `isSilencedPassive()` — sans lui, une passive imprimée aurait survécu au silence passif
    (c'est exactement ce que `silencedByPassive` fait pour un modifier).
- **Ruée de l'ombre** (active, 1×/partie) — *« Kayn assassin échange sa place avec une carte
  du banc, et se soigne de 60hp. Utilisable une fois »*
  - Moteur : `usesPerGame: 1`, `endsTurn` laissé au défaut des capacités (**false**) — le
    repli est gratuit, le personnage qui monte peut encore agir dans le même tour.
  - Le joueur choisit la carte du banc sur le plateau (`select-characters`), puis
    `forceSwitch(ownerId, …)`. La `condition` refuse l'activation si le banc est vide.
  - Le soin de 60 PV va à **Kayn**, pas à la carte qui monte, et il est appliqué **avant**
    le switch : si le switch est refusé (Arène, `chained`, `canSwitchAny`), l'unique
    utilisation a quand même été payée, elle ne doit pas être perdue pour rien.

### Rhaast — 240 HP — forme évoluée de Kayn (jamais en deck)

- **Faux Rouge** (60 ATK, pas de texte) — description implicite.
- **Buveur de sang** (passive, `afterDamage`) — *« Heal de la moitié de ses dégâts
  infligés. »*
  - Moteur : se déclenche sur chaque instance de dégâts dont Rhaast est la source
    (`usesPerTurn: Infinity`, `usableFromBench: true`), et rend `floor(amount / 2)`.
    `amount` = les dégâts **réellement encaissés**, après bouclier et réductions : un coup
    entièrement absorbé ne soigne rien.
  - Garde explicite : le coût en PV de « Soif de sang » frappe un **allié**, il ne doit pas
    soigner Rhaast. La condition exige donc que la victime appartienne au camp adverse.
- **Soif de sang** (active) — *« Sacrifie la moitié des hp actuels d'une carte allié sur le
  banc pour infliger 50 dégâts supplémentaires à la prochaine attaque. »*
  - Moteur : coût = `floor(PV actuels / 2)` de l'allié choisi, infligé avec
    `{ ignoreShield: true, ignoreDamageReduction: true }` (coût que le camp se paie à
    lui-même : ni bouclier ni réduction ne doivent l'absorber). Arrondi vers le bas, donc le
    sacrifice **ne tue jamais** l'allié.
  - Les alliés proposés passent par `canTargetBench` (Bouclier Ultime, Arène peuvent les
    mettre hors de portée) et doivent avoir au moins 2 PV actuels — en dessous, la moitié
    arrondie vaut 0 et la capacité serait gaspillée.
  - Le bonus est un statut visible `rhaast-soif-de-sang` (`data.amount: 50`) **sans durée** :
    il attend la prochaine « Faux Rouge », même à un tour ultérieur.
  - **Non cumulable** : la `condition` refuse l'activation tant que le bonus n'a pas été
    consommé, plutôt que de laisser gaspiller les PV d'un second allié.
  - Le bonus est consommé par l'attaque **qu'elle touche ou soit esquivée** — les PV de
    l'allié ont déjà été payés (même parti pris que Godspeed de Killua).

### Killua — 240 HP

- **Narukami** (60 ATK) — *« Inflige 60 dégâts à l'actif adverse ; si le coup touche, 33% de
  chance de le désarmer pendant 1 tour. »*
- **Godspeed** (passive, `onBecomeActive`) — *« Lorsque Killua devient le personnage actif
  via un switch, la première attaque qu'il effectue lors de ce tour inflige obligatoirement
  un coup critique. »*
  - Moteur : statut `critical` avec `data.percent = 100`, consommé au premier coup. Exclut
    explicitement `reason: 'setup'` — l'actif de départ ne l'arme pas.

### Kirigiri — 300 HP

- **Déduction Froide** (90 ATK) — *« Inflige 90 dégâts à l'actif adverse. »*
- **Ultimate Détective** (active, 1×/partie) — *« Révèle définitivement toutes les cartes
  objets et terrains non jouées de l'adversaire pour le reste de la partie. Utilisation
  unique. »*
  - Moteur : bascule un drapeau de révélation lu par `view.ts` ; la révélation vaut aussi
    pour les cartes que l'adversaire piochera ensuite.

### Light Yagami — 290 HP

- **Écriture du Nom** (0 ATK) — *« Pose une marque "Nom" sur le personnage actif adverse.
  Octroi au prochain tour esquive à light »*
  → `baseATK: 0` : aucun dégât, seulement une marque "Nom" de plus sur l'actif adverse (via
  `addNameMark`, le même point de passage que "Serment de Vengeance" ci-dessous). Esquivable
  (`ctx.rollEvasion` roulé **avant** de toucher au compteur — voir plus bas pourquoi).
  → Pose aussi le statut générique `evasive` sur **Light lui-même**, `remainingTurns: 1`,
  **sans** le `+1` des statuts bloquants : ce n'est pas un débuff posé sur l'ennemi, c'est un
  buff sur soi qui doit couvrir exactement le tour adverse qui suit. Un statut d'un
  personnage n'est décompté qu'au tick d'ouverture du tour de SON propre camp — donc posé
  pendant le tour de Light, il traverse tout le tour adverse intact et n'est retiré qu'au
  tick d'ouverture du tour SUIVANT de Light, avant même qu'il rejoue. `ticksOnBench: true`
  au cas où Light se retrouve benché entre-temps (sans quoi le décompte gèlerait).
  → Termine le tour comme n'importe quelle attaque, donc "Serment de Vengeance" (qui tique à
  la fin du tour de Light) pose souvent une **deuxième** marque dans la foulée — les deux
  sources ne s'excluent pas, une Écriture peut ajouter 2 marques d'un coup.
- **Serment de Vengeance** (passive, `onTurnEnd`) — *« À la fin de ton tour, pose 1 marque
  "Nom" sur le personnage actif adverse. À 8 marques, il subit une crise cardiaque et la
  carte Meurt »* *(le nom de la capacité, "Sermet", reprend une coquille de la carte
  d'origine — volontairement conservée)*
  → Tique à la fin de **chaque tour de Light lui-même** (`ctx.event.playerId ===
  ctx.ownerId`), et seulement s'il tient le poste actif à ce moment-là — pas de
  `usableFromBench`, donc `canUseAbility` l'exige déjà, la `condition` ne fait que le
  documenter. Passe par `addNameMark`, comme Écriture du Nom.
  → Marques dans un statut custom `light-yagami-marque-nom` (`data.count`), **sans**
  `remainingTurns` (compteur tenu par la carte, pas un décompte du moteur, cf. le pattern du
  compteur persistant dans CLAUDE.md) et volontairement **visible** : l'adversaire doit
  pouvoir décider de fuir à temps. À 8, `koCharacter` — une mort hors du circuit des dégâts,
  donc ni bouclier, ni réduction, ni `death-ward` ne l'empêchent (même convention que
  l'ancienne "horloge").
  → **L'esquive se roule AVANT de toucher au compteur** (`ctx.rollEvasion`, puis
  `applyStatus(..., {skipEvasionRoll:true})` pour la repose) : sans ça, `applyStatus` aurait
  roulé sa propre esquive lors de la repose, et un jet perdu à ce moment-là (après le
  `removeStatus` de l'ancienne instance, faute d'API "update") aurait effacé les marques déjà
  posées au lieu de simplement ne pas en ajouter une nouvelle. Même pattern que Marteau de
  Locke.
  → Ne se remet **jamais** à zéro tant qu'aucun switch n'a lieu, y compris si l'actif
  adverse change de personnage d'un côté puis revient (les marques suivent l'**instance de
  personnage**, pas "l'actif adverse" en général) : seul "Contrainte" les efface.
- **Contrainte** (passive, `onSwitch`) — *« Switcher vers le banc efface les marques du
  personnage qui fuit. En contrepartie, le personnage qui fuit subit 50 dégâts par marque
  effacée »*
  → Se déclenche sur **tout** changement d'actif adverse, volontaire **comme forcé par une
  carte, mais jamais sur le remplacement d'un mort** : `onSwitch` n'est émis que par
  `zones.switchActive`, le remplacement après KO passant par `onBecomeActive` seul. Demande
  aussi que Light Yagami tienne le poste actif.
  → Vise uniquement **le personnage qui fuit** (`previousActiveInstanceId`) : ses marques
  sont retirées et il encaisse `50 × marques effacées` en dégâts **ordinaires** (esquivables,
  absorbables par un bouclier — contrairement à la mort par crise cardiaque, ce n'est pas un
  KO hors-circuit). Rien ne touche l'entrant : contrairement à l'ancienne version de la
  carte, ses propres marques (s'il en avait déjà) ne sont **pas** effacées. Sans marque sur
  le fuyard, la passive ne fait rigoureusement rien (pas de dégâts à 0, pas de log).
- **Manipulation** (active, 1×/partie) — *« Force le personnage actif ennemi à retourner sur
  le banc. L'adversaire doit envoyer un nouveau personnage de son choix sur le terrain
  Utilisable une fois »*
  → Complètement réécrite : ce n'est plus un blocage de switch (l'ancienne version posait un
  statut d'emprise via `canSwitchStandard`), c'est un **switch forcé** de l'actif adverse.
  `ctx.forceSwitch(ctx.opponentId, ...)` passe par `zones.switchActive`, qui referme
  lui-même la porte sur un actif enchaîné ou explicitement bloqué -- rien à revérifier ici.
  → **C'est l'adversaire qui choisit son remplaçant**, pas Light : `ctx.chooseOptionFor`
  adresse la question à `ctx.opponentId` avec les illustrations des personnages du banc
  (`card` sur chaque option, même pattern qu'Offrande du Dieu de la Mort). `ctx.choose`
  (`kind: 'select-characters'`) ne sait interroger que le propriétaire de l'effet, donc pas
  utilisable pour une carte qui demande à l'ADVERSAIRE de choisir.
  → `usesPerGame: 1`, sans recharge : refermée pour le reste de la partie dès la première
  utilisation, plutôt que revenir après un cooldown. Indisponible si l'adversaire n'a
  personne sur le banc (`condition`) — sans ça, `forceSwitch` n'aurait personne à faire
  entrer.

### Levi — 220 HP

- **Taillade éclair** — 90 ATK, pas de texte. Peut viser le banc affaibli via Traque.
- **Frappe à la nuque** — 60 ATK, *« Cette attaque peut crit »* → **convention maison : la
  mention « peut crit » vaut 33 % de chance de critique** (contre 2 % de base pour toute
  autre attaque). Implémentée avec le statut générique `critical` et son `data.percent`,
  posé puis retiré autour du coup (même primitive que Godspeed de Killua) — sauf si Levi
  portait déjà un `critical` venu d'ailleurs, qu'il ne faut ni écraser ni supprimer.
- **Traque** (passive, purement descriptive) — *« Si au moins un personnage sur le banc
  adverse a moins de 60 HP actuels, les attaques de Levi peuvent cibler ce personnage du
  banc, ignorant la restriction de ciblage par défaut. »*
  → Les **deux** attaques proposent l'actif adverse **plus** chaque personnage du banc
  adverse sous 60 PV actuels ; au-delà d'une cible, Levi choisit dans une fenêtre de
  ciblage sur le plateau. Le seuil est relu **à chaque attaque**, jamais mémorisé : un
  personnage soigné au-dessus de 60 PV redevient hors de portée.
  → Le banc reste soumis aux protections générales : Traque lève la **restriction de
  ciblage par défaut**, pas un refus posé par une carte adverse (Bouclier Ultime le protège,
  Arène l'isole).

### Locke — 250 HP

- **Purgatoire** (passive, `afterDamage` / `onSwitch` / `onBecomeActive` / `onTurnStart`) —
  *« Si l'ennemi au poste actif est à 10% de ses hp max ou moins, l'execute immédiatement. »*
  - Moteur : aura active uniquement quand **Locke est lui-même l'actif**
    (`usableFromBench` non déclaré, donc `canUseAbility` l'exige). La condition relit l'état
    courant de l'actif adverse (pas le payload de l'event), donc elle se déclenche quelle
    que soit la cause du passage sous le seuil : n'importe quelle instance de dégâts
    (`afterDamage` — attaque, ability, tic de poison/brûlure/saignement, pas seulement les
    coups de Locke), un switch/remplacement qui amène un survivant déjà sous le seuil
    (`onSwitch`/`onBecomeActive`, ex : rescapé d'une AoE), ou une perte de HP max pure
    (valeur lock) qui ne déclenche aucun `afterDamage` — rattrapée au `onTurnStart` suivant,
    filet de sécurité qui tourne à chaque tour (le sien comme celui de l'adversaire).
    Respecte `death-ward` (Détermination).
- **Cloué** (passive, descriptive) — *« Lorsqu'un ennemi a 3 clous sur lui, Locke fait
  exploser les clous infligeant 100 dégâts + 50% hp max. »*
  - Moteur : logique réellement codée dans Marteau ci-dessous (c'est la pose du 3e clou
    qui décide de l'explosion). "50% hp max" = 50% des HP max **de la cible**, pas de
    Locke. Les clous sont consommés par l'explosion (compteur remis à 0, pas de statut à
    réappliquer) ; il faut donc replanter 3 clous pour refaire exploser la même cible.
  - **Inesquivable** : le coup de Marteau qui plante le **3e** clou ne roule aucune esquive
    (sinon le clou ne serait pas planté et l'explosion n'aurait jamais lieu), et l'explosion
    elle-même part en `skipEvasionRoll`. La cible avait sinon **deux** occasions d'échapper
    au même effet. Le reste de l'instance de dégâts est inchangé : bouclier, réductions et
    critique s'appliquent normalement, et le KO est crédité à Locke.
- **Marteau** (0 ATK) — *« Locke enfonce un clou sur n'importe quel ennemi, même sur le
  banc. Cette attaque inflige a 65% de chance d'infliger silence ultime si Locke attaque
  l'ennemi actif. »*
  - Moteur : cible n'importe quel personnage adverse (actif ou banc) via un ciblage sur le
    plateau. Compteur de clous par cible dans un statut custom (`data.count`, affiché en
    label `Clou (n/3)`). Un seul jet d'esquive pour toute la résolution (clou + éventuel
    Silence Ultime), via `ctx.rollEvasion` avant de toucher au compteur -- contrairement à
    Zoé/Chopper/Sion qui roulent séparément dégâts puis effet sur coup, Marteau ne fait
    aucun dégât et n'a donc qu'un seul "coup" à esquiver. **Sauf sur le 3e clou**, où il
    n'y a aucun jet du tout : "Cloué" est inesquivable (voir ci-dessus), ce qui rend du même
    coup le Silence Ultime de cette frappe-là garanti à toucher. Le Silence Ultime (1 tour,
    `remainingTurns: 2`) ne peut se déclencher que si la cible est l'actif adverse au
    moment du clou, et se roule même sur le tour où la cible explose (les deux effets ne
    s'excluent pas).

### Mahito — 270 HP

- **Paume Transfiguratrice** (90 ATK) — *« Inflige 90 dégâts à l'actif adverse. »*
  - Moteur : `dealDamage(..., { asValeurLock: true })` — le coup reste esquivable, mais ce
    qui passe retire du HP **max**, donc jamais soignable. Un KO ainsi obtenu nomme bien
    Mahito comme tueur.
- **Altération de l'Âme** (passive) — *« Toutes les attaques de Mahito convertissent 100% de
  leurs dégâts directement en réduction de HP max. »* (descriptif : la mécanique est dans
  l'`AttackDef`.)
- **Marque** (passive) — *« Les PV retirés par Mahito ne peuvent plus jamais être récupérés,
  par aucun soin. »*
  - Moteur : Paume Transfiguratrice pose le statut générique `unhealable` sur la cible dès
    que le coup a réellement retiré du HP max (comparaison du `currentMaxHP` avant/après
    l'appel à `dealDamage` -- pas de marque sur un coup esquivé). `unhealable` est
    engine-recognized comme `death-ward`/`vulnerable` : `heal()` (match.ts) devient un
    no-op complet sur le porteur (y compris le nettoyage de bleed qu'un soin fait
    normalement), et ça survit à la mort de Mahito -- contrairement à un modifier porté
    par sa propre carte, qui cesserait d'être scanné dès qu'elle serait KO (voir
    `getInPlaySources`, queries.ts). N'est levé que par une résurrection, qui vide tous
    les statuts du personnage.

### Makima — 190 HP

- **Bang !** — *« Inflige 30 dégâts de plus par compétence alliée scellé (sacrifice) »*
  → 40 de base **+ 30 par sceau encore debout dans son camp**, via un modifier
  `getEffectiveATK` (et non une addition dans l'attaque) : buffs et malus d'ATK
  s'appliquent donc au total, comme pour Guts. Un allié sacrifié qui part au cimetière
  emporte ses sceaux : Bang ! redescend d'autant.
- **Sacrifice** (active, 1×/tour) — *« Au début du tour, Makima peut choisir de sceller
  (désactiver) au choix 1 Passif, 1 Actif ou 1 ATK d'un personnage sur son propre banc
  durant son tour »*
  → Le sceau est **permanent** (aucun `remainingTurns`) et **cumulable** : c'est ce qui
  alimente Bang ! et ce qui rend « 2 sacrifices requis » atteignable. Il vise **une seule
  compétence nommée**, pas une catégorie : ni `silence-active` ni `silence-passive` ni
  `disarmed` ne conviennent, ils ferment *tout* l'actif / *tout* le passif / *toute*
  attaque du personnage. Statut `makima-sceau` porté par le sacrifié, `data.sealedIds`
  accumulant les ids scellés ; deux modifiers de Makima refusent exactement ces ids
  (`canUseAbility` pour les compétences, `canAttack` pour les attaques). Grisée quand plus
  aucun allié du banc n'a quelque chose à sacrifier.
  → **Ajout moteur** : `canAttack` reçoit désormais un `attackId` optionnel dans son
  payload, sans quoi il était impossible de fermer une attaque précise sur un personnage
  qui en a plusieurs (Roi des esprits en a 3). Sans `attackId` — une requête qui jauge le
  personnage en général — le sceau ne refuse rien.
- **Manipulation** (active) — *« Pas Utilisable 2 tours de suite| 2 sacrifices requis /
  Désigne 1 carte du banc adverse. Au prochain tour, l'actif ennemi est forcé de
  l'attaquer, ce qui mettra fin à son tour. (L'activation de cette compétence met fin au
  tour de Makima). »*
  → Les 2 sacrifices sont une **condition d'accès, jamais consommée** : Bang ! garde son
  bonus après coup. Recharge : `remainingTurns: 2` + `ticksOnBench`, soit « utilisable au
  tour N, pas au N+1, de retour au N+2 ». Grisée sans actif adverse ou sans banc adverse à
  désigner. La cible désignée doit **toujours être sur le banc adverse** au moment de la
  résolution : morte ou promue actif entre-temps, la manipulation est simplement perdue.
  → **Ce que la résolution fait vraiment** : seuls les **dégâts** de l'attaque adverse sont
  retournés (ATK effectif de l'attaquant), pas le corps de son `execute()` — celui-ci vise
  en dur l'actif d'en face (poison, statuts, effets annexes) et le faire tourner sur un
  allié le ferait mentir. Si l'actif adverse a plusieurs attaques, **son propre joueur**
  choisit laquelle. C'est de l'amical : ni esquive ni critique (ils ne se jouent qu'entre
  camps adverses).
  → **Ajouts moteur** (deux, une carte ne pouvant ni agir pendant le tour d'en face ni
  fermer le tour d'un autre joueur) : le statut générique **`forced-attack`**
  (`data.targetInstanceId`), résolu par `turn.ts::resolveForcedAttack` au début du tour de
  son porteur puis consommé — quoi qu'il arrive ensuite ; et **`AbilityDef.endsTurn`**,
  jumeau de `AttackDef.endsTurn`, évalué après `execute()` sur le même contexte.
  → Conséquence de tempo à connaître : le tour de Makima se ferme sur l'activation, celui
  d'en face s'ouvre puis se referme aussitôt sur l'attaque retournée — **la main revient
  donc immédiatement à Makima**.

### Métamorphe — 60 HP

- **Gel gluant** (10 ATK) — *« Inflige 10 dégâts à l'actif adverse. »*
- **Métamorphose** (active, 1×/partie) — *« Devient définitivement une copie de l'actif
  adverse : ses attaques et ses capacités pour le reste de la partie. Utilisable une seule
  fois. »*
  - Moteur : réécrit le `cardId` **et** le `baseMaxHP` de l'instance (sans quoi une carte
    qui calcule un bonus sur l'écart `currentMaxHP - baseMaxHP`, comme la Surcroissance de
    Mundo, offrirait un bonus fantôme). Les dégâts déjà subis et les statuts en cours sont
    conservés ; le plafond de HP s'aligne sur la carte copiée via
    `raiseMaxHP`/`applyValeurLock`. Les modifiers de la carte copiée s'appliquent aussitôt
    (ils sont scannés à partir du `cardId`).

### Mundo — 400 HP

- **Hache Volante** (25 ATK) — *« Inflige 25 dégâts à l'actif adverse. »*
- **Surcroissance** (passive) — *« Son attaque gagne 10 de dégâts supplémentaires tous les
  100 HP max qu'il a en plus de ses 400HP max de base. »* → modifier `getEffectiveATK`
  calculé sur `currentMaxHP`, donc il redescend si Mundo subit du valeur lock.
- **Eveil** (active, 1×/partie) — *« Mundo gagne l'équivalent de ses HP manquants en HP max.
  Ensuite, il régénère instantanément la moitié de ses HP max. »*

### Muzan — 270 HP

- **Black Blood** (40 ATK) — *« Inflige 40 dégâts à l'actif adverse et applique Poison
  pendant 1 tour. »*
- **Sang Maudit** (passive) — *« Tant que Muzan est actif, le poison des personnages
  adverses ronge leurs HP max au lieu d'infliger des dégâts soignables. Redevient du poison
  normal dès que Muzan quitte le poste actif. »*
  - Moteur : modifier `poisonTicksAsValeurLock`, réévalué **à chaque tic**. S'applique quelle
    que soit la source du poison, y compris un poison qu'un autre camp aurait posé.

### Ornn — 600 HP

- **Récupération de matériaux** (40 ATK, scaling) — *« Inflige 40 dégâts supplémentaires par
  objet forgé. »* → l'ATK de base (40, implicite comme les autres attaques) pose aussi le
  statut caché de déblocage de Living Forge (texte porté par la passive "Matériaux", pas
  répété ici). Le bonus « par objet forgé » est un modifier `getEffectiveATK` qui ajoute
  40 par forge **réussie** (voir Living Forge (récompense) ci-dessous) — compteur permanent
  dans un statut caché, jamais remis à zéro, même schéma que le Berserk de Guts.
- **Matériaux** (passive) — *« Ornn ne peut pas utiliser "Living Forge" sans avoir utilisé son
  attaque "Récupération de matériaux" auparavant. »* (descriptif ; la garde est la
  `condition()` de Living Forge.)
- **Living Forge** (active) — *« Ornn construit un objet et est bloqué sur le poste actif
  pendant 3 tours, il ne peut ni attaquer ni switch. Si il est toujours vivant après les
  3 tours, récupérer un objet ou terrain au choix parmi les 2 cimetières. »*
  - Moteur : « construit un objet » est purement narratif — aucune carte objet n'est
    réellement créée, seul le blocage (`chained` + `disarmed`) est posé ; la récompense est
    un passive `onTurnStart` séparé qui lit un statut caché de suivi.
  - « 2 cimetières » = seulement les deux d'Ornn lui-même (objets, terrains) — il n'a plus
    accès aux cimetières adverses (avant : 4 cimetières, les deux camps).
- **Living Forge (récompense)** (passive, `onTurnStart`) — à chaque forge réussie (Ornn
  survit aux 3 tours de blocage, qu'il y ait ou non quelque chose à récupérer ensuite), le
  compteur de "Récupération de matériaux" progresse de +40 dégâts de façon permanente
  (voir ci-dessus), puis, si ses propres cimetières objet/terrain ne sont pas vides,
  récupère la carte choisie.
  - Le choix de la récupération passe par `ctx.chooseOption` avec un `card` par option : la
    modale montre les illustrations réelles des cartes récupérables, pas une liste de noms.

### Rengoku — 340 HP

- **Souffle du feu** (30 ATK) — *« Inflige 30 dégâts à l'actif adverse et, si le coup touche,
  le met en Brûlure pendant 2 tours. »*
  - Moteur : un seul jet d'esquive partagé (`ctx.rollEvasion` + `skipEvasionRoll`) pour les
    dégâts et la brûlure. Retoucher une cible déjà en feu **additionne les durées** sur
    l'instance existante (2 tours de plus par coup) au lieu d'en créer une deuxième : c'est
    la façon dont la brûlure « stack ». Les dégâts par tic restent fixes (50 HP), sinon deux
    instances tiqueraient le même tour et doubleraient les dégâts en silence.
- **La flamme** (passive) — descriptif, la brûlure est posée par l'attaque.

### Roi des esprits — 240 HP

- **Esprit de glace** (30 ATK) — *« … Si les dégâts passent, 65% de chance d'appliquer Stun
  pendant 1 tour. »*
- **Esprit de feu** (20 ATK) — *« … et applique Burn pendant 1 tour. »*
- **Esprit de soin** (0 ATK) — *« Soigne un personnage allié au choix (actif ou banc) de
  40 HP. »* — c'est une **attaque**, elle termine donc le tour comme les autres.
- **Explosion d'esprits** (active, 1×/partie) — *« Lance les 3 esprits en même temps. Ne peut
  pas attaquer ce tour. »* → pose `disarmed` pour le tour en cours.

### Sion — 500 HP

- **Hache géante** (35 ATK) — *« … Si des dégâts passent, 33% de chance de désarmer la cible
  pendant 1 tour. »*
- **Essence vitale** (active, banc, 1×/partie) — *« Sion gagne 50 de shield, augmenté de 50
  par personnage ennemi dans le cimetière adverse. »*
- **Guerrier mourrant** (passive, `onCharacterKO`, banc) — *« Lorsqu'il meurt, Sion attaque
  une dernière fois (Hache géante) le personnage actif ennemi. »*
  - Moteur : la carte réagit à sa **propre** disparition ; `usableFromBench: true` est
    obligatoire (elle n'est plus l'actif au moment de l'event).

### Soma — 220 HP

- **Couteau de Chef** (40 ATK) — *« Applique 1 de bleed »*
  - Moteur : statut garanti au contact (pré-jet d'esquive + `skipEvasionRoll`, comme
    Chainsaw Man / Sukuna) — pas de jet de chance, contrairement à Katon d'Itachi.
- **Menu Surprise** (active) — *« Ne peut pas être utiliser les 2 prochains tours après
  avoir été utilisé. Soma cuisine un plat mystérieux et force le personnage sur le poste
  actif adverse à choisir instantanément entre deux options : Manger le plat […] soigne de
  80 HP, mais […] Stun 1 tour. Refuser le plat […] subissez 50 dégâts et Silence passif
  pendant 1 tour »*
  - Moteur : rechargement = statut de cooldown à `remainingTurns = 2 + 1`, `ticksOnBench:
    true` (même montage que la Traque de Chopper). Le choix est posé à l'ADVERSAIRE
    (`chooseOptionFor`) sur son actif du moment — c'est lui qui subit les deux branches, pas
    Soma.
- **Sabotage de Recette** (passive, `onObjectPlayed`, banc) — *« Chaque fois que
  l'adversaire joue une carte Objet Soma réduit immédiatement la recharge de sa capacité
  Menu Surprise de 1 tour. »*
  - Moteur : `usableFromBench: true` (continue de réduire la recharge même si Soma est au
    banc) — lit et réécrit directement `remainingTurns` du statut de cooldown de Menu
    Surprise (pas d'API "update" : `removeStatus` puis `applyStatus` si le solde est encore
    positif, sinon la recharge disparaît et Menu Surprise redevient utilisable
    immédiatement).

### Soraka — 160 HP — incompatible avec Chopper

- Deck : `incompatibleWith: ['chopper']` — les deux soigneurs du pool ne peuvent pas être
  empilés dans le même deck. La relation est symétrique : elle n'est déclarée que sur
  Soraka, mais `listDeckPool()` la renvoie des deux côtés et le deck-builder grise donc
  aussi Soraka quand Chopper est déjà pris.
- **Don forcé** (50 ATK) — *« Inflige 50 dégâts à l'actif adverse, puis Soraka se soigne
  de 50. »*
- **Soin Sacrificiel** (active, banc) — *« Sacrifie 100HP pour rendre 150HP au personnage de
  votre choix. Utilisable sur le banc. Nécessite plus de 100HP actuels. »*
  - Moteur : le coût passe par `dealDamage` avec `ignoreShield` + `ignoreDamageReduction`,
    sinon le bouclier de Soraka rendrait la carte gratuite. La `condition()` interdit de se
    tuer avec.

### Sukuna — 250 HP

- **Lacération** (55 ATK) — *« Inflige 55 dégâts à l'actif adverse et applique 2 stacks de
  bleed. »*
  - Moteur : ré-appliquer bleed **additionne** les stacks (max 10). N'importe quel soin sur
    le porteur enlève le saignement avant qu'il ne tique.
- **Sort Inversé** (passive, `onTurnEnd`, actif seulement) — *« À la fin de ton tour, la
  carte récupère 30 PV si elle est sur le poste actif. »*
  - Moteur : plus de `usableFromBench` — le passif ne se déclenche donc plus que si Sukuna
    tient le poste actif à la fin du tour (défaut `canUseAbility` : actif uniquement).
- **Extention de territoire** (passive) — *« Tant que la carte Terrain Autel Démoniaque est
  en jeu (jouée par vous ou l'adversaire), les attaques de Sukuna gagnent +20 dégâts. »*
  → modifier `getEffectiveATK` conditionné à la présence du terrain, quel qu'en soit le
  poseur.

### Todo — 200 HP

- **Black Flash** (70 ATK) — *« Inflige 70 dégâts à l'actif adverse. 33% de chance de
  critique. »* → modifier `getCriticalPercent`.
- **Boogie Woogie** (active, banc, 1×/partie) — *« Switch gratuitement le personnage actif
  avec un personnage du banc allié de votre choix, même si Todo lui-même n'est pas
  l'actif. »* → `forceSwitch`, qui contourne `canSwitchStandard` (un stun sur l'actif ne
  l'arrête donc pas). Seul `chained` (Chaînes) bloque encore le départ, dans
  `zones.switchActive`.

### Toji — 250 HP

- **Aiguillon Céleste** — *« Infligé 33% des pv par rapport aux pv maximum de la cible »*
  → dégâts = `Math.round(currentMaxHP_cible * 0.33)`, indépendant de l'ATK de Toji (pas
  d'appel à `getEffectiveATK`). Passe par `dealDamage` normal : esquivable, peut critiquer,
  absorbé par un bouclier, comme n'importe quelle autre attaque.
- **Traque du Plus Fort** (active, 1×/partie) — *« Force l'adversaire à échanger son
  personnage actif avec celui de son banc qui possède le plus de HP actuels\nUtilisable
  1x »* → `forceSwitch` vers le perso du banc adverse avec le plus de PV actuels (calculé
  via `getCurrentHP`, pas de statut). En cas d'égalité, premier trouvé dans l'ordre du
  banc. Le banc adverse est filtré par `canTargetBench` (un banc protégé, ex: Bouclier
  Ultime, n'est pas éligible) ; l'ability est grisée si aucune cible n'est ciblable.
- **Restriction Céleste** (passive, purement descriptive) — *« Immunisé contre les
  Silences, les Stuns et l'effet Désarmé. »*
  → Le moteur n'avait aucun point d'accroche pour bloquer l'application d'un statut avant
  Toji : ajout d'un nouveau `QueryName` générique `canApplyStatus` (payload
  `{ targetInstanceId, statusId }`), consulté dans `effect-context.ts`'s `applyStatus`
  **avant** le jet d'esquive (un porteur immunisé n'a pas besoin de rouler les dés).
  Réutilisable par toute future carte « immunisé contre X ». Le modifier de Toji vote
  `deny` uniquement pour lui-même (`targetInstanceId === sourceInstanceId`) et pour
  `stun` / `disarmed` / `silence-active` / `silence-passive` / `silence-ultimate`.

### Yugi — 200 HP

- **Appel du Magicien Sombre** — attaque simple, 50 ATK, pas de texte imprimé sur la carte
  (description implicite, comme Jajanken Ultime de Gon Adulte).
- **Puzzle Millénaire** (active, 1×/tour) — *« Obtient aléatoirement l'un des effets
  suivants à qu'il pourra utiliser quand il le souhaite une fois par tour : 40% boost ATK,
  20% bleed, 15% soin, 4% renvoi total, 1% résurrection, 20% échec. »*

  ⚠️ **Deux points confirmés avec l'utilisateur avant implémentation**, le texte imprimé
  étant ambigu :

  - **Le tirage se résout IMMÉDIATEMENT à l'activation** (pas un effet mis en réserve pour
    un moment séparé plus tard) — « qu'il pourra utiliser quand il le souhaite » décrit
    juste le fait que c'est une capacité **active** (le joueur choisit quand l'activer),
    pas un mécanisme de stockage. `usesPerTurn: 1` (déjà le défaut moteur, déclaré quand
    même pour coller au texte).
  - **Le boost d'ATK (branche 40%) dure le tour EN COURS**, pas le prochain tour de Yugi
    (`remainingTurns: 1`, sans le `+1` des statuts posés après le tick du porteur — comme
    Potion force, posé pendant le propre tour de Yugi donc avant son tick suivant).
  - **Tirage à 6 branches inégales sans roue à l'écran** : `ProcWheel` ne sait montrer
    qu'un jet binaire (réussi/raté sur UN taux), pas une table à 6 issues. Le tirage utilise
    donc `randomInt(ctx.state.rng, 100)` comparé à des seuils cumulés (40/60/75/79/80/100),
    sans wheel trompeuse, et une ligne de journal (`Puzzle Millénaire : <issue>`) dit
    exactement ce qui a été obtenu.
  - **Branche 15% (soin)** : choix `select-characters` entre Yugi lui-même (en tête,
    filet de sécurité si le prompt expire) et chaque allié du banc -- auto-résolu vers
    Yugi si le banc est vide (pas de prompt inutile pour un choix à une seule issue).
  - **Branche 4% (renvoi total)** : *« et ne les subit pas »* n'est PAS le comportement du
    statut générique `damage-reflect` existant (Miroir de Renvoi renvoie un %, mais le
    porteur encaisse quand même le coup en entier). Nouveau champ optionnel
    `data.negatesOriginal: true` sur `damage-reflect` (voir CLAUDE.md) : zéro-out
    `finalAmount` côté porteur en plus du renvoi. Miroir de Renvoi ne pose jamais ce champ,
    son comportement est inchangé (couvert par `damage-reflect-negate.spec.ts` et l'ancien
    `miroir-de-renvoi.spec.ts`, tous deux toujours verts).
  - **Branche 1% (résurrection)** : même filet que l'ancienne Absorption Vitale -- cimetière
    vide ⇒ soigne Yugi de 100 HP au lieu de ne rien faire. Choix `chooseOption` avec `card`
    par option (le cimetière n'est pas un personnage sur le plateau, `select-characters` ne
    peut pas l'afficher). Ressuscité sur le banc à 50% de ses PV max (`Math.floor`).

### Yumeko — 140 HP

- **Mise a Fond** — *« Calculé par rapport à Mise à Mort »*
  → `baseATK: 0` : **sans pari remporté, l'attaque inflige 0**. Tout le coup vient du gain
  de « Mise à mort », ajouté par un modifier `getEffectiveATK` (donc buffs et malus d'ATK
  s'appliquent au total). Le gain est consommé par l'attaque, **même si le coup est
  esquivé** : il paie une attaque, pas un tour.
- **Mise à mort** (active) — *« Au début de ton tour, tu peux choisir de parier 40, 60, 70
  PV de Yumeko. […] »*
  → Jet à 50 % annoncé (`rollChance`, la roue de pourcentage tourne pour les deux joueurs).
  Victoire : statut `yumeko-pari-gagne` avec `data.bonus = mise × 2`, valable **le seul
  tour du pari** (`remainingTurns: 1` + `ticksOnBench`) — un nouveau pari **remplace** le
  précédent, les gains ne s'empilent pas d'un tour sur l'autre. Défaite : `dealDamage` sur
  Yumeko elle-même, en **dégâts ordinaires** — choix de design assumé : bouclier et
  réductions de dégâts ont le droit de les absorber, donc une Yumeko protégée par un
  bouclier parie gratuitement. Ce n'est **pas** la convention habituelle des coûts en HP
  (`ignoreShield` + `ignoreDamageReduction`, cf. Adrénaline Ultime), c'est délibéré. Les
  trois mises restent proposées quels que soient ses PV : **elle peut mourir de son propre
  pari**.
- **Bonus** (passive, purement descriptive) — *« Peut utiliser Mise à Mort sur le Banc,
  Utilisable qu'une seul fois »*
  → Une seule fois par partie, Yumeko peut mener **tout son pari depuis le banc** : Mise à
  mort **et** l'attaque qu'elle paie. Le passage se consomme à l'engagement de la mise, pas
  à l'attaque — une mise perdue depuis le banc a bel et bien brûlé l'unique fois
  (`yumeko-bonus-utilise`). L'ouverture de l'attaque ne vaut que ce tour-là
  (`yumeko-bonus-tour`, `remainingTurns: 1` + `ticksOnBench`). Depuis le poste actif, Mise
  à mort reste gratuite et répétable, 1×/tour.
  → **Ajout moteur** : nouveau `QueryName` **`canAttackFromBench`**, permission-style qui
  **refuse par défaut** et n'est ouverte que par la carte qui le dit. `match.ts` remplace
  son ancien « seul l'actif peut attaquer » par « … sauf si le personnage est bien au banc
  de ce camp *et* qu'une carte l'y autorise ». Un attaquant du banc reste soumis à tous les
  refus ordinaires (stun, désarmé, sceau de Makima…), qui vivent dans `canAttack`.
  Côté client, `attackOptions` liste désormais aussi ces attaquants de banc, avec le nom du
  personnage en sous-titre.

### Zoé — 140 HP

- **Sleepy Bubble** (50 ATK) — *« … Si des dégâts passent, 33% de chance d'appliquer Silence
  Ultime pendant 1 tour. »*
- **Portail Dimensionnel** (active, 2×/partie) — *« Switch gratuitement avec un personnage du
  banc allié de votre choix. »*
- **Spell Thief (mémoire)** (passive, `onAbilityUsed`, banc) — mémorise la dernière ability
  active adverse dans un statut caché.
- **Spell Thief** (active) — *« Rejoue immédiatement la dernière capacité active utilisée par
  l'adversaire, mais lancée par Zoé. Rechargement : 3 tours. »*
  - Moteur : même réserve que Kakashi — une capacité adossée à un compteur propre à son
    porteur d'origine rend moins. Le rechargement est un statut de cooldown, avec
    `ticksOnBench: true` comme toutes les recharges.

---

## Objets

### Adrénaline Ultime

*« Utilisable uniquement si ton personnage actif a au moins 110 HP restants. Réduit ses HP
actuels à 10 HP et multiplie par 2 les dégâts de toutes ses attaques pendant ce tour. »*

- Moteur : le coût en HP est infligé avec `ignoreShield` + `ignoreDamageReduction` (sinon le
  bouclier absorbe le coût). Le `atk-multiplier` porte `ticksOnBench: true`, sinon partir au
  banc figerait le buff pour le reste de la partie.

### Absorption Vitale — exemplaire unique, objet à lier

*« Pendant 3 tours, empêche votre personnage actif de switch et d'utiliser ses abilities. Si
il est encore vivant après les 3 tours, le tue, et vous permet de récupérer un personnage
dans votre cimetière, le ramenant sur votre banc avec la moitié de ses hp. Si votre
personnage actif meurt avant la fin des 3 tours, cette carte va au cimetière sans faire
effet. »*

- Moteur : anciennement un terrain, désormais un objet à lier (`equipment: true`,
  `maxCopies: 1`) — s'accroche au personnage actif au moment de la pose via
  `ctx.attachSelfTo`. `chained` (bloque le switch) et `silence-ultimate` (bloque les
  capacités) portent désormais leur propre `remainingTurns` (voir la durée ci-dessous) au lieu d'être suivis
  manuellement par un terrain : plus besoin de traquer « l'actif du moment », le porteur ne
  peut de toute façon plus quitter le poste une fois scellé.
- **Durée : `remainingTurns = 3 − 1 = 2`, sans le `+1` habituel.** Le sceau tombe sur son
  porteur pendant le tour de son propre camp, donc ce tour-là compte déjà comme le premier
  des trois : scellé au tour N, encore scellé au tour N+1, exécuté à l'ouverture du tour
  N+2 — trois tours en jeu, tels que le joueur les compte. Avec le `+1` (qui ne vaut que
  pour un statut bloquant posé sur l'**adversaire**), la carte tenait jusqu'au tour N+4, soit
  cinq tours.
- Moteur : le KO différé et la résurrection sont portés par le statut générique
  `sacrifice-revive` (même durée) : quand il expire avec son porteur toujours en vie,
  le moteur le tue puis propose à son propriétaire de ranimer, sur son banc à la moitié de
  ses HP max, un AUTRE personnage de son cimetière (celui qui vient d'être sacrifié est
  exclu du choix). Résolu directement dans `statuses.ts` (le seul endroit qui peut à la fois
  attendre un choix et enchaîner KO + résurrection) plutôt que via `onExpire`, qui ne sait
  poser qu'un autre statut, pas exécuter une action — un objet ne pouvant réagir à aucun
  event (voir CLAUDE.md), ce comportement ne pouvait plus vivre dans une `AbilityDef` comme
  au temps du terrain.
- Si le porteur meurt avant l'échéance (n'importe quelle cause), l'objet équipé part avec
  lui au cimetière du propriétaire (nettoyage automatique de `zones.koCharacter`) sans que
  `sacrifice-revive` n'ait jamais l'occasion d'expirer — sans effet, comme le dit le texte.

### Annulation de territoire

*« Sacrifiez votre terrain actif pour retirer 3 tours au terrain adverse. »*

- Moteur : `destroyTerrain` sur le sien, `shortenTerrain` sur celui d'en face.
- La carte est **refusée avant d'être consommée** (`unplayableReason`) tant qu'il manque un
  des deux terrains : « vous n'avez aucun terrain actif à sacrifier » / « aucun terrain
  adverse à annuler ». Le serveur rejette l'action avec cette phrase et la main grise la
  carte avec la même.

### Attaque cloné

*« Permet d'attaquer deux fois pendant ce tour, la deuxième attaque inflige 50% des dégâts.
Incapable d'utiliser son actif aux 2 prochains tours. »*

- Moteur : objet **à lier** (`equipment: true` + `ctx.attachSelfTo`), accroché à l'actif qui
  attaque. Reste en jeu tant que son effet l'est encore (double-attaque puis silence), puis
  se détruit tout seul : le statut posé en `onExpire` (le silence) porte
  `data.objectInstanceId`, et `statuses.ts` détruit l'objet correspondant dès que CE statut
  expire naturellement — convention réutilisée de `damage-reflect`, mais déclenchée par le
  temps plutôt que par un coup encaissé. Rien ne reste donc accroché, inerte, une fois
  l'effet vraiment terminé.
- Moteur : statut générique `extra-attack` (`data: { remaining, damagePercent, armed }`) posé
  sur l'actif. La carte ne fait que le poser ; le moteur s'occupe du reste :
  - `match.ts::applyAction` : après une attaque, si une charge reste, il la dépense et
    **ne termine pas le tour** au lieu de le clore, puis arme la décote. C'est aujourd'hui le
    seul moyen de prolonger un tour après une attaque : `doesActionEndTurn` existe dans
    `QueryName` mais n'est évaluée nulle part, et un modifier étant une fonction pure, il ne
    pourrait de toute façon pas dépenser la charge qu'il lit.
  - `queries.ts::getEffectiveATK` : applique `damagePercent` **uniquement** quand `armed` est
    vrai, donc la première attaque reste à pleine puissance. Champ dédié plutôt qu'un statut
    `atk-multiplier`, qui entrerait en collision avec le x2 d'Adrénaline Ultime (retirer l'un
    retirerait l'autre).
  - La charge est retirée dès que l'attaque décotée est résolue, pour qu'une attaque
    ultérieure du même tour n'hérite pas de la décote.
- Moteur : le silence n'est **pas** posé à la lecture de la carte mais à l'expiration de
  `extra-attack`, via le champ transverse `onExpire` (nouveau, voir `StatusInstance`). Il
  arrive donc au début du tour suivant, **après** la passe de décompte de ce tour-là : il
  n'est jamais décompté à vide, ne demande **aucun `+1`**, et le tour où la carte est jouée
  reste libre — ce que dit « aux 2 prochains tours ».
- Moteur : la contrepartie est due même si le joueur n'attaque pas deux fois (ou pas du tout)
  — `extra-attack` expire de toute façon au tour suivant et arme son silence.
- **Refusée si Locke, Light Yagami, Yumeko ou Kayn est au poste actif** (`unplayableReason`,
  message « Interaction trop puissante. ») : liste en dur des `cardId` sur la carte,
  vérifiée sur `state.players[ownerId].characters[activeId].cardId`. Le serveur rejette
  l'action avec cette phrase et la main grise la carte avec la même. Choix délibéré de ne
  PAS passer par un modifier générique (`canPlayObject` n'existe pas côté objet) : rien
  d'autre dans le moteur n'a besoin de refuser « par personnage nommé ». Ne couvre que
  `kayn` lui-même, pas ses formes évoluées (`kayn-assassin` / `rhaast`) — un `cardId`
  distinct chacune.

### Berserk — objet à lier

*« Le porteur doit descendre sous la barre des 30 HP actuels sans mourir. Récompense : Il
gagne définitivement le passif Buveur de Sang (se soigne de 50 % des dégâts qu'il inflige).
En contrepartie, plus aucun soin externe (alliés, objets) n'a d'effet sur lui »*

⚠️ **3e objet du lot (avec Chasseur de prime) qui a demandé un ajout moteur** : un
`ObjectCardDef` n'a pas de champ `abilities`, donc rien ne peut réagir de lui-même à un
dégât encaissé. Points confirmés avec l'utilisateur avant implémentation :

- **Surveillé après TOUT ce qui peut faire bouger les HP actuels du porteur**, pas
  seulement les attaques : `zones.ts::resolveBerserkVow` est rappelé depuis
  `match.ts::dealDamage`, `applyValeurLock`, **et** juste après la pose de l'objet
  (`resolveObjectInPlay`) — ce dernier appel couvre le cas où le porteur est **déjà** sous
  la barre au moment même où on l'équipe (déclenchement immédiat, comme demandé), sans quoi
  il faudrait attendre un dégât futur pour que le vœu se remarque.
- **« Sans mourir » est vérifié à chaque appel** (`!isCharacterKO(char)`) : un coup qui fait
  passer sous 30 HP et tue dans le même geste (overkill) ne tient pas le vœu.
- **Nouveau statut permanent `buveur-de-sang`** (`data.healPercent`), indépendant de la
  survie de l'objet une fois gagné (comme `crit-streak`). Deux effets, tous deux moteur :
  - **Lifesteal** : vérifié dans `effect-context.ts::dealDamage` (même famille que
    `hit-bounty`/`crit-streak`), scopé aux dégâts HOSTILES d'une attaque/capacité avec une
    source résolue — pas de vol de vie sur un allié touché par ricochet. Restaure via
    `hp.heal()` **en direct**, en contournant `api.heal()` — condition nécessaire pour ne
    pas se faire bloquer par l'effet suivant.
  - **Blocage des soins externes** : `match.ts::heal` refuse tout soin (comme
    `unhealable`, y compris son nettoyage de bleed) dès que `buveur-de-sang` est présent.
    Comme le lifesteal ne passe jamais par ce portail, il n'est jamais concerné.
- Champs `hp` / `attacks` du JSON d'origine : artefacts du créateur de cartes, ignorés.

### Bombe aveuglante

*« Empêche le personnage actif adverse d'attaquer (Désarmé) pendant 1 tour. En contrepartie,
l'adversaire obtient 1 carte Objet aléatoire dans sa main, et votre personnage sur le poste
actif subit 40 dégâts. »*

- Aucun ajout moteur : trois effets instantanés indépendants dans un seul `execute()`.
- **Désarmé posé pendant NOTRE tour** : `remainingTurns: 2` (1 tour voulu + 1, le porteur
  adverse doit survivre au tick qui ouvre son tour suivant avant de pouvoir agir) — même
  calcul que le Désarmement de Katarina.
- **« 1 carte Objet aléatoire »** : tout le registre (`listCards()` filtré sur les objets),
  comme le reroll d'Isaac D6 — pas seulement les objets du deck construit ou de la réserve
  du mode en cours. `ctx.createObject(cardId, ctx.opponentId)`.
- **Les 40 dégâts sur son propre actif sont un coût auto-infligé** (`ignoreShield: true,
  ignoreDamageReduction: true`), comme le Contrat de Mort de Gon Adulte ou Adrénaline
  Ultime — confirmé avec l'utilisateur, le texte l'encadre comme un prix à payer plutôt
  qu'une riposte qu'un bouclier pourrait absorber.
- Un objet ne fait jamais rouler l'esquive, quoi qu'il cible (`damageSource: 'other'` dans
  tout `execute()` d'objet ⇒ `canRollAgainst` renvoie toujours faux) : inutile de passer
  `skipEvasionRoll` nulle part ici.

### Caméléon

*« Choisissez une carte objet de votre main actuelle, Caméléon devient celle-ci. Possible
seulement si la carte choisi n'est pas une carte déjà sélectionné 2 fois ou si ce n'est pas
une carte unique exemplaire. »*

- Moteur : transforme SA PROPRE instance en place (mute `cardId` de l'objet en jeu, même
  principe qu'une évolution de personnage mais pour un objet) plutôt que de défausser +
  créer deux cartes séparées. La restriction reste la même règle de deck qu'avant (une carte
  déjà à son plafond d'exemplaires, dont un exemplaire unique dès sa première copie, n'est
  pas proposée) : devenir une copie de plus compte comme un exemplaire supplémentaire.
- Moteur : une fois transformée, la carte **retourne en main** (`ctx.returnSelfToHand()`,
  nouvelle primitive : `zones.returnObjectToPool`, chemin inverse de la pose) au lieu de
  partir au cimetière. Le texte s'arrête à « devient celle-ci » — devenir une carte n'est
  pas la jouer : la nouvelle carte se joue plus tard, normalement, avec ses propres cibles
  et sa propre pose sur le budget d'objets du tour. Poser Caméléon a bien consommé une pose,
  elle. `resolveObjectInPlay` n'enterre l'objet que s'il est encore dans
  `inPlayObjectInstanceIds` : accroché (équipement) ou reparti en main, il n'y a rien à
  enterrer.
- Le journal annonce publiquement que **Caméléon** a été jouée (spotlight ordinaire), mais
  la ligne « Caméléon devient X » porte `data.privateTo = ctx.ownerId` : une carte non jouée
  est secrète (`getPlayerView` masque la réserve adverse), l'annoncer reviendrait à retourner
  une carte de la main sur la table.
- Choix via `ctx.chooseOption` (le prompt `select-characters` ne sait afficher que des
  personnages) — parmi les cartes objet encore dans la réserve non jouée (« votre main
  actuelle »), Caméléon lui-même déjà exclu de cette liste par `handlePlayObject` avant que
  son `execute()` ne tourne.

### Chaînes — exemplaire unique

*« Enchaîne le personnage actif ennemi : il ne peut plus être switché TOTALEMENT, jusqu'à sa
mort. Un exemplaire. »*

- Moteur : objet **à lier** (`equipment: true` + `ctx.attachSelfTo`), accroché à l'actif
  ennemi visé — sur le personnage de l'AUTRE camp, comme Miroir de Renvoi le permet déjà.
  Sa durée de vie suit exactement celle du statut : indéfinie, jusqu'à la mort du porteur,
  où il rejoint le cimetière de son propre propriétaire (`zones.koCharacter`).
- Moteur : statut `chained` sans `remainingTurns`. Bloque **tout** départ du poste actif, le
  switch standard comme les switchs forcés (Hook, Boogie Woogie, Portail Dimensionnel, Dieu
  du Tonnerre Volant) : le garde vit dans `zones.switchActive`, l'unique point de passage de
  tous les switchs. Le défensif prime sur l'offensif.
- Le remplacement après un KO n'est pas concerné (il ne passe pas par `switchActive`) : un
  personnage mort n'est plus enchaîné.

### Chasseur de prime — objet à lier

*« Le porteur doit mettre KO deux personnages adverses s'il réussis le porteur gagne
définitivement +40 ATK et 50 de Shield. »*

⚠️ **1er des deux objets du lot qui a demandé un ajout moteur** (avec Berserk) — même
contrainte : pas de `trigger` possible sur un objet.

- **`data.count` compte les KO adverses réalisés par le porteur DEPUIS l'équipement**,
  repart de 0 à la pose et ignore tout kill antérieur (confirmé avec l'utilisateur).
  Incrémenté par `zones.ts::resolveBountyVow`, appelé juste après `recordKill` dans
  `koCharacter` — le seul endroit qui connaît déjà `killerInstanceId` — même principe que
  `crit-streak`, qui s'auto-incrémente aussi côté moteur plutôt que via un trigger de carte.
- **Un KO allié ne compte pas** (`killerOwnerId === victimOwnerId` ⇒ ignoré) : un ricochet
  (Manipulation de Makima, Jacob et Essau) ne fait pas avancer le compteur — le texte dit
  explicitement « personnages adverses ».
- Au 2ᵉ KO : `atk-boost` **permanent** (pas de `remainingTurns`, indépendant de la survie de
  l'objet une fois gagné, comme `crit-streak`) de +40, et +50 de bouclier immédiat
  (`api.addShield`). L'objet équipé est alors détruit, son rôle rempli.
- Le badge sur la carte affiche la progression directement dans le `label` du statut
  (`Chasseur de prime (1/2)`), mis à jour à chaque incrément — pas besoin de cas spécial
  dans `statusBadgeText` (même astuce que Ronces grimpantes).

### Coeur acier — exemplaire unique, objet à lier

*« Vos 3 prochaines attaques augmente vos hp max de 35 et vous rend 35hp. »*

- ⚠️ Refonte complète (confirmée par l'auteur) : cette carte était un terrain 6 tours
  (marque + prime `hit-bounty` de 150 HP max sans soin sur l'adversaire). Elle est
  désormais un objet à lier posé sur un personnage ALLIÉ, qui buffe SON porteur sur ses
  propres attaques. `hit-bounty` reste un statut générique valide dans le moteur, mais
  plus aucune carte du jeu ne le pose actuellement.
- Moteur : objet **à lier** (`equipment: true`, `maxCopies: 1`), équipe le personnage
  choisi (actif ou banc, sous réserve de `canTargetBench`) avec le statut générique
  `attack-charges` (`data: { remaining: 3, bonusMaxHP: 35, objectInstanceId }`).
- **Nouveau statut générique moteur** (pas un modifier de carte) : consommé une charge
  par attaque **déclarée** par le porteur — qu'elle touche ou non, une seule fois même si
  l'attaque frappe plusieurs cibles (AoE) — dans `match.ts::consumeAttackCharges`, appelé
  juste après `consumeExtraAttack` sur le `case 'attack'`. Chaque charge appelle
  `raiseMaxHP(porteur, 35)` **sans** `keepCurrentHP` (confirmé par l'auteur : « augmente
  vos HP max de 35 et vous rend 35hp » est un seul mouvement, pas deux effets cumulés — le
  plafond ET les PV actuels montent de 35, contrairement à l'ancienne prime « sans soin »
  de l'ex-terrain). La dernière charge retire le statut et détruit l'objet porteur.
- ⚠️ Angle mort assumé : un personnage **lié** (statut `linked`, ex. Jacob et Essau) dont
  le partenaire attaque via `resolveLinkedPartnerAttack` ne consomme pas de charge à ce
  moment-là — seule l'attaque déclarée par l'action du joueur (`action.characterInstanceId`)
  en consomme une.

### Concentration

*« La prochaine attaque du personnage actif a 70% de chances de critiquer. Si elle ne crit
pas, elle n'inflige aucun dégât et le personnage actif ne pourra pas attaquer au tour
suivant. »*

- Moteur : statut générique `concentration` (`data.percent`). Une esquive adverse compte
  comme un échec : le malus s'applique quand même.

### Coup de main

*« Permet à une carte sur le banc d'attaquer sans mettre fin au tour. Néanmoins cette
attaque inflige maximum 5 de dégâts. »*

- Moteur : le personnage du banc choisi utilise une de ses **vraies** attaques (le joueur
  choisit laquelle), avec tous ses effets secondaires (poison, désarmement, statuts...) --
  seuls les dégâts bruts de cette résolution sont plafonnés à 5 **au total** (pas par
  instance de dégâts, si l'attaque en inflige plusieurs). Un contexte d'effet est
  reconstruit pour ce personnage (`EffectContext.buildEffectContext`, nouveau sur
  l'`EffectContext` -- voir `cards/types.ts`) pour que l'ATK, l'esquive et le critique se
  calculent avec SES stats à lui, pas celles de Coup de main. Un personnage étourdi ou
  désarmé n'est pas proposé (`unplayableReason` grise la carte si tout le banc est dans ce
  cas). N'émet pas `onAttackDeclared` : les rares passifs qui y réagissent (la mémoire de
  Copie de Technique de Kakashi) ne voient pas cette attaque.
- « Sans mettre fin au tour » : l'attaque est jouée en appelant directement
  `attack.execute()`, sans passer par le gestionnaire d'action `attack` normal (qui est le
  seul endroit qui déciderait de terminer le tour) -- le joueur peut donc encore attaquer
  normalement avec son actif ensuite. Coup de main reste soumis à la règle standard des 2
  objets par tour (le 2e objet du tour reste une action finale, comme d'habitude).

### Couteau dans le dos — exemplaire unique

*« Exemplaire unique. Dès maintenant et jusqu'à la fin de votre prochain tour, les dégâts
infligés au banc ennemi sont doublés. »*

- Moteur : statut `bench-damage-bonus` (`data.multiplier`) posé sur **tous** vos personnages,
  avec `ticksOnBench: true`. Le pipeline de dégâts (`effect-context.ts::dealDamage`) ne
  regarde pas seulement l'attaquant du coup en cours : il vérifie si **n'importe lequel**
  des personnages du camp porte le statut, ce qui couvre aussi bien une attaque/capacité
  qu'un effet de **terrain** (Autel Démoniaque) ou d'**objet** -- le texte dit « les dégâts
  infligés au banc ennemi », pas « par vos personnages ».

### Crit + — à lier

*« Si la carte a réussis à crit 2x, Tout ses crit passent à 70 pourcents de chance »*

- Moteur : nouveau statut générique reconnu par le moteur, `crit-streak` (`data: { count,
  threshold, boostPercent }`), posé une seule fois par la carte sur le personnage équipé
  (`ctx.applyStatus`, comptage à 0). Le moteur lui-même incrémente `count` à chaque
  critique **réussi** du porteur (`effect-context.ts::dealDamage`, aussi bien un jet normal
  qu'un critique forcé par Concentration) — un objet n'ayant aucun trigger pour réagir à un
  event, il n'y avait pas d'autre point d'accroche possible. Une fois `count` ≥ `threshold`,
  `queries.ts::getCriticalPercent` garantit `boostPercent`%, exactement comme le statut
  `critical` déjà intégré au moteur (`Math.max` avec le taux courant, ne descend jamais un
  taux déjà plus élevé).
  - Le statut porte `data.objectInstanceId` : le compteur est l'effet de **cet objet-là**,
    pas un acquis du porteur. Détruire Crit + (terrain Destruction...) emporte donc le
    compteur et le taux garanti avec lui — `zones.destroyObject` retire du (ex-)porteur tout
    statut nommant l'objet détruit, réciproque exacte de `statuses.ts`, où un statut qui
    expire détruit l'objet qu'il nomme. Même règle pour la Détermination, la Potion force et
    le Miroir de Renvoi, qui posent déjà ce champ.
  - Badge visible sur la carte, avec progression : « Critiques (0/2) » → « (1/2) » → «
    Critique garanti (70%) » une fois le seuil atteint (label mis à jour par le moteur à
    chaque incrément, pas par la carte).
  - À l'aveu du typo d'origine : le texte imprimé garde la faute (« a réussis », « Tout ses
    crit ») conformément à la règle du texte exact.

### Déchetterie — exemplaire unique

*« Permet de récupérer une carte objet parmi une sélection aléatoire de 5 cartes objets des 2
cimetières. »*

- Moteur : pioche jusqu'à 5 cartes objet au hasard (`randomInt`) en piochant dans les
  cimetières objets des DEUX joueurs (le vôtre et celui de l'adversaire) réunis en un seul
  pool — moins de 5 cartes disponibles au total ne fait que réduire la sélection, jamais
  d'erreur. La carte choisie rejoint votre réserve non jouée, jouable normalement plus tard,
  qu'elle vienne de votre propre cimetière ou de celui de l'adversaire.
- Moteur : `ctx.chooseOption` avec un `card` par option — la modale montre les cartes
  tirées en illustration, pas seulement leurs noms.

### Détermination — exemplaire unique, objet à lier

*« Empêche le personnage actif de mourir pendant 1 tour, si il subit des dégâts, ne peut pas
descendre en dessous de 1hp. »*

- Moteur : objet à lier (`equipment: true`) — s'accroche au personnage actif au lieu de
  partir au cimetière. Statut `death-ward`, avec `ticksOnBench: true`. Ne couvre **pas** la
  perte de HP max (Mahito, poison Sang Maudit) ni une mise à mort directe par `koCharacter`
  (Perfect Execution d'Akali).
- Moteur : le statut porte `data.objectInstanceId` — dès que `death-ward` expire
  naturellement (1 tour plus tard), le moteur détruit l'objet tout seul (même convention
  qu'Attaque cloné) au lieu de le laisser accroché pour rien.

### Dieu du Tonnerre Volant

*« Téléportation : échange votre actif avec un personnage de votre banc, gratuitement et sans
finir votre tour. Ignore Stun. »*

- Moteur : `forceSwitch`, qui ignore bien le Stun. Ne passe **pas** au travers de Chaînes
  depuis que `chained` bloque tout switch, ni au travers d'un interdit explicite (Bouclier
  Ultime).
- Refusée avant d'être consommée (`unplayableReason`) quand la téléportation n'aurait pas
  lieu : banc vide, actif enchaîné, ou switch interdit par une carte en jeu.

### Echange équivalent

*« Sacrifier 2 cartes, objets ou terrain. En échange, vous permet de récupérer une carte
objet ou terrain parmi toutes les cartes du jeu. »*

- Moteur : le sacrifice vise toujours la réserve non jouée du joueur (`ctx.chooseOption`,
  deux choix successifs). La récupération, elle, n'est plus limitée au cimetière : elle
  porte sur **n'importe quel objet ou terrain enregistré dans le jeu** — `listCards()`
  filtré par type — et fabrique une copie toute neuve (`ctx.createObject` /
  `ctx.createTerrain`), plafonnée par le nombre max d'exemplaires du deck (même règle que
  Caméléon : une carte déjà à son plafond, dont un exemplaire unique dès sa première copie,
  n'est pas proposée).
- **Ajout moteur** : `ctx.createTerrain(cardId, forPlayerId?)` — pendant de `createObject`
  côté terrain (`EffectContext`/`EngineApi`), absent jusqu'ici car aucune carte n'avait
  besoin de fabriquer un terrain tout neuf plutôt que d'en récupérer un existant. Ajoute une
  instance à la réserve non jouée avec `remainingTurns`/`data` indéfinis, redéfinis
  normalement à la prochaine pose.

### Extension du territoire — exemplaire unique

*« Exemplaire unique. Rajoute 2 tours au terrain actif du joueur qui la joue. »*

- Moteur : no-op si le terrain est de durée indéfinie ou s'il n'y a pas de terrain en jeu.

### Jacob et Essau

*« Lie 2 personnages. Ces deux personnages attaquent désormais ensemble, appliquant leurs
deux attaques. Seul le personnage du poste actif peut utiliser son actif/passif. Ces deux
personnages subissent aussi des dégâts ensemble, si un des deux meurt, les deux meurent. »*

- Moteur : objet **à lier** ; il s'accroche au premier des deux (logo 🔗, dessiné à côté de
  son porteur) mais ne PORTE pas le lien. Celui-ci vit dans le statut générique `linked`
  posé sur les deux, chacun pointant vers l'autre (`data.partnerInstanceId`) — un objet n'a
  pas de champ `abilities` et ne peut donc réagir à aucun événement, exactement la raison
  pour laquelle Miroir de Renvoi passe par `damage-reflect`.
- Moteur : les quatre règles du lien sont appliquées par le **moteur**, pas par la carte :
  - attaque jointe → `match.ts::handleAttack` ; le partenaire ajoute une de ses propres
    attaques, choisie par le joueur à chaque fois (prompt sauté s'il n'en a qu'une).
    Résolue sur un contexte sourcé sur LUI (`ctx.buildEffectContext`), donc son ATK, son
    critique et son esquive s'appliquent. Un partenaire étourdi ou désarmé ne frappe pas
    (`canAttack`). L'attaque jointe n'a pas son mot à dire sur la fin du tour : c'est un
    supplément à l'attaque en cours, pas une seconde action.
  - dégâts partagés → `match.ts::dealDamage`, **toute** instance de dégâts quelle qu'en soit
    la source (attaque, ability, tic de poison/brûlure/saignement, coût que le camp se paie).
    Le miroir reprend les options du coup d'origine (`ignoreShield`, attribution du kill) et
    porte `skipLinkMirror` pour ne pas rebondir indéfiniment.
    ⚠️ Sur une AoE qui touche les deux, chacun prend le coup direct **et** le miroir de
    l'autre, soit le double — conséquence assumée du « miroir intégral ».
  - mort commune → `zones.ts::koCharacter`, résolue **avant** le prompt de remplacement pour
    que le partenaire condamné ne soit pas proposé comme nouvel actif. La récursion mutuelle
    est coupée par le garde « already processed » en tête de `koCharacter`.
  - capacités réservées à l'actif → `queries.ts::canUseAbility` ; plus fort que la règle par
    défaut, ça refuse même une ability déclarée `usableFromBench`.
- ⚠️ La valeur lock (perte de HP max, Mahito) n'est **pas** mirrorée : ce ne sont pas des
  dégâts. Si elle tue un des deux, la règle de mort commune emporte quand même l'autre.
- ⚠️ Détruire l'objet (terrain Destruction...) ne **délie pas** la paire : le lien est dans
  les statuts, et un objet n'a aucun moyen de défaire quoi que ce soit en quittant le jeu.
- Deck : un personnage déjà lié n'est pas proposé à la pose, et la carte est grisée s'il
  reste moins de 2 personnages non liés — le moteur n'a pas de notion de chaîne à trois.

### Miroir de Renvoi

*« À lier à votre personnage actif. Celui-ci subit 100% des dégâts de la prochaine attaque
qu'il subit et en renvoie immédiatement 50% à l'attaquant, puis le miroir se détruit. »*

- Seule carte **équipement** du pool (`equipment: true` + `ctx.attachSelfTo`) : elle reste
  en jeu accrochée au porteur au lieu de partir au cimetière une fois jouée. Le client la
  marque du logo 🔗 partout, la range dans « Objets à lier » au deck-builder, et dessine sa
  carte à côté du porteur (en pastille sur le coin quand il est au banc).
- Si le porteur meurt avant que le miroir ne se déclenche, l'objet part au cimetière avec
  lui (`zones.koCharacter`) — dans le cimetière de **son** propriétaire, même s'il avait
  été posé sur un personnage adverse.

- Moteur : statut `damage-reflect` (`data: { percent, objectInstanceId }`) ; le moteur
  détruit l'objet porteur en consommant le statut. `attachSelfTo` lie l'objet à l'actif.

### Offrande du Dieu de la Mort

*« Une sélection de 6 cartes objets aléatoire dans le jeu se présente à vous, choisissez en
une. Une sélection de 2 cartes objets aléatoire dans le jeu se présente à votre adversaire,
il en choisi une. »*

- Moteur : « dans le jeu » = **tout** le registre de cartes objet (`listCards()`), pas le deck
  des joueurs. Tirage via le RNG seedé de la partie (`randomInt`), jamais `Math.random`.
- Moteur : Offrande **n'est pas exclue de son propre tirage** (choix assumé) — elle peut donc
  se re-piocher et s'enchaîner sur plusieurs tours. Le seul frein est le budget de 2 objets
  par tour.
- Moteur : les deux prompts sont **séquentiels**, le moteur n'autorisant qu'une question
  ouverte à la fois même adressée à deux joueurs différents. Le second passe par
  `ctx.chooseOptionFor(ctx.opponentId, …)` (nouveau sur l'`EffectContext` : `ctx.choose*`
  n'interrogeait que son propre propriétaire).
- Moteur : la carte choisie rejoint la **réserve non jouée** de son destinataire
  (`ctx.createObject(cardId, playerId)` — le second paramètre est également nouveau, la
  méthode était câblée sur le propriétaire de l'effet). Elle se joue donc un autre tour, dans
  la limite habituelle des 2 objets par tour, et ne contourne pas l'économie de tour.
- Moteur : chaque option porte un `card`, donc la modale affiche les illustrations réelles au
  lieu d'une liste de noms.

### Pheonix

*« Tue ce personnage, au bout de 15 tours, le réanime avec 80pv max supplémentaire et 30
d'attaque supplémentaire. Si il ne vous reste plus qu'un personnage en vie. Cette carte ne
ferra pas effet. »*

- Moteur : objet **à lier** (`equipment: true` + `ctx.attachSelfTo`) — accroché à sa cible
  juste avant de la tuer, ce qui envoie l'objet au cimetière avec elle dans la foulée
  (`zones.koCharacter`), même destination qu'avant l'ajout du lien.
- Moteur : le compte à rebours ne peut pas être un statut. `applyStatus` refuse toute cible
  déjà au cimetière et `tickStatusesAtTurnStart` ne parcourt que l'actif et le banc — un
  statut sur un cadavre ne tiquerait jamais. Il vit donc sur le joueur
  (`PlayerState.pendingRevives`, voir `PendingRevive` dans `types.ts`) et est décompté dans
  `startTurn` via `zones.ts::tickPendingRevives`, juste après les tics de statuts.
- Moteur : le décompte est en **tours du propriétaire** et ne demande **aucun `+1`** — il se
  déclenche pile en atteignant zéro, au lieu d'être filtré avant d'avoir servi comme un
  statut bloquant. Le joueur suit le compte à rebours dans le journal à chaque tour.
- Moteur : au retour, les HP max montent **avant** la résurrection (`reviveCharacter`
  plafonne les PV rendus à `currentMaxHP`), donc le personnage revient à fond avec son
  nouveau maximum. Les +30 ATK sont un `atk-boost` sans `remainingTurns` (donc permanent)
  appliqué **après** la résurrection, qui vide les statuts.
- Moteur : `placement: 'active'` retombe sur le banc si le poste actif est déjà occupé
  (`reviveCharacter`), donc le retour ne dégage jamais l'actif en place de force.
- Moteur : si un autre effet (Absorption Vitale, Roi des esprits) a déjà ramené le
  personnage entre-temps, la résurrection programmée est simplement abandonnée.
- Moteur : `unplayableReason` refuse la carte s'il ne reste qu'un personnage vivant — tuer le
  dernier, c'est perdre la partie sur-le-champ (`checkWinCondition` compte les personnages
  sur le plateau).

### Poche de sang

*« Augmente les hp max de 200, sans augmenter les hp actuel. Cet objet ne soigne pas de
200hp. »*

- Moteur : objet **à lier** (`equipment: true` + `ctx.attachSelfTo`). Le joueur choisit
  un de ses personnages (actif ou banc) ; seuls ceux qui ont encore un emplacement d'objet
  libre sont proposés, sinon `api.attachObject` refuserait en silence et la poche partirait
  au cimetière après avoir quand même donné ses HP max.
- Moteur : `ctx.raiseMaxHP(id, 200, { keepCurrentHP: true })` — c'est l'option
  `keepCurrentHP` qui réalise le « sans augmenter les hp actuel » de la carte.
- ⚠️ Le bonus est un changement d'état **permanent**, pas un modifier : il n'existe aucune
  query `getMaxHP` (voir `QueryName`, `cards/types.ts`), donc les HP max ne peuvent pas être
  recalculés en continu à partir des objets en jeu. Détruire la poche (terrain Destruction,
  mort du porteur...) ne reprend donc **pas** les 200 HP max.

### Poison Mortel

*« Applique poison sur la carte ennemi du poste actif pendant 3 tours. »*

- Moteur : 3 tics (pas de `+1`, c'est un statut qui tique). Ré-appliquer sur une cible déjà
  empoisonnée rafraîchit l'instance au lieu d'en empiler une deuxième.

### Potion de soin

*« Soigne un de vos personnages (actif ou banc) de 100 HP. »*

### Potion force — objet à lier

*« Augmente les dégâts des attaques d'un personnage de 50 pendant 1 tour »*

- Moteur : objet à lier (`equipment: true`) — le joueur choisit le personnage à équiper
  (actif ou banc, `ctx.choose` comme Crit +), en filtrant sur `getMaxAttachedObjects` et
  `canTargetBench` (pour son propre banc, au cas où il serait isolé par une carte adverse).
  Statut `atk-boost` (`data.amount: 50`), `remainingTurns: 1`, avec `ticksOnBench: true`.
- Moteur : le statut porte `data.objectInstanceId` — dès que `atk-boost` expire
  naturellement (1 tour plus tard), le moteur détruit l'objet tout seul (même convention
  qu'Attaque cloné) au lieu de le laisser accroché pour rien.

### Poupée Voodoo

*« Prend toutes les altérations négatives d'un personnage au choix sur le plateau (stun,
désarmé, silence, ATK réduite, brûlure, poison, saignement, chaînes) et les déplace sur un de
vos personnages ou sur l'actif ennemi. »*

- Moteur : ne déplace que des statuts de `BUILTIN_STATUS_IDS` ; un compteur privé à une carte
  serait détruit par le transfert.

### Tours compté — objet à lier

*« Le porteur doit survivre pendant 3 tours de combat au poste actif. A la fin de chacun de
ces 3 tours tours, le porteur subit 10% HP Max. Récompense : inflige une réduction définitive
de -150 PV Max au personnage actif adverse et récupère les 50 HP. »*

⚠️ **Premier objet du jeu qui a demandé un vrai ajout au moteur**, pas juste un fichier de
carte : un `ObjectCardDef` n'a pas de champ `abilities` et ne peut donc réagir à AUCUN event
de lui-même (cf. CLAUDE.md). Or le texte veut un tic à la FIN de chaque tour du porteur plus
une récompense unique à l'issue du 3ᵉ -- rien de réutilisable tel quel (poison/burn/bleed
tiquent au DÉBUT du tour et n'ont pas de récompense finale). Portée et points ambigus
confirmés avec l'utilisateur avant implémentation :

- **Nouveau statut générique `survival-vow`** (`BuiltinStatusId`), résolu par une fonction
  dédiée (`turn.ts::resolveSurvivalVow`) appelée depuis `endTurn`, PAS par le tick générique
  `tickStatusesAtTurnStart` -- d'où l'absence volontaire de `remainingTurns` sur ce statut
  (`data.ticksRemaining` fait tout le travail à la main, pour ne pas se faire décompter une
  seconde fois par le tick générique).
- **Ne touche que l'actif du joueur dont le tour se termine.** Si le porteur n'est plus au
  poste actif à ce moment-là (switché, ou toujours sur le banc), rien ne se passe : ni tic, ni
  décompte. **Pause, pas reset** -- `data.ticksRemaining` retient sa valeur telle quelle et
  reprend son décompte dès que le porteur revient au poste actif, exactement le comportement
  par défaut d'un statut sans `ticksOnBench` (section 6 de CLAUDE.md), qui se trouve être
  exactement ce que demande « au poste actif ».
- **Dégâts de tic = 10 % des HP MAX ACTUELS du porteur**, recalculés à chaque tic (pas figés à
  la pose). Dégâts ORDINAIRES (`api.dealDamage` sans `ignoreShield`/`ignoreDamageReduction`) :
  un bouclier ou une réduction de dégâts du porteur s'applique normalement, même traitement
  que burn/bleed -- pas un coût auto-infligé comme le Contrat de Mort de Gon Adulte.
- **Un tic qui tue le porteur annule la récompense** (même garde que partout ailleurs :
  `api.isOnBoard` revérifié après le `dealDamage`). Le vœu n'est tenu que si le porteur est
  toujours en vie une fois `ticksRemaining` à 0.
- **Récompense** : `ctx`-free, appels directs à `api.applyValeurLock` (-150 PV max définitifs
  sur l'actif adverse **du moment**, pas celui d'il y a 3 tours) et `api.heal` (+50 sur le
  porteur). `applyValeurLock` ignore déjà le bouclier par construction (aucun chemin de code
  ne l'y fait passer, contrairement à `dealDamage`) -- pas d'option à passer pour ça.
- **L'objet est détruit une fois le vœu résolu** (`api.destroyObject`, comme la dernière charge
  de Coeur acier), qu'il ait payé ou non n'a plus d'importance à ce stade : si le porteur est
  mort avant, l'objet est déjà parti au cimetière avec lui par le mécanisme générique existant.
- Champs `hp` / `attacks` du JSON d'origine : artefacts du créateur de cartes, ignorés comme
  d'habitude.

### Voleur de bouclier

*« Vole le shield ennemi, lui retirant totalement son shield et se l'applique à soit
même. »*

- Moteur : agit sur le champ `shield` natif ; le pseudo-bouclier de Mana Barrier n'est pas un
  `shield` et n'est donc pas volable. S'ajoute au bouclier existant.

---

## Terrains

### Arène — 2 tours

⚠️ Le JSON d'origine de cette carte contenait, par accident de l'éditeur, les capacités et
l'attaque de **Dio Brando** ainsi qu'un `hp: 200` — tout cela est ignoré : un terrain n'a ni
PV ni attaque. Seuls la description et la durée font foi.

- *« Isole totalement le poste actif des deux joueurs. Les switchs, les soins venant du banc
  et toutes les compétences (Actifs/Passifs) ciblant ou venant du banc sont totalement
  bloqués. De plus, les dégâts infligés entre les deux personnages actifs sont augmentés de
  30 %. »*
- **Switchs** : modifier `canSwitchAny`, qui refuse **pour les deux camps** — y compris les
  switchs **forcés** par une carte (Portail Dimensionnel, Hook, Boogie Woogie, Double Face
  de Chrollo…). ⚠️ **Le remplacement d'un personnage KO passe toujours** : ce n'est pas un
  switch (voir `zones.koCharacter`), et sans cette porte un camp dont l'actif meurt sous
  Arène n'aurait plus d'actif du tout et la partie se bloquerait sans vainqueur.
- **Compétences venant du banc** : modifier `canUseAbility` refusant tout personnage de
  banc, quel que soit son `usableFromBench`. Coupe donc aussi les passives à trigger des
  bancs (Berserk de Guts, la mémoire de Zoé…) tant qu'Arène est en jeu.
- **Compétences ciblant le banc** : modifier `canTargetBench` refusant les deux bancs.
  ⚠️ Cette requête n'est consultée que par les cartes qui **demandent** avant de désigner
  une cible de banc. Le passage a été généralisé pour Arène (voir la note transverse en fin
  de fichier), mais une carte future qui frapperait le banc sans rien demander passerait au
  travers.
- **Soins du banc** : modifier `getIncomingHealAmount` ramenant à 0 tout soin **reçu par**
  un personnage de banc. Le moteur ne transmet pas la *source* d'un soin, seulement sa
  cible ; l'isolement est donc appliqué côté receveur — ce qui couvre aussi les objets et
  terrains qui soigneraient le banc, pas seulement les capacités lancées depuis celui-ci.
- **+30 % entre actifs** : modifier `getIncomingDamageAmount`, appliqué seulement quand
  l'attaquant **et** la cible tiennent chacun un poste actif. Vaut dans les deux sens,
  attaques comme capacités. Un coup venant du banc ou dirigé vers lui n'est pas ce duel-là.

### Autel Démoniaque — 3 tours

*« Pendant 3 tours, au début du tour du joueur actif, inflige 30 dégâts au personnage actif
adverse et 15 dégâts à chaque personnage sur le banc adverse. »*

- Moteur : 3 activations au total, dont celle à la pose (`onTerrainPlayed`, filtré sur son
  propre terrain) ; les suivantes viennent d'`onTurnStart`.
- Ses dégâts au banc sont doublés par Couteau dans le dos si le camp qui possède ce
  terrain a la carte active (voir Couteau dans le dos plus haut).

### Bouclier Ultime — 3 tours

*« Pendant 3 tours, votre banc devient intouchable : impossible à cibler et immunisé contre
tous les dégâts adverses. »*

- Moteur : modifiers `canTargetBench`, `getIncomingDamageAmount`,
  `getIncomingValeurLockAmount`. L'immunité distingue l'attaquant grâce à `attackerOwnerId` :
  vos propres cartes peuvent toujours prélever un coût en HP sur votre banc.
- La carte n'a plus de contrepartie : elle portait aussi un modifier `canSwitchStandard`
  qui interdisait à son possesseur de changer de personnage pendant les 3 tours. Retiré —
  plus aucune carte du pool ne refuse `canSwitchStandard`.

### Confiscation — 2 tours

*« Pendant 2 tours, aucun personnage (allié comme ennemi) ne peut utiliser ses capacités
actives ou passives. Les attaques et les cartes Terrain ne sont pas concernées. »*

- Moteur : modifier `canUseAbility` (vote négatif inconditionnel). Le compte à rebours d'un
  terrain ne descend que pendant les tours de son poseur.

### Destruction — 3 tours

*« Détruit tous les objets actuellement équipés sur le terrain des 2 joueurs. Pendant 3 tours,
aucun joueur ne peut utiliser ou équiper de cartes Objet. »*

- Moteur : la destruction est un passive `onTerrainPlayed` filtré sur son propre terrain ;
  l'interdiction est un modifier `canPlayObject`.

### Faille dimensionnelle — 5 tours

*« Tous les joueurs peuvent switch gratuitement jusqu'à 2 fois pendant la durée de ce
terrain. »*

- **« Gratuitement » = le switch ne ferme pas le tour.** Un switch est normalement une
  action finale (`match.ts::runAction` posait `endsTurn = true` en dur) : sous la Faille, le
  joueur peut changer d'actif **puis** attaquer, poser un objet, enchaîner un second switch.
  C'est la première (et pour l'instant la seule) carte à se servir de la requête
  `doesActionEndTurn`, qui existait dans `QueryName` sans être évaluée nulle part.
- **2 charges par camp, pas 2 en tout**, et elles courent sur toute la durée du terrain —
  pas par tour. Les deux peuvent être dépensées dans le même tour.
- **Le compteur vit dans le `data` de l'instance de terrain**, une clé par joueur. Il ne
  pouvait pas vivre dans le modifier : un modifier est une fonction pure, il ne peut pas
  consommer la charge qu'il lit (même limite que pour `extra-attack`). Le modifier
  `doesActionEndTurn` se contente donc de **lire** le compteur — la question est posée
  *avant* le switch, donc avec le compteur encore intact — et c'est le trigger `onSwitch` de
  la carte qui le décrémente juste après.
- ⚠️ **Seuls les switchs décidés par le joueur consomment une charge.** L'event `onSwitch`
  porte désormais un `reason: 'action' | 'forced'` (ajouté pour cette carte) : un
  `forceSwitch` de carte adverse (Manipulation de Light Yagami, Hook, Boogie Woogie…) ne
  facture rien. De toute façon il ne ferme aucun tour — il ne passe pas par l'action de
  switch —, donc le facturer reviendrait à punir la victime.
- Un switch refusé en silence par `zones.switchActive` (porteur `chained`, `canSwitchAny`
  fermé par Arène…) **ferme le tour malgré tout** : rien n'a bougé, la carte n'a rien
  décompté, et le rendre gratuit laisserait le joueur relancer la même action sans fin.
- Deux Failles en jeu (une par camp) donnent bien 2 charges **chacune** : chaque terrain
  tient son propre compteur et il suffit qu'un seul vote « gratuit ».

### Hôpital — 2 tours

*« Les soins reçus par vos personnages sont multipliés par 2 pendant 2 tours. »*
→ modifier `getIncomingHealAmount`.

### Isaac D6 — 5 tours

*« Chaque joueur peut choisir de donner un de ses objets à Isaac D6. Chaque tour, Isaac D6
reroll l'item, le transformant en un autre objet du jeu de manière aléatoire. Chaque tour,
le joueur peut décider de prendre cet objet ou de le laisser pour qu'il soit reroll une
nouvelle fois au tour suivant. »*

- **Ce qu'on peut confier** : un objet de sa **main** (réserve non jouée) uniquement. Ni un
  objet déjà posé, ni un équipement accroché à un personnage.
- **Un objet par camp à la fois**, les deux compteurs indépendants. Le dé est un `data` sur
  l'instance de terrain : une clé par joueur, contenant un simple `cardId`.
- **L'`ObjectInstance` d'origine est détruite en entrant dans le dé**, et une neuve est
  fabriquée à la sortie (`ctx.createObject`). Garder l'instance en vie hors de toute zone
  n'apporterait rien — le reroll change la carte de toute façon — et laisserait un objet
  fantôme dans `player.objects`.
- **Quand la question est posée** : au début de chaque tour du joueur concerné. **Plus une
  fois immédiatement à la pose**, pour celui qui pose le terrain : son propre début de tour
  est déjà passé, sans ça il attendrait un tour complet avant de pouvoir s'en servir.
  L'adversaire, lui, est servi normalement au début de son tour.
- **Le reroll pioche dans tout le registre** (`listCards()` filtré sur les objets), pas
  seulement dans les decks en jeu, et exclut la face actuelle — « un **autre** objet ».
- **Reprendre est gratuit** : la carte rejoint la main, elle n'est pas *jouée*. Ça ne touche
  ni au budget de 2 objets par tour, ni à la fin du tour. Le dé redevient vide, et une
  nouvelle offre de confier arrivera au tour suivant.
- **À la fin du terrain, l'objet est rendu**, sous la face qu'il a à ce moment-là
  (`onTerrainRemoved`, quelle que soit la raison : expiré, remplacé, détruit). Sur son
  **dernier** tour, le possesseur n'est plus sollicité : le décompte tombe juste après
  `onTurnStart`, relancer dans le vide n'aurait pas de sens.
- ⚠️ **« Ne rien confier » est la première option du prompt**, parce qu'un choix laissé sans
  réponse pendant 120 s est résolu par `defaultChoiceAnswer` — personne ne doit perdre une
  carte par silence.

### Jeu de la mort — 3 tours

*« Pendant 3 tours, à la fin de son tour, les personnage sur le poste actif lance la roue.
50% : Le personnage actif gagne un bonus de +20 ATK pour son prochain tour.
50% : Le personnage actif subit 30 dégâts.
Si vous avez posé le terrain, votre personnage sur le actif gagne 30 de bouclier. »*

⚠️ **Trois points confirmés avec l'utilisateur avant implémentation**, le texte seul étant
ambigu :

- **Les deux camps lancent la roue**, chacun à la fin de son propre tour (`trigger:
  'onTurnEnd'`, sans filtre sur `ctx.event.playerId`) — pas seulement le poseur du terrain.
  Sinon la clause suivante sur le bouclier n'aurait aucune raison de préciser « si vous avez
  posé le terrain ».
- **Le bouclier de 30 n'est PAS répété à chaque proc de la roue** : c'est un bonus **unique**,
  donné une seule fois à la pose du terrain (`trigger: 'onTerrainPlayed'`, filtré sur son
  propre `terrainInstanceId`), au personnage actif du poseur à ce moment-là. Indépendant du
  jet de la roue.
- **Les 30 dégâts de l'échec ne sont jamais esquivables** (`skipEvasionRoll: true`), y compris
  quand c'est l'actif adverse qui les subit — traité comme un aléa de jeu (la roue), pas comme
  une attaque, même logique que Salle de Gravité. Pour le camp du poseur lui-même, l'esquive
  ne se joue de toute façon jamais contre son propre camp (règle générale du moteur).
- **Le bonus +20 ATK est aussi posé avec `skipEvasionRoll: true`** : le jet de la roue
  (`ctx.rollChance`) a déjà tranché, il n'y a pas de second jet d'esquive à faire par-dessus
  un résultat favorable (même raisonnement que Ronces grimpantes).
- **`remainingTurns: 2` pour le bonus ATK** (« pour son prochain tour » = 1 tour effectif),
  posé à la fin du tour en cours du bénéficiaire : le prochain tick de ses statuts est le
  début de son tour SUIVANT, qu'il faut donc laisser passer avant de pouvoir en profiter
  (même `+1` que le Stun de Vision du Futur d'Aki). `ticksOnBench: true` pour que le
  décompte avance même si le personnage repasse par le banc avant son prochain tour.
- Champs `hp` / `attacks` du JSON d'origine : artefacts du créateur de cartes, ignorés comme
  d'habitude pour un `TerrainCardDef`.

### Livre de Chrollo — 3 tours

⚠️ **Carte volontairement réduite par rapport à son texte d'origine.** Le JSON de départ
proposait « un actif, un passif **ou** une attaque au hasard parmi l'entièreté des
ability/attaque du jeu ». Les deux premiers ont été abandonnés d'un commun accord :

- une bonne moitié des **passifs imprimés** du jeu ne sont pas des `AbilityDef` mais des
  `modifiers` (L'Infini de Gojo, le Sharingan de Kakashi) — il n'y a littéralement rien à
  « exécuter » ;
- ceux qui sont des abilities, comme les **actifs**, lisent les statuts, compteurs et formes
  d'évolution de **leur propre carte** (Guts, Kayn, Jacob et Essau, Katarina) : transplantés
  sur un autre personnage, ils tournent dans le vide ou font n'importe quoi.

Une **attaque**, à l'inverse, c'est essentiellement « un ATK et un `execute` qui frappe
l'actif d'en face » : elle se transplante proprement.

*Texte retenu : « Chrollo prête son livre aux joueurs. Chaque tour, au début du tour : une
attaque au hasard parmi l'entièreté des attaques du jeu est proposée aux joueurs. Le joueur
peut décider d'accepter le livre de Chrollo et prendre ce qui est offert. Il ne pourra alors
utiliser que cette attaque pendant ce tour. La même attaque est proposée aux deux joueurs
pendant le tour. »*

- **Nouveau statut générique du moteur : `borrowed-attack`** (`data: { cardId, attackId }`).
  Il fait deux choses d'un coup : `queries.ts::attacksAvailableTo` ajoute l'attaque empruntée
  à celles du porteur, et `queries.ts::canAttack` refuse **toutes les siennes** — « il ne
  pourra que utiliser cette attaque pendant ce tour ». `attacksAvailableTo` est désormais
  **le** point d'entrée pour énumérer les attaques d'un personnage en jeu : `match.ts`
  (validation et résolution), `turn.ts` (la Manipulation de Makima retourne bien l'attaque
  empruntée) et le client (panneau de commandes, fiche de personnage) passent tous par lui.
  Lire `getCharacterCard(...).attacks` en direct raterait l'empruntée.
- **L'attaque s'exécute avec le contexte du PORTEUR** : son ATK effectif, ses buffs, ses
  malus, sa cible en face. Sur une collision d'`attackId` entre deux cartes, l'empruntée
  gagne — c'est elle que `canAttack` autorise.
- **Le tirage se fait une fois par manche**, rangé dans le `data` du terrain avec le
  `state.turnNumber` qui l'a produit : « la même attaque est proposée aux deux joueurs
  pendant le tour ». `turnNumber` n'avance qu'au retour du joueur qui ouvre la manche, il
  identifie donc exactement le tour de jeu que les deux camps partagent.
- **Le prêt dure exactement le tour de son bénéficiaire** : `remainingTurns: 2` (le `+1` des
  statuts bloquants — le statut est posé pendant `onTurnStart`, qui passe **avant**
  `tickStatusesAtTurnStart`) et `ticksOnBench: true`, pour qu'un porteur renvoyé au banc dans
  la foulée ne gèle pas le décompte. ⚠️ Exception pour l'offre faite **à la pose** : la passe
  de décompte du tour est déjà passée à ce moment-là, donc `remainingTurns: 1`, sans quoi le
  prêt tiendrait jusqu'au tour suivant du même joueur.
- Le prêt est fait au **personnage actif du moment** et repart avec lui : switcher pendant le
  tour fait perdre l'attaque empruntée (le nouvel actif n'a pas le statut).
- ⚠️ **« Refermer le livre » est la première option du prompt** : accepter ferme toutes les
  attaques du joueur, ce n'est pas un cadeau qu'on peut lui imposer par un silence de 120 s.
- Comme Isaac D6, le possesseur n'est plus sollicité sur le **dernier** tour du terrain.
- **Le poseur est servi dès la pose** (`trigger: ['onTurnStart', 'onTerrainPlayed']`, la
  branche `onTerrainPlayed` filtrant sur son propre `terrainInstanceId` comme toujours). Le
  tour du poseur a commencé avant que le livre ne soit sur la table : sans ça, il posait un
  terrain dont il ne voyait rien avant deux tours. L'offre du tour est déjà tirée et rangée
  dans le `data` du terrain, donc l'adversaire recevra bien **la même** au début du sien.

### Point faible — 2 tours

*« Pendant 2 tours, les coups critiques du joueur qui a posé ce terrain infligent 3 fois les
dégâts de base au lieu de 2 fois. »*
→ modifier `getCriticalMultiplier`, restreint à l'attaquant du camp poseur.

### Protection Divine — 3 tours

*« Ajoute 50 de shield au personnage actif allié et 30 de shield au personnage actif
ennemi. »*

- Moteur : 3 activations au total (durée du terrain), dont celle à la pose, au début de
  chaque tour du possesseur. Le bouclier va aux actifs **du moment** (allié et ennemi),
  pas à ceux qui étaient là à la pose.
- Moteur : déclenché uniquement sur les tours du possesseur (pas ceux de l'adversaire) —
  l'actif adverse reçoit donc son shield par contrecoup de l'activation du possesseur,
  jamais deux fois par manche.

### Régulation Thermique — 5 tours

*« Pendant 5 tours, la Brûlure ne blesse plus vos personnages (actif comme banc) : elle les
soigne de 50 HP à la place. »*

- Moteur : modifier `getIncomingDamageAmount` filtré sur `source === 'burn'` et sur vos
  propres personnages. Le soin passe par `getIncomingHealAmount`, donc Hôpital le double.
  La durée de la brûlure, elle, continue de s'écouler normalement.

### Ronces grimpantes — 5 tours

*« Tous les personnages actifs subissent de plus en plus de dégâts en fonction du temps
qu'ils restent au poste actif. Premier tour 0% de dégâts prit en plus, ensuite, augmente de
10% les dégâts subis à chaque tour (Tour 2 = 10%, tour 3 = 20%) tant que le personnage actif
reste sur le poste actif. Se réinitialise si il y a un switch où si le personnage actif
meurt, seulement pour le joueur concerné. »*

- **Modifier `getIncomingDamageAmount`**, exactement comme le statut `vulnérable` : ça
  amplifie **toutes** les instances de dégâts reçues — attaques, capacités, effets d'objet ou
  de terrain, **tics de poison / brûlure / saignement** compris. Seul un coût en HP qu'un
  camp se paie à lui-même y échappe, parce qu'il passe par `ignoreDamageReduction`, qui
  court-circuite la requête.
- **Le compteur est porté par un statut** (`ronces-grimpantes-emprise`, `data.turns`) posé
  sur l'actif, et non par le `data` du terrain : le joueur voit ainsi un badge qui lui dit où
  il en est, et l'affichage ne peut pas se désynchroniser du multiplicateur. Le statut est
  privé à la carte (donc ignoré par « Inversion de la Réalité » / Poupée Voodoo, qui ne
  déplacent que les statuts de `BUILTIN_STATUS_IDS` — ce qui est bien le comportement voulu
  pour de la comptabilité liée au terrain).
- **Chaque camp a exactement un tour complet à 0 %.** Le compteur porte un drapeau `armed` :
  à la pose (et à chaque arrivée au poste actif), il est armé pour celui qui est **en train
  de jouer** et pas pour l'autre, dont le début de tour n'est pas encore passé. Résultat : le
  poseur compte son tour en cours comme premier tour, l'adversaire comptera le sien, et les
  deux passent à +10 % à leur deuxième tour sous le terrain.
- **Le reset passe par `onBecomeActive`**, ce qui couvre les trois chemins d'un seul coup :
  switch volontaire, switch **forcé** par une carte, et **remplacement après un KO** (qui
  n'est pas un switch et n'émet donc pas `onSwitch`). Le nouvel arrivant repart à 0 %.
- Chaque mise à jour **balaie tout le plateau du camp** avant de reposer le statut sur
  l'actif : un seul personnage par camp porte le badge, donc un personnage renvoyé au banc
  n'en garde pas un périmé. Le modifier vérifie de toute façon que la cible tient bien le
  poste actif de son camp — « tous les personnages **actifs** », le banc ne prend rien de
  plus.
- Le statut est posé avec `skipEvasionRoll: true` : le terrain frappe les deux camps, et son
  actif d'en face n'a pas à pouvoir « esquiver » de la comptabilité affichée.
- **`onTerrainRemoved` nettoie les deux camps** : le terrain peut partir autrement que par
  son propre décompte (détruit, remplacé), et son tick ne tournerait alors plus jamais — le
  badge resterait collé aux personnages pour toute la partie (même bug que celui corrigé sur
  Absorption Vitale).

### Salle de Gravité — 3 tours

*« Chaque fois qu'un joueur effectue un switch , son nouveau personnage qui arrive sur le
poste actif subit des dégâts . Le poseur du terrain subit 30 dégâts, tandis que l'adversaire
subit 50 dégâts. (Ne s'applique pas au remplacement d'un personnage KO). »*

- **Une seule ability, `trigger: 'onSwitch'`**, sans filtre sur `reason` : un switch
  volontaire comme un switch forcé par une carte (Manipulation de Light Yagami, Dieu du
  Tonnerre Volant…) déclenchent tous les deux les dégâts — le texte ne distingue pas, et
  seul le remplacement après KO est explicitement exclu, ce qui est déjà acquis puisque ce
  chemin n'émet pas `onSwitch` (voir CLAUDE.md).
- **`ctx.event.playerId`** (le camp qui possède le personnage qui arrive au poste actif,
  posé par `zones.switchActive`) détermine le montant : 30 si c'est le poseur du terrain
  (`ctx.ownerId`), 50 sinon. Cible : `ctx.event.data.newActiveInstanceId`.
- **`skipEvasionRoll: true`** : traité comme un aléa d'environnement plutôt que comme une
  attaque, donc jamais esquivable — y compris pour les 50 dégâts sur le camp adverse (choix
  demandé explicitement, cohérent avec Autel Démoniaque qui frappe aussi sans jet d'esquive).
  Les dégâts sur le camp du poseur ne peuvent de toute façon jamais être esquivés par leur
  propre camp (règle générale du moteur).
- Champs `hp` / `attacks` du JSON d'origine (artefacts du créateur de cartes, vides ou sans
  sens pour un terrain) : ignorés, comme d'habitude pour un `TerrainCardDef`.

---

## Note transverse — le passage obligé par `canTargetBench`

L'arrivée d'**Arène** (« toutes les compétences ciblant […] le banc sont totalement
bloquées ») a demandé que les cartes qui désignent un personnage de banc **demandent la
permission** au lieu de le faire directement. Sont passées par `canTargetBench` à cette
occasion : **Autel Démoniaque** (n'arrose plus un banc injoignable), **Locke** (le banc
adverse ne figure dans sa fenêtre de ciblage que s'il est atteignable) et **Crit +** (un
banc isolé n'est plus équipable, même par son propre camp).

Dans la foulée, **Bouclier Ultime** ne refuse plus que le ciblage **adverse** de son banc,
alors qu'il refusait celui de tout le monde. C'est déjà la règle de son immunité aux dégâts
juste en dessous (« immunisé contre tous les dégâts **adverses** »), et sans cette
distinction le passage généralisé ci-dessus aurait empêché son possesseur de soigner,
équiper ou buffer son propre banc.
