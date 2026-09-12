import type { ReactNode, Ref } from 'react';
import { CardFrame } from './CardFrame';

export interface PreviewCard {
  cardId: string;
  kind: 'character' | 'object' | 'terrain';
  name: string;
  /** Carte limitée à un exemplaire par deck -- affiche le même badge « 1× » que le deck-builder. */
  unique?: boolean;
}

/**
 * Carte agrandie posée à côté de son texte complet. C'est le corps commun de toutes les
 * surfaces « montre-moi cette carte » : la prévisualisation au survol du deck-builder,
 * celle du survol en partie, et le panneau épinglé dans le coin du plateau -- pour que
 * la même carte soit lue exactement de la même façon partout.
 */
export function CardPreviewPanel({
  card,
  title,
  subtitle,
  body,
  textRef,
}: {
  card: PreviewCard;
  title?: string;
  subtitle?: ReactNode;
  body: ReactNode;
  /** La colonne de texte, celle qui défile : le fournisseur y relaie la molette. */
  textRef?: Ref<HTMLDivElement>;
}) {
  return (
    <>
      <CardFrame cardId={card.cardId} kind={card.kind} name={card.name} size="large" unique={card.unique} />
      {/* Le texte est ce qu'un lecteur d'écran doit annoncer : la vignette à côté n'est
          qu'une image de la même carte. */}
      <div className="card-preview-text" role="tooltip" aria-label={title ?? card.name} ref={textRef}>
        <h3 className="hover-card-title">{title ?? card.name}</h3>
        {subtitle && <div className="hover-card-subtitle">{subtitle}</div>}
        <div className="hover-card-content">{body}</div>
      </div>
    </>
  );
}
