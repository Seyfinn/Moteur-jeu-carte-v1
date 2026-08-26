import { useEffect, useRef, useState } from 'react';
import { useGameConnection } from './net/useGameConnection';
import { Lobby } from './components/Lobby';
import { DeckBuilder } from './components/DeckBuilder';
import { DraftScreen } from './components/DraftScreen';
import { Board } from './components/Board';
import { HoverCardProvider } from './components/HoverCard';
import { loadDecks, saveDecks } from './decks';

/**
 * Mode Aléatoire : l'équipe composée dans le tirage est enregistrée parmi les decks du
 * joueur à la fin de la partie, pour qu'il puisse la retrouver et la rejouer plus tard.
 *
 * Déclenché sur le résultat du match plutôt qu'à la validation du draft, comme demandé --
 * un abandon compte donc aussi (il produit un résultat), mais fermer l'onglet en pleine
 * partie perd le deck. Le `savedForMatch` empêche d'enregistrer deux fois : l'écran de fin
 * reste affiché, et son état est rediffusé à chaque changement.
 */
function useSaveDraftedDeck(conn: ReturnType<typeof useGameConnection>): void {
  const savedForMatch = useRef<string | null>(null);

  useEffect(() => {
    const matchId = conn.state?.id;
    const roster = conn.lastDraftRoster;
    if (!matchId || !conn.state?.result || !roster) return;
    if (savedForMatch.current === matchId) return;
    savedForMatch.current = matchId;

    const stamp = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    saveDecks([
      ...loadDecks(),
      { id: `deck-aleatoire-${matchId}`, name: `Aléatoire — ${stamp}`, ...roster },
    ]);
  }, [conn.state?.id, conn.state?.result, conn.lastDraftRoster]);
}

export default function App() {
  const conn = useGameConnection();
  const [screen, setScreen] = useState<'lobby' | 'decks'>('lobby');
  const [deckBuilderView, setDeckBuilderView] = useState<'list' | 'new' | 'import'>('list');
  useSaveDraftedDeck(conn);

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
      ) : conn.draftPool ? (
        // Mode Aléatoire : la phase de sélection s'intercale entre l'arrivée des deux
        // joueurs et le début du match.
        <DraftScreen conn={conn} pool={conn.draftPool} />
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
