import { useMemo, useState } from 'react';
import {
  draftIssue,
  listDeckPool,
  validateDraftedRoster,
  type DeckPoolEntry,
  type DraftPool,
  type RosterConfig,
} from 'engine';
import { CardFrame } from './CardFrame';
import {
  CardPreviewProvider,
  DeckContentsPanel,
  SECTIONS,
  SECTION_ICON,
  splitBySubgroup,
  useCardPreview,
  type CardKind,
  type DeckSectionKey,
} from './DeckContentsPanel';
import type { GameConnection } from '../net/useGameConnection';
import { LobbyBackground } from './LobbyBackground';

const EMPTY_ROSTER: RosterConfig = { characterCardIds: [], objectCardIds: [], terrainCardIds: [] };

function countOf(ids: string[], id: string): number {
  return ids.filter((x) => x === id).length;
}

/** Une carte du tirage, avec son compteur +/− -- même geste que dans l'éditeur de deck. */
function DraftCardTile({
  entry,
  count,
  disabledAdd,
  disabledRemove,
  blockedReason,
  onAdd,
  onRemove,
}: {
  entry: DeckPoolEntry;
  count: number;
  disabledAdd: boolean;
  disabledRemove: boolean;
  blockedReason: string | null;
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
      unique={entry.maxCopies === 1}
      dimmed={Boolean(blockedReason)}
      title={blockedReason ?? undefined}
      {...preview.bind(entry)}
      footer={
        <>
          {blockedReason && <span className="deck-card-blocked">{blockedReason}</span>}
          {/* Mêmes pastilles que l'éditeur de deck (`deck-step`) : le joueur qui vient de
              construire un deck retrouve exactement le même geste ici, « + » bleu compris. */}
          <div className="deck-card-stepper">
            <button
              type="button"
              className="deck-step deck-step-minus"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              disabled={disabledRemove}
              aria-label={`Retirer ${entry.name}`}
            >
              −
            </button>
            <span className={count > 0 ? 'deck-step-count taken' : 'deck-step-count'} aria-live="polite">
              {count}
            </span>
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
 * Mode Aléatoire : le joueur compose son équipe (6/8/3) dans la réserve que le serveur lui
 * a tirée (10/10/6). Le reste du tirage n'est pas joué.
 *
 * Toute la validation passe par les mêmes fonctions que le serveur (`validateDraftedRoster`,
 * `draftIssue`) : ce qui est grisé ici est exactement ce que le serveur refuserait.
 */
export function DraftScreen({ conn, pool }: { conn: GameConnection; pool: DraftPool }) {
  const [roster, setRoster] = useState<RosterConfig>(EMPTY_ROSTER);

  const fullPool = useMemo(() => listDeckPool(), []);
  const entryById = useMemo(() => new Map(fullPool.map((e) => [e.id, e] as const)), [fullPool]);

  /** Les cartes du tirage, dans l'ordre où le serveur les a envoyées. */
  const poolByType = useMemo<Record<CardKind, DeckPoolEntry[]>>(
    () => ({
      character: pool.characterCardIds.map((id) => entryById.get(id)).filter((e): e is DeckPoolEntry => !!e),
      object: pool.objectCardIds.map((id) => entryById.get(id)).filter((e): e is DeckPoolEntry => !!e),
      terrain: pool.terrainCardIds.map((id) => entryById.get(id)).filter((e): e is DeckPoolEntry => !!e),
    }),
    [pool, entryById]
  );

  const submitted = conn.you ? conn.draftSubmittedBy.includes(conn.you) : false;
  const opponentSubmitted = conn.draftSubmittedBy.some((id) => id !== conn.you);
  const issue = draftIssue(roster, pool);
  const pickedCount = roster.characterCardIds.length + roster.objectCardIds.length + roster.terrainCardIds.length;

  function add(key: DeckSectionKey, id: string) {
    setRoster((prev) => {
      const next: RosterConfig = { ...prev, [key]: [...prev[key], id] };
      // On ne teste pas les quotas à la main : la même fonction que le serveur tranche,
      // donc unicité, maxCopies et incompatibilités sont couverts d'un coup.
      return validateDraftedRoster(next, pool).ok ? next : prev;
    });
  }

  function remove(key: DeckSectionKey, id: string) {
    setRoster((prev) => {
      const ids = [...prev[key]];
      const idx = ids.lastIndexOf(id);
      if (idx === -1) return prev;
      ids.splice(idx, 1);
      return { ...prev, [key]: ids };
    });
  }

  /** Pourquoi cette carte ne peut-elle pas être ajoutée maintenant ? `null` = elle le peut. */
  function blockedReasonFor(key: DeckSectionKey, entry: DeckPoolEntry): string | null {
    // Le plafond d'exemplaires n'est pas une incompatibilité non plus : sans ce garde,
    // chaque personnage ou terrain déjà pris (tous uniques) se retrouvait grisé et barré
    // d'un « Trop d'exemplaires » -- l'équipe en cours ressemblait à une liste de refus.
    // Son « + » se ferme (voir `disabledAdd`), la carte reste en couleur.
    if (countOf(roster[key], entry.id) >= entry.maxCopies) return null;
    const probe: RosterConfig = { ...roster, [key]: [...roster[key], entry.id] };
    const check = validateDraftedRoster(probe, pool);
    if (check.ok) return null;
    // Un quota atteint n'est pas une incompatibilité : inutile d'en barbouiller chaque carte.
    return check.error.startsWith('Trop de cartes') ? null : check.error;
  }

  return (
    <CardPreviewProvider>
      <div className="lobby-screen">
        <LobbyBackground />
        {/* `draft-shell` élargit le gabarit du salon : trois grilles de cartes et le panneau
            « Mon équipe » ne tiennent pas dans les 1000 px prévus pour deux panneaux de menu. */}
        <div className="lobby-shell draft-shell">
          <header className="lobby-topbar">
            <div className="lobby-brand">
              <span className="lobby-brand-mark" aria-hidden="true">
                🎲
              </span>
              <div className="lobby-brand-text">
                <h1>Mode Aléatoire</h1>
                <p className="lobby-tagline">
                  Composez votre équipe dans le tirage qui vous a été attribué. Votre adversaire a le sien.
                </p>
              </div>
            </div>
            <nav className="lobby-tabs" aria-label="Navigation du salon">
              {/* Une phase de draft sans sortie enfermerait le joueur : même geste que
                  l'abandon en partie, il quitte le salon et revient au lobby. */}
              <button type="button" className="lobby-tab" onClick={conn.leave}>
                Quitter le salon
              </button>
            </nav>
          </header>

          <div className="deck-editor-layout">
            <div className={submitted ? 'deck-editor draft-locked' : 'deck-editor'}>
              {/* Barre d'état collée en haut du défilement : la progression des trois
                  familles, l'action de validation et l'état de l'adversaire restent visibles
                  quelle que soit la grille en cours de lecture. */}
              <div className="draft-submit-bar">
                {submitted ? (
                  <div className="draft-waiting" role="status" aria-live="polite">
                    <span className="draft-spinner" aria-hidden="true" />
                    <div className="draft-waiting-text">
                      <strong className="draft-waiting-title">Équipe validée</strong>
                      <span className="draft-waiting-sub">
                        {opponentSubmitted
                          ? 'Votre adversaire est prêt, la partie démarre…'
                          : 'En attente de votre adversaire…'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="draft-progress" role="group" aria-label="Progression de la sélection">
                      {SECTIONS.map((section) => {
                        const taken = roster[section.key].length;
                        const full = taken >= section.max;
                        return (
                          <span
                            key={section.key}
                            className={full ? 'draft-progress-chip full' : 'draft-progress-chip'}
                            aria-label={`${section.title} : ${taken} sur ${section.max}`}
                          >
                            <span aria-hidden="true">{SECTION_ICON[section.type]}</span>
                            <span className="draft-progress-label">{section.title}</span>
                            <span className="draft-progress-count">
                              {taken}/{section.max}
                            </span>
                            <span className="draft-progress-bar" aria-hidden="true">
                              <span style={{ width: `${Math.min(100, (taken / section.max) * 100)}%` }} />
                            </span>
                          </span>
                        );
                      })}
                    </div>
                    <div className="draft-submit-actions">
                      <button
                        type="button"
                        className="draft-reset"
                        onClick={() => setRoster(EMPTY_ROSTER)}
                        disabled={pickedCount === 0}
                        title="Retirer toutes les cartes sélectionnées"
                      >
                        Tout retirer
                      </button>
                      <button
                        type="button"
                        className={issue === null ? 'lobby-cta draft-cta ready' : 'lobby-cta draft-cta'}
                        onClick={() => conn.submitDraft(roster)}
                        disabled={issue !== null}
                      >
                        <span className="lobby-cta-label">Valider mon équipe</span>
                        <span className="lobby-cta-sub" aria-live="polite">
                          {issue ?? 'Équipe complète, prêt à jouer'}
                        </span>
                      </button>
                    </div>
                    <p
                      className={opponentSubmitted ? 'draft-opponent done' : 'draft-opponent'}
                      role="status"
                      aria-live="polite"
                    >
                      <span className="draft-opponent-dot" aria-hidden="true" />
                      {opponentSubmitted
                        ? 'Votre adversaire a validé son équipe et vous attend.'
                        : 'Votre adversaire compose encore son équipe.'}
                    </p>
                  </>
                )}
              </div>

              {conn.error && (
                <p className="error" role="alert">
                  {conn.error}
                </p>
              )}

              {SECTIONS.map((section) => {
                const selected = roster[section.key];
                const entries = poolByType[section.type];
                const full = selected.length >= section.max;
                return (
                  <section className={`deck-section deck-section-${section.type}`} key={section.key} aria-labelledby={`draft-section-${section.key}`}>
                    <div className="draft-section-head">
                      <span className="deck-section-icon" aria-hidden="true">
                        {SECTION_ICON[section.type]}
                      </span>
                      <h2 id={`draft-section-${section.key}`}>{section.title}</h2>
                      <span className={full ? 'draft-section-count full' : 'draft-section-count'}>
                        {selected.length}/{section.max}
                      </span>
                      <span className="draft-section-hint">
                        {full ? 'Famille au complet' : `Choisissez ${section.max} cartes parmi ${entries.length} tirées`}
                      </span>
                      {/* Même jauge que l'éditeur de deck : au milieu de trois grilles, « où en
                          suis-je sur cette famille ? » doit se lire sans compter les pastilles. */}
                      <div className={full ? 'deck-section-meter full' : 'deck-section-meter'} aria-hidden="true">
                        <span style={{ width: `${Math.min(100, (selected.length / section.max) * 100)}%` }} />
                      </div>
                    </div>
                    {splitBySubgroup(section.type, entries, (entry) => entry.equipment === true).map((group) => (
                      <div key={group.key}>
                        {group.title && (
                          <h3 className="deck-subgroup-header">
                            {group.title}
                            {group.hint && <span className="deck-subgroup-hint">{group.hint}</span>}
                          </h3>
                        )}
                        <div className="deck-card-grid">
                          {group.entries.map((entry) => {
                            const count = countOf(selected, entry.id);
                            const blockedReason = blockedReasonFor(section.key, entry);
                            return (
                              <DraftCardTile
                                key={entry.id}
                                entry={entry}
                                count={count}
                                disabledAdd={submitted || blockedReason !== null || full || count >= entry.maxCopies}
                                // Une équipe validée est partie au serveur : la retoucher ici
                                // ne changerait rien en face, autant fermer les deux boutons.
                                disabledRemove={submitted || count === 0}
                                blockedReason={blockedReason}
                                onAdd={() => add(section.key, entry.id)}
                                onRemove={() => remove(section.key, entry.id)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </section>
                );
              })}
            </div>

            <DeckContentsPanel
              title="Mon équipe"
              deck={{ id: 'draft', name: '', ...roster }}
              pool={poolByType}
              variant="list"
            />
          </div>
        </div>
      </div>
    </CardPreviewProvider>
  );
}
