import type { WebSocket } from 'ws';
import {
  DEMO_STARTER_DECK,
  Match,
  defaultChoiceAnswer,
  getPlayerView,
  type PlayerId,
  type RosterConfig,
  type ServerMessage,
} from 'engine';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid ambiguity
const CODE_LENGTH = 2;

/**
 * How long a prompt may sit unanswered before the server answers it with the engine's
 * neutral default. Without it, one player closing their tab mid-choice freezes the match
 * for the other one permanently.
 */
export const CHOICE_TIMEOUT_MS = Number(process.env.CHOICE_TIMEOUT_MS ?? 120_000);

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

export class Room {
  readonly code: string;
  /** Wall-clock of the last time a socket was attached/detached -- used to reap abandoned rooms. */
  lastActivityAt = Date.now();
  private sockets: Partial<Record<PlayerId, WebSocket>> = {};
  private playerNames: Partial<Record<PlayerId, string>> = {};
  private playerRosters: Partial<Record<PlayerId, RosterConfig>> = {};
  private match?: Match;
  private unsubscribe?: () => void;

  /** The prompt currently on the clock, and the timer that will auto-answer it. */
  private choiceTimer?: ReturnType<typeof setTimeout>;
  private timedChoiceId?: string;
  private choiceDeadline?: number;

  constructor(code: string) {
    this.code = code;
  }

  get isFull(): boolean {
    return Boolean(this.sockets.p1 && this.sockets.p2);
  }

  /** True once both seats are free -- the room is finished and can be reaped. */
  get isAbandoned(): boolean {
    return !this.sockets.p1 && !this.sockets.p2;
  }

  get hasSeat(): boolean {
    return !this.sockets.p1 || !this.sockets.p2;
  }

  addPlayer(socket: WebSocket, playerName: string, roster?: RosterConfig): PlayerId {
    const playerId: PlayerId = this.sockets.p1 ? 'p2' : 'p1';
    this.sockets[playerId] = socket;
    this.playerNames[playerId] = playerName || playerId;
    this.playerRosters[playerId] = roster;
    this.lastActivityAt = Date.now();

    if (this.isFull && !this.match) {
      this.startMatch();
    } else if (this.match) {
      this.sendStateTo(playerId);
    } else {
      send(socket, { type: 'waiting-for-opponent' });
    }
    return playerId;
  }

  /**
   * Reclaims a specific seat (page reload, dropped connection). Any socket still sitting
   * on that seat is closed first: on a reload the browser's old socket often hasn't
   * finished closing yet, and refusing would make the common case fail.
   */
  resumePlayer(playerId: PlayerId, socket: WebSocket): void {
    const previous = this.sockets[playerId];
    if (previous && previous !== socket) {
      this.sockets[playerId] = undefined;
      previous.close();
    }
    this.sockets[playerId] = socket;
    this.lastActivityAt = Date.now();

    const opponentId: PlayerId = playerId === 'p1' ? 'p2' : 'p1';
    const opponent = this.sockets[opponentId];
    if (opponent) send(opponent, { type: 'opponent-reconnected' });

    if (this.match) {
      this.sendStateTo(playerId);
      this.sendStateTo(opponentId);
    } else {
      send(socket, { type: 'waiting-for-opponent' });
    }
  }

  /** Only detaches when `socket` is still the one holding the seat (a stale close must not evict a fresh tab). */
  detachPlayer(playerId: PlayerId, socket: WebSocket): void {
    if (this.sockets[playerId] !== socket) return;
    delete this.sockets[playerId];
    this.lastActivityAt = Date.now();
    const opponent = playerId === 'p1' ? this.sockets.p2 : this.sockets.p1;
    if (opponent) send(opponent, { type: 'opponent-disconnected' });
  }

  private startMatch(): void {
    this.match = Match.create({
      p1Name: this.playerNames.p1 ?? 'Joueur 1',
      p2Name: this.playerNames.p2 ?? 'Joueur 2',
      p1Roster: this.playerRosters.p1 ?? DEMO_STARTER_DECK,
      p2Roster: this.playerRosters.p2 ?? DEMO_STARTER_DECK,
    });
    this.unsubscribe = this.match.onChange(() => {
      this.syncChoiceTimer();
      this.broadcastState();
    });
    this.syncChoiceTimer();
    this.broadcastState();
  }

  /**
   * Keeps exactly one timer armed for the prompt currently on screen: (re)armed when a
   * new choice appears, cleared as soon as it is answered.
   */
  private syncChoiceTimer(): void {
    const pending = this.match?.state.pendingChoice;
    if (!pending) {
      this.clearChoiceTimer();
      return;
    }
    if (this.timedChoiceId === pending.id) return;

    this.clearChoiceTimer();
    this.timedChoiceId = pending.id;
    this.choiceDeadline = Date.now() + CHOICE_TIMEOUT_MS;
    this.choiceTimer = setTimeout(() => this.autoAnswerChoice(), CHOICE_TIMEOUT_MS);
    this.choiceTimer.unref?.();
  }

  private clearChoiceTimer(): void {
    if (this.choiceTimer) clearTimeout(this.choiceTimer);
    this.choiceTimer = undefined;
    this.timedChoiceId = undefined;
    this.choiceDeadline = undefined;
  }

  private autoAnswerChoice(): void {
    const pending = this.match?.state.pendingChoice;
    if (!this.match || !pending || pending.id !== this.timedChoiceId) return;
    this.clearChoiceTimer();
    this.match.answerChoice(pending.playerId, pending.id, defaultChoiceAnswer(pending.spec));
  }

  private sendStateTo(playerId: PlayerId): void {
    if (!this.match) return;
    const socket = this.sockets[playerId];
    if (!socket) return;
    send(socket, {
      type: 'state',
      state: getPlayerView(this.match.state, playerId),
      you: playerId,
      choiceDeadline: this.choiceDeadline,
    });
  }

  private broadcastState(): void {
    if (!this.match) return;
    for (const playerId of ['p1', 'p2'] as PlayerId[]) this.sendStateTo(playerId);
  }

  handleAction(playerId: PlayerId, action: Parameters<Match['applyAction']>[1]): void {
    if (!this.match) return;
    const result = this.match.applyAction(playerId, action);
    if (!result.ok) {
      const socket = this.sockets[playerId];
      if (socket) send(socket, { type: 'error', message: result.error });
    }
  }

  /** Abandon : contrairement à une action, il n'attend ni le tour du joueur ni la fin d'un choix. */
  handleForfeit(playerId: PlayerId): void {
    if (!this.match) return;
    const result = this.match.forfeit(playerId);
    if (!result.ok) {
      const socket = this.sockets[playerId];
      if (socket) send(socket, { type: 'error', message: result.error });
    }
  }

  handleAnswerChoice(playerId: PlayerId, choiceId: string, answer: Parameters<Match['answerChoice']>[2]): void {
    if (!this.match) return;
    const result = this.match.answerChoice(playerId, choiceId, answer);
    if (!result.ok) {
      const socket = this.sockets[playerId];
      if (socket) send(socket, { type: 'error', message: result.error });
    }
  }

  dispose(): void {
    this.clearChoiceTimer();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.match = undefined;
    this.sockets = {};
  }
}
