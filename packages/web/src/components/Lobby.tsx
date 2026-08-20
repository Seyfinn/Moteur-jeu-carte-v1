import { useEffect, useState } from 'react';
import type { GameConnection } from '../net/useGameConnection';
import { deckToRoster, isDeckPlayable, loadDecks, type Deck } from '../decks';

export function Lobby({ conn, onManageDecks }: { conn: GameConnection; onManageDecks: () => void }) {
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);

  useEffect(() => {
    const fresh = loadDecks();
    setDecks(fresh);
    setSelectedDeckId((prev) => (prev && fresh.some((d) => d.id === prev) ? prev : (fresh[0]?.id ?? null)));
  }, []);

  const selectedDeck = decks.find((d) => d.id === selectedDeckId) ?? null;
  const canPlay = Boolean(selectedDeck && isDeckPlayable(selectedDeck));
  const busy = conn.status === 'connecting';

  return (
    <div className="lobby">
      <h1>Moteur de jeu de cartes</h1>
      <p className="subtitle">Cartes de démonstration -- créez un salon et partagez le code avec votre adversaire.</p>

      <label className="field">
        Votre nom
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Joueur" />
      </label>

      <label className="field">
        Votre deck
        {decks.length > 0 ? (
          <select value={selectedDeckId ?? ''} onChange={(e) => setSelectedDeckId(e.target.value)}>
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.name || '(sans nom)'} -- {deck.characterCardIds.length} perso / {deck.objectCardIds.length} objets /{' '}
                {deck.terrainCardIds.length} terrains
              </option>
            ))}
          </select>
        ) : (
          <span className="subtitle">Aucun deck -- créez-en un pour pouvoir jouer.</span>
        )}
      </label>

      <button className="deck-manager-link" onClick={onManageDecks}>
        Gérer mes decks
      </button>

      {selectedDeck && !canPlay && <p className="error">Ce deck n'a aucune carte personnage jouable.</p>}

      <div className="lobby-actions">
        <button
          className="primary"
          onClick={() => selectedDeck && conn.createRoom(name || 'Joueur', deckToRoster(selectedDeck))}
          disabled={busy || !canPlay}
        >
          Créer un salon
        </button>

        <div className="join-row">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="CODE"
            maxLength={2}
          />
          <button
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
        </div>
      )}

      {conn.error && <p className="error">{conn.error}</p>}
    </div>
  );
}
