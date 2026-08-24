import { useMemo, type CSSProperties } from 'react';
import { listDeckPool } from 'engine';

/**
 * Décor animé du salon : des cartes du jeu qui flottent lentement dans le vide.
 *
 * Elles sont posées sur une grille (COLONNES × RANGÉES) avec du bruit, plutôt qu'à des
 * positions purement aléatoires : le hasard pur laisse des trous et des paquets, alors
 * qu'une grille bruitée remplit l'écran de façon homogène tout en restant irrégulière.
 *
 * Le flou et l'opacité sont portés par l'image *interne*, qui ne bouge pas dans son
 * parent : seul le parent est animé (`transform`), donc le navigateur rasterise la
 * texture floue une fois et se contente ensuite de la recomposer. Flouter directement
 * l'élément animé referait le flou à chaque image.
 */
const COLUMNS = 6;
const ROWS = 3;
const DRIFT_VARIANTS = 5;

interface FloatingCard {
  key: string;
  cardId: string;
  left: number;
  top: number;
  width: string;
  variant: number;
  duration: number;
  delay: number;
  blur: number;
  opacity: number;
  tilt: number;
}

/** PRNG déterministe (mulberry32) : le décor est identique à chaque montage du salon. */
function makeRandom(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildLayout(cardIds: string[]): FloatingCard[] {
  if (cardIds.length === 0) return [];
  const rand = makeRandom(0x5eed1);
  const cards: FloatingCard[] = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      const index = row * COLUMNS + col;
      // Pas de doublon visible tant que le pool est plus grand que la grille, et un
      // décalage par rangée pour ne pas aligner les mêmes cartes en colonnes.
      const cardId = cardIds[(index * 7 + row * 3) % cardIds.length]!;
      // « depth » : 0 = carte proche (grande, nette), 1 = carte lointaine (petite, floue).
      const depth = rand();
      const size = 15 - depth * 6;
      cards.push({
        key: `${index}-${cardId}`,
        cardId,
        left: ((col + 0.5) / COLUMNS) * 100 + (rand() - 0.5) * 13,
        top: ((row + 0.5) / ROWS) * 100 + (rand() - 0.5) * 20,
        width: `clamp(${Math.round(size * 6)}px, ${size.toFixed(1)}vw, ${Math.round(size * 17)}px)`,
        variant: index % DRIFT_VARIANTS,
        duration: 30 + rand() * 26,
        // Délai négatif : sans lui toutes les cartes repartiraient du même point au
        // chargement et respireraient à l'unisson, ce qui se voit immédiatement.
        delay: -rand() * 40,
        blur: 3 + depth * 5,
        opacity: 0.3 - depth * 0.12,
        tilt: (rand() - 0.5) * 24,
      });
    }
  }
  return cards;
}

export function LobbyBackground() {
  const cards = useMemo(() => {
    const pool = listDeckPool();
    // Les personnages ont les illustrations les plus lisibles une fois floutées et
    // réduites ; les objets/terrains complètent pour varier les silhouettes.
    const ordered = [...pool.filter((e) => e.type === 'character'), ...pool.filter((e) => e.type !== 'character')];
    return buildLayout(ordered.map((e) => e.id));
  }, []);

  return (
    <div className="lobby-bg" aria-hidden="true">
      <div className="lobby-bg-field">
        {cards.map((card) => (
          <div
            key={card.key}
            className={`lobby-bg-card lobby-bg-card-${card.variant}`}
            style={
              {
                left: `${card.left}%`,
                top: `${card.top}%`,
                width: card.width,
                animationDuration: `${card.duration.toFixed(1)}s`,
                animationDelay: `${card.delay.toFixed(1)}s`,
                '--tilt': `${card.tilt.toFixed(1)}deg`,
              } as CSSProperties
            }
          >
            <div
              className="lobby-bg-card-art"
              style={
                {
                  backgroundImage: `url(/cards/${card.cardId}.png)`,
                  filter: `blur(${card.blur.toFixed(1)}px)`,
                  opacity: card.opacity.toFixed(2),
                } as CSSProperties
              }
            />
          </div>
        ))}
      </div>
      <div className="lobby-bg-glow" />
      <div className="lobby-bg-veil" />
    </div>
  );
}
