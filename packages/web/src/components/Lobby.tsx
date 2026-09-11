import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  DRAW_MODE_ELIMINATIONS_TO_WIN,
  DRAW_MODE_STARTING_CHARACTERS,
  listDeckPool,
  RANDOM_POOL_SIZE,
  type DeckPoolEntry,
  type GameMode,
  type RoomSummary,
} from 'engine';
import type { GameConnection } from '../net/useGameConnection';
import { listOpenRooms } from '../api/rooms';
import { deckIssue, deckToRoster, loadDecks, type Deck } from '../decks';
import { DeckContentsPanel, type CardKind } from './DeckContentsPanel';
import { LobbyBackground } from './LobbyBackground';

const MODE_LABELS: Record<GameMode, string> = {
  normal: 'Mode Normal',
  random: 'Mode Aléatoire',
  draw: 'Mode Pioche',
};

/** Titre + résumé de chaque mode : le titre porte le choix, le résumé aide à trancher. */
const MODE_OPTIONS: ReadonlyArray<{ mode: GameMode; title: string; summary: string }> = [
  { mode: 'normal', title: MODE_LABELS.normal, summary: 'Vous jouez le deck choisi ci-dessous.' },
  {
    mode: 'random',
    title: MODE_LABELS.random,
    summary: `Chacun compose son équipe dans un tirage de ${RANDOM_POOL_SIZE.character}/${RANDOM_POOL_SIZE.object}/${RANDOM_POOL_SIZE.terrain}.`,
  },
  {
    mode: 'draw',
    title: MODE_LABELS.draw,
    summary: `${DRAW_MODE_STARTING_CHARACTERS} personnages au départ, une carte piochée par tour, ${DRAW_MODE_ELIMINATIONS_TO_WIN} éliminations pour gagner.`,
  },
];

/** Rafraîchissement de la liste des salons : assez court pour qu'un salon créé à côté apparaisse. */
const ROOMS_POLL_MS = 5000;
/** Durée d'affichage du « Copié ! » sur le bouton de copie du code. */
const COPIED_FEEDBACK_MS = 1600;

function waitingSince(createdAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - createdAt) / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min`;
}

export function Lobby({
  conn,
  onManageDecks,
  onCreateDeck,
  onImportDeck,
}: {
  conn: GameConnection;
  onManageDecks: () => void;
  onCreateDeck: () => void;
  onImportDeck: () => void;
}) {
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  /** Le mode ne concerne que la CRÉATION : celui qui rejoint hérite du mode du salon. */
  const [mode, setMode] = useState<GameMode>('normal');
  const pool = useMemo(() => listDeckPool(), []);
  const poolByType = useMemo<Record<CardKind, DeckPoolEntry[]>>(
    () => ({
      character: pool.filter((p) => p.type === 'character'),
      object: pool.filter((p) => p.type === 'object'),
      terrain: pool.filter((p) => p.type === 'terrain'),
    }),
    [pool]
  );

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  /** Uniquement pour le tout premier chargement : un rafraîchissement ne doit pas vider la liste à l'écran. */
  const [roomsLoading, setRoomsLoading] = useState(true);
  /** Le bouton « Actualiser » se grise le temps de la requête : sans ça, un clic ne donnait aucun retour. */
  const [roomsRefreshing, setRoomsRefreshing] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  useEffect(() => {
    const fresh = loadDecks();
    setDecks(fresh);
    setSelectedDeckId((prev) => (prev && fresh.some((d) => d.id === prev) ? prev : (fresh[0]?.id ?? null)));
  }, []);

  const refreshRooms = useCallback(async () => {
    setRoomsRefreshing(true);
    try {
      const result = await listOpenRooms();
      setRoomsLoading(false);
      if (!result.ok) {
        setRoomsError(result.error ?? 'Erreur serveur');
        return;
      }
      setRoomsError(null);
      setRooms(result.rooms ?? []);
    } finally {
      setRoomsRefreshing(false);
    }
  }, []);

  // On ne sonde que depuis le lobby au repos : une fois dans un salon (attente, draft,
  // partie), la liste n'est plus affichée et continuer à interroger le serveur ne
  // servirait qu'à réveiller l'hébergeur pour rien.
  const idle = conn.status === 'idle';
  useEffect(() => {
    if (!idle) return;
    void refreshRooms();
    const timer = setInterval(() => void refreshRooms(), ROOMS_POLL_MS);
    return () => clearInterval(timer);
  }, [idle, refreshRooms]);

  // Le « Copié ! » ne doit pas rester affiché indéfiniment.
  useEffect(() => {
    if (!codeCopied) return;
    const timer = setTimeout(() => setCodeCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [codeCopied]);

  const copyRoomCode = useCallback(async () => {
    if (!conn.roomCode) return;
    try {
      await navigator.clipboard.writeText(conn.roomCode);
      setCodeCopied(true);
    } catch {
      /* presse-papiers indisponible (http, permissions) : le code reste lisible à l'écran */
    }
  }, [conn.roomCode]);

  const selectedDeck = decks.find((d) => d.id === selectedDeckId) ?? null;
  const issue = selectedDeck ? deckIssue(selectedDeck) : null;
  // En Mode Aléatoire, le deck sélectionné n'est pas joué : chacun compose le sien dans le
  // tirage que le serveur lui donne. Inutile donc d'exiger un deck valide pour créer.
  const randomMode = mode === 'random';
  const drawMode = mode === 'draw';
  // Ni le Mode Aléatoire ni le Mode Pioche ne jouent le deck sélectionné : inutile d'exiger
  // qu'il soit valide pour créer le salon.
  const deckReady = Boolean(selectedDeck) && issue === null;
  const canPlay = randomMode || drawMode || deckReady;
  const waiting = conn.status === 'waiting';
  // Un salon déjà ouvert en attente : en créer ou en rejoindre un autre n'a pas de sens
  // tant qu'on ne l'a pas annulé -- les actions se grisent au lieu de rester tentantes.
  const busy = conn.status === 'connecting' || conn.resuming || waiting;
  /** Le deck n'est envoyé que s'il est jouable : le serveur refuse un roster incomplet, même
   *  dans un mode où il l'ignorerait ensuite. */
  const roster = deckReady && selectedDeck ? deckToRoster(selectedDeck) : undefined;
  // Le sélecteur de mode ci-dessus ne vaut que pour une CRÉATION : un salon rejoint impose
  // le sien. Seul un salon en Mode Normal exige donc un deck valide.
  const canJoin = (roomMode: GameMode) => !busy && (roomMode !== 'normal' || deckReady);
  // Son propre salon en attente n'est pas une invitation à rejoindre.
  const openRooms = rooms.filter((room) => room.code !== conn.roomCode);
  const deckSize = selectedDeck
    ? selectedDeck.characterCardIds.length + selectedDeck.objectCardIds.length + selectedDeck.terrainCardIds.length
    : 0;
  const deckUnused = randomMode || drawMode;

  const ctaSub = drawMode
    ? 'Tout sort des piles'
    : randomMode
      ? 'Tirage à la connexion'
      : !selectedDeck
        ? 'Aucun deck sélectionné'
        : canPlay
          ? `${deckSize} cartes prêtes`
          : 'Deck injouable';

  const canSubmitCode = !busy && joinCode.length >= 2 && canPlay;
  const submitJoinCode = (event: FormEvent) => {
    // Entrée dans le champ de code = clic sur « Rejoindre » : le formulaire porte les deux.
    event.preventDefault();
    if (!canSubmitCode) return;
    conn.joinRoom(joinCode, name || 'Joueur', roster);
  };

  return (
    <div className="lobby-screen">
      <LobbyBackground />

      <div className="lobby-shell">
        <header className="lobby-topbar">
          <div className="lobby-brand">
            <span className="lobby-brand-mark" aria-hidden="true">
              ⚔
            </span>
            <div className="lobby-brand-text">
              <h1>Jeu de Cartes</h1>
              <p className="lobby-tagline">Créez un salon, ou rejoignez-en un d'un clic dans la liste.</p>
            </div>
          </div>

          {/* Gestion des decks : utile, mais ce n'est pas l'action qu'on vient chercher ici.
              Reléguée en onglets discrets pour laisser la zone de jeu au lancement de partie. */}
          <nav className="lobby-tabs" aria-label="Gestion des decks">
            <button type="button" className="lobby-tab" onClick={onManageDecks}>
              Gérer mes decks
            </button>
            <button type="button" className="lobby-tab" onClick={onCreateDeck}>
              Créer un deck
            </button>
            <button type="button" className="lobby-tab" onClick={onImportDeck}>
              Importer
            </button>
          </nav>
        </header>

        <div className="lobby-layout">
          <section className="lobby-panel lobby-play" aria-labelledby="lobby-play-title">
            <div className="lobby-panel-head">
              <h2 id="lobby-play-title" className="lobby-panel-title">
                Nouvelle partie
              </h2>
              {conn.resuming && (
                <p className="lobby-resuming" role="status">
                  <span className="lobby-pulse" aria-hidden="true" />
                  Reprise de la partie en cours…
                </p>
              )}
            </div>

            <label className="field">
              Votre nom
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Joueur"
                maxLength={24}
                autoComplete="nickname"
                spellCheck={false}
              />
            </label>

            <fieldset className="field lobby-mode">
              <legend>Mode de jeu</legend>
              <div className="lobby-mode-options" role="radiogroup" aria-label="Mode de jeu">
                {MODE_OPTIONS.map((option) => {
                  const checked = mode === option.mode;
                  return (
                    <label
                      key={option.mode}
                      className={checked ? 'lobby-mode-option is-checked' : 'lobby-mode-option'}
                    >
                      <input
                        type="radio"
                        name="game-mode"
                        checked={checked}
                        onChange={() => setMode(option.mode)}
                      />
                      <span className="lobby-mode-text">
                        <span className="lobby-mode-title">{option.title}</span>
                        <span className="lobby-mode-summary">{option.summary}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <label className={deckUnused ? 'field lobby-deck-field is-unused' : 'field lobby-deck-field'}>
              <span className="lobby-field-label">
                Votre deck
                {deckUnused && <span className="lobby-field-note">Non utilisé dans ce mode</span>}
              </span>
              {decks.length > 0 ? (
                <select value={selectedDeckId ?? ''} onChange={(e) => setSelectedDeckId(e.target.value)}>
                  {decks.map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name || '(sans nom)'} -- {deck.characterCardIds.length} perso / {deck.objectCardIds.length}{' '}
                      objets / {deck.terrainCardIds.length} terrains
                    </option>
                  ))}
                </select>
              ) : (
                /* État vide actionnable : le bouton mène droit au deck-builder au lieu de
                   renvoyer le joueur chercher l'onglet en haut de page. */
                <span className="lobby-empty-deck">
                  <span>Aucun deck pour l'instant.</span>
                  <button type="button" className="lobby-inline-btn" onClick={onCreateDeck}>
                    Créer un deck
                  </button>
                </span>
              )}
            </label>

            {selectedDeck && issue && !deckUnused && (
              <p className="lobby-alert" role="alert">
                <span>
                  <strong>Deck injouable :</strong> {issue}
                </span>
                <button type="button" className="lobby-inline-btn" onClick={onManageDecks}>
                  Corriger
                </button>
              </p>
            )}

            <div className="lobby-actions">
              <button
                type="button"
                className="lobby-cta"
                onClick={() => conn.createRoom(name || 'Joueur', roster, mode)}
                disabled={busy || !canPlay}
              >
                <span className="lobby-cta-label">Créer un salon</span>
                <span className="lobby-cta-sub">{ctaSub}</span>
              </button>

              <div className="lobby-or" role="separator">
                <span>ou rejoindre</span>
              </div>

              {/* Les salons ouverts, cliquables : le code à deux lettres reste dispo juste
                  en dessous pour rejoindre un salon dont on a reçu le code ailleurs. */}
              <div className="lobby-rooms">
                <div className="lobby-rooms-head">
                  <span aria-live="polite">
                    Salons ouverts
                    {openRooms.length > 0 && <span className="lobby-rooms-count">{openRooms.length}</span>}
                  </span>
                  <button
                    type="button"
                    className={roomsRefreshing ? 'lobby-rooms-refresh is-busy' : 'lobby-rooms-refresh'}
                    onClick={() => void refreshRooms()}
                    disabled={roomsRefreshing}
                    aria-label="Actualiser la liste des salons"
                  >
                    <span className="lobby-rooms-refresh-icon" aria-hidden="true">
                      ↻
                    </span>
                    Actualiser
                  </button>
                </div>

                {roomsError ? (
                  <p className="lobby-rooms-empty is-error" role="alert">
                    {roomsError}
                  </p>
                ) : openRooms.length === 0 ? (
                  <p className="lobby-rooms-empty">
                    {roomsLoading ? (
                      <>
                        <span className="lobby-pulse" aria-hidden="true" />
                        Recherche des salons…
                      </>
                    ) : (
                      <>
                        Aucun salon ouvert pour le moment.
                        <span className="lobby-rooms-empty-hint">
                          Créez-en un ci-dessus, ou entrez un code reçu d'un ami.
                        </span>
                      </>
                    )}
                  </p>
                ) : (
                  <ul className="lobby-room-list">
                    {openRooms.map((room) => {
                      const joinable = canJoin(room.mode);
                      return (
                        <li key={room.code}>
                          <button
                            type="button"
                            className="lobby-room"
                            onClick={() => conn.joinRoom(room.code, name || 'Joueur', roster)}
                            disabled={!joinable}
                            aria-label={`Rejoindre le salon ${room.code} de ${room.hostName} (${MODE_LABELS[room.mode]})`}
                            title={
                              joinable
                                ? `Rejoindre le salon de ${room.hostName}`
                                : 'Ce salon se joue avec votre deck : il en faut un valide.'
                            }
                          >
                            <span className="lobby-room-code">{room.code}</span>
                            <span className="lobby-room-info">
                              <strong>{room.hostName}</strong>
                              <span className="lobby-room-meta">
                                {MODE_LABELS[room.mode]} · depuis {waitingSince(room.createdAt)}
                                {/* Le motif du refus est aussi écrit : le `title` n'existe
                                    pas au tactile. */}
                                {!joinable && !busy && <span className="lobby-room-locked">Deck valide requis</span>}
                              </span>
                            </span>
                            {/* Un chevron plutôt qu'un « Rejoindre » écrit : dans un panneau
                                aussi étroit, le mot volait la place de la ligne de mode.
                                L'intitulé complet reste porté par `aria-label`. */}
                            <span className="lobby-room-go" aria-hidden="true">
                              ›
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <form className="lobby-join" onSubmit={submitJoinCode}>
                <label className="lobby-join-label" htmlFor="lobby-join-code">
                  Code du salon
                </label>
                <div className="lobby-join-row">
                  <input
                    id="lobby-join-code"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="AB"
                    maxLength={2}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    disabled={busy}
                  />
                  <button type="submit" disabled={!canSubmitCode}>
                    Rejoindre
                  </button>
                </div>
              </form>
            </div>

            {waiting && conn.roomCode && (
              <div className="room-code-banner" role="status">
                <span className="room-code-banner-label">Code du salon</span>
                <strong>{conn.roomCode}</strong>
                <p>
                  <span className="lobby-pulse" aria-hidden="true" />
                  En attente d'un adversaire…
                </p>
                <div className="room-code-banner-actions">
                  <button type="button" onClick={() => void copyRoomCode()}>
                    {codeCopied ? 'Copié !' : 'Copier le code'}
                  </button>
                  {/* Un salon créé par erreur (ou dont l'adversaire ne viendra jamais) n'avait
                      aucune sortie : il fallait recharger la page pour revenir en arrière. */}
                  <button type="button" className="room-code-banner-cancel" onClick={conn.leave}>
                    Annuler le salon
                  </button>
                </div>
              </div>
            )}

            {conn.error && (
              <p className="lobby-alert" role="alert">
                <span>{conn.error}</span>
              </p>
            )}
          </section>

          {selectedDeck && (
            <DeckContentsPanel title="Contenu du deck" deck={selectedDeck} pool={poolByType} variant="list" />
          )}
        </div>
      </div>
    </div>
  );
}
