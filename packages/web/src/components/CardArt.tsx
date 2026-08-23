import { useState } from 'react';

const KIND_ICON: Record<string, string> = {
  character: '⚔️',
  object: '🎒',
  terrain: '🗺️',
};

/**
 * Reserves the visual space for real card art. Tries `/cards/<cardId>.png`
 * first (drop a file there once real art exists -- no code change needed)
 * and falls back to a plain placeholder otherwise.
 */
export function CardArt({ cardId, kind }: { cardId: string; kind: 'character' | 'object' | 'terrain' }) {
  const [failedCardId, setFailedCardId] = useState<string | null>(null);
  // Keyed by cardId rather than a plain boolean: React reuses this component when a
  // slot's card changes (a switch, a transformation, a re-sorted list), and a sticky
  // `failed` flag would keep showing the placeholder for a card that does have art.
  const failed = failedCardId === cardId;
  return (
    <div className="tcg-card-art">
      {!failed ? (
        // eslint-disable-next-line jsx-a11y/alt-text
        <img src={`/cards/${cardId}.png`} alt="" onError={() => setFailedCardId(cardId)} />
      ) : (
        <span className="tcg-card-art-placeholder">{KIND_ICON[kind] ?? '❔'}</span>
      )}
    </div>
  );
}
