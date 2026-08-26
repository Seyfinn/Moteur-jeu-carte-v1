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
  splitBySubgroup,
  useCardPreview,
  type CardKind,
  type DeckSectionKey,
} from './DeckContentsPanel';
import type { GameConnection } from '../net/useGameConnection';
import { usePointerCoarse } from '../hooks/usePointerCoarse';
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
  blockedReason,
  onAdd,
  onRemove,
}: {
  entry: DeckPoolEntry;
  count: number;
  disabledAdd: boolean;
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
        <div className="lobby-shell">
          <header className="lobby-topbar">
            <div className="lobby-brand">
              <span className="lobby-brand-mark">🎲</span>
              <div className="lobby-brand-text">
                <h1>Mode Aléatoire</h1>
                <p className="lobby-tagline">
                  Composez votre équipe dans le tirage qui vous a été attribué. Votre adversaire a le sien.
                </p>
              </div>
            </div>
            <nav className="lobby-tabs">
              {/* Une phase de draft sans sortie enfermerait le joueur : même geste que
                  l'abandon en partie, il quitte le salon et revient au lobby. */}
              <button type="button" className="lobby-tab" onClick={conn.leave}>
                Quitter le salon
              </button>
            </nav>
          </header>

          <div className="deck-editor-layout">
            <div className="deck-editor">
              {submitted ? (
                <p className="lobby-resuming">
                  Équipe validée. En attente de votre adversaire...
                </p>
              ) : (
                <>
                  {opponentSubmitted && (
                    <p className="lobby-resuming">Votre adversaire a validé son équipe.</p>
                  )}
                  <div className="draft-submit-bar">
                    <button type="button" className="lobby-cta" onClick={() => conn.submitDraft(roster)} disabled={issue !== null}>
                      <span className="lobby-cta-label">Valider mon équipe</span>
                      <span className="lobby-cta-sub">{issue ?? 'Prêt à jouer'}</span>
                    </button>
                  </div>
                </>
              )}

              {conn.error && <p className="error">{conn.error}</p>}

              {SECTIONS.map((section) => {
                const selected = roster[section.key];
                const entries = poolByType[section.type];
                return (
                  <div className="deck-section" key={section.key}>
                    <div className="deck-section-head">
                      <h2>
                        {section.title}{' '}
                        <span className="deck-section-count">
                          ({selected.length}/{section.max})
                        </span>
                      </h2>
                    </div>
                    {splitBySubgroup(section.type, entries, (entry) => entry.equipment === true).map((group) => (
                      <div key={group.key}>
                        {group.title && <h4 className="deck-subgroup-header">{group.title}</h4>}
                        <div className="deck-card-grid">
                          {group.entries.map((entry) => {
                            const count = countOf(selected, entry.id);
                            return (
                              <DraftCardTile
                                key={entry.id}
                                entry={entry}
                                count={count}
                                disabledAdd={submitted || blockedReasonFor(section.key, entry) !== null || selected.length >= section.max}
                                blockedReason={blockedReasonFor(section.key, entry)}
                                onAdd={() => add(section.key, entry.id)}
                                onRemove={() => remove(section.key, entry.id)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
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
