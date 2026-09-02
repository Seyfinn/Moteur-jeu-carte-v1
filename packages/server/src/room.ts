import type { WebSocket } from 'ws';
import {
  DEMO_STARTER_DECK,
  Match,
  createRng,
  defaultChoiceAnswer,
  drawRandomPools,
  getPlayerView,
  validateDraftedRoster,
  type DraftPool,
  type GameMode,
  type PlayerId,
  type RoomSummary,
  type RosterConfig,
  type ServerMessage,
} from 'engine';
import { saveGameHistory } from './supabase.js';

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
  /** Création du salon -- affichée dans la liste des salons ouverts (« en attente depuis... »). */
  readonly createdAt = Date.now();
  /** Wall-clock of the last time a socket was attached/detached -- used to reap abandoned rooms. */
  lastActivityAt = Date.now();
  private sockets: Partial<Record<PlayerId, WebSocket>> = {};
  private playerNames: Partial<Record<PlayerId, string>> = {};
  private playerRosters: Partial<Record<PlayerId, RosterConfig>> = {};
  /**
   * Mode du salon, fixé par celui qui le crée. En 'random', les decks envoyés à la
   * connexion sont ignorés : chacun compose le sien depuis le tirage que le serveur lui
   * attribue, dans une phase de draft qui s'intercale avant le début du match.
   */
  private mode: GameMode = 'normal';
  /** Mode Aléatoire : la réserve tirée pour chaque joueur, et l'équipe qu'il en a tirée. */
  private draftPools: Partial<Record<PlayerId, DraftPool>> = {};
  private draftSubmissions: Partial<Record<PlayerId, RosterConfig>> = {};
  private match?: Match;
  private unsubscribe?: () => void;
  /**
   * Revanches demandées pour la partie en cours. Il en faut une de chaque camp : sans ça,
   * un joueur relancerait la partie sous le nez de l'autre, qui lit encore son résultat.
   * Vidé dès qu'une nouvelle partie démarre.
   */
  private rematchVotes = new Set<PlayerId>();
  private gameSaved = false;

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

  /**
   * Salon proposé dans la liste publique : quelqu'un dedans, une place libre, et rien de
   * commencé. Les deux exclusions comptent autant que la place libre :
   * - un salon dont un joueur s'est déconnecté en pleine partie garde bien un siège vide,
   *   mais ce siège appartient à celui qui l'a quitté (il a son jeton de reprise) ;
   * - un salon abandonné est gardé dix minutes pour permettre une reconnexion, et sans
   *   `isAbandoned` un salon annulé resterait tout ce temps dans la liste, à inviter à
   *   rejoindre un hôte qui n'est plus là.
   */
  get isOpen(): boolean {
    return this.hasSeat && !this.isAbandoned && !this.match && !this.draftPools.p1 && !this.draftPools.p2;
  }

  /** Ce que la liste des salons ouverts affiche. Aucun deck, aucun jeton : rien de secret. */
  get summary(): RoomSummary {
    return {
      code: this.code,
      // Le salon est ouvert, donc il n'a qu'un occupant -- mais lequel des deux sièges
      // n'est pas garanti (l'hôte peut être parti et son adversaire rester seul).
      hostName: this.playerNames.p1 ?? this.playerNames.p2 ?? 'Joueur',
      mode: this.mode,
      createdAt: this.createdAt,
    };
  }

  addPlayer(socket: WebSocket, playerName: string, roster?: RosterConfig, mode?: GameMode): PlayerId {
    const playerId: PlayerId = this.sockets.p1 ? 'p2' : 'p1';
    // Seul le créateur du salon fixe le mode ; celui qui rejoint le subit (il ne peut pas
    // le connaître avant d'entrer, et son deck sera simplement ignoré en Aléatoire).
    if (playerId === 'p1' && mode) this.mode = mode;
    this.sockets[playerId] = socket;
    this.playerNames[playerId] = playerName || playerId;
    this.playerRosters[playerId] = roster;
    this.lastActivityAt = Date.now();
    // Le siège change de main : la revanche demandée par son occupant précédent ne vaut
    // évidemment pas pour le nouveau venu.
    this.rematchVotes.delete(playerId);

    if (this.isFull && !this.match) {
      // Le Mode Pioche n'a pas de phase de sélection : tout sort des piles, la partie
      // démarre directement.
      if (this.mode === 'random') this.startDraft();
      else this.startMatch();
    } else if (this.match) {
      this.sendStateTo(playerId);
    } else if (this.draftPools[playerId]) {
      // Le siège est repris pendant un draft déjà lancé : on lui rend sa réserve.
      this.sendDraftTo(playerId);
    } else {
      send(socket, { type: 'waiting-for-opponent' });
    }
    return playerId;
  }

  /**
   * Mode Aléatoire : deux réserves tirées **indépendamment**, une par joueur. Une même carte
   * peut donc sortir des deux côtés -- ce qui compte est que chacun pioche dans son propre
   * tirage, pas que les tirages soient disjoints (ils ne peuvent pas l'être : 6 + 6 terrains
   * pour 11 terrains dans le jeu).
   */
  private startDraft(): void {
    this.draftSubmissions = {};
    const pools = drawRandomPools(createRng(Date.now() ^ Math.floor(Math.random() * 0xffffffff)));
    this.draftPools = { p1: pools.p1, p2: pools.p2 };
    for (const playerId of ['p1', 'p2'] as PlayerId[]) this.sendDraftTo(playerId);
  }

  private sendDraftTo(playerId: PlayerId): void {
    const socket = this.sockets[playerId];
    const pool = this.draftPools[playerId];
    if (!socket || !pool) return;
    // La réserve d'en face n'est jamais envoyée : chacun ne voit que la sienne.
    send(socket, { type: 'draft-pool', pool, you: playerId });
    // Un joueur qui revient après avoir déjà validé doit retrouver son écran d'attente.
    for (const id of ['p1', 'p2'] as PlayerId[]) {
      if (this.draftSubmissions[id]) send(socket, { type: 'draft-submitted', by: id });
    }
  }

  /**
   * Équipe composée depuis le tirage. Revalidée intégralement côté serveur : le client
   * pourrait très bien annoncer un deck qu'il n'a pas tiré.
   */
  handleSubmitDraft(playerId: PlayerId, roster: RosterConfig): void {
    const socket = this.sockets[playerId];
    const pool = this.draftPools[playerId];
    if (!pool || this.match) {
      if (socket) send(socket, { type: 'error', message: "Aucune sélection en cours." });
      return;
    }
    const validation = validateDraftedRoster(roster, pool);
    if (!validation.ok) {
      if (socket) send(socket, { type: 'error', message: validation.error });
      return;
    }

    this.draftSubmissions[playerId] = roster;
    this.playerRosters[playerId] = roster;
    this.lastActivityAt = Date.now();
    this.broadcast({ type: 'draft-submitted', by: playerId });

    if (this.draftSubmissions.p1 && this.draftSubmissions.p2) this.startMatch();
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
    // Une revanche repasse par ici : la partie précédente laisse derrière elle son
    // abonnement et, si elle s'est terminée sur un choix en attente, son minuteur.
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.clearChoiceTimer();
    this.rematchVotes.clear();
    this.gameSaved = false;
    this.match = Match.create({
      p1Name: this.playerNames.p1 ?? 'Joueur 1',
      p2Name: this.playerNames.p2 ?? 'Joueur 2',
      // En Mode Pioche les rosters ne servent à rien -- Match.create les remplace par les
      // piles -- mais il en faut un valide pour construire l'état initial.
      p1Roster: this.playerRosters.p1 ?? DEMO_STARTER_DECK,
      p2Roster: this.playerRosters.p2 ?? DEMO_STARTER_DECK,
      mode: this.mode === 'draw' ? 'draw' : 'standard',
    });
    this.unsubscribe = this.match.onChange(() => {
      this.syncChoiceTimer();
      this.broadcastState();
      this.saveGameIfFinished();
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

  /** Un clic malheureux sur une attaque/ability : voir Match.cancelPendingChoice. */
  handleCancelChoice(playerId: PlayerId): void {
    if (!this.match) return;
    const result = this.match.cancelPendingChoice(playerId);
    if (!result.ok) {
      const socket = this.sockets[playerId];
      if (socket) send(socket, { type: 'error', message: result.error });
    }
  }

  private async saveGameIfFinished(): Promise<void> {
    if (!this.match || this.gameSaved || !this.match.state.result) return;
    this.gameSaved = true;

    const result = this.match.state.result;
    await saveGameHistory(
      this.playerNames.p1 ?? 'Joueur 1',
      this.playerNames.p2 ?? 'Joueur 2',
      result.kind === 'win' ? result.winner : null,
      this.playerRosters.p1,
      this.playerRosters.p2,
      this.match.state.log,
      this.match.state
    );
  }

  /**
   * Revanche : une nouvelle partie dans le même salon, avec les mêmes noms et les mêmes
   * decks. Les deux camps doivent la demander -- la demande du premier est simplement
   * annoncée à l'autre, qui voit « l'adversaire veut rejouer » sur son écran de fin.
   */
  handleRematch(playerId: PlayerId): void {
    const socket = this.sockets[playerId];
    if (!this.match?.state.result) {
      if (socket) send(socket, { type: 'error', message: "La partie n'est pas terminée." });
      return;
    }
    this.rematchVotes.add(playerId);
    this.lastActivityAt = Date.now();
    this.broadcast({ type: 'rematch-requested', by: playerId });
    if (!this.rematchVotes.has('p1') || !this.rematchVotes.has('p2')) return;

    // En Mode Aléatoire, une revanche rejoue tout depuis le début : nouveau tirage et
    // nouveau draft, pas une reprise des équipes précédentes.
    if (this.mode === 'random') {
      this.match = undefined;
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.clearChoiceTimer();
      this.rematchVotes.clear();
      this.startDraft();
      return;
    }
    this.startMatch();
  }

  private broadcast(message: ServerMessage): void {
    for (const id of ['p1', 'p2'] as PlayerId[]) {
      const socket = this.sockets[id];
      if (socket) send(socket, message);
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
