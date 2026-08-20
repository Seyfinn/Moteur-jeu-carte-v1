import { useGameConnection } from './net/useGameConnection';
import { Lobby } from './components/Lobby';
import { Board } from './components/Board';
import { HoverCardProvider } from './components/HoverCard';

export default function App() {
  const conn = useGameConnection();

  return (
    <HoverCardProvider>
      {conn.state && conn.you ? <Board conn={conn} /> : <Lobby conn={conn} />}
    </HoverCardProvider>
  );
}
