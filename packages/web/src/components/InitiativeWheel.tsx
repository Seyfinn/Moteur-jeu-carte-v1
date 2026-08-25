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
/** Nombre de tours complets avant de ralentir sur la bonne part. */
const FULL_TURNS = 5;

/**
 * Chaque camp occupe une moitié de la roue. L'aiguille est en haut (midi) : pour désigner
 * un joueur, la roue tourne jusqu'à amener le centre de sa part sous l'aiguille.
 */
const SEGMENT_CENTER: Record<PlayerId, number> = { p1: 90, p2: 270 };

const FALLBACK_NAME: Record<PlayerId, string> = { p1: 'Joueur 1', p2: 'Joueur 2' };

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

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase('spinning'), REVEAL_MS),
      setTimeout(() => setPhase('settled'), REVEAL_MS + SPIN_MS),
      setTimeout(onDone, REVEAL_MS + SPIN_MS + HOLD_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onDone]);

  const spin = FULL_TURNS * 360 - SEGMENT_CENTER[starterId];
  const label = (id: PlayerId) => names[id] || FALLBACK_NAME[id];

  return (
    <div className="modal-backdrop initiative-backdrop">
      <div className="initiative-modal">
        <h2 className="initiative-title">Qui commence ?</h2>

        <div className="initiative-wheel-holder">
          <span className="initiative-pointer" aria-hidden="true" />
          <div
            className={`initiative-wheel${phase === 'reveal' ? '' : ' spinning'}`}
            style={{ '--spin': `${spin}deg`, '--spin-ms': `${SPIN_MS}ms` } as CSSProperties}
          >
            {(['p1', 'p2'] as const).map((id) => (
              <div
                key={id}
                className={`initiative-slot initiative-slot-${id}`}
                style={{ '--seg': `${SEGMENT_CENTER[id]}deg` } as CSSProperties}
              >
                {/* Le nom annule le décalage de sa part (et, pendant la rotation, la
                    rotation elle-même) : il reste droit et lisible du début à la fin.
                    Il ne doit surtout pas s'étirer sur toute la hauteur de la part --
                    la contre-rotation se ferait alors autour du centre de la roue et le
                    nom partirait en orbite au lieu de rester à sa place. */}
                <span className="initiative-name">{label(id)}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="initiative-versus">
          <span className="initiative-versus-p1">{label('p1')}</span>
          <span className="initiative-versus-vs">vs</span>
          <span className="initiative-versus-p2">{label('p2')}</span>
        </p>

        <p className={`initiative-result${phase === 'settled' ? ' settled' : ''}`} aria-live="polite">
          {phase === 'settled'
            ? `${label(starterId)} commence !`
            : phase === 'reveal'
              ? 'Une chance sur deux…'
              : 'La roue tourne…'}
        </p>
      </div>
    </div>
  );
}
