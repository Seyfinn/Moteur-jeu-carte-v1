import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DECK_LIMITS, type DeckPoolEntry } from 'engine';
import { CardFrame, type HoverHandlers } from './CardFrame';
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
 * Pictogramme par famille de cartes, partagé par tout ce qui titre une section de deck :
 * en-tête de section dans l'éditeur, pastille de compte sur la vignette d'un deck. Une
 * famille se reconnaît ainsi à la même image partout dans le gestionnaire.
 */
export const SECTION_ICON: Record<CardKind, string> = {
  character: '⚔️',
  object: '🎒',
  terrain: '🗺️',
};

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

/**
 * Collapses a list of ids into { id, count } pairs, **par ordre alphabétique de nom** --
 * le même classement que les grilles du pool à côté. L'ordre d'ajout, qui prévalait avant,
 * ne veut rien dire pour qui relit son deck, et faisait sauter une carte de place dès qu'on
 * la retirait puis la remettait.
 */
function groupByCount(ids: string[], nameOf: (id: string) => string): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => nameOf(a.id).localeCompare(nameOf(b.id), 'fr', { sensitivity: 'base' }));
}

/** Hover-and-hold preview: unlike the instant in-game HoverCard, this waits for the
    mouse to stay still on a pool card for a bit before popping up an enlarged card
    next to its description -- browsing the pool shouldn't flash a tooltip per swipe. */
const PREVIEW_DELAY_MS = 300;
/**
 * Délai avant la fermeture au départ de la souris : le temps d'entrer dans la bulle pour y
 * faire défiler un long texte. La bulle elle-même annule la fermeture tant qu'on la survole.
 */
const PREVIEW_HIDE_DELAY_MS = 300;
const PREVIEW_PANEL_WIDTH = 700;
/** Doit suivre `max-height` de `.card-preview-text` (+ le cadre) : sert à ne pas poser la bulle sous le bord bas. */
const PREVIEW_PANEL_MAX_HEIGHT = 600;

interface CardPreviewApi {
  requestShow: (entry: DeckPoolEntry, target: HTMLElement) => void;
  /** Opens the preview centered on screen, pinned open until explicitly dismissed --
      used on touch devices (no hover), and on click / right-click at the mouse. */
  showCentered: (entry: DeckPoolEntry) => void;
  cancel: () => void;
  /**
   * Branchement standard d'une vignette : survol prolongé = bulle à côté (souris
   * seulement), clic ou clic droit = fiche épinglée au centre jusqu'à fermeture. Le clic
   * gauche est libre sur toutes ces vignettes (les « + » / « − » sont des boutons à part).
   */
  bind: (entry: DeckPoolEntry) => { onClick: () => void; hoverProps?: HoverHandlers };
}

const CardPreviewCtx = createContext<CardPreviewApi | null>(null);

export function useCardPreview(): CardPreviewApi {
  const ctx = useContext(CardPreviewCtx);
  if (!ctx) throw new Error('useCardPreview must be used within a CardPreviewProvider');
  return ctx;
}

interface PreviewState {
  entry: DeckPoolEntry;
  /** `null` = épinglée au centre. */
  rect: DOMRect | null;
  /** La vignette survolée : la molette posée dessus fait défiler la bulle à sa place. */
  anchor: HTMLElement | null;
}

export function CardPreviewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PreviewState | null>(null);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const coarse = usePointerCoarse();

  function clearTimers() {
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    showTimer.current = null;
    hideTimer.current = null;
  }
  // Quitter l'écran (Retour, Échap) pendant qu'un survol arme l'aperçu : le minuteur
  // survivait au démontage et tentait d'ouvrir l'aperçu sur un composant disparu.
  useEffect(() => clearTimers, []);

  const pinned = state !== null && state.rect === null;

  // Fiche épinglée : Échap la ferme, comme la croix ou le voile. En phase de capture et
  // sans laisser passer l'événement : l'éditeur de deck écoute aussi Échap pour quitter
  // l'écran, et une fiche ouverte doit être la seule chose qu'une pression referme.
  useEffect(() => {
    if (!pinned) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setState(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [pinned]);

  // La molette posée sur la vignette survolée fait défiler la bulle, sans avoir à aller la
  // chercher. Non passif pour retenir le défilement de la grille ; quand le texte tient
  // entier, la molette garde son sens habituel.
  useEffect(() => {
    const anchor = state?.anchor;
    if (!anchor) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.target instanceof Node) || !anchor.contains(e.target)) return;
      const text = textRef.current;
      if (!text || text.scrollHeight <= text.clientHeight + 1) return;
      e.preventDefault();
      text.scrollTop += e.deltaY;
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [state]);

  const api: CardPreviewApi = {
    requestShow(entry, target) {
      clearTimers();
      const rect = target.getBoundingClientRect();
      showTimer.current = window.setTimeout(() => {
        showTimer.current = null;
        // Une fiche épinglée reste maîtresse : le survol d'une autre vignette ne la remplace pas.
        setState((prev) => (prev && prev.rect === null ? prev : { entry, rect, anchor: target }));
      }, PREVIEW_DELAY_MS);
    },
    showCentered(entry) {
      clearTimers();
      setState({ entry, rect: null, anchor: null });
    },
    cancel() {
      clearTimers();
      hideTimer.current = window.setTimeout(() => {
        hideTimer.current = null;
        setState((prev) => (prev && prev.rect === null ? prev : null));
      }, PREVIEW_HIDE_DELAY_MS);
    },
    bind(entry) {
      return {
        onClick: () => api.showCentered(entry),
        hoverProps: coarse
          ? undefined
          : {
              onMouseEnter: (e) => api.requestShow(entry, e.currentTarget),
              onMouseLeave: api.cancel,
              onContextMenu: (e) => {
                e.preventDefault();
                api.showCentered(entry);
              },
            },
      };
    },
  };

  // Entrer dans la bulle annule la fermeture en cours ; la quitter la relance.
  const keepOpen = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };

  let style: CSSProperties = {};
  if (state?.rect) {
    const { rect } = state;
    const spaceRight = window.innerWidth - rect.right;
    const left = spaceRight > PREVIEW_PANEL_WIDTH + 16 ? rect.right + 12 : Math.max(8, rect.left - PREVIEW_PANEL_WIDTH - 12);
    const top = Math.min(Math.max(8, rect.top - 40), Math.max(8, window.innerHeight - PREVIEW_PANEL_MAX_HEIGHT - 8));
    style = { left, top };
  }

  // Rendu dans `body` : `.deck-manager` porte un `backdrop-filter`, qui fait de lui le
  // repère des descendants en `position: fixed`. Posée dedans, la bulle suivait le
  // défilement de l'écran de deck et la fiche « centrée » se centrait sur le panneau.
  const overlay = state && (
    <>
      {pinned && <div className="hover-card-backdrop" onClick={() => setState(null)} />}
      <div
        className={`card-preview${pinned ? ' pinned' : ''}`}
        style={style}
        onMouseEnter={pinned ? undefined : keepOpen}
        onMouseLeave={pinned ? undefined : api.cancel}
        role={pinned ? 'dialog' : undefined}
        aria-modal={pinned ? true : undefined}
        aria-label={pinned ? state.entry.name : undefined}
      >
        {pinned && (
          <button
            className="hover-card-close"
            onClick={() => setState(null)}
            aria-label="Fermer (Échap)"
            title="Fermer (Échap)"
            autoFocus
          >
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
          textRef={textRef}
        />
      </div>
    </>
  );

  return (
    <CardPreviewCtx.Provider value={api}>
      {children}
      {overlay && createPortal(overlay, document.body)}
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
  return (
    <CardFrame
      cardId={entry.id}
      kind={entry.type}
      name={entry.name}
      size="small"
      unique={entry.maxCopies === 1}
      {...preview.bind(entry)}
      footer={
        count > 1 || onRemove ? (
          <div className="deck-selected-stepper">
            {count > 1 && <span className="deck-selected-count-badge">×{count}</span>}
            {onRemove && (
              <button
                type="button"
                className="deck-selected-remove"
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
  const { onClick, hoverProps } = preview.bind(entry);
  return (
    <li
      className="deck-row"
      style={{ '--row-art': `url(/cards/${entry.id}.png)` } as CSSProperties}
      onClick={onClick}
      onMouseEnter={hoverProps?.onMouseEnter}
      onMouseLeave={hoverProps?.onMouseLeave}
      onContextMenu={hoverProps?.onContextMenu}
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

  // Total du deck à côté du titre : les trois compteurs de famille se lisent un par un, le
  // « 17/17 » dit d'un coup si le deck est plein.
  const total = SECTIONS.reduce((sum, section) => sum + deck[section.key].length, 0);
  const totalMax = SECTIONS.reduce((sum, section) => sum + section.max, 0);

  return (
    <CardPreviewProvider>
      <aside className="deck-selected-panel" aria-label={title}>
        <h2>
          {title}
          <span className={total >= totalMax ? 'deck-selected-total full' : 'deck-selected-total'}>
            {total}/{totalMax}
          </span>
        </h2>
        {SECTIONS.map((section) => {
          const ids = deck[section.key];
          const groups = groupByCount(ids, (id) => poolById.get(id)?.name ?? id);
          const full = ids.length >= section.max;
          return (
            <div className={`deck-selected-group deck-section-${section.type}`} key={section.key}>
              <h3>
                <span className="deck-selected-group-icon" aria-hidden="true">
                  {SECTION_ICON[section.type]}
                </span>
                {section.title}
                <span className={full ? 'deck-section-count full' : 'deck-section-count'}>
                  {ids.length}/{section.max}
                </span>
              </h3>
              {groups.length === 0 ? (
                <p className="deck-selected-empty">
                  {onRemove ? `Ajoutez des ${section.title.toLowerCase()} depuis les cartes disponibles.` : 'Aucune carte.'}
                </p>
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
