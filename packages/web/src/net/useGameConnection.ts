import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChoiceAnswer,
  ClientMessage,
  DraftPool,
  GameMode,
  GameState,
  PlayerAction,
  PlayerId,
  RosterConfig,
  ServerMessage,
} from 'engine';

const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ??
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

// Free hosting (e.g. Render) spins the server down after inactivity; the first WebSocket
// upgrade after a cold start can fail while the instance is still waking up, so retry a
// few times before surfacing an error.
const MAX_CONNECT_RETRIES = 4;
const RETRY_DELAY_MS = 2000;

/**
 * Seat credential handed out by the server. Reloading the page tears down the socket but
 * not the seat, so it is kept and replayed on mount to walk straight back into the game
 * instead of dropping the player on the lobby with a lost match.
 *
 * `sessionStorage`, not `localStorage`, on purpose: it is scoped to the tab. Testing (or
 * playing) locally means two tabs on the same origin, and a shared credential would have
 * each tab overwrite the other's seat, so a reload would drop you into your opponent's
 * game. The trade-off is that closing the tab loses the seat -- which is the right scope
 * anyway, since a closed tab isn't a reload.
 */
const SESSION_KEY = 'ctg-session-v1';

function readSessionToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null; // private mode / storage disabled -- resume simply won't be available
  }
}

function writeSessionToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** 'drafting' : Mode Aléatoire, entre l'arrivée des deux joueurs et le début du match. */
export type ConnectionStatus = 'idle' | 'connecting' | 'waiting' | 'drafting' | 'playing' | 'error';

export interface GameConnection {
  status: ConnectionStatus;
  roomCode: string | null;
  you: PlayerId | null;
  state: GameState | null;
  error: string | null;
  opponentDisconnected: boolean;
  /** Epoch ms at which the pending choice will be auto-answered by the server, if any. */
  choiceDeadline: number | null;
  /** True while an interrupted session is being reclaimed on page load. */
  resuming: boolean;
  createRoom(playerName: string, roster: RosterConfig, mode?: GameMode): void;
  joinRoom(roomCode: string, playerName: string, roster: RosterConfig): void;
  /** Mode Aléatoire : la réserve tirée pour ce joueur, `null` hors phase de draft. */
  draftPool: DraftPool | null;
  /** Camps ayant déjà validé leur équipe -- pour afficher « en attente de l'adversaire ». */
  draftSubmittedBy: PlayerId[];
  submitDraft(roster: RosterConfig): void;
  /**
   * La dernière équipe composée en Mode Aléatoire. Conservée ici plutôt que dans l'écran
   * de draft, qui est démonté dès que le match démarre -- c'est elle qu'on enregistre
   * dans les decks du joueur une fois la partie finie.
   */
  lastDraftRoster: RosterConfig | null;
  applyAction(action: PlayerAction): void;
  answerChoice(choiceId: string, answer: ChoiceAnswer): void;
  /** Un clic malheureux sur une attaque/ability : n'a d'effet que si le choix en cours est `cancellable`. */
  cancelChoice(): void;
  clearError(): void;
  /** Concedes the match: the opponent wins immediately, whoever's turn it is. */
  forfeit(): void;
  /**
   * Revanche : rejouer dans le même salon avec les mêmes decks. Il en faut une des deux
   * camps -- `rematchVotes` dit qui l'a déjà demandée, pour que l'écran de fin puisse
   * afficher « en attente de l'adversaire ».
   */
  requestRematch(): void;
  rematchVotes: PlayerId[];
  /** Closes the socket and returns to the lobby (used once a game is over). */
  leave(): void;
}

export function useGameConnection(): GameConnection {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [you, setYou] = useState<PlayerId | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [choiceDeadline, setChoiceDeadline] = useState<number | null>(null);
  const [rematchVotes, setRematchVotes] = useState<PlayerId[]>([]);
  const [draftPool, setDraftPool] = useState<DraftPool | null>(null);
  const [draftSubmittedBy, setDraftSubmittedBy] = useState<PlayerId[]>([]);
  const [lastDraftRoster, setLastDraftRoster] = useState<RosterConfig | null>(null);
  const [resuming, setResuming] = useState(() => readSessionToken() !== null);
  const socketRef = useRef<WebSocket | null>(null);

  const ensureSocket = useCallback((onOpen: () => void) => {
    setStatus('connecting');
    setError(null);

    // Every call opens a fresh socket; without closing the previous one, a second
    // "Créer un salon"/"Rejoindre" click would leave an orphaned connection still
    // holding a seat on the server.
    const previous = socketRef.current;
    if (previous && previous.readyState !== WebSocket.CLOSED) {
      previous.onclose = null;
      previous.close();
    }

    const attemptConnect = (attempt: number) => {
      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;
      let opened = false;

      socket.addEventListener('open', () => {
        opened = true;
        onOpen();
      });

      socket.addEventListener('message', (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data as string);
        } catch {
          // Anything that isn't valid JSON isn't ours -- ignore it rather than letting
          // the exception escape the listener and break the connection.
          return;
        }
        switch (message.type) {
          case 'room-created':
            writeSessionToken(message.sessionToken);
            setRoomCode(message.roomCode);
            setYou(message.you);
            setStatus('waiting');
            setResuming(false);
            break;
          case 'joined':
            writeSessionToken(message.sessionToken);
            setRoomCode(message.roomCode);
            setYou(message.you);
            setStatus('playing');
            setResuming(false);
            break;
          case 'waiting-for-opponent':
            setStatus('waiting');
            setResuming(false);
            break;
          case 'draft-pool':
            setDraftPool(message.pool);
            setYou(message.you);
            setStatus('drafting');
            setResuming(false);
            break;
          case 'draft-submitted':
            setDraftSubmittedBy((sent) => (sent.includes(message.by) ? sent : [...sent, message.by]));
            break;
          case 'state':
            setState(message.state);
            setYou(message.you);
            // Le match a démarré : la phase de draft est derrière nous. Une revanche en
            // Mode Aléatoire renverra un nouveau 'draft-pool' et rouvrira l'écran.
            setDraftPool(null);
            setDraftSubmittedBy([]);
            setChoiceDeadline(message.choiceDeadline ?? null);
            setStatus('playing');
            setResuming(false);
            setError(null);
            // Une partie en cours = la revanche précédente a abouti (ou n'a jamais été
            // demandée) : les votes ne valent que pour la partie qu'ils concluent.
            if (!message.state.result) setRematchVotes([]);
            break;
          case 'rematch-requested':
            setRematchVotes((votes) => (votes.includes(message.by) ? votes : [...votes, message.by]));
            break;
          case 'opponent-disconnected':
            setOpponentDisconnected(true);
            break;
          case 'opponent-reconnected':
            setOpponentDisconnected(false);
            break;
          case 'session-expired':
            // The room is gone for good -- drop the stale credential and show the lobby.
            writeSessionToken(null);
            setResuming(false);
            setStatus('idle');
            break;
          case 'error':
            setError(message.message);
            break;
        }
      });

      socket.addEventListener('close', () => {
        // A socket replaced by a newer attempt must not touch shared state any more.
        if (socketRef.current !== socket) return;
        if (!opened && attempt < MAX_CONNECT_RETRIES) {
          setTimeout(() => attemptConnect(attempt + 1), RETRY_DELAY_MS);
          return;
        }
        if (!opened) setError('Connexion au serveur impossible.');
        else setError('Connexion au serveur perdue.');
        setStatus('error');
        // Never leave the lobby stuck behind a "reprise en cours" spinner.
        setResuming(false);
      });
    };

    attemptConnect(0);
  }, []);

  useEffect(
    () => () => {
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    },
    []
  );

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError('Pas de connexion au serveur.');
      return;
    }
    socket.send(JSON.stringify(message));
  }, []);

  const createRoom = useCallback(
    (playerName: string, roster: RosterConfig, mode?: GameMode) => {
      ensureSocket(() => send({ type: 'create-room', playerName, roster, mode }));
    },
    [ensureSocket, send]
  );

  const joinRoom = useCallback(
    (code: string, playerName: string, roster: RosterConfig) => {
      ensureSocket(() => send({ type: 'join-room', roomCode: code, playerName, roster }));
    },
    [ensureSocket, send]
  );

  // If a seat credential survived the reload, walk straight back into the game instead
  // of showing the lobby. Deliberately *not* guarded by a "ran once" ref: React
  // StrictMode mounts, unmounts and remounts in dev, and the unmount cleanup above closes
  // the socket -- a ref that survives the remount would leave the resume permanently
  // half-done. `ensureSocket`/`send` are stable, so this still runs once in production.
  useEffect(() => {
    const token = readSessionToken();
    if (!token) return;
    ensureSocket(() => send({ type: 'resume-session', sessionToken: token }));
  }, [ensureSocket, send]);

  const applyAction = useCallback((action: PlayerAction) => send({ type: 'action', action }), [send]);
  const answerChoice = useCallback(
    (choiceId: string, answer: ChoiceAnswer) => send({ type: 'answer-choice', choiceId, answer }),
    [send]
  );
  const cancelChoice = useCallback(() => send({ type: 'cancel-choice' }), [send]);
  const clearError = useCallback(() => setError(null), []);
  // Deliberately keeps the socket open: the server ends the match and both sides get the
  // result screen from the state broadcast, exactly like a game won on the board.
  const forfeit = useCallback(() => send({ type: 'forfeit' }), [send]);
  // Comme l'abandon, la revanche garde le salon ouvert : le serveur remet une partie en
  // place dès que les deux camps l'ont demandée et la diffuse comme n'importe quel état.
  const requestRematch = useCallback(() => send({ type: 'rematch' }), [send]);
  const submitDraft = useCallback(
    (roster: RosterConfig) => {
      setLastDraftRoster(roster);
      send({ type: 'submit-draft', roster });
    },
    [send]
  );

  const leave = useCallback(() => {
    writeSessionToken(null);
    const socket = socketRef.current;
    socketRef.current = null;
    socket?.close();
    setChoiceDeadline(null);
    setResuming(false);
    setState(null);
    setYou(null);
    setRoomCode(null);
    setOpponentDisconnected(false);
    setRematchVotes([]);
    setDraftPool(null);
    setDraftSubmittedBy([]);
    setLastDraftRoster(null);
    setError(null);
    setStatus('idle');
  }, []);

  return {
    status,
    roomCode,
    you,
    state,
    error,
    opponentDisconnected,
    createRoom,
    joinRoom,
    draftPool,
    draftSubmittedBy,
    submitDraft,
    lastDraftRoster,
    applyAction,
    answerChoice,
    cancelChoice,
    clearError,
    forfeit,
    requestRematch,
    rematchVotes,
    leave,
    choiceDeadline,
    resuming,
  };
}
