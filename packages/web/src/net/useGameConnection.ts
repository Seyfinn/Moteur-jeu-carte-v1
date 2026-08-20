import { useCallback, useRef, useState } from 'react';
import type { ChoiceAnswer, ClientMessage, GameState, PlayerAction, PlayerId, ServerMessage } from 'engine';

const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ??
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

// Free hosting (e.g. Render) spins the server down after inactivity; the first WebSocket
// upgrade after a cold start can fail while the instance is still waking up, so retry a
// few times before surfacing an error.
const MAX_CONNECT_RETRIES = 4;
const RETRY_DELAY_MS = 2000;

export type ConnectionStatus = 'idle' | 'connecting' | 'waiting' | 'playing' | 'error';

export interface GameConnection {
  status: ConnectionStatus;
  roomCode: string | null;
  you: PlayerId | null;
  state: GameState | null;
  error: string | null;
  opponentDisconnected: boolean;
  createRoom(playerName: string): void;
  joinRoom(roomCode: string, playerName: string): void;
  applyAction(action: PlayerAction): void;
  answerChoice(choiceId: string, answer: ChoiceAnswer): void;
  clearError(): void;
}

export function useGameConnection(): GameConnection {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [you, setYou] = useState<PlayerId | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  const ensureSocket = useCallback((onOpen: () => void) => {
    setStatus('connecting');
    setError(null);

    const attemptConnect = (attempt: number) => {
      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;
      let opened = false;

      socket.addEventListener('open', () => {
        opened = true;
        onOpen();
      });

      socket.addEventListener('message', (event) => {
        const message: ServerMessage = JSON.parse(event.data as string);
        switch (message.type) {
          case 'room-created':
            setRoomCode(message.roomCode);
            setYou(message.you);
            setStatus('waiting');
            break;
          case 'joined':
            setRoomCode(message.roomCode);
            setYou(message.you);
            setStatus('playing');
            break;
          case 'waiting-for-opponent':
            setStatus('waiting');
            break;
          case 'state':
            setState(message.state);
            setYou(message.you);
            setStatus('playing');
            setError(null);
            break;
          case 'opponent-disconnected':
            setOpponentDisconnected(true);
            break;
          case 'error':
            setError(message.message);
            break;
        }
      });

      socket.addEventListener('close', () => {
        if (!opened && attempt < MAX_CONNECT_RETRIES) {
          setTimeout(() => attemptConnect(attempt + 1), RETRY_DELAY_MS);
          return;
        }
        if (!opened) setError('Connexion au serveur impossible.');
        setStatus((prev) => (prev === 'playing' ? prev : 'error'));
      });
    };

    attemptConnect(0);
  }, []);

  const send = useCallback((message: ClientMessage) => {
    socketRef.current?.send(JSON.stringify(message));
  }, []);

  const createRoom = useCallback(
    (playerName: string) => {
      ensureSocket(() => send({ type: 'create-room', playerName }));
    },
    [ensureSocket, send]
  );

  const joinRoom = useCallback(
    (code: string, playerName: string) => {
      ensureSocket(() => send({ type: 'join-room', roomCode: code, playerName }));
    },
    [ensureSocket, send]
  );

  const applyAction = useCallback((action: PlayerAction) => send({ type: 'action', action }), [send]);
  const answerChoice = useCallback(
    (choiceId: string, answer: ChoiceAnswer) => send({ type: 'answer-choice', choiceId, answer }),
    [send]
  );
  const clearError = useCallback(() => setError(null), []);

  return {
    status,
    roomCode,
    you,
    state,
    error,
    opponentDisconnected,
    createRoom,
    joinRoom,
    applyAction,
    answerChoice,
    clearError,
  };
}
