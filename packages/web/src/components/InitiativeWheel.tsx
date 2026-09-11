import { useEffect, useState, type CSSProperties } from 'react';
import type { PlayerId } from 'engine';

/**
 * Temps d'arrêt AVANT la rotation : la roue s'affiche coupée en deux moitiés égales, un
 * pseudo par part, et le joueur a le temps de lire les deux camps avant que ça tourne.
 * Sans ce temps mort, la roue partait déjà lancée et on ne voyait qu'un nom défiler.
 */
const REVEAL_MS = 1100;
/** Durée de rotation, puis temps d'affichage du résultat une fois la roue arrêtée. */
const SPIN_MS = 3000;
const HOLD_MS = 1400;
/**
 * Sans animation (`prefers-reduced-motion`), la roue ne tourne pas : elle paraît déjà
 * arrêtée sur le vainqueur. Le temps de lecture est alors le seul délai qui reste, un peu
 * allongé pour que le nom ait le temps d'être lu sans le suspense qui le précédait.
 */
const STILL_HOLD_MS = 2200;
/** Nombre de tours complets avant de ralentir sur la bonne part. */
const FULL_TURNS = 5;

/**
 * Chaque camp occupe une moitié de la roue. L'aiguille est en haut (midi) : pour désigner
 * un joueur, la roue tourne jusqu'à amener le centre de sa part sous l'aiguille.
 */
const SEGMENT_CENTER: Record<PlayerId, number> = { p1: 90, p2: 270 };

const FALLBACK_NAME: Record<PlayerId, string> = { p1: 'Joueur 1', p2: 'Joueur 2' };

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function InitiativeWheel({
  starterId,
  names,
  onDone,
}: {
  starterId: PlayerId;
  names: Record<PlayerId, string>;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<'reveal' | 'spinning' | 'settled'>('reveal');
  // Lu une fois au montage : un changement de réglage système en pleine roue n'a pas à
  // relancer la mise en scène.
  const [still] = useState(prefersReducedMotion);

  useEffect(() => {
    // Sans mouvement : les deux parts se lisent, puis la roue est posée directement sur le
    // vainqueur (aucune phase `spinning`, donc aucune animation CSS lancée).
    if (still) {
      const timers = [setTimeout(() => setPhase('settled'), REVEAL_MS), setTimeout(onDone, REVEAL_MS + STILL_HOLD_MS)];
      return () => timers.forEach(clearTimeout);
    }
    const timers = [
      setTimeout(() => setPhase('spinning'), REVEAL_MS),
      setTimeout(() => setPhase('settled'), REVEAL_MS + SPIN_MS),
      setTimeout(onDone, REVEAL_MS + SPIN_MS + HOLD_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onDone, still]);

  const spin = FULL_TURNS * 360 - SEGMENT_CENTER[starterId];
  const label = (id: PlayerId) => names[id] || FALLBACK_NAME[id];
  const settled = phase === 'settled';

  return (
    <div className="modal-backdrop initiative-backdrop">
      <div className="initiative-modal" role="dialog" aria-modal="true" aria-labelledby="initiative-title">
        <h2 className="initiative-title" id="initiative-title">
          Qui commence ?
        </h2>

        <div className="initiative-wheel-holder">
          <span className="initiative-pointer" aria-hidden="true" />
          <div
            className={`initiative-wheel${phase === 'spinning' ? ' spinning' : ''}${still && settled ? ' still' : ''}${settled ? ' settled' : ''}`}
            style={{ '--spin': `${spin}deg`, '--spin-ms': `${SPIN_MS}ms` } as CSSProperties}
          >
            {(['p1', 'p2'] as const).map((id) => (
              <div
                key={id}
                className={`initiative-slot initiative-slot-${id}${settled && id === starterId ? ' initiative-slot-winner' : ''}`}
                style={{ '--seg': `${SEGMENT_CENTER[id]}deg` } as CSSProperties}
              >
                {/* Le nom annule le décalage de sa part (et, pendant la rotation, la
                    rotation elle-même) : il reste droit et lisible du début à la fin.
                    Il ne doit surtout pas s'étirer sur toute la hauteur de la part --
                    la contre-rotation se ferait alors autour du centre de la roue et le
                    nom partirait en orbite au lieu de rester à sa place. */}
                <span className="initiative-name">
                  {settled && id === starterId && (
                    <span className="initiative-crown" aria-hidden="true">
                      👑
                    </span>
                  )}
                  {label(id)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <p className="initiative-versus">
          <span className={`initiative-versus-p1${settled && starterId === 'p1' ? ' winner' : ''}`}>{label('p1')}</span>
          <span className="initiative-versus-vs">vs</span>
          <span className={`initiative-versus-p2${settled && starterId === 'p2' ? ' winner' : ''}`}>{label('p2')}</span>
        </p>

        {/* Le verdict est une PHRASE, pas seulement une part qui s'allume : le camp qui
            commence porte la couleur de sa part, et le texte le dit en toutes lettres. */}
        <p
          className={`initiative-result${settled ? ` settled initiative-result-${starterId}` : ''}`}
          aria-live="polite"
          aria-atomic="true"
        >
          {settled ? (
            <>
              <strong>{label(starterId)}</strong> commence la partie !
            </>
          ) : phase === 'reveal' ? (
            'Une chance sur deux…'
          ) : (
            'La roue tourne…'
          )}
        </p>
      </div>
    </div>
  );
}
