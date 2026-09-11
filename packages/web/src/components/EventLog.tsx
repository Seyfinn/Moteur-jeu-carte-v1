import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { LogEntry, PlayerId } from 'engine';

/**
 * Famille visuelle d'une entrée. Elle ne décide que de la couleur et du poids de la ligne :
 * `danger` pour ce qui fait mal, `ok` pour ce qui soigne, `warn` pour un coup de chance,
 * `accent` pour un changement de position, `muted` pour la plomberie que le joueur n'a pas
 * besoin de lire (une ligne sans `kind` tombe aussi là-dedans).
 */
type LogTone = 'danger' | 'ok' | 'warn' | 'accent' | 'muted' | 'neutral';

interface KindMeta {
  icon: string;
  tone: LogTone;
}

/** Icône et famille de couleur par `data.kind` du moteur, pour balayer le journal d'un coup d'oeil. */
const KIND_META: Record<string, KindMeta> = {
  attack: { icon: '⚔️', tone: 'neutral' },
  'use-ability': { icon: '✨', tone: 'neutral' },
  'play-object': { icon: '🎒', tone: 'neutral' },
  'play-terrain': { icon: '🗺️', tone: 'neutral' },
  pass: { icon: '⏭️', tone: 'muted' },
  forfeit: { icon: '🏳️', tone: 'danger' },
  damage: { icon: '💥', tone: 'danger' },
  'status-tick': { icon: '☠️', tone: 'danger' },
  heal: { icon: '💚', tone: 'ok' },
  shield: { icon: '🛡️', tone: 'ok' },
  'shield-absorb': { icon: '🛡️', tone: 'accent' },
  'valeur-lock': { icon: '🔻', tone: 'danger' },
  'max-hp': { icon: '🔺', tone: 'ok' },
  ko: { icon: '💀', tone: 'danger' },
  revive: { icon: '⭐', tone: 'ok' },
  evolve: { icon: '🌟', tone: 'warn' },
  switch: { icon: '🔁', tone: 'accent' },
  status: { icon: '🔮', tone: 'neutral' },
  critical: { icon: '🎯', tone: 'warn' },
  evasion: { icon: '💨', tone: 'accent' },
  redirect: { icon: '↪️', tone: 'accent' },
  'coin-flip': { icon: '🪙', tone: 'warn' },
  initiative: { icon: '🪙', tone: 'warn' },
  'destroy-object': { icon: '💣', tone: 'neutral' },
  'terrain-removed': { icon: '🍂', tone: 'muted' },
  'terrain-duration': { icon: '⏳', tone: 'muted' },
  'gain-object': { icon: '🃏', tone: 'neutral' },
  'gain-terrain': { icon: '🃏', tone: 'neutral' },
  recycle: { icon: '♻️', tone: 'muted' },
  'concentration-missed': { icon: '😖', tone: 'danger' },
  'chance-roll': { icon: '🎲', tone: 'warn' },
  'proc-miss': { icon: '🎲', tone: 'muted' },
  blocked: { icon: '⛓️', tone: 'muted' },
  'trigger-depth': { icon: '⚠️', tone: 'danger' },
  error: { icon: '⚠️', tone: 'danger' },
  info: { icon: 'ℹ️', tone: 'muted' },
};

const MAX_ENTRIES = 120;
/** Marge, en pixels, sous laquelle on considère que la liste est « en bas » et doit suivre le flux. */
const STICK_THRESHOLD_PX = 28;

/** Bornes de redimensionnement du tiroir, partagées entre la souris et le clavier. */
const MIN_W = 240;
const MIN_H = 140;
const KEY_STEP_PX = 24;
const SIZE_STORAGE_KEY = 'event-log-size';

function kindOf(entry: LogEntry): string | undefined {
  const kind = entry.data?.['kind'];
  return typeof kind === 'string' ? kind : undefined;
}

/**
 * Montant chiffré attaché à l'entrée (dégâts subis, HP rendus, bouclier posé...). Il est
 * déjà dans le message, mais un chiffre isolé à droite se lit sans parcourir la phrase --
 * c'est ce qui permet de repérer d'un coup d'oeil le gros coup d'un tour.
 */
function amountChip(entry: LogEntry, kind: string | undefined): string | null {
  const amount = entry.data?.['amount'];
  if (typeof amount !== 'number' || amount <= 0) return null;
  switch (kind) {
    case 'damage':
    case 'status-tick':
    case 'valeur-lock':
      return `−${amount}`;
    case 'heal':
    case 'max-hp':
    case 'shield':
      return `+${amount}`;
    default:
      return null;
  }
}

function turnLabel(turnNumber: number): string {
  // Le tour 0 est la mise en place : actifs de départ, tirage du premier joueur.
  return turnNumber === 0 ? 'Mise en place' : `Tour ${turnNumber}`;
}

interface DrawerSize {
  w: number;
  h: number;
}

function clampSize(size: DrawerSize): DrawerSize {
  const maxW = Math.min(window.innerWidth * 0.9, 640);
  const maxH = window.innerHeight * 0.92;
  return {
    w: Math.round(Math.max(MIN_W, Math.min(maxW, size.w))),
    h: Math.round(Math.max(MIN_H, Math.min(maxH, size.h))),
  };
}

function loadStoredSize(): DrawerSize | null {
  try {
    const raw = localStorage.getItem(SIZE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DrawerSize>;
    if (typeof parsed.w !== 'number' || typeof parsed.h !== 'number') return null;
    return clampSize({ w: parsed.w, h: parsed.h });
  } catch {
    return null;
  }
}

function storeSize(size: DrawerSize) {
  try {
    localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(size));
  } catch {
    // Stockage indisponible (navigation privée, quota) : la taille ne survit pas au
    // rechargement, et c'est tout.
  }
}

/**
 * Journal de combat : une pastille ronde en bas à gauche, qui ouvre au clic un tiroir
 * coulissant depuis le bord gauche de l'écran. Il démarre réduit -- ouvert d'emblée, il
 * couvrait une bonne part du plateau dès la première seconde, et l'immense majorité des
 * tours se lit très bien sans lui.
 *
 * Le tiroir reste monté même fermé : c'est ce qui lui permet de coulisser (une simple
 * translation) au lieu d'apparaître d'un coup, et la liste garde sa position de défilement
 * d'une ouverture à l'autre.
 *
 * Les entrées sont dans l'ordre chronologique, regroupées par tour, et la liste suit le
 * flux (défilement automatique vers le bas) tant que le joueur n'est pas remonté lire plus
 * haut -- auquel cas un bouton « nouvelles entrées » lui propose de redescendre, sans
 * jamais lui arracher sa position de lecture.
 */
export function EventLog({ log, you }: { log: LogEntry[]; you?: PlayerId }) {
  const [open, setOpen] = useState(false);
  const [seenCount, setSeenCount] = useState(log.length);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [size, setSize] = useState<DrawerSize | null>(() => loadStoredSize());
  const listRef = useRef<HTMLUListElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Nombre d'entrées vues la dernière fois que la liste était en bas : c'est ce qui
  // alimente le bouton « N nouvelles » quand le joueur a remonté.
  const [bottomSeenCount, setBottomSeenCount] = useState(log.length);
  // Vrai seulement quand la fermeture vient du clavier ou de la croix : le focus doit
  // alors revenir sur la pastille, sinon il tombe sur `body` et le joueur au clavier
  // repart de zéro.
  const returnFocusRef = useRef(false);

  const recent = log.slice(-MAX_ENTRIES);
  const unread = Math.max(0, log.length - seenCount);
  const newBelow = stickToBottom ? 0 : Math.max(0, log.length - bottomSeenCount);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Le journal suit le flux tant que le joueur est en bas ; s'il a remonté lire un tour
  // précédent, une rafale d'entrées ne doit pas lui voler sa position.
  useEffect(() => {
    if (!open) return;
    if (stickToBottom) {
      scrollToBottom(false);
      setBottomSeenCount(log.length);
    }
  }, [log.length, open, stickToBottom, scrollToBottom]);

  // Le compteur de non-lus ne court que pendant que le tiroir est fermé.
  useEffect(() => {
    if (open) setSeenCount(log.length);
  }, [open, log.length]);

  // À l'ouverture, le focus entre dans le tiroir (sur la croix, premier contrôle) ; à la
  // fermeture demandée au clavier, il revient sur la pastille.
  useEffect(() => {
    if (open) {
      closeRef.current?.focus({ preventScroll: true });
    } else if (returnFocusRef.current) {
      returnFocusRef.current = false;
      pillRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // Échap referme le tiroir : il recouvre le bord gauche du plateau, on doit pouvoir le
  // renvoyer sans viser la croix.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        returnFocusRef.current = true;
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const onListScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
    const atBottom = distance <= STICK_THRESHOLD_PX;
    if (atBottom !== stickToBottom) setStickToBottom(atBottom);
    if (atBottom) setBottomSeenCount(log.length);
  };

  const applySize = (next: DrawerSize) => {
    const clamped = clampSize(next);
    setSize(clamped);
    storeSize(clamped);
  };

  const currentSize = (): DrawerSize => {
    if (size) return size;
    const rect = drawerRef.current?.getBoundingClientRect();
    return { w: rect?.width ?? 320, h: rect?.height ?? 300 };
  };

  // Poignée dans le coin HAUT-DROIT : le tiroir est collé en bas à gauche, donc il ne peut
  // grandir que vers le haut et vers la droite -- c'est là que doit être la prise.
  const onGripPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = currentSize();
    const startX = e.clientX;
    const startY = e.clientY;
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('dragging');
    const onMove = (ev: PointerEvent) => {
      applySize({ w: start.w + (ev.clientX - startX), h: start.h + (startY - ev.clientY) });
    };
    const onUp = () => {
      grip.classList.remove('dragging');
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  };

  const onGripKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const s = currentSize();
    switch (e.key) {
      case 'ArrowRight':
        applySize({ ...s, w: s.w + KEY_STEP_PX });
        break;
      case 'ArrowLeft':
        applySize({ ...s, w: s.w - KEY_STEP_PX });
        break;
      case 'ArrowUp':
        applySize({ ...s, h: s.h + KEY_STEP_PX });
        break;
      case 'ArrowDown':
        applySize({ ...s, h: s.h - KEY_STEP_PX });
        break;
      case 'Home':
        setSize(null);
        try {
          localStorage.removeItem(SIZE_STORAGE_KEY);
        } catch {
          // idem storeSize : sans stockage, rien à effacer.
        }
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const drawerStyle = size ? ({ '--log-h': `${size.h}px`, width: `${size.w}px` } as CSSProperties) : undefined;

  // Regroupement par tour : un séparateur collant s'insère dès que le numéro change.
  let lastTurn: number | null = null;

  return (
    <>
      {!open && (
        <button
          ref={pillRef}
          className="event-log-pill"
          onClick={() => setOpen(true)}
          title="Ouvrir le journal de combat"
          aria-label={unread > 0 ? `Ouvrir le journal de combat (${unread} nouvelles entrées)` : 'Ouvrir le journal de combat'}
        >
          📜
          {unread > 0 && (
            <span className="event-log-unread" aria-hidden="true">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      )}
      <aside
        ref={drawerRef}
        className={`event-log-drawer${open ? ' open' : ''}${size ? ' sized' : ''}`}
        aria-hidden={!open}
        aria-label="Journal de combat"
        style={drawerStyle}
      >
        <header className="event-log-head">
          <span className="event-log-grip" aria-hidden="true">
            📜
          </span>
          <h3>Journal</h3>
          <span className="event-log-count" title="Entrées enregistrées">
            {log.length}
          </span>
          <button
            ref={closeRef}
            className="event-log-close"
            onClick={() => {
              returnFocusRef.current = true;
              setOpen(false);
            }}
            title="Fermer le journal (Échap)"
            aria-label="Fermer le journal"
          >
            ×
          </button>
        </header>
        <div
          className="event-log-resize"
          role="separator"
          tabIndex={open ? 0 : -1}
          aria-label="Redimensionner le journal : flèches pour ajuster, Début pour revenir à la taille d'origine"
          aria-orientation="horizontal"
          title="Glisser pour redimensionner (flèches au clavier, Début = taille d'origine)"
          onPointerDown={onGripPointerDown}
          onKeyDown={onGripKeyDown}
        />
        <ul ref={listRef} role="log" aria-live="polite" onScroll={onListScroll}>
          {recent.length === 0 && (
            <li className="log-empty">
              <span className="log-empty-icon" aria-hidden="true">
                📜
              </span>
              <span className="log-empty-title">Rien ne s'est encore passé.</span>
              <span className="log-empty-sub">Attaques, soins, KO et jets de chance s'inscriront ici, tour par tour.</span>
            </li>
          )}
          {recent.map((entry) => {
            const kind = kindOf(entry);
            const meta = kind ? KIND_META[kind] : undefined;
            const tone: LogTone = meta?.tone ?? 'muted';
            const mine = you !== undefined && entry.playerId === you;
            const chip = amountChip(entry, kind);
            const showSep = entry.turnNumber !== lastTurn;
            lastTurn = entry.turnNumber;
            return (
              <Fragment key={entry.id}>
                {/* Le séparateur est un `li` à part entière, et non un en-tête dans la ligne :
                    `position: sticky` se confine à son parent, il ne collerait à rien
                    depuis l'intérieur d'une ligne d'une seule entrée. */}
                {showSep && (
                  <li className="log-turn-sep" role="presentation">
                    <span>{turnLabel(entry.turnNumber)}</span>
                  </li>
                )}
                <li className={`log-entry log-tone-${tone}${kind ? ` log-kind-${kind}` : ''}${mine ? ' log-mine' : ''}`}>
                  <span className="log-icon" aria-hidden="true">
                    {meta?.icon ?? '·'}
                  </span>
                  <span className="log-message">{entry.message}</span>
                  {chip && <span className="log-amount">{chip}</span>}
                </li>
              </Fragment>
            );
          })}
        </ul>
        {newBelow > 0 && (
          <button
            className="event-log-jump"
            onClick={() => {
              setStickToBottom(true);
              scrollToBottom(true);
            }}
            aria-label={`${newBelow} nouvelles entrées : revenir en bas du journal`}
          >
            ↓ {newBelow} {newBelow > 1 ? 'nouvelles' : 'nouvelle'}
          </button>
        )}
      </aside>
    </>
  );
}
