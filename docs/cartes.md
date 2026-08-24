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
- 2 objets et 1 terrain par tour maximum ; le 2ᵉ objet termine le tour.

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
- **Shroud** (active) — *« Akali lance son nuage de fumée, lui accordant esquive pendant
  3 tours. »* → statut `evasive`, 33 %.
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

### Blitzcrank — 250 HP

- **Poing d'acier** (50 ATK) — *« Inflige 50 dégâts à l'actif adverse. »*
- **Mana Barrier** (passive, `afterDamage`, banc, 1×/partie) — *« Si Blitzcrank tombe sous
  50HP, il gagne un bouclier absorbant 150 points de dégâts, mais Hook est verrouillé
  pendant 2 tours. Ne se déclenche qu'une seule fois par partie. »*
  - Moteur : la réserve n'est **pas** le champ `shield` natif mais un statut propre
    (`blitzcrank-mana-barrier-shield`, volontairement **visible**) consommé par un modifier
    `getIncomingDamageAmount`. Conséquence : Brise bouclier et Voleur de bouclier n'ont
    aucune prise dessus. Le verrou de Hook est le statut `blitzcrank-hook-locked`.
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

### Chopper — 250 HP — carte unique

- **Heavy Point** (60 ATK) — *« Inflige 60 dégâts à l'actif adverse. Si les dégâts passent,
  33% de chance d'appliquer Poison pendant 1 tour. »*
  - Moteur : le jet de poison n'a lieu que si le coup n'a pas été esquivé.
- **Traque** (active, utilisable du banc) — *« Soigne un personnage allié au choix (actif ou
  banc) de 70 HP. Utilisable même depuis le banc. Rechargement : 3 tours après usage. »*
  - Moteur : le rechargement est un statut de cooldown à `remainingTurns = 3 + 1` (posé sur
    soi pendant son propre tour), pas un `usesPerGame`. Sans `ticksOnBench`, il est
    suspendu tant que Chopper reste au banc — la recharge ne reprend qu'une fois actif.

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

### Rengoku — 340 HP

- **Souffle du feu** (30 ATK) — *« Inflige 30 dégâts à l'actif adverse et, si le coup touche,
  le met en Brûlure pendant 2 tours. »*
  - Moteur : un seul jet d'esquive partagé (`ctx.rollEvasion` + `skipEvasionRoll`) pour les
    dégâts et la brûlure. Retoucher une cible déjà en feu **rafraîchit** l'instance
    existante (durée = max des deux) au lieu d'en créer une deuxième.
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

### Soraka — 160 HP

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
  l'actif. »* → `forceSwitch`, donc insensible à `chained`/`stun` sur l'actif, mais bloqué
  par un interdit explicite de switch (Bouclier Ultime).

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
    porteur d'origine rend moins. Le rechargement est un statut de cooldown.

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

- Moteur : sans terrain à soi, la carte est un no-op (elle reste jouable et se consomme).
  `destroyTerrain` sur le sien, `shortenTerrain` sur celui d'en face.

### Caméléon

*« Défaussez une carte objet de votre réserve et remplacez-la par une autre carte objet de
votre deck, au choix — à condition que celle-ci n'ait pas déjà atteint son nombre maximum
d'exemplaires. »*

- Moteur : choix via `ctx.chooseOption` (le prompt `select-characters` ne sait afficher que
  des personnages). `ctx.createObject` fabrique la nouvelle carte.

### Chaînes — exemplaire unique

*« Enchaîne le personnage actif ennemi : il ne peut plus être switché via l'action standard,
jusqu'à sa mort. Un exemplaire. »*

- Moteur : statut `chained` sans `remainingTurns`. Ne bloque que le switch **standard** :
  un `forceSwitch` (Hook, Boogie Woogie, Dieu du Tonnerre Volant) passe outre.

### Concentration

*« La prochaine attaque du personnage actif a 70% de chances de critiquer. Si elle ne crit
pas, elle n'inflige aucun dégât et le personnage actif ne pourra pas attaquer au tour
suivant. »*

- Moteur : statut générique `concentration` (`data.percent`). Une esquive adverse compte
  comme un échec : le malus s'applique quand même.

### Couteau dans le dos — exemplaire unique

*« Exemplaire unique. Dès maintenant et jusqu'à la fin de votre prochain tour, les dégâts
infligés au banc ennemi par n'importe lequel de vos personnages (attaque ou capacité) sont
doublés. »*

- Moteur : statut `bench-damage-bonus` (`data.multiplier`) posé sur **tous** vos personnages,
  avec `ticksOnBench: true`.

### Déchetterie — exemplaire unique

*« Exemplaire unique. Tire 2 cartes objet au hasard dans le cimetière adverse et vous en fait
choisir une : elle rejoint votre réserve, jouable normalement plus tard. »*

### Détermination — exemplaire unique

*« Exemplaire unique. Jusqu'à la fin de ce tour, aucun coup ne peut faire descendre votre
personnage actif en dessous de 1 HP. »*

- Moteur : statut `death-ward`, avec `ticksOnBench: true`. Ne couvre **pas** la perte de HP
  max (Mahito, poison Sang Maudit) ni une mise à mort directe par `koCharacter` (Perfect
  Execution d'Akali).

### Dieu du Tonnerre Volant

*« Téléportation : échange votre actif avec un personnage de votre banc, gratuitement et sans
finir votre tour. Ignore Stun et Chaînes. »*

- Moteur : `forceSwitch`. Reste bloqué par un interdit explicite de switch (Bouclier Ultime),
  qui vote via `canSwitchStandard` **et** est vérifié ici.

### Echange équivalent

*« Sacrifiez 2 cartes de votre réserve non jouée (objets ou terrains, au choix). En échange,
récupérez une carte objet ou terrain au choix dans votre cimetière. »*

- Moteur : les deux choix passent par `ctx.chooseOption`.

### Extension du territoire — exemplaire unique

*« Exemplaire unique. Rajoute 2 tours au terrain actif du joueur qui la joue. »*

- Moteur : no-op si le terrain est de durée indéfinie ou s'il n'y a pas de terrain en jeu.

### Miroir de Renvoi

*« À lier à votre personnage actif. Celui-ci subit 100% des dégâts de la prochaine attaque
qu'il subit et en renvoie immédiatement 50% à l'attaquant, puis le miroir se détruit. »*

- Moteur : statut `damage-reflect` (`data: { percent, objectInstanceId }`) ; le moteur
  détruit l'objet porteur en consommant le statut. `attachSelfTo` lie l'objet à l'actif.

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

*« Pendant 3 tours, vous ne pouvez plus switcher. En échange, votre banc devient intouchable :
impossible à cibler et immunisé contre tous les dégâts adverses. »*

- Moteur : modifiers `canSwitchStandard`, `canTargetBench`, `getIncomingDamageAmount`,
  `getIncomingValeurLockAmount`. L'immunité distingue l'attaquant grâce à `attackerOwnerId` :
  vos propres cartes peuvent toujours prélever un coût en HP sur votre banc.

### Brise bouclier — 6 tours

*« Pendant 6 tours, le bouclier des personnages ennemis n'absorbe plus rien. »*

- Moteur : modifier `canShieldAbsorb`. La valeur de bouclier reste affichée et redevient
  efficace à l'expiration. Ne touche pas les pseudo-boucliers d'une carte (Mana Barrier).

### Coeur acier — 6 tours

*« Marque l'actif adverse. Si c'est toujours le même à votre tour suivant, la marque se
charge : la première attaque qui le touche alors rapporte 150 HP max à son attaquant (pas de
soin), puis la marque se réinitialise. Si l'adversaire a switché entre-temps, la marque passe
simplement sur le nouvel actif. »*

- Moteur : statut `hit-bounty` (`data: { bonusMaxHP, forOwnerId }`), consommé au premier coup
  qui touche vraiment. Les trois passives filtrent sur leur propre terrain, et
  `onTerrainRemoved` nettoie la marque chargée.

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
