import { useState } from 'react';

const KIND_ICON: Record<string, string> = {
  character: '⚔️',
  object: '🎒',
  terrain: '🗺️',
};

const KIND_LABEL: Record<string, string> = {
  character: 'Personnage',
  object: 'Objet',
  terrain: 'Terrain',
};

/**
 * Reserves the visual space for real card art. Tries `/cards/<cardId>.png`
 * first (drop a file there once real art exists -- no code change needed)
 * and falls back to a plain placeholder otherwise.
 *
 * `name` sert au texte alternatif : une illustration de carte n'est pas décorative, c'est
 * la carte elle-même. `decorative` la rend muette quand le cadre qui l'entoure porte déjà
 * le nom (une carte-bouton, cf. CardFrame) -- sinon le lecteur d'écran l'annonçait deux fois.
 */
export function CardArt({
  cardId,
  kind,
  name,
  decorative,
}: {
  cardId: string;
  kind: 'character' | 'object' | 'terrain';
  name?: string;
  decorative?: boolean;
}) {
  const [failedCardId, setFailedCardId] = useState<string | null>(null);
  // Keyed by cardId rather than a plain boolean: React reuses this component when a
  // slot's card changes (a switch, a transformation, a re-sorted list), and a sticky
  // `failed` flag would keep showing the placeholder for a card that does have art.
  const failed = failedCardId === cardId;
  const alt = decorative || !name ? '' : `${KIND_LABEL[kind] ?? 'Carte'} : ${name}`;
  return (
    <div className="tcg-card-art">
      {!failed ? (
        <img
          src={`/cards/${cardId}.png`}
          alt={alt}
          // Une carte se clique, elle ne se traîne pas : sans ça, un clic un peu appuyé
          // décollait un fantôme de l'illustration au lieu d'ouvrir la fiche ou de viser.
          draggable={false}
          decoding="async"
          onError={() => setFailedCardId(cardId)}
        />
      ) : (
        <span
          className="tcg-card-art-placeholder"
          role={alt ? 'img' : undefined}
          aria-label={alt || undefined}
          aria-hidden={alt ? undefined : true}
        >
          {KIND_ICON[kind] ?? '❔'}
        </span>
      )}
    </div>
  );
}
