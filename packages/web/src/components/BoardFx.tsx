import type { CSSProperties } from 'react';
import { readCardRect } from './cardRects';
import type { CardFlourish, StrikeBolt } from './gameEvents';

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
      <span className="card-flourish-ring" />
      <span className="card-flourish-core" />
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
      {(flourish.kind === 'evolve' || flourish.kind === 'revive') && <span className="card-flourish-beam" />}
    </div>
  );
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
