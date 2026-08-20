import { useState } from 'react';
import type { GameConnection } from '../net/useGameConnection';

export function Lobby({ conn }: { conn: GameConnection }) {
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  return (
    <div className="lobby">
      <h1>Moteur de jeu de cartes</h1>
      <p className="subtitle">Cartes de démonstration -- créez un salon et partagez le code avec votre adversaire.</p>

      <label className="field">
        Votre nom
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Joueur" />
      </label>

      <div className="lobby-actions">
        <button className="primary" onClick={() => conn.createRoom(name || 'Joueur')} disabled={conn.status === 'connecting'}>
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
            onClick={() => conn.joinRoom(joinCode, name || 'Joueur')}
            disabled={conn.status === 'connecting' || joinCode.length < 2}
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
