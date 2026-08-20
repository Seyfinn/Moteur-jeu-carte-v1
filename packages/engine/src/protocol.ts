import type { ChoiceAnswer, GameState, PlayerId } from './types.js';
import type { PlayerAction } from './match.js';

/**
 * WebSocket wire protocol between the web client and the server. Lives in
 * the engine package so both `server` and `web` can import the same types
 * without depending on each other.
 */
export type ClientMessage =
  | { type: 'create-room'; playerName: string }
  | { type: 'join-room'; roomCode: string; playerName: string }
  | { type: 'action'; action: PlayerAction }
  | { type: 'answer-choice'; choiceId: string; answer: ChoiceAnswer };

export type ServerMessage =
  | { type: 'room-created'; roomCode: string; you: PlayerId }
  | { type: 'joined'; roomCode: string; you: PlayerId }
  | { type: 'waiting-for-opponent' }
  | { type: 'state'; state: GameState; you: PlayerId }
  | { type: 'opponent-disconnected' }
  | { type: 'error'; message: string };
