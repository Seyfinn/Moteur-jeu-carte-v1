# Référence des cartes — texte imprimé vs. comportement réel

⚠️ **Ce fichier n'est PAS affiché en jeu.** C'est la note de travail de Claude.

Le champ `description` d'une carte est le **texte exact de la carte** (voir la règle dans
[CLAUDE.md](../CLAUDE.md)) : rien n'y est ajouté, expliqué ni résumé. Tout ce que ce texte
ne dit pas mais que le moteur fait quand même est consigné ici, sous « Moteur ».

À tenir à jour à chaque carte ajoutée ou modifiée : une entrée par carte, avec le texte
imprimé et les faits mécaniques. Le tableau de valeurs vient des constantes en tête de
chaque fichier `packages/engine/src/cards/demo/<carte>.ts`.

Rappels transverses qui valent pour **toutes** les cartes, et qu'aucune n'a donc à répéter :

- Base 5 % d'esquive et 2 % de critique (x2) sur toute attaque/ability hostile ; les statuts
  `evasive`/`critical` montent la base à 33 %. Esquive et critique ne se jouent qu'entre
  camps adverses (jamais sur un soin ou un coût que le camp se paie).
- Poison = 10 HP + 10 % des HP max par tour ; Burn = 50 HP par tour ; Bleed = 10 % des HP
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

### Bakugo — 250 HP

- **Explosion** (60 ATK) — *« Inflige 60 dégâts à l'actif adverse. »*
- **Sueur Nitroglycérine** (passive) — *« Si le personnage actif adverse subit déjà l'effet
  Burn, les attaques de Bakugo infligent +70 dégâts supplémentaires. »*
  - Moteur : modifier `getEffectiveATK`, réévalué à chaque coup. Le bonus tombe dès que la
    brûlure expire.

### Black Panther — 340 HP

- **Griffes** (40 ATK) — *« 33% de chance d'infliger vulnérable pendant 1 tour. »*
  - Moteur : première carte du pool à poser `vulnerable`. `remainingTurns = 1 + 1` : posé sur
    l'ennemi pendant le tour de Black Panther, il serait sinon retiré au tout début du tour
    adverse, donc avant que Black Panther ait pu frapper une cible réellement vulnérable
    (même `+1` que le Silence de Zoé ou le Désarmement de Sion).
  - Moteur : le jet de 33 % n'a lieu que si le coup a réellement entamé la cible (même
    convention que Sion/Killua/Chopper) — une esquive annule donc aussi le vulnérable.
- **Energie Cinétique** (active, 1×/partie) — *« Black Panther stock 50% des dégâts qu'il
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

### Chopper — 250 HP — incompatible avec Soraka

- Deck : l'incompatibilité avec [Soraka](#soraka--160-hp--incompatible-avec-chopper) est
  déclarée sur la carte de celle-ci et symétrisée par le moteur — ne pas la re-déclarer ici,
  sous peine d'avoir deux sources de vérité pour la même règle. (L'exemplaire unique, lui,
  n'est plus propre à la carte : tous les personnages le sont.)
- **Heavy Point** (60 ATK) — *« Inflige 60 dégâts à l'actif adverse. Si les dégâts passent,
  33% de chance d'appliquer Poison pendant 1 tour. »*
  - Moteur : le jet de poison n'a lieu que si le coup n'a pas été esquivé.
- **Traque** (active, utilisable du banc) — *« Soigne un personnage allié au choix (actif ou
  banc) de 70 HP. Utilisable même depuis le banc. Rechargement : 3 tours après usage. »*
  - Moteur : le rechargement est un statut de cooldown à `remainingTurns = 3 + 1` (posé sur
    soi pendant son propre tour), pas un `usesPerGame`. Il porte `ticksOnBench: true` : la
    recharge descend même quand Chopper reste au banc — c'est bien là que la Traque se joue,
    et sans ce champ elle ne revenait jamais.

### Guts — 250 HP

- **Coup d'épée** (50 ATK) — *« Inflige 50 dégâts à l'actif adverse. »*
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
  - Moteur : modifier `getEvasionPercent` à 33 %, pas un statut `evasive`. Donc il tient dès
    le premier coup de la partie, survit à une résurrection, et ne peut être ni dissipé ni
    volé.
- **Extension du Territoire** (active, 1×/partie) — *« Inflige Stun au personnage actif
  adverse pendant son prochain tour. Utilisable une seule fois par partie. »*
  - Moteur : statut `stun` à `remainingTurns = 2` (le `+1` des statuts bloquants).

### Hulk — 500 HP

- **Smash** (30 ATK) — *« Inflige 30 dégâts à l'actif adverse. »*
- **Enervement** (passive, `afterDamage`, banc) — *« Chaque fois que Hulk subit une instance
  de dégâts (actif ou banc), il s'énerve et gagne 30 dégâts d'attaque de façon
  permanente. »*
  - Moteur : même montage que Berserk (compteur caché + `getEffectiveATK`). Compte les
    *instances* de dégâts, pas les points : un tic de brûlure vaut autant qu'une grosse
    attaque.

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
  soit actif ou au banc. »* → même montage que L'Infini (modifier `getEvasionPercent`).
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

### Locke — 250 HP

- **Purgatoire** (passive, `afterDamage`) — *« Si l'ennemi au poste actif est à 10% de ses
  hp max ou moins, l'execute immédiatement. »*
  - Moteur : aura active uniquement quand **Locke est lui-même l'actif**
    (`usableFromBench` non déclaré, donc `canUseAbility` l'exige). Se déclenche après
    n'importe quelle instance de dégâts touchant l'actif adverse (attaque, ability, tic de
    poison/brûlure/saignement), pas seulement les coups de Locke. Respecte `death-ward`
    (Détermination). Un seul trigger (`afterDamage`) : un second trigger `onBecomeActive`
    aurait dû être une deuxième `AbilityDef`, ce qui aurait affiché "Purgatoire" en double
    dans le détail de carte -- angle mort assumé, voir le commentaire dans `locke.ts`.
- **Cloué** (passive, descriptive) — *« Lorsqu'un ennemi a 3 clous sur lui, Locke fait
  exploser les clous infligeant 100 dégâts + 50% hp max. »*
  - Moteur : logique réellement codée dans Marteau ci-dessous (c'est la pose du 3e clou
    qui décide de l'explosion). "50% hp max" = 50% des HP max **de la cible**, pas de
    Locke. Les clous sont consommés par l'explosion (compteur remis à 0, pas de statut à
    réappliquer) ; il faut donc replanter 3 clous pour refaire exploser la même cible.
- **Marteau** (0 ATK) — *« Locke enfonce un clou sur n'importe quel ennemi, même sur le
  banc. Cette attaque inflige a 65% de chance d'infliger silence ultime si Locke attaque
  l'ennemi actif. »*
  - Moteur : cible n'importe quel personnage adverse (actif ou banc) via un ciblage sur le
    plateau. Compteur de clous par cible dans un statut custom (`data.count`, affiché en
    label `Clou (n/3)`). Un seul jet d'esquive pour toute la résolution (clou + éventuel
    Silence Ultime), via `ctx.rollEvasion` avant de toucher au compteur -- contrairement à
    Zoé/Chopper/Sion qui roulent séparément dégâts puis effet sur coup, Marteau ne fait
    aucun dégât et n'a donc qu'un seul "coup" à esquiver. Le Silence Ultime (1 tour,
    `remainingTurns: 2`) ne peut se déclencher que si la cible est l'actif adverse au
    moment du clou, et se roule même sur le tour où la cible explose (les deux effets ne
    s'excluent pas). L'explosion, elle, passe par `dealDamage` et roule sa propre esquive/
    critique indépendamment (c'est une vraie deuxième instance de dégâts).

### Mahito — 270 HP

- **Paume Transfiguratrice** (90 ATK) — *« Inflige 90 dégâts à l'actif adverse. »*
  - Moteur : `dealDamage(..., { asValeurLock: true })` — le coup reste esquivable, mais ce
    qui passe retire du HP **max**, donc jamais soignable. Un KO ainsi obtenu nomme bien
    Mahito comme tueur.
- **Altération de l'Âme** (passive) — *« Toutes les attaques de Mahito convertissent 100% de
  leurs dégâts directement en réduction de HP max. »* (descriptif : la mécanique est dans
  l'`AttackDef`.)
- **Marque** (passive) — *« Les PV retirés par Mahito ne peuvent plus jamais être récupérés,
  par aucun soin. »* (conséquence directe du valeur lock, rien de plus dans le code.)

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

- **Récupération de matériaux** (40 ATK) — *« Inflige 40 dégâts à l'actif adverse. Débloque
  Living Forge pour le reste de la partie. »* → pose un statut caché de déblocage.
- **Matériaux** (passive) — *« Ornn ne peut pas utiliser Living Forge sans avoir utilisé
  "Récupération de matériaux" au moins une fois auparavant. »* (descriptif ; la garde est la
  `condition()` de Living Forge.)
- **Living Forge** (active) — *« Ornn se bloque sur le poste actif pendant 3 tours (ne peut
  ni attaquer ni switch). S'il est toujours vivant à l'issue, récupère un objet ou terrain
  au choix parmi les 4 cimetières. »*
  - Moteur : le blocage est la combinaison `chained` + `disarmed` ; la récompense est un
    passive `onTurnStart` séparé qui lit un statut caché de suivi. « 4 cimetières » = les
    deux vôtres (objets, terrains) et les deux de l'adversaire.
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

- **Lacération** (70 ATK) — *« Inflige 70 dégâts à l'actif adverse et applique 2 stacks de
  bleed. »*
  - Moteur : ré-appliquer bleed **additionne** les stacks (max 10). N'importe quel soin sur
    le porteur enlève le saignement avant qu'il ne tique.
- **Sort Inversé** (passive, `onTurnEnd`, banc) — *« À la fin de ton tour, Sukuna récupère
  30 PV automatiquement, même si elle est sur le banc. »*
- **Extention de territoire** (passive) — *« Tant que la carte Terrain Autel Démoniaque est
  en jeu (jouée par vous ou l'adversaire), les attaques de Sukuna gagnent +40 dégâts. »*
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

*« Utilisable uniquement si ton personnage actif a au moins 150 HP restants. Réduit ses HP
actuels à 10 HP et multiplie par 2 les dégâts de toutes ses attaques pendant ce tour. »*

- Moteur : le coût en HP est infligé avec `ignoreShield` + `ignoreDamageReduction` (sinon le
  bouclier absorbe le coût). Le `atk-multiplier` porte `ticksOnBench: true`, sinon partir au
  banc figerait le buff pour le reste de la partie.

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

- Moteur : **pas** d'`equipment: true` malgré le « à lier » de la maquette — tout l'effet est
  porté par des statuts temporaires, plus rien n'a besoin de rester en jeu, et l'objet
  occuperait sinon un des 2 emplacements du personnage pour rien.
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

### Caméléon

*« Défaussez une carte objet de votre réserve et remplacez-la par une autre carte objet de
votre deck, au choix — à condition que celle-ci n'ait pas déjà atteint son nombre maximum
d'exemplaires. »*

- Moteur : choix via `ctx.chooseOption` (le prompt `select-characters` ne sait afficher que
  des personnages). `ctx.createObject` fabrique la nouvelle carte.

### Chaînes — exemplaire unique

*« Enchaîne le personnage actif ennemi : il ne peut plus être switché TOTALEMENT, jusqu'à sa
mort. Un exemplaire. »*

- Moteur : statut `chained` sans `remainingTurns`. Bloque **tout** départ du poste actif, le
  switch standard comme les switchs forcés (Hook, Boogie Woogie, Portail Dimensionnel, Dieu
  du Tonnerre Volant) : le garde vit dans `zones.switchActive`, l'unique point de passage de
  tous les switchs. Le défensif prime sur l'offensif.
- Le remplacement après un KO n'est pas concerné (il ne passe pas par `switchActive`) : un
  personnage mort n'est plus enchaîné.

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
infligés au banc ennemi par n'importe lequel de vos personnages (attaque ou capacité) sont
doublés. »*

- Moteur : statut `bench-damage-bonus` (`data.multiplier`) posé sur **tous** vos personnages,
  avec `ticksOnBench: true`.

### Déchetterie — exemplaire unique

*« Exemplaire unique. Tire 2 cartes objet au hasard dans le cimetière adverse et vous en fait
choisir une : elle rejoint votre réserve, jouable normalement plus tard. »*

- Moteur : `ctx.chooseOption` avec un `card` par option — la modale montre les deux cartes
  tirées en illustration, pas leurs seuls noms.

### Détermination — exemplaire unique

*« Exemplaire unique. Jusqu'à la fin de ce tour, aucun coup ne peut faire descendre votre
personnage actif en dessous de 1 HP. »*

- Moteur : statut `death-ward`, avec `ticksOnBench: true`. Ne couvre **pas** la perte de HP
  max (Mahito, poison Sang Maudit) ni une mise à mort directe par `koCharacter` (Perfect
  Execution d'Akali).

### Dieu du Tonnerre Volant

*« Téléportation : échange votre actif avec un personnage de votre banc, gratuitement et sans
finir votre tour. Ignore Stun. »*

- Moteur : `forceSwitch`, qui ignore bien le Stun. Ne passe **pas** au travers de Chaînes
  depuis que `chained` bloque tout switch, ni au travers d'un interdit explicite (Bouclier
  Ultime).
- Refusée avant d'être consommée (`unplayableReason`) quand la téléportation n'aurait pas
  lieu : banc vide, actif enchaîné, ou switch interdit par une carte en jeu.

### Echange équivalent

*« Sacrifiez 2 cartes de votre réserve non jouée (objets ou terrains, au choix). En échange,
récupérez une carte objet ou terrain au choix dans votre cimetière. »*

- Moteur : les deux choix passent par `ctx.chooseOption`.

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

*« Tue ce personnage, au bout de 20 tours, le réanime avec 100pv max supplémentaire et 50
d'attaque supplémentaire. Si il ne vous reste plus qu'un personnage en vie. Cette carte ne
ferra pas effet. »*

- Moteur : **pas** d'`equipment: true` malgré le « à lier » de la maquette — la carte tue sa
  cible dans la foulée, ce qui enverrait tout objet équipé au cimetière avec elle
  (`zones.koCharacter`). Poser le logo 🔗 promettrait un lien durable qui n'existe pas.
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
  nouveau maximum. Les +50 ATK sont un `atk-boost` sans `remainingTurns` (donc permanent)
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

### Potion force

*« Votre personnage actif inflige 40 dégâts de plus avec ses attaques jusqu'à la fin de ce
tour. »*

- Moteur : statut `atk-boost` avec `ticksOnBench: true`.

### Poupée Voodoo

*« Prend toutes les altérations négatives d'un personnage au choix sur le plateau (stun,
désarmé, silence, ATK réduite, brûlure, poison, saignement, chaînes) et les déplace sur un de
vos personnages ou sur l'actif ennemi. »*

- Moteur : ne déplace que des statuts de `BUILTIN_STATUS_IDS` ; un compteur privé à une carte
  serait détruit par le transfert.

### Voleur de bouclier

*« Retire tout le shield du personnage actif ennemi et l'applique à votre personnage
actif. »*

- Moteur : agit sur le champ `shield` natif ; le pseudo-bouclier de Mana Barrier n'est pas un
  `shield` et n'est donc pas volable. S'ajoute au bouclier existant.

---

## Terrains

### Absorption Vitale — 4 tours

*« Votre personnage actif est scellé : pendant 3 tours il ne peut ni switcher ni utiliser ses
capacités (il peut toujours attaquer). S'il tient jusqu'au bout, il meurt et vous ranimez sur
votre banc, à la moitié de ses HP max, un autre personnage de votre cimetière (jamais celui
qui vient d'être sacrifié). S'il meurt ou quitte le poste actif avant la fin, le terrain part
au cimetière sans rien donner. »*

- Moteur : sceau = `chained` + `silence-ultimate` sans durée propre, d'où un passive
  `onTerrainRemoved` obligatoire pour les lever si le terrain part autrement que par son
  décompte. Les trois passives filtrent sur `terrainInstanceId === sourceInstanceId`.

### Autel Démoniaque — 3 tours

*« Pendant 3 tours, au début du tour du joueur actif, inflige 30 dégâts au personnage actif
adverse et 15 dégâts à chaque personnage sur le banc adverse. »*

- Moteur : 3 activations au total, dont celle à la pose (`onTerrainPlayed`, filtré sur son
  propre terrain) ; les suivantes viennent d'`onTurnStart`.

### Bouclier Ultime — 3 tours

*« Pendant 3 tours, votre banc devient intouchable : impossible à cibler et immunisé contre
tous les dégâts adverses. »*

- Moteur : modifiers `canTargetBench`, `getIncomingDamageAmount`,
  `getIncomingValeurLockAmount`. L'immunité distingue l'attaquant grâce à `attackerOwnerId` :
  vos propres cartes peuvent toujours prélever un coût en HP sur votre banc.
- La carte n'a plus de contrepartie : elle portait aussi un modifier `canSwitchStandard`
  qui interdisait à son possesseur de changer de personnage pendant les 3 tours. Retiré —
  plus aucune carte du pool ne refuse `canSwitchStandard`.

### Coeur acier — 6 tours

*« Marque l'actif adverse. Si c'est toujours le même à votre tour suivant, la marque se
charge : la première attaque qui le touche alors rapporte 150 HP max à son attaquant (pas de
soin), puis la marque se réinitialise. Si l'adversaire a switché entre-temps, la marque passe
simplement sur le nouvel actif. »*

- Moteur : deux statuts qui se succèdent sur la cible, pour qu'elle voie venir le coup :
  `coeur-acier-mark` (marque posée, aucune mécanique propre, purement visuelle) puis le
  statut générique `hit-bounty` (`data: { bonusMaxHP, forOwnerId }`) une fois la marque
  chargée, consommé au premier coup qui touche vraiment.
- « Pas de soin » au sens littéral : la prime passe par
  `raiseMaxHP(..., { keepCurrentHP: true })`, donc le plafond de l'attaquant monte de 150 et
  ses PV actuels ne bougent pas d'un point.
- « La marque se réinitialise » : le terrain garde `markedInstanceId`/`charged` dans ses
  `data`, et repère l'encaissement au fait que `hit-bounty` a disparu d'une cible encore
  marquée comme chargée. Il repose alors une marque neuve, qui devra attendre un tour de
  plus pour se recharger. Sans ce retour à zéro, le terrain rechargeait la même cible à
  chaque tour et repayait la prime autant de fois.
- Les trois passives filtrent sur leur propre terrain, et `onTerrainRemoved` nettoie les
  deux statuts.

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

### Hôpital — 2 tours

*« Les soins reçus par vos personnages sont multipliés par 2 pendant 2 tours. »*
→ modifier `getIncomingHealAmount`.

### Point faible — 2 tours

*« Pendant 2 tours, les coups critiques du joueur qui a posé ce terrain infligent 3 fois les
dégâts de base au lieu de 2 fois. »*
→ modifier `getCriticalMultiplier`, restreint à l'attaquant du camp poseur.

### Protection Divine — 3 tours

*« Pendant 3 tours, au début de chaque tour du possesseur, ajoute 50 de shield à son
personnage actif du moment. »*

- Moteur : 3 activations au total, dont celle à la pose. Le bouclier va à l'actif **du
  moment**, pas à celui qui était là à la pose.

### Régulation Thermique — 5 tours

*« Pendant 5 tours, la Brûlure ne blesse plus vos personnages (actif comme banc) : elle les
soigne de 50 HP à la place. »*

- Moteur : modifier `getIncomingDamageAmount` filtré sur `source === 'burn'` et sur vos
  propres personnages. Le soin passe par `getIncomingHealAmount`, donc Hôpital le double.
  La durée de la brûlure, elle, continue de s'écouler normalement.
