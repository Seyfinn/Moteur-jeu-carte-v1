import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listDeckPool, validateRoster, type DeckPoolEntry, type EvolutionFormEntry } from 'engine';
import { CardFrame } from './CardFrame';
import {
  CardPreviewProvider,
  DeckContentsPanel,
  SECTIONS,
  splitBySubgroup,
  useCardPreview,
  type CardKind,
  type DeckSectionKey,
} from './DeckContentsPanel';
import { createEmptyDeck, decodeDeckCode, deckToRoster, encodeDeckCode, loadDecks, saveDecks, type Deck } from '../decks';
import { usePointerCoarse } from '../hooks/usePointerCoarse';

type SortValue = 'hp-desc' | 'hp-asc' | 'name-asc' | 'name-desc' | 'duration-desc' | 'duration-asc';

/**
 * Le tri alphabétique ouvre chaque liste et sert de tri par défaut (DEFAULT_SORT ci-dessous)
 * pour les trois sections. L'ancien « Par défaut » a été retiré : il n'ordonnait rien, il
 * laissait l'ordre d'enregistrement des cartes dans le registre du moteur -- arbitraire, et
 * il bougeait à chaque carte ajoutée au jeu.
 */
const SORT_OPTIONS: Record<DeckSectionKey, Array<{ value: SortValue; label: string }>> = {
  characterCardIds: [
    { value: 'name-asc', label: 'Nom (A → Z)' },
    { value: 'name-desc', label: 'Nom (Z → A)' },
    { value: 'hp-desc', label: 'PV : le plus haut d’abord' },
    { value: 'hp-asc', label: 'PV : le plus bas d’abord' },
  ],
  objectCardIds: [
    { value: 'name-asc', label: 'Nom (A → Z)' },
    { value: 'name-desc', label: 'Nom (Z → A)' },
  ],
  terrainCardIds: [
    { value: 'name-asc', label: 'Nom (A → Z)' },
    { value: 'name-desc', label: 'Nom (Z → A)' },
    { value: 'duration-desc', label: 'Durée : la plus longue d’abord' },
    { value: 'duration-asc', label: 'Durée : la plus courte d’abord' },
  ],
};

const DEFAULT_SORT: SortValue = 'name-asc';

/** Terrains without `durationTurns` last indefinitely -- treated as longer than any timed terrain. */
const INDEFINITE_DURATION = Number.MAX_SAFE_INTEGER;

function sortEntries(entries: DeckPoolEntry[], sort: SortValue): DeckPoolEntry[] {
  const sorted = [...entries];
  switch (sort) {
    case 'hp-desc':
      sorted.sort((a, b) => (b.baseMaxHP ?? 0) - (a.baseMaxHP ?? 0));
      break;
    case 'hp-asc':
      sorted.sort((a, b) => (a.baseMaxHP ?? 0) - (b.baseMaxHP ?? 0));
      break;
    case 'name-asc':
      sorted.sort((a, b) => compareNames(a, b));
      break;
    case 'name-desc':
      sorted.sort((a, b) => compareNames(b, a));
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

/**
 * Comparaison de noms en français, accents et casse ignorés pour le classement : « Épée »
 * doit se ranger avec les E, et l'ordre ne doit pas dépendre de la locale du navigateur du
 * joueur (`localeCompare` sans locale explicite la suit).
 */
function compareNames(a: DeckPoolEntry, b: DeckPoolEntry): number {
  return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
}

function countOf(ids: string[], id: string): number {
  return ids.filter((x) => x === id).length;
}

/**
 * Les formes évoluées d'une carte, montrées SOUS elle et jamais sélectionnables : elles
 * n'entrent pas dans le quota du deck et arrivent en jeu par l'évolution de leur base.
 * Sans ce bandeau, un joueur qui découvre Kayn n'aurait aucun moyen de savoir qu'il mène
 * à Rhaast ou à Kayn Assassin, puisque ces deux cartes sont absentes du pool.
 */
function EvolutionStrip({ forms }: { forms: EvolutionFormEntry[] }) {
  const preview = useCardPreview();
  const coarse = usePointerCoarse();
  if (forms.length === 0) return null;

  return (
    <div className="deck-card-evolutions">
      <span className="deck-card-evolutions-label">{forms.length > 1 ? 'Évolue en (au choix)' : 'Évolue en'}</span>
      <div className="deck-card-evolutions-row">
        {forms.map((form) => {
          // La fiche de survol attend une entrée de pool : les formes évoluées n'en ont
          // pas (elles sont exclues du pool), on en fabrique une minimale pour l'aperçu.
          const asEntry: DeckPoolEntry = {
            id: form.id,
            type: 'character',
            name: form.name,
            baseMaxHP: form.baseMaxHP,
            maxCopies: 1,
            incompatibleWith: [],
          };
          return (
            <CardFrame
              key={form.id}
              cardId={form.id}
              kind="character"
              name={form.name}
              size="small"
              title={`${form.name} — forme évoluée, non sélectionnable`}
              onClick={coarse ? () => preview.showCentered(asEntry) : undefined}
              hoverProps={
                coarse
                  ? undefined
                  : {
                      onMouseEnter: (e) => preview.requestShow(asEntry, e.currentTarget),
                      onMouseLeave: preview.cancel,
                    }
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function PoolCardTile({
  entry,
  count,
  disabledAdd,
  blockedReason,
  onAdd,
  onRemove,
}: {
  entry: DeckPoolEntry;
  count: number;
  disabledAdd: boolean;
  /** Carte interdite par une autre déjà prise (Chopper / Soraka) : grisée, avec la raison. */
  blockedReason: string | null;
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
      dimmed={Boolean(blockedReason)}
      title={blockedReason ?? undefined}
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
        <>
          {blockedReason && <span className="deck-card-blocked">{blockedReason}</span>}
          <EvolutionStrip forms={entry.evolutions ?? []} />
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
        </>
      }
    />
  );
}

/**
 * En-tête collant de l'éditeur. « Annuler » et « Enregistrer » ne vivaient qu'en bas de
 * page, après les trois grilles de cartes : sortir d'un deck en cours d'édition (ou le
 * sauvegarder) obligeait à traverser tout le pool au scroll. La sortie demande
 * confirmation tant qu'il reste des modifications non enregistrées, et Échap fait la
 * même chose que le bouton.
 */
function DeckEditorHeader({
  title,
  dirty,
  canSave,
  onBack,
  onSave,
}: {
  title: string;
  dirty: boolean;
  canSave: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const requestBack = useCallback(() => {
    if (dirty) setConfirming(true);
    else onBack();
  }, [dirty, onBack]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirming) setConfirming(false);
      else requestBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirming, requestBack]);

  return (
    <div className="deck-manager-header deck-editor-header">
      <button className="deck-back-button" onClick={requestBack}>
        ← Retour
      </button>
      <h1>{title}</h1>
      {confirming ? (
        <span className="deck-editor-discard">
          Quitter sans enregistrer ?
          <button className="danger" onClick={onBack}>
            Oui
          </button>
          <button onClick={() => setConfirming(false)}>Non</button>
        </span>
      ) : (
        <button className="primary" disabled={!canSave} onClick={onSave}>
          Enregistrer
        </button>
      )}
    </div>
  );
}

function DeckEditor({
  deck,
  pool,
  title,
  onChange,
  onSave,
  onCancel,
}: {
  deck: Deck;
  pool: Record<CardKind, DeckPoolEntry[]>;
  title: string;
  onChange: (deck: Deck) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const validation = validateRoster(deckToRoster(deck));
  const canSave = deck.name.trim().length > 0 && validation.ok;
  /**
   * Cartes interdites par ce que le deck contient déjà (Chopper / Soraka), et par quoi.
   * Le moteur symétrise la relation dans `listDeckPool()`, donc peu importe laquelle des
   * deux cartes la déclare : les deux sens sont ici.
   */
  const blockedBy = useMemo(() => {
    const blocked = new Map<string, string>();
    const inDeck = new Set([...deck.characterCardIds, ...deck.objectCardIds, ...deck.terrainCardIds]);
    for (const entry of [...pool.character, ...pool.object, ...pool.terrain]) {
      if (!inDeck.has(entry.id)) continue;
      for (const otherId of entry.incompatibleWith) blocked.set(otherId, entry.name);
    }
    return blocked;
  }, [deck, pool]);
  // Instantané pris au montage (le composant est monté avec une `key` par deck édité) :
  // sortir sans avoir rien touché ne doit pas réclamer de confirmation.
  const [initialSnapshot] = useState(() => JSON.stringify(deck));
  const dirty = JSON.stringify(deck) !== initialSnapshot;
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
          <DeckEditorHeader title={title} dirty={dirty} canSave={canSave} onBack={onCancel} onSave={onSave} />

          <label className="field">
            Nom du deck
            <input value={deck.name} onChange={(e) => onChange({ ...deck, name: e.target.value })} placeholder="Mon deck" autoFocus />
          </label>

          {SECTIONS.map((section) => {
            const ids = deck[section.key];
            const sortBy = sortBySections[section.key] ?? DEFAULT_SORT;
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
                {!collapsed &&
                  splitBySubgroup(section.type, entries, (entry) => entry.equipment === true).map((group) => (
                    <div key={group.key}>
                      {group.title && (
                        <h3 className="deck-subgroup-header">
                          {group.title}
                          <span className="deck-subgroup-hint">{group.hint}</span>
                        </h3>
                      )}
                      <div className="deck-card-grid">
                        {group.entries.map((entry) => {
                          const blockedByName = blockedBy.get(entry.id);
                          return (
                            <PoolCardTile
                              key={entry.id}
                              entry={entry}
                              count={countOf(ids, entry.id)}
                              // Per-card cap, not the global one: a "1x" card (Chopper, Chaînes, tous les
                              // terrains...) used to be addable twice, then blocked the whole deck at save
                              // time with a cryptic error.
                              disabledAdd={
                                ids.length >= section.max ||
                                countOf(ids, entry.id) >= entry.maxCopies ||
                                blockedByName !== undefined
                              }
                              blockedReason={blockedByName ? `Incompatible avec ${blockedByName}` : null}
                              onAdd={() => add(section.key, section.max, entry.id, entry.maxCopies)}
                              onRemove={() => remove(section.key, entry.id)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                {!collapsed && entries.length === 0 && <p className="subtitle">Aucune carte disponible pour l'instant.</p>}
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
  // « Créer un deck » depuis le lobby ouvre directement l'éditeur : en sortir doit rendre
  // au lobby, pas à une liste de decks que le joueur n'a jamais vue.
  const [editorIsRoot, setEditorIsRoot] = useState(initialView === 'new');
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

  // Échap remonte d'un cran depuis la liste, comme le bouton « Retour ». L'éditeur a le
  // sien (avec sa confirmation), donc on ne s'en mêle pas quand il est ouvert.
  useEffect(() => {
    if (editing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, onBack]);

  function openEditor(deck: Deck) {
    setEditorIsRoot(false);
    setEditing(deck);
  }

  /** Sortie de l'éditeur : d'un cran vers la liste, ou jusqu'au lobby si on y a atterri direct. */
  function closeEditor() {
    setEditing(null);
    if (editorIsRoot) {
      setEditorIsRoot(false);
      onBack();
    }
  }

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
    const known = decks.some((d) => d.id === editing.id);
    return (
      <div className="deck-manager">
        <DeckEditor
          key={editing.id}
          deck={editing}
          pool={poolByType}
          title={known ? 'Modifier le deck' : 'Nouveau deck'}
          onChange={setEditing}
          onSave={saveEditing}
          onCancel={closeEditor}
        />
      </div>
    );
  }

  return (
    <div className="deck-manager">
      <div className="deck-manager-header">
        <h1>Mes decks</h1>
        <button className="deck-back-button" onClick={onBack}>
          ← Retour
        </button>
      </div>

      <button className="primary" onClick={() => openEditor(createEmptyDeck())}>
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
                <button onClick={() => openEditor({ ...deck })}>Modifier</button>
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
