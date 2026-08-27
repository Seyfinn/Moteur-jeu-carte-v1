import { useEffect, useMemo, useState } from 'react';
import {
  DRAW_MODE_ELIMINATIONS_TO_WIN,
  DRAW_MODE_STARTING_CHARACTERS,
  listDeckPool,
  RANDOM_POOL_SIZE,
  type DeckPoolEntry,
  type GameMode,
} from 'engine';
import type { GameConnection } from '../net/useGameConnection';
import { deckIssue, deckToRoster, loadDecks, type Deck } from '../decks';
import { DeckContentsPanel, type CardKind } from './DeckContentsPanel';
import { LobbyBackground } from './LobbyBackground';

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

  useEffect(() => {
    const fresh = loadDecks();
    setDecks(fresh);
    setSelectedDeckId((prev) => (prev && fresh.some((d) => d.id === prev) ? prev : (fresh[0]?.id ?? null)));
  }, []);

  const selectedDeck = decks.find((d) => d.id === selectedDeckId) ?? null;
  const issue = selectedDeck ? deckIssue(selectedDeck) : null;
  // En Mode Aléatoire, le deck sélectionné n'est pas joué : chacun compose le sien dans le
  // tirage que le serveur lui donne. Inutile donc d'exiger un deck valide pour créer.
  const randomMode = mode === 'random';
  const drawMode = mode === 'draw';
  // Ni le Mode Aléatoire ni le Mode Pioche ne jouent le deck sélectionné : inutile d'exiger
  // qu'il soit valide pour créer le salon.
  const canPlay = randomMode || drawMode || (Boolean(selectedDeck) && issue === null);
  const busy = conn.status === 'connecting' || conn.resuming;
  const deckSize = selectedDeck
    ? selectedDeck.characterCardIds.length + selectedDeck.objectCardIds.length + selectedDeck.terrainCardIds.length
    : 0;

  return (
    <div className="lobby-screen">
      <LobbyBackground />

      <div className="lobby-shell">
        <header className="lobby-topbar">
          <div className="lobby-brand">
            <span className="lobby-brand-mark">⚔</span>
            <div className="lobby-brand-text">
              <h1>Jeu de Cartes</h1>
              <p className="lobby-tagline">Créez un salon et partagez le code avec votre adversaire.</p>
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
          <section className="lobby-panel lobby-play">
            {conn.resuming && <p className="lobby-resuming">Reprise de la partie en cours...</p>}

            <label className="field">
              Votre nom
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Joueur" />
            </label>

            <fieldset className="field lobby-mode">
              <legend>Mode de jeu</legend>
              <label>
                <input
                  type="radio"
                  name="game-mode"
                  checked={mode === 'normal'}
                  onChange={() => setMode('normal')}
                />
                Mode Normal — vous jouez le deck choisi ci-dessous
              </label>
              <label>
                <input
                  type="radio"
                  name="game-mode"
                  checked={randomMode}
                  onChange={() => setMode('random')}
                />
                Mode Aléatoire — chacun compose son équipe dans un tirage de{' '}
                {RANDOM_POOL_SIZE.character}/{RANDOM_POOL_SIZE.object}/{RANDOM_POOL_SIZE.terrain}
              </label>
              <label>
                <input
                  type="radio"
                  name="game-mode"
                  checked={drawMode}
                  onChange={() => setMode('draw')}
                />
                Mode Pioche — {DRAW_MODE_STARTING_CHARACTERS} personnages au départ, une carte
                piochée par tour, {DRAW_MODE_ELIMINATIONS_TO_WIN} éliminations pour gagner
              </label>
              {(randomMode || drawMode) && (
                <p className="subtitle">
                  Le mode s'applique au salon entier. Votre deck n'est pas utilisé.
                </p>
              )}
            </fieldset>

            <label className="field">
              Votre deck
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
                <span className="subtitle">Aucun deck -- créez-en un pour pouvoir jouer.</span>
              )}
            </label>

            {selectedDeck && issue && <p className="error">Deck injouable : {issue}</p>}

            <div className="lobby-actions">
              <button
                type="button"
                className="lobby-cta"
                aria-label="Créer un salon"
                onClick={() =>
                  conn.createRoom(
                    name || 'Joueur',
                    selectedDeck ? deckToRoster(selectedDeck) : { characterCardIds: [], objectCardIds: [], terrainCardIds: [] },
                    mode
                  )
                }
                disabled={busy || !canPlay}
              >
                <span className="lobby-cta-label">Créer un salon</span>
                <span className="lobby-cta-sub">
                  {drawMode
                    ? 'Tout sort des piles'
                    : randomMode
                      ? 'Tirage à la connexion'
                      : canPlay
                        ? `${deckSize} cartes prêtes`
                        : 'Deck injouable'}
                </span>
              </button>

              <div className="lobby-or">
                <span>ou rejoindre</span>
              </div>

              <div className="lobby-join">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="CODE"
                  maxLength={2}
                  aria-label="Code du salon"
                />
                <button
                  type="button"
                  onClick={() => selectedDeck && conn.joinRoom(joinCode, name || 'Joueur', deckToRoster(selectedDeck))}
                  disabled={busy || joinCode.length < 2 || !canPlay}
                >
                  Rejoindre
                </button>
              </div>
            </div>

            {conn.status === 'waiting' && conn.roomCode && (
              <div className="room-code-banner">
                Code du salon : <strong>{conn.roomCode}</strong>
                <p>En attente d'un adversaire...</p>
                {/* Un salon créé par erreur (ou dont l'adversaire ne viendra jamais) n'avait
                    aucune sortie : il fallait recharger la page pour revenir en arrière. */}
                <button onClick={conn.leave}>Annuler le salon</button>
              </div>
            )}

            {conn.error && <p className="error">{conn.error}</p>}
          </section>

          {selectedDeck && (
            <DeckContentsPanel title="Contenu du deck" deck={selectedDeck} pool={poolByType} variant="list" />
          )}
        </div>
      </div>
    </div>
  );
}
