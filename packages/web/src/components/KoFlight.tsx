import type { CSSProperties } from 'react';
import { CardArt } from './CardArt';
import { graveyardRectKey, readCardRect } from './cardRects';
import type { KoFlight } from './gameEvents';

/**
 * Mort d'un personnage, rejouée par-dessus le plateau.
 *
 * Le moteur range la carte au cimetière dans le même état que celui qui annonce le KO :
 * quand cette animation démarre, la vraie carte n'est plus dans le DOM. On rejoue donc un
 * fantôme en position fixe, à sa dernière position connue (`cardRects.ts`), qu'on fait
 * trembler, se désintégrer, puis filer vers la pile de son camp.
 *
 * Sans position connue (carte jamais rendue, reconnexion en pleine mort), on ne dessine
 * rien : mieux vaut pas d'animation qu'un fantôme dans le coin de l'écran.
 */
function KoGhost({ flight }: { flight: KoFlight }) {
  const from = readCardRect(flight.instanceId);
  const to = readCardRect(graveyardRectKey(flight.ownerId));
  if (!from || from.width === 0) return null;

  // Cible par défaut : là où la carte est déjà, donc une simple dissolution sur place quand
  // le cimetière n'a pas encore été mesuré.
  const dx = to ? to.left + to.width / 2 - (from.left + from.width / 2) : 0;
  const dy = to ? to.top + to.height / 2 - (from.top + from.height / 2) : 0;

  const style = {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    ['--ko-dx']: `${Math.round(dx)}px`,
    ['--ko-dy']: `${Math.round(dy)}px`,
  } as CSSProperties;

  return (
    <div className="ko-ghost" style={style} aria-hidden="true">
      <div className="ko-ghost-card">
        <CardArt cardId={flight.cardId} kind="character" />
        <span className="ko-ghost-ash" />
      </div>
    </div>
  );
}

export function KoFlights({ flights }: { flights: KoFlight[] }) {
  if (flights.length === 0) return null;
  return (
    <div className="ko-flight-stack">
      {flights.map((f) => (
        <KoGhost key={f.id} flight={f} />
      ))}
    </div>
  );
}
