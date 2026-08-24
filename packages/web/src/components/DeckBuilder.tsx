import { useEffect, useMemo, useRef, useState } from 'react';
import { listDeckPool, validateRoster, type DeckPoolEntry } from 'engine';
import { CardFrame } from './CardFrame';
import { CardPreviewProvider, DeckContentsPanel, SECTIONS, useCardPreview, type CardKind, type DeckSectionKey } from './DeckContentsPanel';
import { createEmptyDeck, decodeDeckCode, deckToRoster, encodeDeckCode, loadDecks, saveDecks, type Deck } from '../decks';
import { usePointerCoarse } from '../hooks/usePointerCoarse';

type SortValue = 'default' | 'hp-desc' | 'hp-asc' | 'name-asc' | 'name-desc' | 'duration-desc' | 'duration-asc';

const SORT_OPTIONS: Record<DeckSectionKey, Array<{ value: SortValue; label: string }>> = {
  characterCardIds: [
    { value: 'default', label: 'Par défaut' },
    { value: 'hp-desc', label: 'PV : le plus haut d’abord' },
    { value: 'hp-asc', label: 'PV : le plus bas d’abord' },
  ],
  objectCardIds: [
    { value: 'default', label: 'Par défaut' },
    { value: 'name-asc', label: 'Nom (A → Z)' },
    { value: 'name-desc', label: 'Nom (Z → A)' },
  ],
  terrainCardIds: [
    { value: 'default', label: 'Par défaut' },
    { value: 'duration-desc', label: 'Durée : la plus longue d’abord' },
    { value: 'duration-asc', label: 'Durée : la plus courte d’abord' },
  ],
};

/** Terrains without `durationTurns` last indefinitely -- treated as longer than any timed terrain. */
const INDEFINITE_DURATION = Number.MAX_SAFE_INTEGER;

function sortEntries(entries: DeckPoolEntry[], sort: SortValue): DeckPoolEntry[] {
  if (sort === 'default') return entries;
  const sorted = [...entries];
  switch (sort) {
    case 'hp-desc':
      sorted.sort((a, b) => (b.baseMaxHP ?? 0) - (a.baseMaxHP ?? 0));
      break;
    case 'hp-asc':
      sorted.sort((a, b) => (a.baseMaxHP ?? 0) - (b.baseMaxHP ?? 0));
      break;
    case 'name-asc':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'name-desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case 'duration-desc':
      sorted.sort((a, b) => (b.durationTurns ?? INDEFINITE_DURATION) - (a.durationTurns ?? INDEFINITE_DURATION));
      break;
    case 'duration-asc':
      sorted.sort((a, b) => (a.durationTurns ?? INDEFINITE_DURATION) - (b.durationTurns ?? INDEFINITE_DURATION));
      break;
  }
  return sorted;
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
  const coarse = usePointerCoarse();
  return (
    <CardFrame
      cardId={entry.id}
      kind={entry.type}
      name={entry.name}
      size="normal"
      highlight={count > 0}
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
        <div className="deck-card-stepper">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            disabled={count === 0}
          >
            −
          </button>
          <span>{count}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
            disabled={disabledAdd}
          >
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
  const [sortBySections, setSortBySections] = useState<Partial<Record<DeckSectionKey, SortValue>>>({});

  function toggleSection(key: DeckSectionKey) {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function add(key: DeckSectionKey, max: number, id: string, maxCopies: number) {
    const ids = deck[key];
    if (ids.length >= max || countOf(ids, id) >= maxCopies) return;
    onChange({ ...deck, [key]: [...ids, id] });
  }

  function remove(key: DeckSectionKey, id: string) {
    const ids = deck[key];
    const idx = ids.lastIndexOf(id);
    if (idx === -1) return;
    onChange({ ...deck, [key]: [...ids.slice(0, idx), ...ids.slice(idx + 1)] });
  }

  return (
    <div className="deck-editor-layout">
      <CardPreviewProvider>
        <div className="deck-editor">
          <label className="field">
            Nom du deck
            <input value={deck.name} onChange={(e) => onChange({ ...deck, name: e.target.value })} placeholder="Mon deck" autoFocus />
          </label>

          {SECTIONS.map((section) => {
            const ids = deck[section.key];
            const sortBy = sortBySections[section.key] ?? 'default';
            const entries = sortEntries(pool[section.type], sortBy);
            const collapsed = !!collapsedSections[section.key];
            return (
              <div className="deck-section" key={section.key}>
                <div className="deck-section-header">
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
                    <label className="deck-section-sort">
                      Trier
                      <select
                        value={sortBy}
                        onChange={(e) =>
                          setSortBySections((prev) => ({ ...prev, [section.key]: e.target.value as SortValue }))
                        }
                      >
                        {SORT_OPTIONS[section.key].map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {!collapsed && (
                  <div className="deck-card-grid">
                    {entries.map((entry) => (
                      <PoolCardTile
                        key={entry.id}
                        entry={entry}
                        count={countOf(ids, entry.id)}
                        // Per-card cap, not the global one: a "1x" card (Chopper, Chaînes...) used to be
                        // addable twice, then blocked the whole deck at save time with a cryptic error.
                        disabledAdd={ids.length >= section.max || countOf(ids, entry.id) >= entry.maxCopies}
                        onAdd={() => add(section.key, section.max, entry.id, entry.maxCopies)}
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

      <DeckContentsPanel title="Deck actuel" deck={deck} pool={pool} onRemove={remove} />
    </div>
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

export function DeckBuilder({
  onBack,
  initialView = 'list',
}: {
  onBack: () => void;
  initialView?: 'list' | 'new' | 'import';
}) {
  const [decks, setDecks] = useState<Deck[]>(() => loadDecks());
  const [editing, setEditing] = useState<Deck | null>(() => (initialView === 'new' ? createEmptyDeck() : null));
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [importCode, setImportCode] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLTextAreaElement>(null);
  const pool = useMemo(() => listDeckPool(), []);
  const poolByType = useMemo<Record<CardKind, DeckPoolEntry[]>>(
    () => ({
      character: pool.filter((p) => p.type === 'character'),
      object: pool.filter((p) => p.type === 'object'),
      terrain: pool.filter((p) => p.type === 'terrain'),
    }),
    [pool]
  );

  useEffect(() => {
    if (initialView === 'import') importInputRef.current?.focus();
  }, [initialView]);

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
            ref={importInputRef}
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
