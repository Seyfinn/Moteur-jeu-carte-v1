---
description: Ajouter une nouvelle carte au jeu (image/JSON/texte en entrée)
---

L'utilisateur veut ajouter une nouvelle carte au jeu. Voici ce qu'il a fourni après la
commande (image de carte, JSON, ou description texte — peut être vide si tout est en
pièce jointe) :

$ARGUMENTS

Étapes à suivre :

1. Lis d'abord [CLAUDE.md](CLAUDE.md) à la racine du repo si ce n'est pas déjà en
   contexte — il documente l'API des cartes (`CharacterCardDef`/`ObjectCardDef`/
   `TerrainCardDef`, `AttackDef`, `AbilityDef`, `EffectContext`), les patterns récurrents
   (attaque simple, compteur persistant, ré-activation conditionnelle, AoE, modifiers) et
   le workflow d'enregistrement de carte. Ne re-explore pas `types.ts`/`match.ts`/
   `events.ts`/`zones.ts`/`statuses.ts` sauf si CLAUDE.md ne suffit pas à trancher un
   détail.
2. Traduis toi-même l'image/JSON/texte fourni en `CharacterCardDef`, `ObjectCardDef` ou
   `TerrainCardDef` — ne demande pas à l'utilisateur de remplir un schéma.
3. Si un point est ambigu (ex : timing d'un effet, ce qui se passe si la cible est KO,
   interaction avec un statut existant, valeur exacte d'un chiffre flou sur l'image),
   pose la question avant d'écrire le code plutôt que de deviner.
4. Si un mécanisme demandé semble trop risqué ou fragile à implémenter tel quel avec
   l'API actuelle (contourne le moteur, dépend d'un ordre d'exécution non garanti, etc.),
   signale-le à l'utilisateur et propose une alternative plus sûre avant d'implémenter.
5. Crée le fichier dans `packages/engine/src/cards/demo/<kebab-case>.ts`, puis
   enregistre-le dans `packages/engine/src/cards/demo/index.ts` (import, ajout dans le
   bloc `export { ... }`, `registerCard(...)` dans `registerDemoCards()`, et ajout de
   l'id dans `DEMO_ROSTER` selon le type).
6. Vérifie avec `npm run build -w engine`.
7. Par défaut, pas de test unitaire dédié ni de vérification navigateur pour une carte
   qui recombine des mécaniques déjà couvertes (voir CLAUDE.md pour l'exception).
