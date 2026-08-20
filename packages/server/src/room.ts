import type { WebSocket } from 'ws';
import { DEMO_ROSTER, Match, getPlayerView, type PlayerId, type ServerMessage } from 'engine';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid ambiguity

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 2; i++) {
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
  private sockets: Partial<Record<PlayerId, WebSocket>> = {};
  private playerNames: Partial<Record<PlayerId, string>> = {};
  private match?: Match;
  private unsubscribe?: () => void;

  constructor(code: string) {
    this.code = code;
  }

  get isFull(): boolean {
    return Boolean(this.sockets.p1 && this.sockets.p2);
  }

  addPlayer(socket: WebSocket, playerName: string): PlayerId {
    const playerId: PlayerId = this.sockets.p1 ? 'p2' : 'p1';
    this.sockets[playerId] = socket;
    this.playerNames[playerId] = playerName || playerId;

    if (this.isFull && !this.match) {
      this.startMatch();
    } else if (!this.isFull) {
      send(socket, { type: 'waiting-for-opponent' });
    }
    return playerId;
  }

  removePlayer(playerId: PlayerId): void {
    delete this.sockets[playerId];
    const opponent = playerId === 'p1' ? this.sockets.p2 : this.sockets.p1;
    if (opponent) send(opponent, { type: 'opponent-disconnected' });
  }

  private startMatch(): void {
    this.match = Match.create({
      p1Name: this.playerNames.p1 ?? 'Joueur 1',
      p2Name: this.playerNames.p2 ?? 'Joueur 2',
      p1Roster: DEMO_ROSTER,
      p2Roster: DEMO_ROSTER,
    });
    this.unsubscribe = this.match.onChange(() => this.broadcastState());
    this.broadcastState();
  }

  private broadcastState(): void {
    if (!this.match) return;
    for (const playerId of ['p1', 'p2'] as PlayerId[]) {
      const socket = this.sockets[playerId];
      if (!socket) continue;
      const view = getPlayerView(this.match.state, playerId);
      send(socket, { type: 'state', state: view, you: playerId });
    }
  }

  handleAction(playerId: PlayerId, action: Parameters<Match['applyAction']>[1]): void {
    if (!this.match) return;
    const result = this.match.applyAction(playerId, action);
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
    this.unsubscribe?.();
  }
}
