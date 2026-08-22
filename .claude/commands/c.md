---
description: Ajouter une nouvelle carte dans le jeu (avec questions de clarification obligatoires)
---

Ajoute cette carte dans le jeu. Voici ce que l'utilisateur a fourni après la commande
(image de carte, JSON, ou description texte — peut être vide si tout est en pièce
jointe) :

$ARGUMENTS

Je veux que tu me demandes de t'expliquer chaque partie de la carte que tu ne
comprends pas. Je veux à tout prix éviter les bugs ou des malentendus sur le
fonctionnement d'un point d'une carte. Pose-moi des questions avant de valider le code
d'une carte. Si une idée de la carte te paraît trop complexe pour être mise en place
dans le jeu sans que ça crée trop de bugs, dis-le moi, pour qu'on réfléchisse à une
solution.

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
3. Crée le fichier dans `packages/engine/src/cards/demo/<kebab-case>.ts`, puis
   enregistre-le dans `packages/engine/src/cards/demo/index.ts` (import, ajout dans le
   bloc `export { ... }`, `registerCard(...)` dans `registerDemoCards()`, et ajout de
   l'id dans `DEMO_ROSTER` selon le type).
4. Vérifie avec `npm run build -w engine`.
5. Par défaut, pas de test unitaire dédié ni de vérification navigateur pour une carte
   qui recombine des mécaniques déjà couvertes (voir CLAUDE.md pour l'exception).
