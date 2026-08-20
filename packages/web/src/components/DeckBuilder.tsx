import { useMemo, useState } from 'react';
import { DECK_LIMITS, listDeckPool, validateRoster, type DeckPoolEntry } from 'engine';
import { CardFrame } from './CardFrame';
import { useHoverCard } from './HoverCard';
import { characterDetailBody, objectDetailBody, terrainDetailBody } from './cardDetails';
import { createEmptyDeck, deckToRoster, loadDecks, saveDecks, type Deck } from '../decks';

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
  const hover = useHoverCard();
  return (
    <CardFrame
      cardId={entry.id}
      kind={entry.type}
      name={entry.name}
      size="small"
      highlight={count > 0}
      hoverProps={{
        onMouseEnter: (e) => hover.show({ title: entry.name, body: detailBodyFor(entry) }, e.currentTarget),
        onMouseLeave: hover.hide,
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
    <div className="deck-editor">
      <label className="field">
        Nom du deck
        <input value={deck.name} onChange={(e) => onChange({ ...deck, name: e.target.value })} placeholder="Mon deck" autoFocus />
      </label>

      {SECTIONS.map((section) => {
        const ids = deck[section.key];
        const entries = pool[section.type];
        return (
          <div className="deck-section" key={section.key}>
            <h2>
              {section.title} <span className="deck-section-count">({ids.length}/{section.max})</span>
            </h2>
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
  );
}

export function DeckBuilder({ onBack }: { onBack: () => void }) {
  const [decks, setDecks] = useState<Deck[]>(() => loadDecks());
  const [editing, setEditing] = useState<Deck | null>(null);
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
            <div className="deck-list-info">
              <strong>{deck.name || '(sans nom)'}</strong>
              <span className="subtitle">
                {deck.characterCardIds.length} perso · {deck.objectCardIds.length} objets · {deck.terrainCardIds.length} terrains
              </span>
            </div>
            <div className="deck-list-actions">
              <button onClick={() => setEditing({ ...deck })}>Modifier</button>
              <button onClick={() => removeDeck(deck.id)}>Supprimer</button>
            </div>
          </li>
        ))}
        {decks.length === 0 && <p className="subtitle">Aucun deck pour l'instant -- créez-en un pour pouvoir jouer.</p>}
      </ul>
    </div>
  );
}
