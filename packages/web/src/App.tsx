import { useState } from 'react';
import { useGameConnection } from './net/useGameConnection';
import { Lobby } from './components/Lobby';
import { DeckBuilder } from './components/DeckBuilder';
import { Board } from './components/Board';
import { HoverCardProvider } from './components/HoverCard';

export default function App() {
  const conn = useGameConnection();
  const [screen, setScreen] = useState<'lobby' | 'decks'>('lobby');
  const [deckBuilderView, setDeckBuilderView] = useState<'list' | 'new' | 'import'>('list');

  function openDeckBuilder(view: 'list' | 'new' | 'import') {
    setDeckBuilderView(view);
    setScreen('decks');
  }

  return (
    <HoverCardProvider>
      {conn.state && conn.you ? (
        // Clé = l'identifiant de la partie : une revanche est une NOUVELLE partie dans le
        // même salon, et tout ce que le plateau garde en mémoire d'un tour à l'autre (roue
        // d'initiative déjà jouée, longueur du journal déjà animée, rubrique de commandes
        // ouverte) doit repartir de zéro avec elle.
        <Board key={conn.state.id} conn={conn} />
      ) : screen === 'decks' && !conn.resuming ? (
        <DeckBuilder onBack={() => setScreen('lobby')} initialView={deckBuilderView} />
      ) : (
        <Lobby
          conn={conn}
          onManageDecks={() => openDeckBuilder('list')}
          onCreateDeck={() => openDeckBuilder('new')}
          onImportDeck={() => openDeckBuilder('import')}
        />
      )}
    </HoverCardProvider>
  );
}
