import { useState } from 'react';
import { useGameConnection } from './net/useGameConnection';
import { Lobby } from './components/Lobby';
import { DeckBuilder } from './components/DeckBuilder';
import { Board } from './components/Board';
import { HoverCardProvider } from './components/HoverCard';

export default function App() {
  const conn = useGameConnection();
  const [screen, setScreen] = useState<'lobby' | 'decks'>('lobby');

  return (
    <HoverCardProvider>
      {conn.state && conn.you ? (
        <Board conn={conn} />
      ) : screen === 'decks' ? (
        <DeckBuilder onBack={() => setScreen('lobby')} />
      ) : (
        <Lobby conn={conn} onManageDecks={() => setScreen('decks')} />
      )}
    </HoverCardProvider>
  );
}
