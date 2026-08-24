import type { CardSpotlight as Spotlight } from './gameEvents';
import { CardFrame } from './CardFrame';

/**
 * La carte qui vient d'être jouée, projetée en très grand au centre du plateau -- objet,
 * terrain, ou le personnage dont on déclenche une capacité. Les deux joueurs la voient :
 * elle est construite à partir du journal, que le serveur diffuse aux deux camps.
 *
 * Une seule à la fois : `useGameEvents` échelonne les retraits, donc la suivante n'apparaît
 * qu'une fois la précédente partie (une carte qui en déclenche une autre reste lisible).
 * `pointer-events: none` sur tout le bloc -- l'animation ne doit jamais avaler un clic.
 */
export function CardSpotlights({ spotlights }: { spotlights: Spotlight[] }) {
  const current = spotlights[0];
  if (!current) return null;
  return (
    <div className="card-spotlight-layer" aria-hidden="true">
      {/* La clé porte l'id : deux cartes qui se suivent rejouent bien l'animation d'entrée
          au lieu de se remplacer en silence dans le même noeud. */}
      <div className="card-spotlight" key={current.id}>
        <span className="card-spotlight-action">{current.action}</span>
        <CardFrame cardId={current.cardId} kind={current.cardKind} name={current.name} size="large" />
        {current.detail && <span className="card-spotlight-detail">{current.detail}</span>}
      </div>
    </div>
  );
}
