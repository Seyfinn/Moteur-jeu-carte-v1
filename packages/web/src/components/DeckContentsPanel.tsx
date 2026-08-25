import { createContext, useContext, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DECK_LIMITS, type DeckPoolEntry } from 'engine';
import { CardFrame } from './CardFrame';
import { CardPreviewPanel } from './CardPreviewPanel';
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

/**
 * Les objets se lisent en deux familles très différentes : ceux qui se **lient** à un
 * personnage et restent en jeu, et ceux qui produisent leur effet et partent aussitôt.
 * Les équipements passent devant : ce sont eux qui engagent une place sur un personnage,
 * donc ceux qu'on choisit en premier quand on compose un deck.
 *
 * `null` en libellé pour les personnages et les terrains : une seule famille, aucun
 * en-tête intermédiaire à afficher.
 */
export const OBJECT_SUBGROUPS: Array<{ key: 'equipment' | 'basic'; title: string; hint: string }> = [
  { key: 'equipment', title: 'Objets à lier', hint: "S'accrochent à un personnage et le suivent jusqu'à sa mort" },
  { key: 'basic', title: 'Objets basiques', hint: 'Effet immédiat, puis la carte part au cimetière' },
];

/** Découpe une liste de cartes en sous-familles affichables. Un seul groupe hors objets. */
export function splitBySubgroup<T>(
  type: CardKind,
  entries: T[],
  isEquipment: (entry: T) => boolean
): Array<{ key: string; title: string | null; hint?: string; entries: T[] }> {
  if (type !== 'object') return [{ key: 'all', title: null, entries }];
  return OBJECT_SUBGROUPS.map((group) => ({
    ...group,
    entries: entries.filter((entry) => isEquipment(entry) === (group.key === 'equipment')),
  })).filter((group) => group.entries.length > 0);
}

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
        <div className={`card-preview${pinned ? ' pinned' : ''}`} style={style}>
          {pinned && (
            <button className="hover-card-close" onClick={() => setState(null)} aria-label="Fermer">
              ×
            </button>
          )}
          <CardPreviewPanel
            card={{
              cardId: state.entry.id,
              kind: state.entry.type,
              name: state.entry.name,
              unique: state.entry.maxCopies === 1,
            }}
            body={detailBodyFor(state.entry)}
          />
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

/** Ligne d'une carte dans la vue « liste » : une bande de l'illustration en fond, le nom
    par-dessus et la quantité. Une grille de vignettes complètes sature vite un panneau
    latéral -- ici, une carte = une ligne, et l'illustration reste une simple ambiance.
    L'aperçu complet (survol prolongé, ou tap sur mobile) reste la façon de vraiment lire
    la carte, exactement comme sur les vignettes. */
export function DeckCardRow({
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
    <li
      className="deck-row"
      style={{ '--row-art': `url(/cards/${entry.id}.png)` } as CSSProperties}
      onClick={coarse ? () => preview.showCentered(entry) : undefined}
      onMouseEnter={coarse ? undefined : (e) => preview.requestShow(entry, e.currentTarget)}
      onMouseLeave={coarse ? undefined : preview.cancel}
    >
      <span className="deck-row-art" />
      <span className="deck-row-scrim" />
      {/* Le badge « unique » se colle au nom : posé à côté du compteur, « 1× ×1 » se lit
          comme deux quantités contradictoires. */}
      <span className="deck-row-main">
        <span className="deck-row-name">{entry.name}</span>
        {entry.maxCopies === 1 && (
          <span className="deck-row-unique" title="Carte unique exemplaire (1 max par deck)">
            1×
          </span>
        )}
      </span>
      <span className="deck-row-count">×{count}</span>
      {onRemove && (
        <button
          type="button"
          className="deck-row-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Retirer ${entry.name}`}
        >
          −
        </button>
      )}
    </li>
  );
}

/** Read-or-edit panel listing every card currently in a deck, grouped by category.
    Used both as the live "Deck actuel" tracker while building a deck, and as a
    read-only preview of the deck picked in the lobby before starting a game.
    `variant` choisit la densité : `grid` (vignettes) pour le deck-builder, où l'on
    compare des cartes, `list` (lignes) pour le salon, où l'on relit juste son deck. */
export function DeckContentsPanel({
  title,
  deck,
  pool,
  onRemove,
  variant = 'grid',
}: {
  title: string;
  deck: Deck;
  pool: Record<CardKind, DeckPoolEntry[]>;
  onRemove?: (key: DeckSectionKey, id: string) => void;
  variant?: 'grid' | 'list';
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
                // Même découpage que le pool du deck-builder : équipements d'abord, objets
                // basiques ensuite, pour qu'on lise son deck comme on l'a composé.
                splitBySubgroup(section.type, groups, ({ id }) => poolById.get(id)?.equipment === true).map(
                  (group) => (
                    <div key={group.key}>
                      {group.title && <h4 className="deck-subgroup-header compact">{group.title}</h4>}
                      {variant === 'list' ? (
                        <ul className="deck-row-list">
                          {group.entries.map(({ id, count }) => {
                            const entry = poolById.get(id);
                            if (!entry) return null;
                            return (
                              <DeckCardRow
                                key={id}
                                entry={entry}
                                count={count}
                                onRemove={onRemove ? () => onRemove(section.key, id) : undefined}
                              />
                            );
                          })}
                        </ul>
                      ) : (
                        <div className="deck-selected-grid">
                          {group.entries.map(({ id, count }) => {
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
                  )
                )
              )}
            </div>
          );
        })}
      </aside>
    </CardPreviewProvider>
  );
}
