import { createContext, useContext, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DECK_LIMITS, type DeckPoolEntry } from 'engine';
import { CardFrame } from './CardFrame';
import { characterDetailBody, objectDetailBody, terrainDetailBody } from './cardDetails';
import type { Deck } from '../decks';
import { usePointerCoarse } from '../hooks/usePointerCoarse';

export type DeckSectionKey = 'characterCardIds' | 'objectCardIds' | 'terrainCardIds';
export type CardKind = DeckPoolEntry['type'];

export const SECTIONS: Array<{ key: DeckSectionKey; type: CardKind; max: number; title: string }> = [
  { key: 'characterCardIds', type: 'character', max: DECK_LIMITS.character, title: 'Personnages' },
  { key: 'objectCardIds', type: 'object', max: DECK_LIMITS.object, title: 'Objets' },
  { key: 'terrainCardIds', type: 'terrain', max: DECK_LIMITS.terrain, title: 'Terrains' },
];

export function detailBodyFor(entry: DeckPoolEntry) {
  switch (entry.type) {
    case 'character':
      return characterDetailBody(entry.id);
    case 'object':
      return objectDetailBody(entry.id);
    case 'terrain':
      return terrainDetailBody(entry.id);
  }
}

/** Collapses a list of ids into { id, count } pairs, in order of first appearance. */
function groupByCount(ids: string[]): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()].map(([id, count]) => ({ id, count }));
}

/** Hover-and-hold preview: unlike the instant in-game HoverCard, this waits for the
    mouse to stay still on a pool card for a bit before popping up an enlarged card
    next to its description -- browsing the pool shouldn't flash a tooltip per swipe. */
const PREVIEW_DELAY_MS = 300;
const PREVIEW_PANEL_WIDTH = 700;
const PREVIEW_PANEL_MAX_HEIGHT = 480;

interface CardPreviewApi {
  requestShow: (entry: DeckPoolEntry, target: HTMLElement) => void;
  /** Opens the preview centered on screen, pinned open until explicitly dismissed --
      used on touch devices, which have no hover to show/hide it on. */
  showCentered: (entry: DeckPoolEntry) => void;
  cancel: () => void;
}

const CardPreviewCtx = createContext<CardPreviewApi | null>(null);

export function useCardPreview(): CardPreviewApi {
  const ctx = useContext(CardPreviewCtx);
  if (!ctx) throw new Error('useCardPreview must be used within a CardPreviewProvider');
  return ctx;
}

export function CardPreviewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ entry: DeckPoolEntry; rect: DOMRect | null } | null>(null);
  const showTimer = useRef<number | null>(null);

  function clearTimer() {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  }

  const api: CardPreviewApi = {
    requestShow(entry, target) {
      clearTimer();
      const rect = target.getBoundingClientRect();
      showTimer.current = window.setTimeout(() => {
        showTimer.current = null;
        setState({ entry, rect });
      }, PREVIEW_DELAY_MS);
    },
    showCentered(entry) {
      clearTimer();
      setState({ entry, rect: null });
    },
    cancel() {
      clearTimer();
      setState(null);
    },
  };

  const pinned = state !== null && state.rect === null;

  let style: CSSProperties = {};
  if (state?.rect) {
    const { rect } = state;
    const spaceRight = window.innerWidth - rect.right;
    const left = spaceRight > PREVIEW_PANEL_WIDTH + 16 ? rect.right + 12 : Math.max(8, rect.left - PREVIEW_PANEL_WIDTH - 12);
    const top = Math.min(Math.max(8, rect.top - 40), Math.max(8, window.innerHeight - PREVIEW_PANEL_MAX_HEIGHT - 8));
    style = { left, top };
  }

  return (
    <CardPreviewCtx.Provider value={api}>
      {children}
      {pinned && <div className="hover-card-backdrop" onClick={() => setState(null)} />}
      {state && (
        <div className={`deck-card-preview${pinned ? ' pinned' : ''}`} style={style}>
          {pinned && (
            <button className="hover-card-close" onClick={() => setState(null)} aria-label="Fermer">
              ×
            </button>
          )}
          <CardFrame
            cardId={state.entry.id}
            kind={state.entry.type}
            name={state.entry.name}
            size="large"
            unique={state.entry.maxCopies === 1}
          />
          <div className="deck-card-preview-text">
            <div className="hover-card-title">{state.entry.name}</div>
            <div className="hover-card-content">{detailBodyFor(state.entry)}</div>
          </div>
        </div>
      )}
    </CardPreviewCtx.Provider>
  );
}

/** Tile shown in a deck-contents tracker -- a compact readout of what's in the deck.
    When `onRemove` is provided (editing a deck) it also offers a one-click way to drop
    a copy; omitted (just reviewing a deck before playing) it's read-only. */
export function SelectedCardTile({
  entry,
  count,
  onRemove,
}: {
  entry: DeckPoolEntry;
  count: number;
  onRemove?: () => void;
}) {
  const preview = useCardPreview();
  const coarse = usePointerCoarse();
  return (
    <CardFrame
      cardId={entry.id}
      kind={entry.type}
      name={entry.name}
      size="small"
      unique={entry.maxCopies === 1}
      onClick={coarse ? () => preview.showCentered(entry) : undefined}
      hoverProps={
        coarse
          ? undefined
          : {
              onMouseEnter: (e) => preview.requestShow(entry, e.currentTarget),
              onMouseLeave: preview.cancel,
            }
      }
      footer={
        count > 1 || onRemove ? (
          <div className="deck-selected-stepper">
            {count > 1 && <span className="deck-selected-count-badge">×{count}</span>}
            {onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                aria-label={`Retirer ${entry.name}`}
              >
                −
              </button>
            )}
          </div>
        ) : undefined
      }
    />
  );
}

/** Read-or-edit panel listing every card currently in a deck, grouped by category.
    Used both as the live "Deck actuel" tracker while building a deck, and as a
    read-only preview of the deck picked in the lobby before starting a game. */
export function DeckContentsPanel({
  title,
  deck,
  pool,
  onRemove,
}: {
  title: string;
  deck: Deck;
  pool: Record<CardKind, DeckPoolEntry[]>;
  onRemove?: (key: DeckSectionKey, id: string) => void;
}) {
  const poolById = useMemo(() => {
    const map = new Map<string, DeckPoolEntry>();
    for (const entries of Object.values(pool)) {
      for (const entry of entries) map.set(entry.id, entry);
    }
    return map;
  }, [pool]);

  return (
    <CardPreviewProvider>
      <aside className="deck-selected-panel">
        <h2>{title}</h2>
        {SECTIONS.map((section) => {
          const ids = deck[section.key];
          const groups = groupByCount(ids);
          return (
            <div className="deck-selected-group" key={section.key}>
              <h3>
                {section.title} <span className="deck-section-count">({ids.length}/{section.max})</span>
              </h3>
              {groups.length === 0 ? (
                <p className="subtitle">Aucune carte pour l'instant.</p>
              ) : (
                <div className="deck-selected-grid">
                  {groups.map(({ id, count }) => {
                    const entry = poolById.get(id);
                    if (!entry) return null;
                    return (
                      <SelectedCardTile
                        key={id}
                        entry={entry}
                        count={count}
                        onRemove={onRemove ? () => onRemove(section.key, id) : undefined}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </aside>
    </CardPreviewProvider>
  );
}
