import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { listDeckPool, validateRoster, type DeckPoolEntry, type EvolutionFormEntry } from 'engine';
import { CardFrame } from './CardFrame';
import { LobbyBackground } from './LobbyBackground';
import {
  CardPreviewProvider,
  DeckContentsPanel,
  SECTION_ICON,
  SECTIONS,
  splitBySubgroup,
  useCardPreview,
  type CardKind,
  type DeckSectionKey,
} from './DeckContentsPanel';
import {
  createEmptyDeck,
  decodeDeckCode,
  deckIssue,
  deckToRoster,
  encodeDeckCode,
  loadDecks,
  saveDecks,
  type Deck,
} from '../decks';
import { usePointerCoarse } from '../hooks/usePointerCoarse';
import { getCloudUserName, loadDecksFromCloud, saveDeckToCloud, setCloudUserName } from '../api/cloudDecks';

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

type NoticeTone = 'ok' | 'warn' | 'danger' | 'info';

const NOTICE_ICON: Record<NoticeTone, string> = { ok: '✓', warn: '!', danger: '✕', info: 'i' };

/**
 * Message d'état du gestionnaire (deck incomplet, import raté, sauvegarde faite...). Les
 * retours étaient de simples lignes de texte rouge ou muettes : un bloc teinté, annoncé
 * aux lecteurs d'écran via `role="status"`, se repère d'un coup d'œil au milieu des grilles.
 */
function DeckNotice({ tone, children }: { tone: NoticeTone; children: ReactNode }) {
  return (
    <p className={`deck-notice deck-notice-${tone}`} role="status">
      <span className="deck-notice-icon" aria-hidden="true">
        {NOTICE_ICON[tone]}
      </span>
      <span>{children}</span>
    </p>
  );
}

/** Durée d'affichage d'un retour éphémère (« enregistré », « importé », « copié »). */
const NOTICE_MS = 3000;

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
              className="deck-step deck-step-minus"
              // Retirer une carte qu'on n'a pas prise ne faisait rien : le bouton se grise
              // maintenant, au lieu d'inviter à un clic sans effet.
              disabled={count === 0}
              aria-label={`Retirer ${entry.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              −
            </button>
            <span className={count > 0 ? 'deck-step-count taken' : 'deck-step-count'}>{count}</span>
            <button
              type="button"
              className="deck-step deck-step-plus"
              onClick={(e) => {
                e.stopPropagation();
                onAdd();
              }}
              disabled={disabledAdd}
              aria-label={`Ajouter ${entry.name}`}
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
 * même chose que le bouton. L'état de confirmation appartient à l'éditeur : le « Annuler »
 * du bas de page doit passer par la même question, pas sortir en douce.
 */
function DeckEditorHeader({
  title,
  dirty,
  canSave,
  issue,
  saveBlocker,
  confirming,
  onRequestBack,
  onConfirmBack,
  onDismiss,
  onSave,
}: {
  title: string;
  dirty: boolean;
  canSave: boolean;
  /** Ce qui manque encore au deck, ou `null` s'il est jouable : repris dans la pastille d'état. */
  issue: string | null;
  /** Pourquoi « Enregistrer » est grisé (deck incomplet OU nom vide), en infobulle du bouton. */
  saveBlocker: string | null;
  confirming: boolean;
  onRequestBack: () => void;
  onConfirmBack: () => void;
  onDismiss: () => void;
  onSave: () => void;
}) {
  return (
    <div className="deck-manager-header deck-editor-header">
      <button className="deck-back-button" onClick={onRequestBack}>
        ← Retour
      </button>
      <h1>{title}</h1>
      {/* État du deck, à portée de regard pendant qu'on parcourt le pool : le message de
          `validateRoster` ne vivait qu'en bas de page, sous les trois grilles. */}
      <span className={issue ? 'deck-state-pill' : 'deck-state-pill ready'} title={issue ?? undefined}>
        <span className="deck-state-dot" />
        {issue ? 'Incomplet' : 'Prêt à jouer'}
      </span>
      {dirty && !confirming && <span className="deck-dirty-mark">Modifications non enregistrées</span>}
      {confirming ? (
        <span className="deck-editor-discard" role="alertdialog" aria-label="Quitter sans enregistrer ?">
          Quitter sans enregistrer ?
          <button className="danger" onClick={onConfirmBack} autoFocus>
            Oui
          </button>
          <button onClick={onDismiss}>Non</button>
        </span>
      ) : (
        // Le point sur le bouton reprend le rappel « modifications non enregistrées » là où
        // la barre n'a plus la place de l'écrire (écran étroit, cf. CSS).
        <button
          className={dirty ? 'primary deck-save-button dirty' : 'primary deck-save-button'}
          disabled={!canSave}
          title={saveBlocker ?? undefined}
          onClick={onSave}
        >
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
  const nameMissing = deck.name.trim().length === 0;
  const canSave = !nameMissing && validation.ok;
  // Un deck complet mais sans nom laissait « Enregistrer » gris sans un mot d'explication :
  // le nom vide est une raison de blocage comme une autre, dite au même endroit.
  const saveBlocker = !validation.ok ? validation.error : nameMissing ? 'Donnez un nom à votre deck pour l’enregistrer.' : null;
  const totalCards = deck.characterCardIds.length + deck.objectCardIds.length + deck.terrainCardIds.length;
  const totalMax = SECTIONS.reduce((sum, section) => sum + section.max, 0);
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
  // Confirmation de sortie, partagée par « Retour » (en-tête), « Annuler » (bas de page)
  // et Échap : les trois posent la même question, ou sortent direct si rien n'a changé.
  const [confirming, setConfirming] = useState(false);
  const requestBack = useCallback(() => {
    if (dirty) setConfirming(true);
    else onCancel();
  }, [dirty, onCancel]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirming) setConfirming(false);
      else requestBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirming, requestBack]);

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
          <DeckEditorHeader
            title={title}
            dirty={dirty}
            canSave={canSave}
            issue={validation.ok ? null : validation.error}
            saveBlocker={saveBlocker}
            confirming={confirming}
            onRequestBack={requestBack}
            onConfirmBack={onCancel}
            onDismiss={() => setConfirming(false)}
            onSave={onSave}
          />

          <label className="field deck-name-field">
            Nom du deck
            <input
              value={deck.name}
              onChange={(e) => onChange({ ...deck, name: e.target.value })}
              placeholder="Mon deck"
              autoFocus
              aria-invalid={nameMissing || undefined}
            />
          </label>

          {SECTIONS.map((section) => {
            const ids = deck[section.key];
            const sortBy = sortBySections[section.key] ?? DEFAULT_SORT;
            const entries = sortEntries(pool[section.type], sortBy);
            const collapsed = !!collapsedSections[section.key];
            const full = ids.length >= section.max;
            const missing = section.max - ids.length;
            const bodyId = `deck-section-body-${section.type}`;
            return (
              <div className={`deck-section deck-section-${section.type}${full ? ' full' : ''}`} key={section.key}>
                <div className="deck-section-header">
                  <button
                    type="button"
                    className="deck-section-toggle"
                    onClick={() => toggleSection(section.key)}
                    aria-expanded={!collapsed}
                    aria-controls={bodyId}
                  >
                    <span className={collapsed ? 'deck-section-chevron collapsed' : 'deck-section-chevron'} aria-hidden="true">
                      ▾
                    </span>
                    <span className="deck-section-icon" aria-hidden="true">
                      {SECTION_ICON[section.type]}
                    </span>
                    <h2>{section.title}</h2>
                    <span className={full ? 'deck-section-count full' : 'deck-section-count'}>
                      {ids.length}/{section.max}
                    </span>
                    {/* « 6/6 » se lit, « 4/6 » se calcule : le reste à prendre est écrit en clair. */}
                    <span className="deck-section-remaining">
                      {full ? 'Au complet' : `Encore ${missing} à choisir`}
                    </span>
                  </button>
                  {/* Jauge de remplissage : au milieu de trois grilles de cartes, « où en
                      suis-je sur cette famille ? » doit se lire sans compter les pastilles. */}
                  <div className={full ? 'deck-section-meter full' : 'deck-section-meter'} aria-hidden="true">
                    <span style={{ width: `${Math.min(100, (ids.length / section.max) * 100)}%` }} />
                  </div>
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
                  <div id={bodyId} className="deck-section-body">
                  {splitBySubgroup(section.type, entries, (entry) => entry.equipment === true).map((group) => (
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
                  {entries.length === 0 && <p className="deck-empty-hint">Aucune carte disponible pour l'instant.</p>}
                  </div>
                )}
              </div>
            );
          })}

          {/* Bilan en bas de page, là où on arrive après avoir parcouru les trois grilles :
              ce qui bloque encore l'enregistrement, ou le feu vert. */}
          <div className="deck-editor-footer">
            {saveBlocker ? (
              <DeckNotice tone="warn">{saveBlocker}</DeckNotice>
            ) : (
              <DeckNotice tone="ok">Deck complet et prêt à jouer.</DeckNotice>
            )}
            <div className="deck-editor-actions">
              <span className="deck-editor-total">
                <strong>{totalCards}</strong>/{totalMax} cartes
              </span>
              <button onClick={requestBack}>Annuler</button>
              <button className="primary" disabled={!canSave} title={saveBlocker ?? undefined} onClick={onSave}>
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      </CardPreviewProvider>

      <DeckContentsPanel title="Deck actuel" deck={deck} pool={pool} onRemove={remove} />
    </div>
  );
}

/** Nombre d'illustrations dans la bannière d'une vignette de deck. Assez pour donner une
    couleur au deck, assez peu pour qu'on reconnaisse chaque carte. */
const TILE_ART_COUNT = 4;

/**
 * Un deck enregistré, présenté comme une carte plutôt que comme une ligne de tableau :
 * une bande d'illustrations tirées du deck lui-même, son état (jouable ou non) et ses
 * trois compteurs. Une liste de noms ne disait rien de ce qu'il y avait dedans -- il
 * fallait ouvrir l'éditeur pour se rappeler lequel était lequel.
 */
function DeckTile({
  deck,
  sharing,
  onEdit,
  onShare,
  onDelete,
}: {
  deck: Deck;
  sharing: boolean;
  onEdit: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const issue = deckIssue(deck);
  // Les personnages portent l'identité du deck, donc ils ouvrent la bannière ; terrains et
  // objets complètent quand ils ne suffisent pas à la remplir. Doublons écartés : deux fois
  // la même potion ferait une bannière qui bégaie.
  const arts = [...new Set([...deck.characterCardIds, ...deck.terrainCardIds, ...deck.objectCardIds])].slice(
    0,
    TILE_ART_COUNT
  );

  return (
    <article className={issue ? 'deck-tile' : 'deck-tile ready'}>
      {/* La bannière ouvre l'éditeur : c'est la plus grande surface de la vignette, et
          celle sur laquelle on clique d'instinct -- la vignette se soulevait au survol
          sans que rien n'y réponde. La pastille d'état est posée par-dessus, hors du
          bouton, pour garder son infobulle propre. */}
      <div className="deck-tile-banner">
        <button
          type="button"
          className="deck-tile-banner-button"
          onClick={onEdit}
          aria-label={`Modifier ${deck.name || 'le deck sans nom'}`}
        >
          {arts.map((cardId) => (
            <span key={cardId} className="deck-tile-art" style={{ backgroundImage: `url(/cards/${cardId}.png)` }} />
          ))}
          {arts.length === 0 && <span className="deck-tile-art empty">🂠</span>}
          <span className="deck-tile-scrim" />
          <span className="deck-tile-banner-cta" aria-hidden="true">
            Ouvrir l’éditeur
          </span>
        </button>
        <span className={issue ? 'deck-state-pill' : 'deck-state-pill ready'} title={issue ?? undefined}>
          <span className="deck-state-dot" />
          {issue ? 'Incomplet' : 'Prêt'}
        </span>
      </div>

      <div className="deck-tile-body">
        <strong className="deck-tile-name">{deck.name || '(sans nom)'}</strong>

        <div className="deck-tile-chips">
          {SECTIONS.map((section) => {
            const count = deck[section.key].length;
            return (
              <span
                key={section.key}
                className={count >= section.max ? 'deck-chip full' : 'deck-chip'}
                title={`${section.title} : ${count} sur ${section.max}`}
              >
                <span aria-hidden="true">{SECTION_ICON[section.type]}</span>
                {count}
                <em>/{section.max}</em>
              </span>
            );
          })}
        </div>

        {/* La raison pour laquelle le deck n'est pas jouable, écrite sous le nom : la
            pastille « Incomplet » ne disait pas quoi compléter sans survoler. */}
        {issue && <p className="deck-tile-issue">{issue}</p>}

        <div className="deck-tile-actions">
          <button className="primary" onClick={onEdit}>
            Modifier
          </button>
          <SaveToCloudButton deck={deck} />
          <button onClick={onShare} aria-expanded={sharing}>
            {sharing ? 'Fermer' : 'Partager'}
          </button>
          {/* Suppression en deux temps, comme la sortie de l'éditeur : un deck composé
              carte par carte ne doit pas partir sur un clic malheureux. */}
          {confirmingDelete ? (
            <span className="deck-tile-confirm">
              Supprimer&nbsp;?
              <button className="danger" onClick={onDelete}>
                Oui
              </button>
              <button onClick={() => setConfirmingDelete(false)}>Non</button>
            </span>
          ) : (
            <button className="deck-tile-delete" onClick={() => setConfirmingDelete(true)}>
              Supprimer
            </button>
          )}
        </div>

        {sharing && <DeckShareBox code={encodeDeckCode(deck)} />}
      </div>
    </article>
  );
}

function DeckShareBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), NOTICE_MS);
    } catch {
      // Clipboard API unavailable/denied -- the code below is still selectable for manual copy.
    }
  }

  return (
    <div className="deck-share-box">
      <label className="deck-share-label">
        Code à envoyer à un autre joueur
        <textarea readOnly value={code} rows={3} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <button className={copied ? 'deck-share-copy copied' : 'deck-share-copy'} onClick={copy} aria-live="polite">
        {copied ? '✓ Copié dans le presse-papiers' : 'Copier le code'}
      </button>
    </div>
  );
}

/**
 * Barre de sauvegarde cloud : un pseudo (persisté en local, sert d'identifiant côté
 * Supabase -- pas un vrai compte) et un bouton pour rapatrier les decks sauvegardés
 * sous ce pseudo depuis n'importe quel appareil.
 */
function CloudDeckBar({ onImportDecks }: { onImportDecks: (decks: Deck[]) => void }) {
  const [userName, setUserName] = useState(() => getCloudUserName());
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  // Le chargement réussi ne disait rien : les decks apparaissaient plus bas dans la
  // galerie, hors champ sur un écran court, et on recliquait pour « être sûr ».
  const [loadedCount, setLoadedCount] = useState<number | null>(null);

  function commitUserName(value: string) {
    setUserName(value);
    setCloudUserName(value);
  }

  async function handleLoad() {
    if (!userName.trim()) return;
    setStatus('loading');
    setError(null);
    const result = await loadDecksFromCloud(userName.trim());
    if (!result.ok) {
      setStatus('error');
      setError(result.error ?? 'Erreur inconnue');
      return;
    }
    setStatus('idle');
    const decks: Deck[] = (result.decks ?? []).map((d) => ({
      id: `deck-cloud-${d.deckName}-${Date.now()}`,
      name: d.deckName,
      ...d.roster,
    }));
    onImportDecks(decks);
    setLoadedCount(decks.length);
    window.setTimeout(() => setLoadedCount(null), NOTICE_MS);
  }

  return (
    <div className="deck-cloud-bar deck-panel">
      <h2 className="deck-panel-title">
        <span aria-hidden="true">☁</span> Mes decks en ligne
      </h2>
      <label className="field">
        Pseudo
        <input
          value={userName}
          onChange={(e) => commitUserName(e.target.value)}
          placeholder="Votre pseudo"
          autoComplete="username"
        />
      </label>
      <button
        onClick={handleLoad}
        disabled={!userName.trim() || status === 'loading'}
        aria-busy={status === 'loading'}
        title={userName.trim() ? undefined : 'Renseignez un pseudo pour charger vos decks'}
      >
        {status === 'loading' ? 'Chargement…' : '☁ Charger mes decks en ligne'}
      </button>
      <p className="deck-panel-hint">
        Le pseudo sert à retrouver vos decks depuis n’importe quel appareil -- ce n’est pas un compte.
      </p>
      {error && <DeckNotice tone="danger">{error}</DeckNotice>}
      {loadedCount !== null && (
        <DeckNotice tone={loadedCount > 0 ? 'ok' : 'info'}>
          {loadedCount === 0
            ? 'Aucun deck en ligne sous ce pseudo.'
            : `${loadedCount} deck${loadedCount > 1 ? 's' : ''} chargé${loadedCount > 1 ? 's' : ''} depuis le cloud.`}
        </DeckNotice>
      )}
    </div>
  );
}

function SaveToCloudButton({ deck }: { deck: Deck }) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'no-username'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const userName = getCloudUserName().trim();
    if (!userName) {
      setStatus('no-username');
      return;
    }
    setStatus('saving');
    setError(null);
    const result = await saveDeckToCloud(userName, deck.name || '(sans nom)', deckToRoster(deck));
    if (!result.ok) {
      setStatus('error');
      setError(result.error ?? 'Erreur inconnue');
      return;
    }
    setStatus('saved');
    window.setTimeout(() => setStatus('idle'), NOTICE_MS);
  }

  // « Renseignez un pseudo d'abord » et « Échec » restaient affichés sur le bouton jusqu'au
  // prochain clic : le libellé ne revenait jamais à l'action qu'il propose.
  useEffect(() => {
    if (status !== 'no-username' && status !== 'error') return;
    const timer = window.setTimeout(() => setStatus('idle'), NOTICE_MS * 2);
    return () => window.clearTimeout(timer);
  }, [status]);

  const labels: Record<typeof status, string> = {
    idle: '☁ Sauvegarder en ligne',
    saving: 'Sauvegarde…',
    saved: '✓ Sauvegardé',
    error: 'Échec de la sauvegarde',
    'no-username': 'Renseignez un pseudo d’abord',
  };

  return (
    <span className="deck-cloud-save">
      <button
        className={`deck-cloud-save-button ${status}`}
        onClick={handleSave}
        disabled={status === 'saving'}
        aria-busy={status === 'saving'}
        aria-live="polite"
        title="Sauvegarde ce deck en ligne sous votre pseudo"
      >
        {labels[status]}
      </button>
      {status === 'error' && error && (
        <span className="deck-cloud-save-error" role="status">
          {error}
        </span>
      )}
    </span>
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
  // Retour éphémère de la liste (« deck enregistré », « deck importé ») : enregistrer
  // renvoyait à la galerie sans un mot, et un import réussi ne se voyait qu'en cherchant
  // la nouvelle vignette.
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const noticeTimer = useRef<number | null>(null);
  function flash(tone: NoticeTone, text: string) {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    setNotice({ tone, text });
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }
  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);
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
    flash('ok', `Deck « ${editing.name.trim() || '(sans nom)'} » enregistré.`);
  }

  function handleImport() {
    try {
      const deck = decodeDeckCode(importCode);
      persist([...decks, deck]);
      setImportCode('');
      setImportError(null);
      flash('ok', `Deck « ${deck.name || '(sans nom)'} » importé.`);
    } catch (err) {
      setImportError((err as Error).message);
    }
  }

  if (editing) {
    const known = decks.some((d) => d.id === editing.id);
    return (
      // Même décor que le salon, mais en retrait : le gestionnaire pose déjà ses propres
      // cartes plein écran, le champ qui dérive derrière ne doit pas leur disputer l'œil.
      <div className="deck-screen">
        <LobbyBackground quiet />
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
      </div>
    );
  }

  const playableCount = decks.filter((deck) => deckIssue(deck) === null).length;

  return (
    <div className="deck-screen">
      <LobbyBackground quiet />
      <div className="deck-manager">
        <div className="deck-manager-header">
          <div className="deck-manager-title">
            <span className="deck-manager-mark" aria-hidden="true">
              🗂️
            </span>
            <div className="deck-manager-titles">
              <h1>Mes decks</h1>
              <p className="deck-manager-sub">
                {decks.length === 0
                  ? 'Aucun deck enregistré'
                  : `${decks.length} deck${decks.length > 1 ? 's' : ''} · ${playableCount} prêt${playableCount > 1 ? 's' : ''} à jouer`}
              </p>
            </div>
          </div>
          <button className="deck-back-button" onClick={onBack}>
            ← Retour
          </button>
        </div>

        {notice && (
          <div className="deck-flash">
            <DeckNotice tone={notice.tone}>{notice.text}</DeckNotice>
          </div>
        )}

        <CloudDeckBar onImportDecks={(imported) => persist([...decks, ...imported])} />

        <div className="deck-gallery">
          {/* La création vit dans la galerie, à la place de la prochaine vignette, plutôt
              qu'en bouton isolé au-dessus : c'est là qu'on la cherche. */}
          <button type="button" className="deck-tile deck-tile-new" onClick={() => openEditor(createEmptyDeck())}>
            <span className="deck-tile-new-plus" aria-hidden="true">
              +
            </span>
            <span className="deck-tile-new-label">Nouveau deck</span>
            <span className="deck-tile-new-sub">Composer une équipe de zéro</span>
          </button>

          {decks.length === 0 && (
            <p className="deck-gallery-empty">
              Aucun deck pour l’instant. Composez-en un, importez un code reçu d’un autre joueur, ou chargez ceux
              que vous avez sauvegardés en ligne.
            </p>
          )}

          {decks.map((deck) => (
            <DeckTile
              key={deck.id}
              deck={deck}
              sharing={sharingId === deck.id}
              onEdit={() => openEditor({ ...deck })}
              onShare={() => setSharingId((id) => (id === deck.id ? null : deck.id))}
              onDelete={() => removeDeck(deck.id)}
            />
          ))}
        </div>

        <div className="deck-import deck-panel">
          <h2 className="deck-panel-title">
            <span aria-hidden="true">📥</span> Importer un deck
          </h2>
          <label className="field">
            Coller un code reçu d'un autre joueur
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
          {importError && <DeckNotice tone="danger">{importError}</DeckNotice>}
          <button className="primary" onClick={handleImport} disabled={!importCode.trim()}>
            Importer
          </button>
        </div>
      </div>
    </div>
  );
}
