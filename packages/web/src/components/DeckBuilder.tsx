import { createContext, useContext, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DECK_LIMITS, listDeckPool, validateRoster, type DeckPoolEntry } from 'engine';
import { CardFrame } from './CardFrame';
import { characterDetailBody, objectDetailBody, terrainDetailBody } from './cardDetails';
import { createEmptyDeck, decodeDeckCode, deckToRoster, encodeDeckCode, loadDecks, saveDecks, type Deck } from '../decks';

/** Hover-and-hold preview: unlike the instant in-game HoverCard, this waits for the
    mouse to stay still on a pool card for a bit before popping up an enlarged card
    next to its description -- browsing the pool shouldn't flash a tooltip per swipe. */
const PREVIEW_DELAY_MS = 1000;
const PREVIEW_PANEL_WIDTH = 560;
const PREVIEW_PANEL_MAX_HEIGHT = 460;

interface CardPreviewApi {
  requestShow: (entry: DeckPoolEntry, target: HTMLElement) => void;
  cancel: () => void;
}

const CardPreviewCtx = createContext<CardPreviewApi | null>(null);

function useCardPreview(): CardPreviewApi {
  const ctx = useContext(CardPreviewCtx);
  if (!ctx) throw new Error('useCardPreview must be used within a CardPreviewProvider');
  return ctx;
}

function CardPreviewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ entry: DeckPoolEntry; rect: DOMRect } | null>(null);
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
    cancel() {
      clearTimer();
      setState(null);
    },
  };

  let style: CSSProperties = {};
  if (state) {
    const { rect } = state;
    const spaceRight = window.innerWidth - rect.right;
    const left = spaceRight > PREVIEW_PANEL_WIDTH + 16 ? rect.right + 12 : Math.max(8, rect.left - PREVIEW_PANEL_WIDTH - 12);
    const top = Math.min(Math.max(8, rect.top - 40), Math.max(8, window.innerHeight - PREVIEW_PANEL_MAX_HEIGHT - 8));
    style = { left, top };
  }

  return (
    <CardPreviewCtx.Provider value={api}>
      {children}
      {state && (
        <div className="deck-card-preview" style={style}>
          <CardFrame cardId={state.entry.id} kind={state.entry.type} name={state.entry.name} size="large" />
          <div className="deck-card-preview-text">
            <div className="hover-card-title">{state.entry.name}</div>
            <div className="hover-card-content">{detailBodyFor(state.entry)}</div>
          </div>
        </div>
      )}
    </CardPreviewCtx.Provider>
  );
}

type DeckSectionKey = 'characterCardIds' | 'objectCardIds' | 'terrainCardIds';
type CardKind = DeckPoolEntry['type'];

const SECTIONS: Array<{ key: DeckSectionKey; type: CardKind; max: number; title: string }> = [
  { key: 'characterCardIds', type: 'character', max: DECK_LIMITS.character, title: 'Personnages' },
  { key: 'objectCardIds', type: 'object', max: DECK_LIMITS.object, title: 'Objets' },
  { key: 'terrainCardIds', type: 'terrain', max: DECK_LIMITS.terrain, title: 'Terrains' },
];

function detailBodyFor(entry: DeckPoolEntry) {
  switch (entry.type) {
    case 'character':
      return characterDetailBody(entry.id);
    case 'object':
      return objectDetailBody(entry.id);
    case 'terrain':
      return terrainDetailBody(entry.id);
  }
}

function countOf(ids: string[], id: string): number {
  return ids.filter((x) => x === id).length;
}

function PoolCardTile({
  entry,
  count,
  disabledAdd,
  onAdd,
  onRemove,
}: {
  entry: DeckPoolEntry;
  count: number;
  disabledAdd: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const preview = useCardPreview();
  return (
    <CardFrame
      cardId={entry.id}
      kind={entry.type}
      name={entry.name}
      size="normal"
      highlight={count > 0}
      hoverProps={{
        onMouseEnter: (e) => preview.requestShow(entry, e.currentTarget),
        onMouseLeave: preview.cancel,
      }}
      footer={
        <div className="deck-card-stepper">
          <button type="button" onClick={onRemove} disabled={count === 0}>
            −
          </button>
          <span>{count}</span>
          <button type="button" onClick={onAdd} disabled={disabledAdd}>
            +
          </button>
        </div>
      }
    />
  );
}

function DeckEditor({
  deck,
  pool,
  onChange,
  onSave,
  onCancel,
}: {
  deck: Deck;
  pool: Record<CardKind, DeckPoolEntry[]>;
  onChange: (deck: Deck) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const validation = validateRoster(deckToRoster(deck));
  const canSave = deck.name.trim().length > 0 && validation.ok;
  const [collapsedSections, setCollapsedSections] = useState<Partial<Record<DeckSectionKey, boolean>>>({});

  function toggleSection(key: DeckSectionKey) {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function add(key: DeckSectionKey, max: number, id: string) {
    const ids = deck[key];
    if (ids.length >= max || countOf(ids, id) >= DECK_LIMITS.maxCopiesPerCard) return;
    onChange({ ...deck, [key]: [...ids, id] });
  }

  function remove(key: DeckSectionKey, id: string) {
    const ids = deck[key];
    const idx = ids.lastIndexOf(id);
    if (idx === -1) return;
    onChange({ ...deck, [key]: [...ids.slice(0, idx), ...ids.slice(idx + 1)] });
  }

  return (
    <CardPreviewProvider>
      <div className="deck-editor">
        <label className="field">
          Nom du deck
          <input value={deck.name} onChange={(e) => onChange({ ...deck, name: e.target.value })} placeholder="Mon deck" autoFocus />
        </label>

        {SECTIONS.map((section) => {
          const ids = deck[section.key];
          const entries = pool[section.type];
          const collapsed = !!collapsedSections[section.key];
          return (
            <div className="deck-section" key={section.key}>
              <button
                type="button"
                className="deck-section-toggle"
                onClick={() => toggleSection(section.key)}
                aria-expanded={!collapsed}
              >
                <span className={collapsed ? 'deck-section-chevron collapsed' : 'deck-section-chevron'}>▾</span>
                <h2>
                  {section.title} <span className="deck-section-count">({ids.length}/{section.max})</span>
                </h2>
              </button>
              {!collapsed && (
                <div className="deck-card-grid">
                  {entries.map((entry) => (
                    <PoolCardTile
                      key={entry.id}
                      entry={entry}
                      count={countOf(ids, entry.id)}
                      disabledAdd={ids.length >= section.max || countOf(ids, entry.id) >= DECK_LIMITS.maxCopiesPerCard}
                      onAdd={() => add(section.key, section.max, entry.id)}
                      onRemove={() => remove(section.key, entry.id)}
                    />
                  ))}
                  {entries.length === 0 && <p className="subtitle">Aucune carte disponible pour l'instant.</p>}
                </div>
              )}
            </div>
          );
        })}

        {!validation.ok && <p className="error">{validation.error}</p>}

        <div className="deck-editor-actions">
          <button onClick={onCancel}>Annuler</button>
          <button className="primary" disabled={!canSave} onClick={onSave}>
            Enregistrer
          </button>
        </div>
      </div>
    </CardPreviewProvider>
  );
}

function DeckShareBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable/denied -- the code below is still selectable for manual copy.
    }
  }

  return (
    <div className="deck-share-box">
      <textarea readOnly value={code} rows={3} onFocus={(e) => e.currentTarget.select()} />
      <button onClick={copy}>{copied ? 'Copié !' : 'Copier le code'}</button>
    </div>
  );
}

export function DeckBuilder({ onBack }: { onBack: () => void }) {
  const [decks, setDecks] = useState<Deck[]>(() => loadDecks());
  const [editing, setEditing] = useState<Deck | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [importCode, setImportCode] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const pool = useMemo(() => listDeckPool(), []);
  const poolByType = useMemo<Record<CardKind, DeckPoolEntry[]>>(
    () => ({
      character: pool.filter((p) => p.type === 'character'),
      object: pool.filter((p) => p.type === 'object'),
      terrain: pool.filter((p) => p.type === 'terrain'),
    }),
    [pool]
  );

  function persist(next: Deck[]) {
    setDecks(next);
    saveDecks(next);
  }

  function removeDeck(id: string) {
    persist(decks.filter((d) => d.id !== id));
  }

  function saveEditing() {
    if (!editing) return;
    const exists = decks.some((d) => d.id === editing.id);
    persist(exists ? decks.map((d) => (d.id === editing.id ? editing : d)) : [...decks, editing]);
    setEditing(null);
  }

  function handleImport() {
    try {
      const deck = decodeDeckCode(importCode);
      persist([...decks, deck]);
      setImportCode('');
      setImportError(null);
    } catch (err) {
      setImportError((err as Error).message);
    }
  }

  if (editing) {
    return (
      <div className="deck-manager">
        <DeckEditor deck={editing} pool={poolByType} onChange={setEditing} onSave={saveEditing} onCancel={() => setEditing(null)} />
      </div>
    );
  }

  return (
    <div className="deck-manager">
      <div className="deck-manager-header">
        <h1>Mes decks</h1>
        <button onClick={onBack}>Retour</button>
      </div>

      <button className="primary" onClick={() => setEditing(createEmptyDeck())}>
        + Nouveau deck
      </button>

      <ul className="deck-list">
        {decks.map((deck) => (
          <li key={deck.id} className="deck-list-item">
            <div className="deck-list-row">
              <div className="deck-list-info">
                <strong>{deck.name || '(sans nom)'}</strong>
                <span className="subtitle">
                  {deck.characterCardIds.length} perso · {deck.objectCardIds.length} objets · {deck.terrainCardIds.length} terrains
                </span>
              </div>
              <div className="deck-list-actions">
                <button onClick={() => setSharingId((id) => (id === deck.id ? null : deck.id))}>Partager</button>
                <button onClick={() => setEditing({ ...deck })}>Modifier</button>
                <button onClick={() => removeDeck(deck.id)}>Supprimer</button>
              </div>
            </div>
            {sharingId === deck.id && <DeckShareBox code={encodeDeckCode(deck)} />}
          </li>
        ))}
        {decks.length === 0 && <p className="subtitle">Aucun deck pour l'instant -- créez-en un pour pouvoir jouer.</p>}
      </ul>

      <div className="deck-import">
        <label className="field">
          Importer un deck (coller un code reçu d'un autre joueur)
          <textarea
            value={importCode}
            onChange={(e) => {
              setImportCode(e.target.value);
              setImportError(null);
            }}
            rows={3}
            placeholder="CTGDECK1:..."
          />
        </label>
        {importError && <p className="error">{importError}</p>}
        <button onClick={handleImport} disabled={!importCode.trim()}>
          Importer
        </button>
      </div>
    </div>
  );
}
