import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { listDeckPool } from 'engine';

/**
 * Décor animé du salon : des cartes du jeu, tirées au hasard dans tout le pool, qui
 * flottent lentement dans le vide.
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

/** Opacité des cartes selon leur profondeur. Le décor doit rester *lisible comme des
    cartes* -- on reconnaît les illustrations et leurs couleurs -- pendant que la lisibilité
    de l'interface est assurée ailleurs : par le voile léger du fond et surtout par le verre
    dépoli des deux panneaux centraux, pas en éteignant le décor. */
const OPACITY_NEAR = 0.5;
const OPACITY_FAR = 0.4;

/**
 * Une graine par *chargement de page*, pas par montage du composant : aller au
 * gestionnaire de decks et revenir ne redistribue pas le décor sous les yeux du joueur,
 * alors qu'un rechargement, lui, rebat les cartes.
 */
const SESSION_SEED = Math.floor(Math.random() * 0xffffffff) || 1;

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

/** PRNG déterministe (mulberry32), alimenté par la graine de session. */
function makeRandom(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates : un tirage sans doublon dans la totalité du pool. */
function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function buildLayout(cardIds: string[], rand: () => number): FloatingCard[] {
  if (cardIds.length === 0) return [];
  const cards: FloatingCard[] = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      const index = row * COLUMNS + col;
      // Le pool est déjà mélangé : prendre les cartes dans l'ordre suffit, et tant qu'il
      // est plus grand que la grille aucune carte n'apparaît deux fois.
      const cardId = cardIds[index % cardIds.length]!;
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
        // Flou de profondeur seulement : au-delà, les illustrations se réduisent à des
        // taches de couleur et le décor perd ce qui en fait un décor de cartes.
        blur: 0.8 + depth * 3.2,
        opacity: OPACITY_NEAR - depth * (OPACITY_NEAR - OPACITY_FAR),
        tilt: (rand() - 0.5) * 24,
      });
    }
  }
  return cards;
}

const EASTER_EGG_TEXT = 'ray le goat';
/** Le clin d'œil doit rester une trouvaille : jamais dans la première minute, puis une
    apparition toutes les deux à cinq minutes. */
const FIRST_APPEARANCE_MS: readonly [number, number] = [60_000, 150_000];
const NEXT_APPEARANCE_MS: readonly [number, number] = [120_000, 300_000];
/** Durée de la traversée. À garder alignée sur `lobby-bg-easter-drift` dans styles.css. */
const TRAVEL_MS = 19_000;

interface EasterEggRun {
  id: number;
  /** Hauteur de la traversée, en %, pour ne pas toujours passer au même endroit. */
  top: number;
}

/**
 * Programme les passages du clin d'œil. Il n'est monté que pendant sa traversée : c'est
 * ce démontage qui garantit que l'animation CSS repart bien du début au passage suivant.
 */
function useEasterEgg(): EasterEggRun | null {
  const [run, setRun] = useState<EasterEggRun | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let seq = 0;

    const schedule = ([min, max]: readonly [number, number]) => {
      timer = setTimeout(
        () => {
          setRun({ id: ++seq, top: 25 + Math.random() * 50 });
          timer = setTimeout(() => {
            setRun(null);
            schedule(NEXT_APPEARANCE_MS);
          }, TRAVEL_MS);
        },
        min + Math.random() * (max - min)
      );
    };

    schedule(FIRST_APPEARANCE_MS);
    // Un seul minuteur est armé à la fois, et `timer` porte toujours le dernier en date.
    return () => clearTimeout(timer);
  }, []);

  return run;
}

export function LobbyBackground() {
  const cards = useMemo(() => {
    const rand = makeRandom(SESSION_SEED);
    // Tirage dans la totalité du pool -- personnages, objets et terrains confondus.
    return buildLayout(shuffle(listDeckPool().map((entry) => entry.id), rand), rand);
  }, []);
  const easterEgg = useEasterEgg();

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

      {/* Posé entre les cartes et les voiles : le texte passe au milieu du champ, et le
          halo comme le voile de lisibilité continuent de l'estomper. */}
      {easterEgg && (
        <div
          key={easterEgg.id}
          className="lobby-bg-easter"
          style={{ top: `${easterEgg.top.toFixed(1)}%`, animationDuration: `${TRAVEL_MS}ms` }}
        >
          {EASTER_EGG_TEXT}
        </div>
      )}

      <div className="lobby-bg-glow" />
      <div className="lobby-bg-veil" />
    </div>
  );
}
