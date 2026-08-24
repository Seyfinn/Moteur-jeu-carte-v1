import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { CardPreviewPanel, type PreviewCard } from './CardPreviewPanel';
import type { HoverHandlers } from './CardFrame';
import { usePointerCoarse } from '../hooks/usePointerCoarse';

export interface HoverPayload {
  /** Identité stable de ce qui est affiché (instanceId d'un personnage, id d'une carte).
      Permet de rafraîchir un panneau épinglé quand l'instance qu'il montre bouge (PV,
      statuts) au lieu de laisser un instantané périmé sous les yeux du joueur. */
  id?: string;
  title: string;
  subtitle?: string;
  body: ReactNode;
  /** Quand elle est fournie, la carte est dessinée en grand à côté de son texte. */
  card?: PreviewCard;
  /** Bouton d'action proposé dans le panneau épinglé (jouer l'objet, poser le terrain...). */
  actionLabel?: string;
  onAction?: () => void;
}

interface HoverCardApi {
  /** Aperçu volatil ancré à la carte survolée. */
  show: (payload: HoverPayload, target: HTMLElement) => void;
  /** Épingle la carte en grand dans un coin, jusqu'à fermeture explicite par la croix. */
  pin: (payload: HoverPayload) => void;
  /** Variante centrée + voile, pour le tactile qui n'a pas de survol pour ouvrir/fermer. */
  showCentered: (payload: HoverPayload) => void;
  /** Remplace le contenu du panneau épinglé s'il montre déjà ce `payload.id` (no-op sinon). */
  refreshPinned: (payload: HoverPayload) => void;
  hide: () => void;
}

const HoverCardCtx = createContext<HoverCardApi | null>(null);

const POPOVER_WIDTH = 320;
const POPOVER_MAX_HEIGHT = 420;
/** Largeur de l'aperçu « carte en grand + texte », identique à celle du deck-builder. */
const PREVIEW_WIDTH = 700;
const PREVIEW_MAX_HEIGHT = 480;
const CORNER_PANEL_WIDTH = 300;
/** Comme dans le deck-builder : l'aperçu géant attend que la souris se pose vraiment sur
    une carte, sinon il clignote à chaque traversée du plateau. Un simple encart de texte
    (options du menu d'action) reste instantané. */
const PREVIEW_DELAY_MS = 200;
const HIDE_DELAY_MS = 60;

interface AnchoredState {
  payload: HoverPayload;
  rect: DOMRect;
}

interface PinnedState {
  payload: HoverPayload;
  /** `true` = centré avec un voile (tactile) ; `false` = épinglé dans le coin de l'écran. */
  centered: boolean;
}

function anchoredStyle(rect: DOMRect, wide: boolean, reservedRight: number): CSSProperties {
  const width = wide ? PREVIEW_WIDTH : POPOVER_WIDTH;
  const maxHeight = wide ? PREVIEW_MAX_HEIGHT : POPOVER_MAX_HEIGHT;
  const spaceRight = window.innerWidth - rect.right - reservedRight;
  const left = spaceRight > width + 16 ? rect.right + 10 : Math.max(8, rect.left - width - 10);
  const top = Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - maxHeight - 8));
  return { left, top };
}

function payloadBody(payload: HoverPayload): ReactNode {
  if (payload.card) {
    return <CardPreviewPanel card={payload.card} title={payload.title} subtitle={payload.subtitle} body={payload.body} />;
  }
  return (
    <>
      <div className="hover-card-title">{payload.title}</div>
      {payload.subtitle && <div className="hover-card-subtitle">{payload.subtitle}</div>}
      <div className="hover-card-content">{payload.body}</div>
    </>
  );
}

export function HoverCardProvider({ children }: { children: ReactNode }) {
  const [anchored, setAnchored] = useState<AnchoredState | null>(null);
  const [pinned, setPinned] = useState<PinnedState | null>(null);
  const hideTimer = useRef<number | null>(null);
  const showTimer = useRef<number | null>(null);
  const visibleRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
    hideTimer.current = null;
    showTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const show = useCallback(
    (payload: HoverPayload, target: HTMLElement) => {
      clearTimers();
      const rect = target.getBoundingClientRect();
      // Passer d'une carte à l'autre ne réarme pas le délai : il ne sert qu'à ne pas
      // ouvrir l'aperçu sous une souris qui ne fait que traverser le plateau.
      if (!payload.card || visibleRef.current) {
        visibleRef.current = true;
        setAnchored({ payload, rect });
        return;
      }
      showTimer.current = window.setTimeout(() => {
        showTimer.current = null;
        visibleRef.current = true;
        setAnchored({ payload, rect });
      }, PREVIEW_DELAY_MS);
    },
    [clearTimers]
  );

  const hide = useCallback(() => {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      visibleRef.current = false;
      setAnchored(null);
    }, HIDE_DELAY_MS);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimer.current === null) return;
    window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);

  const pin = useCallback(
    (payload: HoverPayload) => {
      clearTimers();
      visibleRef.current = false;
      setAnchored(null);
      setPinned({ payload, centered: false });
    },
    [clearTimers]
  );

  const showCentered = useCallback(
    (payload: HoverPayload) => {
      clearTimers();
      visibleRef.current = false;
      setAnchored(null);
      setPinned({ payload, centered: true });
    },
    [clearTimers]
  );

  const refreshPinned = useCallback((payload: HoverPayload) => {
    setPinned((prev) => {
      if (!prev || payload.id === undefined || prev.payload.id !== payload.id) return prev;
      return { ...prev, payload };
    });
  }, []);

  const api = useMemo<HoverCardApi>(
    () => ({ show, pin, showCentered, refreshPinned, hide }),
    [show, pin, showCentered, refreshPinned, hide]
  );

  // Échap ferme d'abord l'aperçu volatil, puis le panneau épinglé -- la sortie clavier
  // que réclame tout ce qui reste ouvert « jusqu'à fermeture explicite ».
  useEffect(() => {
    if (!anchored && !pinned) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (anchored) {
        clearTimers();
        visibleRef.current = false;
        setAnchored(null);
        return;
      }
      setPinned(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anchored, pinned, clearTimers]);

  const cornerOpen = pinned !== null && !pinned.centered;

  return (
    <HoverCardCtx.Provider value={api}>
      {children}

      {anchored && (
        <div
          className={anchored.payload.card ? 'card-preview' : 'hover-card-popover'}
          style={anchoredStyle(anchored.rect, Boolean(anchored.payload.card), cornerOpen ? CORNER_PANEL_WIDTH + 24 : 0)}
          onMouseEnter={cancelHide}
          onMouseLeave={hide}
        >
          {payloadBody(anchored.payload)}
        </div>
      )}

      {pinned && pinned.centered && <div className="hover-card-backdrop" onClick={() => setPinned(null)} />}
      {pinned && (
        <div
          className={`${pinned.payload.card ? 'card-preview' : 'hover-card-popover'} ${
            pinned.centered ? 'pinned' : 'corner-pinned'
          }`}
        >
          <button className="hover-card-close" onClick={() => setPinned(null)} aria-label="Fermer">
            ×
          </button>
          {payloadBody(pinned.payload)}
          {pinned.payload.actionLabel && (
            <button
              className="hover-card-action"
              onClick={() => {
                pinned.payload.onAction?.();
                setPinned(null);
              }}
            >
              {pinned.payload.actionLabel}
            </button>
          )}
        </div>
      )}
    </HoverCardCtx.Provider>
  );
}

export function useHoverCard(): HoverCardApi {
  const ctx = useContext(HoverCardCtx);
  if (!ctx) throw new Error('useHoverCard must be used within a HoverCardProvider');
  return ctx;
}

/**
 * Branchement standard d'une carte du plateau : survol = aperçu volatil en grand, clic =
 * le même aperçu épinglé dans le coin jusqu'à ce qu'on le ferme. Sur écran tactile, où il
 * n'y a pas de survol, le tap ouvre la version centrée.
 */
export function useCardInspect(payload: HoverPayload): { onClick: () => void; hoverProps?: HoverHandlers } {
  const hover = useHoverCard();
  const coarse = usePointerCoarse();
  return {
    onClick: () => (coarse ? hover.showCentered(payload) : hover.pin(payload)),
    hoverProps: coarse
      ? undefined
      : {
          onMouseEnter: (e) => hover.show(payload, e.currentTarget),
          onMouseLeave: hover.hide,
        },
  };
}
