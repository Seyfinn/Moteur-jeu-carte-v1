import { useEffect, useState, type CSSProperties } from 'react';
import type { PlayerId } from 'engine';

/** Durée de rotation, puis temps d'affichage du résultat une fois la roue arrêtée. */
const SPIN_MS = 3400;
const HOLD_MS = 1500;
/** Nombre de tours complets avant de ralentir sur la bonne part. */
const FULL_TURNS = 5;

/**
 * Chaque camp occupe une moitié de la roue. L'aiguille est en haut (midi) : pour désigner
 * un joueur, la roue tourne jusqu'à amener le centre de sa part sous l'aiguille.
 */
const SEGMENT_CENTER: Record<PlayerId, number> = { p1: 90, p2: 270 };

export function InitiativeWheel({
  starterId,
  names,
  onDone,
}: {
  starterId: PlayerId;
  names: Record<PlayerId, string>;
  onDone: () => void;
}) {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const spun = setTimeout(() => setSettled(true), SPIN_MS);
    const done = setTimeout(onDone, SPIN_MS + HOLD_MS);
    return () => {
      clearTimeout(spun);
      clearTimeout(done);
    };
  }, [onDone]);

  const spin = FULL_TURNS * 360 - SEGMENT_CENTER[starterId];

  return (
    <div className="modal-backdrop initiative-backdrop">
      <div className="initiative-modal">
        <h2 className="initiative-title">Qui commence ?</h2>

        <div className="initiative-wheel-holder">
          <span className="initiative-pointer" aria-hidden="true" />
          <div
            className="initiative-wheel"
            style={{ '--spin': `${spin}deg`, '--spin-ms': `${SPIN_MS}ms` } as CSSProperties}
          >
            {(['p1', 'p2'] as const).map((id) => (
              <div
                key={id}
                className={`initiative-slot initiative-slot-${id}`}
                style={{ '--seg': `${SEGMENT_CENTER[id]}deg` } as CSSProperties}
              >
                {/* Le nom contre-tourne exactement ce que la roue lui fait subir (son
                    décalage de part + la rotation en cours) : il reste donc lisible
                    pendant toute l'animation, et droit une fois la roue arrêtée. */}
                <span className="initiative-name">{names[id] || (id === 'p1' ? 'Joueur 1' : 'Joueur 2')}</span>
              </div>
            ))}
          </div>
        </div>

        <p className={`initiative-result${settled ? ' settled' : ''}`} aria-live="polite">
          {settled ? `${names[starterId] || 'Le joueur'} commence !` : 'La roue tourne…'}
        </p>
      </div>
    </div>
  );
}
