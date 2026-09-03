import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { PreviewCard } from './CardPreviewPanel';
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

/**
 * Encombrement du panneau d'inspection. La largeur n'est plus recopiée ici : elle est LUE
 * sur la CSS (`--ins-panel-w`), parce que les deux valeurs avaient déjà divergé une fois
 * (340 en JS, 360 en CSS) et que le panneau se posait alors 20 px trop à droite, à cheval
 * sur le banc. Un seul chiffre, un seul endroit où le changer.
 */
const PANEL_WIDTH_FALLBACK = 360;
const PANEL_MAX_HEIGHT = 460;

function panelWidth(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--ins-panel-w');
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : PANEL_WIDTH_FALLBACK;
}
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

/**
 * Bande centrale du plateau : ce qu'il y a entre les deux rails latéraux. Le panneau y est
 * confiné, ce qui garantit qu'il ne recouvre JAMAIS un banc -- ni celui de gauche, ni celui
 * de droite. Hors partie (deck-builder), il n'y a pas de rail : toute la fenêtre fait
 * office de bande.
 */
function centralBand(): { min: number; max: number } {
  const left = document.querySelector('.rail-self')?.getBoundingClientRect();
  const right = document.querySelector('.rail-opp')?.getBoundingClientRect();
  const min = left ? left.right + 8 : 8;
  const max = right ? right.left - 8 : window.innerWidth - 8;
  // Bande trop étroite pour le panneau (fenêtre minuscule) : on retombe sur la fenêtre
  // entière plutôt que de produire un intervalle vide.
  return max - min < panelWidth() ? { min: 8, max: window.innerWidth - 8 } : { min, max };
}

/** Plafond du panneau : la main du joueur occupe le bas de l'écran, il s'arrête au-dessus. */
function bandFloor(): number {
  return document.querySelector('.hand-dock')?.getBoundingClientRect().top ?? window.innerHeight;
}

/**
 * Recadrage APRÈS montage, sur les mesures réelles du panneau et des rails.
 *
 * `anchoredStyle` calcule une position au moment du rendu, à partir d'un relevé qui peut
 * déjà être périmé (une illustration qui finit de charger décale les colonnes de la grille,
 * et le panneau se retrouvait à cheval sur le banc de droite). Ce dernier mot, lui, est
 * pris quand tout est en place -- c'est lui qui garantit l'absence de recouvrement.
 */
function clampIntoBand(el: HTMLDivElement | null): void {
  if (!el) return;
  const band = centralBand();
  const rect = el.getBoundingClientRect();
  const corrected = Math.min(Math.max(band.min, rect.left), Math.max(band.min, band.max - rect.width));
  if (Math.abs(corrected - rect.left) > 0.5) el.style.left = `${corrected}px`;

  // Même recadrage sur la verticale : la hauteur retenue au rendu était calculée sur un
  // plancher (le haut de la main) relevé avant que la main n'ait fini de se déployer.
  const floor = bandFloor();
  const maxHeight = Math.max(200, Math.min(PANEL_MAX_HEIGHT, floor - 16));
  el.style.maxHeight = `${maxHeight}px`;
  const height = Math.min(rect.height, maxHeight);
  const top = Math.min(Math.max(8, rect.top), Math.max(8, floor - height - 8));
  if (Math.abs(top - rect.top) > 0.5) el.style.top = `${top}px`;
}

function anchoredStyle(rect: DOMRect): CSSProperties {
  const band = centralBand();
  // Le panneau se colle au bord de la bande OPPOSÉ à la carte survolée. Deux garanties d'un
  // coup, sans arbitrage fragile sur la place disponible : il reste toujours dans la bande
  // (donc ne recouvre jamais un banc), et toujours du côté opposé à ce qu'on inspecte (donc
  // ne recouvre jamais la carte qu'on est en train de lire). La bande fait ~900 px pour un
  // panneau de 360 : il y a toujours la place des deux côtés.
  const cardIsOnTheRight = rect.left + rect.width / 2 > (band.min + band.max) / 2;
  const left = cardIsOnTheRight ? band.min : Math.max(band.min, band.max - panelWidth());

  // La main du joueur occupe le bas de l'écran : le panneau s'arrête au-dessus d'elle.
  const floor = bandFloor();
  const maxHeight = Math.max(200, Math.min(PANEL_MAX_HEIGHT, floor - 16));
  const top = Math.min(Math.max(8, rect.top), Math.max(8, floor - maxHeight - 8));
  return { left, top, maxHeight };
}

/**
 * Le panneau ne redessine PLUS la carte à côté de son texte : au survol, la carte est déjà
 * sous le curseur, et sa vignette en doublon volait la moitié de la largeur au texte, qui
 * est justement ce qu'on vient lire. Le deck-builder, lui, garde la vignette
 * (`CardPreviewPanel`) -- là-bas la carte n'est pas forcément visible.
 */
function panelBody(payload: HoverPayload): ReactNode {
  return (
    <>
      <header className="ins-head">
        <h3 className="ins-name">{payload.title}</h3>
        {payload.subtitle && <p className="ins-subtitle">{payload.subtitle}</p>}
      </header>
      <div className="ins-body">{payload.body}</div>
    </>
  );
}

export function HoverCardProvider({ children }: { children: ReactNode }) {
  const [anchored, setAnchored] = useState<AnchoredState | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
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

  // Dernier mot sur la position, pris une fois le panneau posé : React réutilise le même
  // noeud d'un survol à l'autre, donc un rappel de `ref` ne suffirait pas -- il ne se
  // redéclencherait jamais après le premier.
  useLayoutEffect(() => {
    if (!anchored) return;
    clampIntoBand(panelRef.current);

    // ... et à chaque fois que le plateau bouge SOUS le panneau déjà ouvert. Un rail qui
    // s'élargit (illustration de banc qui finit de charger), la main qui se déploie, une
    // fenêtre redimensionnée : le relevé du montage devient faux et le panneau se
    // retrouvait à cheval sur le banc. Le recadrage est rejoué à chaque mouvement.
    const recheck = () => clampIntoBand(panelRef.current);
    const observer = new ResizeObserver(recheck);
    for (const selector of ['.rail-self', '.rail-opp', '.hand-dock']) {
      const el = document.querySelector(selector);
      if (el) observer.observe(el);
    }
    window.addEventListener('resize', recheck);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', recheck);
    };
  }, [anchored]);

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
          className="ins-panel"
          ref={panelRef}
          style={anchoredStyle(anchored.rect)}
          onMouseEnter={cancelHide}
          onMouseLeave={hide}
        >
          {panelBody(anchored.payload)}
        </div>
      )}

      {pinned && <div className="hover-card-backdrop" onClick={() => setPinned(null)} />}
      {pinned && (
        // Inspection : rien que la carte, en très grand. Le texte imprimé est sur
        // l'illustration -- le doubler d'un pavé de description à côté ne ferait que voler
        // la place qui la rend lisible. Un payload sans carte (cas rare : une fiche
        // purement textuelle) retombe sur l'ancien encart.
        <div className={pinned.payload.card ? 'card-inspect' : 'ins-panel pinned'}>
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
            panelBody(pinned.payload)
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
