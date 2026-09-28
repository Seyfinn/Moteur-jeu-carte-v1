# Effets visuels du combat

Les composants de combat partagent `EffectPrimitives.tsx` (glyphes SVG, cercles gravés,
particules déterministes) et `combatEffects.css`, chargé après le style du plateau.
Les animations sont décoratives, sans interception des clics ni modification des règles.

- Impacts : cinq intensités selon les dégâts, traînée directionnelle et éclat sur la cible.
  Le critique ajoute une signature dorée. Les secousses restent contenues.
- Statuts : brume violette, braises, gouttes selon les stacks, chaînes, orbite d'étourdissement,
  flux de bonus/malus, viseurs, sceaux et trame protectrice. Le ton suit celui du glossaire,
  y compris pour les statuts qui partagent une forme mais ont des rôles différents.
- Soins : anneaux ascendants et particules qui traversent la carte. Les chiffres suivent
  les changements réels de PV. Boucliers : formation, absorption et fracture distinctes.
- Esquive, application de statut et verrou de PV max : éclats dédiés à partir des logs
  structurés. Les logs de compteurs sans `statusId` ne déclenchent aucun éclat de statut.
- Objets, terrains et capacités : révélation avec cercle gravé, respectivement or, jade
  et violet. Les files de révélations et de jets de chance conservent leur cadence.
- Résurrection et évolution : cercles et poussière lumineuse autour de la carte ; les
  scènes propres à Gon, Kayn Assassin et Rhaast sont conservées et enrichies.
- KO : fracture lumineuse puis retrait vers le cimetière. Arrivées au poste actif,
  transition de tour et révélation du recycleur suivent la même palette.

Les effets qui débordent vivent dans `BoardFx.tsx` sur le calque fixe existant, ancré aux
rectangles des cartes. Les durées de retrait restent dans `gameEvents.ts`. Une nouvelle
carte est remesurée avant que les effets ne relisent le cache, pour couvrir la résurrection
et l'arrivée au poste actif. Une nouvelle
animation doit finir avant le retrait du composant. Les impacts, soins et boucliers
successifs rejouent leur animation sans qu'un ancien délai coupe le suivant.

`prefers-reduced-motion: reduce` garde les glyphes, halos et chiffres mais supprime les
déplacements, rotations, particules et secousses. Les petits écrans affichent moins de
particules ; aucune boucle JavaScript ni dépendance supplémentaire n'est nécessaire.

## Atelier de vérification

Avec le serveur web de développement lancé, ouvrir `/effects.html`. Cette entrée est
réservée au développement, absente du build de production. Elle affiche les vrais
composants, propose les scènes de combat et une galerie de statuts. « Arrêt sur image »
et le curseur permettent d'inspecter les animations CSS. Les soins/boucliers liés aux
changements de PV gardent leurs délais de retrait réels.
« Simuler le mouvement réduit » applique les véritables règles CSS de cette préférence,
sans modifier les paramètres du système.

Validation : `npm run build -w web`, vérification visuelle des scènes dans l'atelier,
contrôle des petits écrans et du mouvement réduit.
