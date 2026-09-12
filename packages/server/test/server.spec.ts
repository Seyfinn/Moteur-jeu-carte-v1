import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from 'engine';

/**
 * Tests d'intégration du serveur : un vrai processus (`tsx src/index.ts`), de vraies
 * sockets. Ce qu'on vérifie ici ne se voit nulle part ailleurs -- le moteur a ses tests,
 * le client a ses yeux, mais la couche entre les deux (salons, sièges, reprise d'une
 * connexion coupée, validation de ce qui arrive du réseau) n'avait rien.
 *
 * `SERVER_PORT=0` : le système choisit un port libre, que le serveur annonce dans sa
 * première ligne de sortie -- aucune collision possible avec un serveur de dev déjà lancé.
 * `CHOICE_TIMEOUT_MS` très court : la mise en place (choix de l'actif de départ) se résout
 * toute seule, ce qui amène la partie en phase principale sans avoir à jouer les prompts.
 */

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHOICE_TIMEOUT_MS = 300;

let server: ChildProcess;
let wsUrl: string;

function startServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const tsxCli = path.resolve(serverDir, '../../node_modules/tsx/dist/cli.mjs');
    server = spawn(process.execPath, [tsxCli, 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, SERVER_PORT: '0', CHOICE_TIMEOUT_MS: String(CHOICE_TIMEOUT_MS) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /listening on http:\/\/localhost:(\d+)/.exec(output);
      if (match) resolve(`ws://localhost:${match[1]}`);
    };
    server.stdout!.on('data', onData);
    server.stderr!.on('data', onData);
    server.on('exit', (code) => reject(new Error(`Le serveur s'est arrêté (code ${code}) :\n${output}`)));
    setTimeout(() => reject(new Error(`Serveur muet après 20 s :\n${output}`)), 20_000).unref();
  });
}

/** Une socket client avec une boîte aux lettres : `next()` rend le prochain message d'un type donné. */
class Client {
  readonly socket: WebSocket;
  private inbox: ServerMessage[] = [];
  private waiters: Array<{ predicate: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      const index = this.waiters.findIndex((w) => w.predicate(message));
      if (index !== -1) {
        const [waiter] = this.waiters.splice(index, 1);
        waiter!.resolve(message);
      } else {
        this.inbox.push(message);
      }
    });
  }

  static async open(): Promise<Client> {
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return new Client(socket);
  }

  send(message: ClientMessage | Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message));
  }

  sendRaw(text: string): void {
    this.socket.send(text);
  }

  /** Le prochain message satisfaisant `predicate` (déjà reçu ou à venir), ou une erreur après `timeoutMs`. */
  next<T extends ServerMessage['type']>(type: T, timeoutMs = 5000): Promise<Extract<ServerMessage, { type: T }>> {
    return this.nextWhere((m) => m.type === type, timeoutMs, type) as Promise<Extract<ServerMessage, { type: T }>>;
  }

  nextWhere(predicate: (m: ServerMessage) => boolean, timeoutMs = 5000, label = 'message'): Promise<ServerMessage> {
    const index = this.inbox.findIndex(predicate);
    if (index !== -1) return Promise.resolve(this.inbox.splice(index, 1)[0]!);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i === -1) return;
        this.waiters.splice(i, 1);
        reject(new Error(`Aucun ${label} reçu en ${timeoutMs} ms (reçus : ${this.inbox.map((m) => m.type).join(', ') || 'rien'})`));
      }, timeoutMs).unref();
    });
  }

  /** Vide la boîte des messages d'un type donné, pour ne pas confondre un ancien état avec le prochain. */
  drain(type: ServerMessage['type']): void {
    this.inbox = this.inbox.filter((m) => m.type !== type);
  }

  /** Vrai si un message de ce type est arrivé dans la boîte (sans le consommer). */
  has(type: ServerMessage['type']): boolean {
    return this.inbox.some((m) => m.type === type);
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.readyState === WebSocket.CLOSED) return resolve();
      this.socket.once('close', () => resolve());
      this.socket.close();
    });
  }
}

/** Un salon complet dont la partie a atteint la phase principale (mise en place auto-résolue par le minuteur). */
async function startedMatch(): Promise<{
  p1: Client;
  p2: Client;
  roomCode: string;
  p1Token: string;
  p2Token: string;
  /** Qui a la main au moment où la phase principale s'ouvre (tirage d'initiative). */
  active: 'p1' | 'p2';
}> {
  const p1 = await Client.open();
  p1.send({ type: 'create-room', playerName: 'Alice' });
  const created = await p1.next('room-created');
  const p2 = await Client.open();
  p2.send({ type: 'join-room', roomCode: created.roomCode, playerName: 'Bob' });
  const joined = await p2.next('joined');
  expect(joined.you).toBe('p2');

  // Deux choix d'actif de départ, chacun rendu par le minuteur : on attend l'état qui dit
  // que la partie est en cours.
  const mainFor = (client: Client) =>
    client.nextWhere((m) => m.type === 'state' && m.state.phase === 'main', 10 * CHOICE_TIMEOUT_MS + 3000, 'état en phase principale');
  const [main] = await Promise.all([mainFor(p1), mainFor(p2)]);
  p1.drain('state');
  p2.drain('state');
  const active = main.type === 'state' ? main.state.activePlayerId : 'p1';
  return { p1, p2, roomCode: created.roomCode, p1Token: created.sessionToken, p2Token: joined.sessionToken, active };
}

beforeAll(async () => {
  wsUrl = await startServer();
}, 30_000);

afterAll(() => {
  server?.kill();
});

describe('messages malformés', () => {
  it("un texte qui n'est pas du JSON est refusé proprement, la socket reste ouverte", async () => {
    const c = await Client.open();
    c.sendRaw('{not json');
    const err = await c.next('error');
    expect(err.message).toMatch(/Malformed/);
    c.send({ type: 'nope' });
    expect((await c.next('error')).message).toMatch(/Unsupported or malformed/);
    expect(c.socket.readyState).toBe(WebSocket.OPEN);
    await c.close();
  });

  it("une action d'un `kind` inconnu ou aux champs manquants ne passe pas la validation d'enveloppe", async () => {
    const { p1, p2 } = await startedMatch();
    for (const action of [{ kind: 'explode' }, { kind: 'attack' }, { kind: 'switch', newActiveInstanceId: 42 }, { kind: 'recycle-objects', objectInstanceIds: 'x' }]) {
      p1.send({ type: 'action', action });
      expect((await p1.next('error')).message).toMatch(/Unsupported or malformed/);
    }
    // Le serveur est toujours là : une vraie action passe.
    p1.send({ type: 'forfeit' });
    const over = await p1.nextWhere((m) => m.type === 'state' && Boolean(m.state.result), 5000, 'état final');
    expect(over.type === 'state' && over.state.result?.kind).toBe('win');
    await Promise.all([p1.close(), p2.close()]);
  });

  it("un `mode` de salon inconnu retombe sur le mode normal et un pseudo trop long est tronqué", async () => {
    const c = await Client.open();
    c.send({ type: 'create-room', playerName: 'x'.repeat(200), mode: 'hackmode' });
    const created = await c.next('room-created');
    const res = await fetch(wsUrl.replace('ws://', 'http://') + '/api/rooms');
    const { rooms } = (await res.json()) as { rooms: Array<{ code: string; mode: string; hostName: string }> };
    const room = rooms.find((r) => r.code === created.roomCode);
    expect(room?.mode).toBe('normal');
    expect(room?.hostName).toHaveLength(24);
    await c.close();
  });
});

describe('tour et sièges', () => {
  it("une action du joueur qui n'a pas la main est refusée avec un message, sans toucher à la partie", async () => {
    const { p1, p2, active } = await startedMatch();
    const idle = active === 'p1' ? p2 : p1;
    idle.send({ type: 'action', action: { kind: 'pass' } });
    expect((await idle.next('error')).message).toMatch(/pas votre tour/);
    // Et un choix qui n'est pas le sien non plus.
    idle.send({ type: 'answer-choice', choiceId: 'x', answer: { kind: 'yes-no', value: true } });
    expect((await idle.next('error')).message).toMatch(/Aucun choix en attente/);
    await Promise.all([p1.close(), p2.close()]);
  });

  it('un choix sans réponse est résolu par le serveur au bout du délai, avec une échéance annoncée au client', async () => {
    const p1 = await Client.open();
    p1.send({ type: 'create-room', playerName: 'Alice' });
    const created = await p1.next('room-created');
    const p2 = await Client.open();
    p2.send({ type: 'join-room', roomCode: created.roomCode, playerName: 'Bob' });
    await p2.next('joined');
    const setup = await p1.nextWhere((m) => m.type === 'state' && Boolean(m.state.pendingChoice), 5000, 'état avec choix');
    expect(setup.type === 'state' && typeof setup.choiceDeadline).toBe('number');
    const main = await p1.nextWhere((m) => m.type === 'state' && m.state.phase === 'main', 10 * CHOICE_TIMEOUT_MS + 3000, 'phase principale');
    expect(main.type === 'state' && main.choiceDeadline).toBeUndefined();
    await Promise.all([p1.close(), p2.close()]);
  });

  it('rejoindre par son code un salon dont la partie a commencé est refusé (le siège vide appartient au déconnecté)', async () => {
    const { p1, p2, roomCode } = await startedMatch();
    await p2.close();
    await p1.next('opponent-disconnected');
    const intruder = await Client.open();
    intruder.send({ type: 'join-room', roomCode, playerName: 'Mallory' });
    expect((await intruder.next('error')).message).toMatch(/déjà commencé/);
    await Promise.all([p1.close(), intruder.close()]);
  });

  it("un salon introuvable ou complet est refusé par un `error` SANS fermer la socket, qui reste utilisable", async () => {
    // Contrat sur lequel le client s'appuie : après un refus, c'est à lui de sortir de
    // l'état « connexion » (useGameConnection remet `status` à 'idle' et referme lui-même
    // la socket orpheline) -- le serveur, lui, ne coupe rien.
    const c = await Client.open();
    c.send({ type: 'join-room', roomCode: 'ZZ', playerName: 'Zoé' });
    expect((await c.next('error')).message).toMatch(/introuvable/);
    const { p1, p2, roomCode } = await startedMatch();
    // Salon complet : refus aussi, socket toujours ouverte, et elle peut encore créer un salon.
    c.send({ type: 'join-room', roomCode, playerName: 'Zoé' });
    expect((await c.next('error')).message).toMatch(/complet|commencé/);
    expect(c.socket.readyState).toBe(WebSocket.OPEN);
    c.send({ type: 'create-room', playerName: 'Zoé' });
    await c.next('room-created');
    await Promise.all([c.close(), p1.close(), p2.close()]);
  });

  it('un jeton inconnu reçoit `session-expired`', async () => {
    const c = await Client.open();
    c.send({ type: 'resume-session', sessionToken: 'nope' });
    await c.next('session-expired');
    await c.close();
  });
});

describe('reconnexion', () => {
  it('le joueur coupé reprend SON siège avec son jeton et reçoit son état ; l’adversaire est prévenu dans les deux sens', async () => {
    const { p1, p2, p2Token } = await startedMatch();
    await p2.close();
    await p1.next('opponent-disconnected');

    const p2b = await Client.open();
    p2b.send({ type: 'resume-session', sessionToken: p2Token });
    const joined = await p2b.next('joined');
    expect(joined.you).toBe('p2');
    expect(joined.sessionToken).toBe(p2Token);
    const state = await p2b.next('state');
    expect(state.you).toBe('p2');
    expect(state.state.phase).toBe('main');
    await p1.next('opponent-reconnected');
    await Promise.all([p1.close(), p2b.close()]);
  });

  it("une reprise pendant que l'ancienne socket est encore ouverte (rechargement) éjecte l'ancienne, pas la nouvelle", async () => {
    const { p1, p2, p1Token } = await startedMatch();
    const p1b = await Client.open();
    p1b.send({ type: 'resume-session', sessionToken: p1Token });
    await p1b.next('joined');
    await p1b.next('state');
    // L'ancien onglet est fermé par le serveur...
    await new Promise<void>((resolve) => (p1.socket.readyState === WebSocket.CLOSED ? resolve() : p1.socket.once('close', () => resolve())));
    // ...et sa fermeture ne doit PAS passer pour un départ de p1 : l'adversaire n'est pas prévenu.
    await new Promise((r) => setTimeout(r, 200));
    expect(p2.has('opponent-disconnected')).toBe(false);
    await Promise.all([p1b.close(), p2.close()]);
  });

  it('une reprise en plein draft (Mode Aléatoire) rend sa réserve au joueur, pas un « en attente »', async () => {
    const p1 = await Client.open();
    p1.send({ type: 'create-room', playerName: 'Alice', mode: 'random' });
    const created = await p1.next('room-created');
    const p2 = await Client.open();
    p2.send({ type: 'join-room', roomCode: created.roomCode, playerName: 'Bob' });
    const joined = await p2.next('joined');
    const pool = await p2.next('draft-pool');
    await p2.close();
    const p2b = await Client.open();
    p2b.send({ type: 'resume-session', sessionToken: joined.sessionToken });
    await p2b.next('joined');
    const again = await p2b.next('draft-pool');
    expect(again.pool).toEqual(pool.pool);
    expect(p2b.has('waiting-for-opponent')).toBe(false);
    await Promise.all([p1.close(), p2b.close()]);
  });

  it("celui qui revient apprend que l'adversaire est parti entre-temps", async () => {
    const { p1, p2, p1Token } = await startedMatch();
    await p1.close();
    await p2.next('opponent-disconnected');
    await p2.close();
    const p1b = await Client.open();
    p1b.send({ type: 'resume-session', sessionToken: p1Token });
    await p1b.next('joined');
    await p1b.next('opponent-disconnected');
    await p1b.close();
  });
});

describe('vue joueur', () => {
  it("l'état reçu ne porte ni la graine du hasard, ni la main adverse, ni les options du choix adverse", async () => {
    const p1 = await Client.open();
    p1.send({ type: 'create-room', playerName: 'Alice' });
    const created = await p1.next('room-created');
    const p2 = await Client.open();
    p2.send({ type: 'join-room', roomCode: created.roomCode, playerName: 'Bob' });
    await p2.next('joined');

    // Mise en place : p1 choisit son actif de départ en premier ; p2 reçoit ce même état.
    const p2View = await p2.nextWhere((m) => m.type === 'state' && Boolean(m.state.pendingChoice), 5000, 'état avec choix');
    if (p2View.type !== 'state') throw new Error('unreachable');
    const { state } = p2View;
    expect(state.rng).toEqual({ seed: 0 });
    // La main d'objets de p1 : des ids opaques, aucune instance résolvable.
    for (const id of state.players.p1.unplayedObjectInstanceIds) {
      expect(id).toMatch(/^hidden-object-/);
      expect(state.players.p1.objects[id]).toBeUndefined();
    }
    for (const id of state.players.p1.unplayedTerrainInstanceIds) expect(id).toMatch(/^hidden-terrain-/);
    // Le choix en cours est celui de p1 : p2 sait QUI choisit, mais pas parmi quoi.
    const pending = state.pendingChoice!;
    expect(pending.playerId).toBe('p1');
    expect(pending.cancellable).toBe(false);
    if (pending.spec.kind === 'select-characters' || pending.spec.kind === 'select-option') {
      expect(pending.spec.options).toEqual([]);
    }
    // Alors que p1, lui, a bien ses options.
    const p1View = await p1.nextWhere((m) => m.type === 'state' && m.state.pendingChoice?.playerId === 'p1', 5000, 'état avec choix');
    if (p1View.type !== 'state') throw new Error('unreachable');
    const own = p1View.state.pendingChoice!.spec;
    expect(own.kind === 'select-characters' && own.options.length).toBeGreaterThan(0);
    await Promise.all([p1.close(), p2.close()]);
  });
});
