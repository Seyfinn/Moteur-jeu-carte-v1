import type { ChoiceAnswer, GameState, PlayerId } from './types.js';
import type { PlayerAction, RosterConfig } from './match.js';

/**
 * WebSocket wire protocol between the web client and the server. Lives in
 * the engine package so both `server` and `web` can import the same types
 * without depending on each other.
 */
export type ClientMessage =
  | { type: 'create-room'; playerName: string; roster?: RosterConfig }
  | { type: 'join-room'; roomCode: string; playerName: string; roster?: RosterConfig }
  /** Reclaim a seat after a reload/disconnect, using the token handed out when the seat was taken. */
  | { type: 'resume-session'; sessionToken: string }
  | { type: 'action'; action: PlayerAction }
  /** Abandon : recevable à tout moment, tour de l'adversaire ou choix en attente compris. */
  | { type: 'forfeit' }
  | { type: 'answer-choice'; choiceId: string; answer: ChoiceAnswer };

export type ServerMessage =
  /** `sessionToken` is the credential for `resume-session`; the client persists it. */
  | { type: 'room-created'; roomCode: string; you: PlayerId; sessionToken: string }
  | { type: 'joined'; roomCode: string; you: PlayerId; sessionToken: string }
  | { type: 'waiting-for-opponent' }
  /** `choiceDeadline` (epoch ms) is present while a choice is pending and will be auto-answered. */
  | { type: 'state'; state: GameState; you: PlayerId; choiceDeadline?: number }
  | { type: 'opponent-disconnected' }
  | { type: 'opponent-reconnected' }
  /** A seat the client tried to resume is gone (room reaped, match over and cleaned up...). */
  | { type: 'session-expired' }
  | { type: 'error'; message: string };
