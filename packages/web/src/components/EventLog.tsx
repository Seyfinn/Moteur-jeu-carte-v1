import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { LogEntry, PlayerId } from 'engine';

/** Small icon per engine log `data.kind`, so the journal can be skimmed at a glance. */
const KIND_ICON: Record<string, string> = {
  attack: '⚔️',
  'use-ability': '✨',
  'play-object': '🎒',
  'play-terrain': '🗺️',
  pass: '⏭️',
  forfeit: '🏳️',
  damage: '💥',
  'status-tick': '☠️',
  heal: '💚',
  shield: '🛡️',
  'shield-absorb': '🛡️',
  'valeur-lock': '🔻',
  'max-hp': '🔺',
  ko: '💀',
  revive: '⭐',
  switch: '🔁',
  status: '🔮',
  critical: '🎯',
  evasion: '💨',
  redirect: '↪️',
  'coin-flip': '🪙',
  initiative: '🪙',
  'destroy-object': '💣',
  'terrain-removed': '🍂',
  'terrain-duration': '⏳',
  'gain-object': '🃏',
  'concentration-missed': '😖',
  'chance-roll': '🎲',
  'proc-miss': '🎲',
  blocked: '⛓️',
  'trigger-depth': '⚠️',
  error: '⚠️',
  info: 'ℹ️',
};

const MAX_ENTRIES = 60;
/** Marge minimale entre la fenêtre et le bord de l'écran, en pixels. */
const EDGE = 6;
/** En deçà, le pointeur n'a pas « glissé » : c'est un clic, avec le tremblement habituel. */
const DRAG_THRESHOLD_PX = 4;
/** Même seuil « petit écran » que le reste de l'app (cf. styles.css). */
const MOBILE_QUERY = '(max-width: 760px)';

function kindOf(entry: LogEntry): string | undefined {
  const kind = entry.data?.['kind'];
  return typeof kind === 'string' ? kind : undefined;
}

interface Position {
  x: number;
  y: number;
}

function clampToViewport(pos: Position, width: number, height: number): Position {
  return {
    x: Math.min(Math.max(EDGE, pos.x), Math.max(EDGE, window.innerWidth - width - EDGE)),
    y: Math.min(Math.max(EDGE, pos.y), Math.max(EDGE, window.innerHeight - height - EDGE)),
  };
}

/**
 * Journal de combat : une fenêtre flottante qu'on déplace par son en-tête et qu'on réduit
 * en pastille de notification pour dégager la vue du plateau. Tant qu'elle n'a pas été
 * déplacée, sa position vient de la CSS (coin bas-gauche) ; le premier glisser fige des
 * coordonnées explicites.
 */
export function EventLog({ log, you }: { log: LogEntry[]; you?: PlayerId }) {
  // Sur petit écran (mobile), le journal démarre réduit : ouvert par défaut, il couvrait
  // une bonne partie du plateau dès la première seconde. N'affecte que la valeur initiale
  // -- pas de ré-évaluation live au redimensionnement, volontairement, pour ne pas
  // réduire/rouvrir le journal sous les pieds d'un joueur qui l'a déjà rouvert lui-même.
  const [minimized, setMinimized] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY).matches : false
  );
  const [pos, setPos] = useState<Position | null>(null);
  const [seenCount, setSeenCount] = useState(log.length);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dragRef = useRef<{ dx: number; dy: number; startX: number; startY: number } | null>(null);
  // Un glisser se termine par un `click` sur la poignée : sans mémoriser qu'on a
  // réellement bougé, déplacer la pastille la rouvrirait aussitôt.
  const movedRef = useRef(false);

  const recent = log.slice(-MAX_ENTRIES).reverse();
  const unread = Math.max(0, log.length - seenCount);

  // Newest first, so "scrolled to the top" is the live view. A burst of entries
  // resolved while the player was reading older ones shouldn't strand them mid-list.
  useEffect(() => {
    if (!minimized) listRef.current?.scrollTo({ top: 0 });
  }, [log.length, minimized]);

  // Le compteur de non-lus ne court que pendant que la fenêtre est réduite.
  useEffect(() => {
    if (!minimized) setSeenCount(log.length);
  }, [minimized, log.length]);

  const clampNow = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    setPos((prev) => (prev ? clampToViewport(prev, box.offsetWidth, box.offsetHeight) : prev));
  }, []);

  // Une fenêtre posée à droite de l'écran doit rester attrapable quand la fenêtre du
  // navigateur rétrécit (ou qu'un téléphone bascule en paysage).
  useEffect(() => {
    window.addEventListener('resize', clampNow);
    return () => window.removeEventListener('resize', clampNow);
  }, [clampNow]);

  // Même garde-fou quand c'est la boîte qui change de taille : une pastille de 46px collée
  // au coin bas-droit redevient une fenêtre de 300px, qui déborderait de l'écran.
  useLayoutEffect(clampNow, [minimized, clampNow]);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    const box = boxRef.current;
    if (!box) return;
    // Un appui né sur un bouton *contenu* dans la poignée (le « – » qui réduit) ne doit pas
    // armer le glisser : capturer le pointeur détourne le `pointerup` vers la poignée et le
    // clic du bouton se perd en route. La pastille réduite, elle, EST le bouton -- elle
    // reste donc déplaçable.
    const pressed = (e.target as HTMLElement).closest('button');
    if (pressed && pressed !== e.currentTarget) return;
    const rect = box.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, startX: e.clientX, startY: e.clientY };
    movedRef.current = false;
    // Le pointeur est capturé par l'en-tête : le glisser survit à une sortie de la
    // fenêtre (et au relâchement en dehors), sans écouteur global sur `document`.
    e.currentTarget.setPointerCapture(e.pointerId);
    setPos({ x: rect.left, y: rect.top });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const box = boxRef.current;
    if (!drag || !box) return;
    e.preventDefault();
    // Au-delà du seuil seulement : sinon le tremblement d'un clic sur la pastille
    // comptait comme un glisser et le clic de réouverture était avalé.
    if (Math.abs(e.clientX - drag.startX) > DRAG_THRESHOLD_PX || Math.abs(e.clientY - drag.startY) > DRAG_THRESHOLD_PX) {
      movedRef.current = true;
    }
    setPos(clampToViewport({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }, box.offsetWidth, box.offsetHeight));
  };

  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const style: CSSProperties | undefined = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined;

  if (minimized) {
    return (
      <div ref={boxRef} className="event-log floating minimized" style={style}>
        <button
          className="event-log-pill"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={() => {
            if (movedRef.current) return;
            setMinimized(false);
          }}
          title="Rouvrir le journal (glisser pour déplacer)"
          aria-label="Rouvrir le journal de combat"
        >
          📜
          {unread > 0 && <span className="event-log-unread">{unread > 99 ? '99+' : unread}</span>}
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="event-log floating" style={style}>
      <header
        className="event-log-head"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="event-log-grip" aria-hidden="true">
          ⠿
        </span>
        <h3>Journal</h3>
        <button
          className="event-log-minimize"
          onClick={() => setMinimized(true)}
          title="Réduire le journal"
          aria-label="Réduire le journal"
        >
          –
        </button>
      </header>
      <ul ref={listRef}>
        {recent.length === 0 && <li className="log-empty">Rien ne s'est encore passé.</li>}
        {recent.map((entry) => {
          const kind = kindOf(entry);
          const mine = you !== undefined && entry.playerId === you;
          return (
            <li key={entry.id} className={`log-entry${kind ? ` log-kind-${kind}` : ''}${mine ? ' log-mine' : ''}`}>
              <span className="log-turn">T{entry.turnNumber}</span>
              <span className="log-icon">{(kind && KIND_ICON[kind]) ?? '·'}</span>
              <span className="log-message">{entry.message}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
