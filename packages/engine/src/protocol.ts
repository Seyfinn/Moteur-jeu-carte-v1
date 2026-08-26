import type { ChoiceAnswer, GameState, PlayerId } from './types.js';
import type { PlayerAction, RosterConfig } from './match.js';
import type { DraftPool, GameMode } from './draft.js';

/**
 * WebSocket wire protocol between the web client and the server. Lives in
 * the engine package so both `server` and `web` can import the same types
 * without depending on each other.
 */
export type ClientMessage =
  /** `mode` n'est lu qu'à la création : c'est l'hôte qui fixe le mode du salon. En Mode
   *  Aléatoire le `roster` envoyé ici est ignoré, chacun compose depuis son tirage. */
  | { type: 'create-room'; playerName: string; roster?: RosterConfig; mode?: GameMode }
  | { type: 'join-room'; roomCode: string; playerName: string; roster?: RosterConfig }
  /** Mode Aléatoire : le deck composé depuis son tirage. Le serveur revérifie tout. */
  | { type: 'submit-draft'; roster: RosterConfig }
  /** Reclaim a seat after a reload/disconnect, using the token handed out when the seat was taken. */
  | { type: 'resume-session'; sessionToken: string }
  | { type: 'action'; action: PlayerAction }
  /** Abandon : recevable à tout moment, tour de l'adversaire ou choix en attente compris. */
  | { type: 'forfeit' }
  /** Revanche : rejouer dans le même salon, avec les mêmes decks. Il en faut une de chaque camp. */
  | { type: 'rematch' }
  | { type: 'answer-choice'; choiceId: string; answer: ChoiceAnswer };

export type ServerMessage =
  /** `sessionToken` is the credential for `resume-session`; the client persists it. */
  | { type: 'room-created'; roomCode: string; you: PlayerId; sessionToken: string }
  | { type: 'joined'; roomCode: string; you: PlayerId; sessionToken: string }
  | { type: 'waiting-for-opponent' }
  /** Mode Aléatoire : la réserve tirée pour CE joueur (celle d'en face reste secrète). */
  | { type: 'draft-pool'; pool: DraftPool; you: PlayerId }
  /** Un camp a validé son équipe. Les deux = le match démarre. */
  | { type: 'draft-submitted'; by: PlayerId }
  /** `choiceDeadline` (epoch ms) is present while a choice is pending and will be auto-answered. */
  | { type: 'state'; state: GameState; you: PlayerId; choiceDeadline?: number }
  | { type: 'opponent-disconnected' }
  | { type: 'opponent-reconnected' }
  /** A seat the client tried to resume is gone (room reaped, match over and cleaned up...). */
  | { type: 'session-expired' }
  /** Un camp a demandé la revanche. Les deux la demandent = une nouvelle partie démarre. */
  | { type: 'rematch-requested'; by: PlayerId }
  | { type: 'error'; message: string };
