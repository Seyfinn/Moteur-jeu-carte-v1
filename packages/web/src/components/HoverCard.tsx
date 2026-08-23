import { createContext, useContext, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface HoverPayload {
  title: string;
  subtitle?: string;
  body: ReactNode;
  /** Optional action button shown only in the tap-opened ("pinned") mobile popover. */
  actionLabel?: string;
  onAction?: () => void;
}

interface HoverCardApi {
  show: (payload: HoverPayload, target: HTMLElement) => void;
  /** Opens the popover centered on screen, pinned open until explicitly dismissed --
      used on touch devices, which have no hover to show/hide it on. */
  showCentered: (payload: HoverPayload) => void;
  hide: () => void;
}

const HoverCardCtx = createContext<HoverCardApi | null>(null);

const POPOVER_WIDTH = 320;
const POPOVER_MAX_HEIGHT = 420;

interface HoverState {
  payload: HoverPayload;
  /** null means "pinned/centered" (opened via showCentered) rather than anchored to a rect. */
  rect: DOMRect | null;
}

export function HoverCardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HoverState | null>(null);
  const hideTimer = useRef<number | null>(null);

  function clearHideTimer() {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  const api: HoverCardApi = {
    show(payload, target) {
      clearHideTimer();
      setState({ payload, rect: target.getBoundingClientRect() });
    },
    showCentered(payload) {
      clearHideTimer();
      setState({ payload, rect: null });
    },
    hide() {
      hideTimer.current = window.setTimeout(() => setState(null), 60);
    },
  };

  const pinned = state !== null && state.rect === null;

  let style: CSSProperties = {};
  if (state?.rect) {
    const { rect } = state;
    const spaceRight = window.innerWidth - rect.right;
    const left = spaceRight > POPOVER_WIDTH + 16 ? rect.right + 10 : Math.max(8, rect.left - POPOVER_WIDTH - 10);
    const top = Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - POPOVER_MAX_HEIGHT - 8));
    style = { left, top };
  }

  return (
    <HoverCardCtx.Provider value={api}>
      {children}
      {pinned && <div className="hover-card-backdrop" onClick={() => setState(null)} />}
      {state && (
        <div
          className={`hover-card-popover${pinned ? ' pinned' : ''}`}
          style={style}
          onMouseEnter={pinned ? undefined : () => api.show(state.payload, { getBoundingClientRect: () => state.rect! } as HTMLElement)}
          onMouseLeave={pinned ? undefined : api.hide}
        >
          {pinned && (
            <button className="hover-card-close" onClick={() => setState(null)} aria-label="Fermer">
              ×
            </button>
          )}
          <div className="hover-card-title">{state.payload.title}</div>
          {state.payload.subtitle && <div className="hover-card-subtitle">{state.payload.subtitle}</div>}
          <div className="hover-card-content">{state.payload.body}</div>
          {state.payload.actionLabel && (
            <button
              className="hover-card-action"
              onClick={() => {
                state.payload.onAction?.();
                setState(null);
              }}
            >
              {state.payload.actionLabel}
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
