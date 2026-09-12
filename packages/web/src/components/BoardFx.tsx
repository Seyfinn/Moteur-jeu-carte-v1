import type { CSSProperties } from 'react';
import { readCardRect } from './cardRects';
import type { CardFlourish, EvolutionFlourishVariant, StrikeBolt } from './gameEvents';

/**
 * Les deux calques d'effet posés PAR-DESSUS le plateau, et non dans le calque d'effets
 * d'une carte.
 *
 * Deux raisons, les mêmes que pour le vol d'une carte morte (`KoFlight.tsx`) :
 * un trait de frappe relie deux cartes situées aux deux bouts de l'écran, et un anneau de
 * souffle doit pouvoir déborder du cadre -- que l'`overflow: hidden` de `.tcg-card`
 * rognerait net. Les positions viennent des rectangles relevés à chaque rendu
 * (`cardRects.ts`), jamais d'une mesure faite ici : au moment où l'animation démarre, la
 * carte peut déjà avoir bougé (bond de l'attaquant) ou disparu.
 *
 * Aucun des deux ne capte le moindre clic : une animation ne doit jamais avaler une action.
 */

function centerOf(instanceId: string): { x: number; y: number; w: number; h: number } | null {
  const rect = readCardRect(instanceId);
  if (!rect || rect.width === 0) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height };
}

/**
 * Trait de frappe : une traînée lumineuse qui part de l'attaquant, file jusqu'à la cible et
 * se dissipe. C'est elle qui fait d'un bond et d'une secousse un seul et même échange de
 * coups -- sur un plateau large, les deux animations étaient trop loin l'une de l'autre
 * pour se lire ensemble.
 *
 * La barre est dessinée à l'horizontale depuis le centre de l'attaquant, puis pivotée vers
 * la cible : `transform-origin` sur son bord gauche, donc le point d'ancrage ne bouge pas.
 */
function StrikeTracer({ bolt }: { bolt: StrikeBolt }) {
  const from = centerOf(bolt.fromInstanceId);
  const to = centerOf(bolt.toInstanceId);
  if (!from || !to) return null;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return null;

  const style = {
    left: `${Math.round(from.x)}px`,
    top: `${Math.round(from.y)}px`,
    width: `${Math.round(distance)}px`,
    ['--bolt-angle']: `${(Math.atan2(dy, dx) * 180) / Math.PI}deg`,
  } as CSSProperties;

  return (
    <div className={`strike-bolt strike-${bolt.tier}${bolt.critical ? ' strike-crit' : ''}`} style={style}>
      <span className="strike-bolt-beam" />
      {/* Pointe lumineuse qui court le long de la barre : c'est elle qui donne le sens de
          la frappe, la traînée seule pouvant se lire dans les deux sens. */}
      <span className="strike-bolt-head" />
    </div>
  );
}

export function StrikeBolts({ bolts }: { bolts: StrikeBolt[] }) {
  if (bolts.length === 0) return null;
  return (
    <div className="strike-bolt-layer" aria-hidden="true">
      {bolts.map((b) => (
        <StrikeTracer key={b.id} bolt={b} />
      ))}
    </div>
  );
}

/** Nombre d'éclats projetés par une déflagration de critique. Purement décoratif. */
const CRIT_SPARK_COUNT = 8;

/**
 * Éclat ponctuel calé sur une carte : déflagration de critique, éclosion d'évolution,
 * colonne de résurrection, bris de bouclier. Le bloc épouse le rectangle de la carte, et
 * chaque effet déborde librement autour.
 */
function Flourish({ flourish }: { flourish: CardFlourish }) {
  const rect = readCardRect(flourish.characterInstanceId);
  if (!rect || rect.width === 0) return null;

  const style: CSSProperties = {
    left: `${Math.round(rect.left)}px`,
    top: `${Math.round(rect.top)}px`,
    width: `${Math.round(rect.width)}px`,
    height: `${Math.round(rect.height)}px`,
  };

  return (
    <div className={`card-flourish card-flourish-${flourish.kind}`} style={style}>
      {/* Une scène d'évolution dédiée remplace l'éclat générique (anneau, cœur, colonne) :
          sa colonne blanche jurait sous la brume bleue de Kayn ou les veines de Rhaast. */}
      {flourish.variant ? (
        <EvolutionScene variant={flourish.variant} />
      ) : (
        <>
          <span className="card-flourish-ring" />
          <span className="card-flourish-core" />
        </>
      )}
      {flourish.kind === 'crit' && (
        <>
          <span className="card-flourish-star" />
          {Array.from({ length: CRIT_SPARK_COUNT }, (_, i) => (
            <span
              key={i}
              className="card-flourish-spark"
              style={{ ['--spark-angle']: `${(360 / CRIT_SPARK_COUNT) * i}deg` } as CSSProperties}
            />
          ))}
        </>
      )}
      {/* L'évolution et la résurrection montent : une colonne de lumière, plus un halo qui
          s'élève depuis le bas de la carte. */}
      {(flourish.kind === 'evolve' || flourish.kind === 'revive') && !flourish.variant && (
        <span className="card-flourish-beam" />
      )}
    </div>
  );
}

/** Volutes de fumée d'une scène d'évolution (aura de Gon, corruption de Rhaast). */
const SCENE_SMOKE_COUNT = 6;
/** Lames d'ombre qui balaient la carte de Kayn Assassin. */
const KAYN_SLASH_COUNT = 3;

/**
 * La scène marquante de chaque forme évoluée, rejouée par-dessus l'éclosion générique
 * (anneau + colonne) qui reste en dessous. Les tracés SVG sont en `viewBox` 0-100 × 0-140
 * étirés sur le rectangle de la carte (`preserveAspectRatio="none"`), et `pathLength="1"`
 * permet de les faire se dessiner d'un simple `stroke-dashoffset` 1 → 0.
 */
function EvolutionScene({ variant }: { variant: EvolutionFlourishVariant }) {
  switch (variant) {
    case 'gon-adulte':
      // L'éveil face à Pitou : le monde s'assombrit, le sol se fend, une colonne d'aura
      // noire monte jusqu'au ciel, striée d'éclairs, et tout finit dans un flash blanc.
      return (
        <>
          <span className="evo-gon-dark" />
          <svg className="evo-gon-cracks" viewBox="0 0 100 40" preserveAspectRatio="none">
            {[
              'M50 0 L40 10 L28 14 L16 22 L4 26',
              'M50 0 L60 8 L74 12 L84 20 L98 24',
              'M50 0 L46 14 L50 24 L44 36',
              'M50 0 L58 16 L54 28 L62 40',
              'M40 10 L36 20 L26 30',
              'M74 12 L76 24 L86 34',
            ].map((d, i) => (
              <path key={i} d={d} pathLength={1} style={{ ['--i' as string]: i }} />
            ))}
          </svg>
          <span className="evo-gon-pillar" />
          {Array.from({ length: SCENE_SMOKE_COUNT }, (_, i) => (
            <span key={i} className="evo-gon-smoke" style={{ ['--i' as string]: i }} />
          ))}
          <svg className="evo-gon-bolts" viewBox="0 0 100 140" preserveAspectRatio="none">
            {[
              '30,-10 38,30 26,55 40,85 28,110 36,150',
              '70,-10 62,28 76,52 60,80 72,108 64,150',
              '50,-10 56,36 44,66 58,96 48,150',
              '10,10 22,50 8,80 20,120',
              '90,10 78,50 92,80 80,120',
            ].map((points, i) => (
              <polyline key={i} points={points} style={{ ['--i' as string]: i }} />
            ))}
          </svg>
          <span className="evo-gon-flash" />
        </>
      );
    case 'kayn-assassin':
      // Kayn l'emporte sur la faux : brume d'ombre bleue, deux images rémanentes qui
      // partent de chaque côté (le pas de l'ombre), trois lames qui balaient la carte,
      // puis une onde cyan sèche. Rapide et silencieux -- un assassin.
      return (
        <>
          <span className="evo-kayn-mist" />
          <span className="evo-kayn-ghost evo-kayn-ghost-l" />
          <span className="evo-kayn-ghost evo-kayn-ghost-r" />
          {Array.from({ length: KAYN_SLASH_COUNT }, (_, i) => (
            <span key={i} className="evo-kayn-slash" style={{ ['--i' as string]: i }} />
          ))}
          <span className="evo-kayn-burst" />
        </>
      );
    case 'rhaast':
      // Le Darkin prend le corps : des veines rouges qui remontent depuis le bas de la
      // carte au rythme d'un battement de cœur, une fumée sombre, puis l'éruption écarlate.
      return (
        <>
          <span className="evo-rhaast-heart" />
          <svg className="evo-rhaast-veins" viewBox="0 0 100 140" preserveAspectRatio="none">
            {[
              'M50 140 L47 120 L52 104 L46 88 L51 70 L45 52 L49 34 L44 16 L48 0',
              'M47 120 L36 110 L30 96 L20 88 L14 72',
              'M52 104 L64 96 L70 82 L80 76 L86 60',
              'M46 88 L34 78 L26 64 L18 48',
              'M51 70 L62 60 L72 50 L78 34 L84 20',
              'M45 52 L36 42 L28 28 L22 12',
              'M49 34 L60 26 L70 14 L74 2',
            ].map((d, i) => (
              <path key={i} d={d} pathLength={1} style={{ ['--i' as string]: i }} />
            ))}
          </svg>
          {Array.from({ length: SCENE_SMOKE_COUNT }, (_, i) => (
            <span key={i} className="evo-rhaast-smoke" style={{ ['--i' as string]: i }} />
          ))}
          <span className="evo-rhaast-eruption" />
        </>
      );
  }
}

export function CardFlourishes({ flourishes }: { flourishes: CardFlourish[] }) {
  if (flourishes.length === 0) return null;
  return (
    <div className="card-flourish-layer" aria-hidden="true">
      {flourishes.map((f) => (
        <Flourish key={f.id} flourish={f} />
      ))}
    </div>
  );
}
