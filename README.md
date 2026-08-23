# Moteur de jeu de cartes — v1

Moteur pour un jeu de cartes 1v1 (façon TCG), conçu autour d'une contrainte centrale du document de règles :

> « Le moteur de jeu doit toujours permettre à un texte de carte d'autoriser une action, une cible, une fréquence, une durée ou une interaction qui serait normalement interdite ou différente. »

Concrètement : les règles par défaut (fin de tour, ciblage, limites d'utilisation...) ne sont jamais codées en dur. Elles passent par un système de **requêtes modifiables** (`packages/engine/src/queries.ts`) que n'importe quelle carte en jeu peut voter pour changer, avec la règle « ce qui empêche > ce qui permet » (section 10) appliquée automatiquement. Les effets de carte (attaques, abilities, objets, terrains) ont un accès impératif complet à un `EffectContext` (dégâts, valeur lock, soin, statuts, choix interactifs, clonage...) plutôt que d'être limités à un mini-langage déclaratif.

## Structure

```
packages/
  engine/    -- logique pure (aucune I/O), testable indépendamment
  server/    -- serveur Node + WebSocket, autoritatif, gère les salons
  web/       -- interface React minimale, jouable à deux
```

### `engine`

- `types.ts` — modèle de données (`GameState`, `PlayerState`, `CharacterInstance` avec `currentMaxHP`/`damage` séparés pour modéliser la valeur lock, `StatusInstance`, etc.)
- `queries.ts` — système de requêtes/modificateurs à vote (scanne les cartes en jeu à chaque appel, pas de registre à maintenir)
- `events.ts` — bus d'événements pour les abilities passives déclenchées (`onAttackDeclared`, `onCharacterKO`, `onTurnStart`, ...)
- `hp.ts` / `statuses.ts` / `zones.ts` — primitives HP/valeur lock, états (suspension sur banc, exception Poison/Brûlure), déplacements de zone (KO, remplacement obligatoire, cimetière, clonage)
- `turn.ts` / `match.ts` — machine à tours et orchestration d'une partie (`Match`), avec un pipeline d'actions asynchrone qui se met en pause sur `ctx.choose(...)` et reprend via `answerChoice`
- `cards/demo/` — le pool de cartes jouables (≈25 personnages, ≈17 objets, ≈11 terrains). `registerDemoCards()` les enregistre toutes ; `DEMO_ROSTER` est le pool complet exposé au deck-builder et `DEMO_STARTER_DECK` un deck légal prêt à jouer (6/6/2)
- `test/` — suite Vitest (règles de tour, HP/valeur lock, états, KO/victoire/égalité, garde-fous du moteur, cartes à mécanique inédite)

### `server`

Serveur `ws` + HTTP minimal, en mémoire (pas de base de données). Un salon = un code à 6 caractères + une instance de `Match`. Le serveur est la seule autorité : les clients envoient des intentions, validées par les mêmes requêtes que le moteur expose. La vue envoyée à chaque joueur masque les objets/terrains non joués de l'adversaire (section 1 des règles).

### `web`

Vite + React, interface fonctionnelle (pas de design final) : lobby (créer/rejoindre un salon), plateau (actif + banc des deux joueurs, terrain, cimetière, journal d'événements), barre d'actions contextuelle, et une modale de choix pour les décisions interactives des cartes (cible, ordre de résolution, oui/non).

## Lancer le projet

```bash
npm install
npm run dev
```

Cela démarre le serveur WebSocket (port 8787) et le client web (port 5173, `npm run dev -w web` en interne). Ouvrez `http://localhost:5173` dans deux onglets (ou partagez l'URL sur votre réseau local) pour jouer une partie complète.

Le serveur lit `SERVER_PORT`, puis `PORT`, puis 8787 par défaut. `PORT` seul est ce qu'injectent les hébergeurs (Render...) ; `SERVER_PORT` sert à le désambiguïser quand un outil a déjà réquisitionné `PORT` pour le serveur de dev web (Vite le lit aussi).

Tests et vérifications :

```bash
npm run test -w engine     # suite Vitest du moteur
npm run build -w engine    # typecheck du moteur
npm run typecheck -w web   # typecheck du client (aussi exécuté par `npm run build -w web`)
npm run build              # engine + web + server
```

## Ajouter une nouvelle carte

Une carte est un fichier dans `packages/engine/src/cards/demo/` (ou un nouveau dossier une fois qu'on sort du stade « démo ») qui exporte un `CharacterCardDef` / `ObjectCardDef` / `TerrainCardDef` (voir `packages/engine/src/cards/types.ts`). Chaque attaque/ability a une fonction `execute(ctx)` avec accès complet aux primitives du moteur ; les cartes qui doivent modifier une règle générale (fréquence, ciblage, limite d'objets équipés, ATK effectif...) déclarent un `modifiers: ModifierDef[]` scanné automatiquement par le moteur tant que la carte est en jeu.

## Reprise de partie et prompts abandonnés

- **Reprise de session** : à l'entrée dans un salon, le serveur remet un jeton de siège que le client garde en `sessionStorage`. Recharger l'onglet le rejoue automatiquement (`resume-session`) et remet le joueur exactement sur son siège, avec l'état à jour. Volontairement en `sessionStorage` (portée onglet) et non `localStorage` : jouer en local, c'est deux onglets sur la même origine, et un jeton partagé ferait que chaque onglet écrase le siège de l'autre. Conséquence assumée : fermer l'onglet perd le siège, seul le rechargement est couvert. Un jeton périmé (salon recyclé, serveur redémarré) renvoie `session-expired` et le client repart proprement sur le lobby.
- **Prompts abandonnés** : un choix laissé sans réponse pendant `CHOICE_TIMEOUT_MS` (120 s par défaut, `packages/server/src/room.ts`) est résolu par le serveur avec la réponse neutre de `defaultChoiceAnswer` — sinon un joueur qui ferme son onglet en pleine modale gèlerait la partie de l'autre pour toujours. Les deux joueurs voient le compte à rebours. Surchargeable via la variable d'environnement `CHOICE_TIMEOUT_MS` (pratique pour les tests).

## Limites connues

- **Pas de persistance** : les parties vivent en mémoire sur le serveur. Un redémarrage du serveur perd les salons en cours (et les jetons de siège qui vont avec).
- **Salons éphémères** : un salon dont les deux joueurs sont partis est recyclé après 10 minutes. Les codes font 2 caractères (~1000 combinaisons), ce qui suffit pour un usage entre amis mais pas pour du volume.
- **Pas d'IA / de mode solo** : il faut deux navigateurs (ou deux personnes).
- **`onStatusApplied` / `onCoinFlip`** sont déclarés dans `EventName` mais jamais émis (voir CLAUDE.md).
