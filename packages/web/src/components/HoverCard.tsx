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
import { CardFrame } from './CardFrame';
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
  /**
   * Inspection : la carte seule, en très grand au centre de l'écran, jusqu'à fermeture
   * (croix, voile ou Échap). Aucun texte à côté -- l'illustration porte déjà le texte
   * imprimé de la carte, et c'est précisément pour le lire qu'on ouvre cette vue.
   */
  pin: (payload: HoverPayload) => void;
  /** Alias historique de `pin` : le tactile n'a pas de survol, le tap ouvre la même vue. */
  showCentered: (payload: HoverPayload) => void;
  /** Remplace le contenu de la fiche ouverte si elle montre déjà ce `payload.id` (no-op sinon). */
  refreshPinned: (payload: HoverPayload) => void;
  hide: () => void;
  /**
   * Délai avant l'aperçu au survol. En plein combat il doit être franchement long : la
   * souris traverse le plateau en permanence et l'aperçu clignoterait sans arrêt.
   */
  setPreviewDelay: (ms: number) => void;
}

const HoverCardCtx = createContext<HoverCardApi | null>(null);

const POPOVER_WIDTH = 320;
const POPOVER_MAX_HEIGHT = 420;
/** Largeur de l'aperçu « carte en grand + texte » (la carte y occupe la majeure partie). */
const PREVIEW_WIDTH = 800;
const PREVIEW_MAX_HEIGHT = 700;
/**
 * Délai par défaut avant l'aperçu au survol : celui du deck-builder, où l'on parcourt une
 * grille de cartes pour les lire. Le plateau le remonte à `COMBAT_PREVIEW_DELAY_MS` via
 * `setPreviewDelay` -- en combat la souris traverse sans arrêt des cartes qu'on ne cherche
 * pas à lire, et l'aperçu clignoterait en permanence. Un simple encart de texte (options
 * du menu d'action) reste instantané dans les deux cas.
 */
export const DECK_PREVIEW_DELAY_MS = 300;
export const COMBAT_PREVIEW_DELAY_MS = 1000;
const HIDE_DELAY_MS = 60;

interface AnchoredState {
  payload: HoverPayload;
  rect: DOMRect;
}

interface PinnedState {
  payload: HoverPayload;
}

function anchoredStyle(rect: DOMRect, wide: boolean): CSSProperties {
  const width = wide ? PREVIEW_WIDTH : POPOVER_WIDTH;
  const maxHeight = wide ? PREVIEW_MAX_HEIGHT : POPOVER_MAX_HEIGHT;
  const spaceRight = window.innerWidth - rect.right;
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
  const delayRef = useRef(DECK_PREVIEW_DELAY_MS);

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
      }, delayRef.current);
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
      setPinned({ payload });
    },
    [clearTimers]
  );

  const setPreviewDelay = useCallback((ms: number) => {
    delayRef.current = ms;
  }, []);

  const refreshPinned = useCallback((payload: HoverPayload) => {
    setPinned((prev) => {
      if (!prev || payload.id === undefined || prev.payload.id !== payload.id) return prev;
      return { ...prev, payload };
    });
  }, []);

  const api = useMemo<HoverCardApi>(
    () => ({ show, pin, showCentered: pin, refreshPinned, hide, setPreviewDelay }),
    [show, pin, refreshPinned, hide, setPreviewDelay]
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

  return (
    <HoverCardCtx.Provider value={api}>
      {children}

      {anchored && (
        <div
          className={anchored.payload.card ? 'card-preview' : 'hover-card-popover'}
          style={anchoredStyle(anchored.rect, Boolean(anchored.payload.card))}
          onMouseEnter={cancelHide}
          onMouseLeave={hide}
        >
          {payloadBody(anchored.payload)}
        </div>
      )}

      {pinned && <div className="hover-card-backdrop" onClick={() => setPinned(null)} />}
      {pinned && (
        // Inspection : rien que la carte, en très grand. Le texte imprimé est sur
        // l'illustration -- le doubler d'un pavé de description à côté ne ferait que voler
        // la place qui la rend lisible. Un payload sans carte (cas rare : une fiche
        // purement textuelle) retombe sur l'ancien encart.
        <div className={pinned.payload.card ? 'card-inspect' : 'hover-card-popover pinned'}>
          <button className="hover-card-close" onClick={() => setPinned(null)} aria-label="Fermer">
            ×
          </button>
          {pinned.payload.card ? (
            <CardFrame
              cardId={pinned.payload.card.cardId}
              kind={pinned.payload.card.kind}
              name={pinned.payload.card.name}
              size="large"
              unique={pinned.payload.card.unique}
            />
          ) : (
            payloadBody(pinned.payload)
          )}
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
 * Branchement standard d'une carte du plateau : survol = aperçu carte + texte à côté de la
 * carte survolée, clic = la carte seule en très grand au centre, jusqu'à fermeture. Sur
 * écran tactile, où il n'y a pas de survol, le tap ouvre directement cette dernière.
 */
export function useCardInspect(payload: HoverPayload): { onClick: () => void; hoverProps?: HoverHandlers } {
  const hover = useHoverCard();
  const coarse = usePointerCoarse();
  return {
    onClick: () => hover.pin(payload),
    hoverProps: coarse
      ? undefined
      : {
          onMouseEnter: (e) => hover.show(payload, e.currentTarget),
          onMouseLeave: hover.hide,
        },
  };
}
