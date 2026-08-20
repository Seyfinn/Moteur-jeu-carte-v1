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
- `cards/demo/` — 8 cartes d'exemple (Nakime, Gilgamesh V, Kashimo V, Gogeta Blue V, Beyond Netero VMAX, Batman V, Allié indomptable, Terrain : Domaine Quincy) qui servent à démontrer l'étendue des mécaniques possibles (lancers de pièce, valeur lock, esquive, clonage à la mort, aura de terrain, fréquence de déclenchement doublée, protection du banc...). **Ce ne sont pas les cartes finales du jeu.**
- `test/` — suite Vitest (règles de tour, HP/valeur lock, états, KO/victoire/égalité, cartes de démo, simulation bot-vs-bot)

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

Pour lancer uniquement les tests du moteur :

```bash
npm run test -w engine
```

## Ajouter une nouvelle carte

Une carte est un fichier dans `packages/engine/src/cards/demo/` (ou un nouveau dossier une fois qu'on sort du stade « démo ») qui exporte un `CharacterCardDef` / `ObjectCardDef` / `TerrainCardDef` (voir `packages/engine/src/cards/types.ts`). Chaque attaque/ability a une fonction `execute(ctx)` avec accès complet aux primitives du moteur ; les cartes qui doivent modifier une règle générale (fréquence, ciblage, limite d'objets équipés, ATK effectif...) déclarent un `modifiers: ModifierDef[]` scanné automatiquement par le moteur tant que la carte est en jeu.

## Limites connues de ce lot (v1)

- **Roster fixe** : les deux joueurs démarrent avec les mêmes 8 cartes de démo (pas de deck-builder). Le roster complet visé par les règles (6 personnages / 6 objets / 2 terrains, jusqu'à 2 exemplaires) n'est pas encore rempli faute de cartes définitives.
- **Pas de persistance** : les parties vivent en mémoire sur le serveur ; un redémarrage serveur perd les salons en cours, et il n'y a pas de reconnexion après coupure réseau.
- **Accessible en local / LAN uniquement** : pour qu'un ami hors réseau local rejoigne, il faut soit un tunnel (ngrok, Cloudflare Tunnel...), soit un déploiement réel (Render, Railway, Fly.io, VPS...) — pas fait dans ce lot.
- **Pas de deck-builder / construction de deck** : les limites de copies (max 2, ou 1 si précisé) ne sont pas encore validées puisqu'il n'y a pas encore de vrai pool de cartes à construire.
