import { CardFrame } from './CardFrame';
import { useCardInspect } from './HoverCard';
import { objectDetailBody } from './cardDetails';
import type { AttachedObjectView } from './boardActions';

/**
 * Un objet lié, posé à côté de son personnage. Volontairement plus petit que lui : il
 * doit se lire comme un accessoire accroché à la carte, pas comme une carte de plus sur
 * la table. Survol/clic ouvrent la fiche complète, comme n'importe quelle carte.
 */
function AttachedObjectCard({ object }: { object: AttachedObjectView }) {
  const inspect = useCardInspect({
    id: object.instanceId,
    title: object.name,
    subtitle: 'Objet lié',
    card: { cardId: object.cardId, kind: 'object', name: object.name },
    body: objectDetailBody(object.cardId),
  });

  return (
    <div className="attached-object-card" title={`${object.name} — objet lié`}>
      <CardFrame cardId={object.cardId} kind="object" name={object.name} size="small" {...inspect} />
    </div>
  );
}

/** La colonne d'objets liés affichée à côté du personnage actif. */
export function AttachedObjectCards({ objects }: { objects: AttachedObjectView[] }) {
  if (objects.length === 0) return null;
  return (
    <div className="attached-object-rail" role="list" aria-label="Objets liés">
      {objects.map((object) => (
        <div key={object.instanceId} role="listitem" className="attached-object-slot">
          <AttachedObjectCard object={object} />
        </div>
      ))}
    </div>
  );
}

/**
 * Version banc : l'illustration seule, en pastille posée sur le coin de la carte du
 * personnage. Aucune place pour une vignette à côté sans élargir toute la colonne, et le
 * calque d'effets est de toute façon le seul endroit qui ne soit pas rogné par
 * l'`overflow: hidden` de la carte.
 *
 * Purement décoratif : la carte du personnage porte déjà le clic (fiche, ciblage), et une
 * zone cliquable de 20 px posée dessus ne ferait que voler ces clics.
 */
export function AttachedObjectChips({ objects }: { objects: AttachedObjectView[] }) {
  if (objects.length === 0) return null;
  return (
    <div className="attached-object-chips" aria-hidden="true">
      {objects.map((object) => (
        <span key={object.instanceId} className="attached-object-chip" title={`${object.name} — objet lié`}>
          <img src={`/cards/${object.cardId}.png`} alt="" draggable={false} />
          {/* Le logo « à lier » sur la pastille elle-même : à 20 px, une illustration
              seule ne dit pas qu'il s'agit d'un objet accroché plutôt que d'un statut. */}
          <span className="attached-object-chip-mark">🔗</span>
        </span>
      ))}
    </div>
  );
}
