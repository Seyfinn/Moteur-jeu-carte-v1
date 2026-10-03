---
description: Ajouter une nouvelle carte dans le jeu (avec questions de clarification obligatoires)
---

Ajoute cette carte dans le jeu. Voici ce que l'utilisateur a fourni après la commande
(nom/slug de la carte, image, JSON, ou description texte — peut être vide si tout est en
pièce jointe) :

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
2. Trouve le JSON de la carte dans `E:\Code\ADMIN Cartes tout\` (le slug = l'id de la
   carte). S'il n'existe pas, demande-le à l'utilisateur ou, à défaut, traduis toi-même
   l'image/texte fourni — mais ne demande jamais de remplir un schéma.
3. Génère le squelette avec le scaffold, jamais à la main :

   ```bash
   npm run new-card -- <slug>
   ```

   (`--dry-run` d'abord si tu veux relire ce qu'il va produire.) Il crée le fichier de
   carte avec les textes exacts, l'enregistre dans `index.ts` et `DEMO_ROSTER`, ajoute
   l'entrée de `docs/cartes.md` et copie le PNG. Ne retouche pas les `description`
   générées : ce sont le texte de la carte.
4. Avant d'écrire la moindre logique, pose tes questions sur chaque `TODO(scaffold)` dont
   le comportement n'est pas évident (trigger d'une passive, cas limites, interactions
   avec le banc, durées). Puis remplis les `TODO(scaffold)` du fichier de carte ET celui
   de `docs/cartes.md` (ce que le moteur fait vraiment derrière le texte).
5. Vérifie avec `npm run build -w engine` puis `npm test -w engine`. Les trois filets
   (`card-conventions`, `card-lint`, `card-smoke`) couvrent la nouvelle carte : un
   `TODO(scaffold)` oublié, un texte qui dévie du JSON, un piège de CLAUDE.md ou un crash
   en partie font échouer la suite avec un message qui dit quoi corriger.
6. Par défaut, pas de test unitaire dédié ni de vérification navigateur pour une carte
   qui recombine des mécaniques déjà couvertes (voir CLAUDE.md pour l'exception).
