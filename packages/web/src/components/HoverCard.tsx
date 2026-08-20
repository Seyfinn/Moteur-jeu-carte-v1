import { createContext, useContext, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface HoverPayload {
  title: string;
  subtitle?: string;
  body: ReactNode;
}

interface HoverCardApi {
  show: (payload: HoverPayload, target: HTMLElement) => void;
  hide: () => void;
}

const HoverCardCtx = createContext<HoverCardApi | null>(null);

const POPOVER_WIDTH = 320;
const POPOVER_MAX_HEIGHT = 420;

export function HoverCardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ payload: HoverPayload; rect: DOMRect } | null>(null);
  const hideTimer = useRef<number | null>(null);

  const api: HoverCardApi = {
    show(payload, target) {
      if (hideTimer.current !== null) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      setState({ payload, rect: target.getBoundingClientRect() });
    },
    hide() {
      hideTimer.current = window.setTimeout(() => setState(null), 60);
    },
  };

  let style: CSSProperties = {};
  if (state) {
    const { rect } = state;
    const spaceRight = window.innerWidth - rect.right;
    const left = spaceRight > POPOVER_WIDTH + 16 ? rect.right + 10 : Math.max(8, rect.left - POPOVER_WIDTH - 10);
    const top = Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - POPOVER_MAX_HEIGHT - 8));
    style = { left, top };
  }

  return (
    <HoverCardCtx.Provider value={api}>
      {children}
      {state && (
        <div className="hover-card-popover" style={style} onMouseEnter={() => api.show(state.payload, { getBoundingClientRect: () => state.rect } as HTMLElement)} onMouseLeave={api.hide}>
          <div className="hover-card-title">{state.payload.title}</div>
          {state.payload.subtitle && <div className="hover-card-subtitle">{state.payload.subtitle}</div>}
          <div className="hover-card-content">{state.payload.body}</div>
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
