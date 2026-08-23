import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { registerDemoCards, validateRoster, type ClientMessage, type PlayerId, type ServerMessage } from 'engine';
import { randomUUID } from 'node:crypto';
import { generateRoomCode, Room } from './room.js';

registerDemoCards();

/**
 * `PORT` is what hosting platforms (Render, Fly...) inject, so it stays the default.
 * `SERVER_PORT` takes precedence for the case where something else in the toolchain has
 * already claimed `PORT` for the web dev server -- both packages read it otherwise, and
 * they end up fighting over the same port.
 */
const PORT = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 8787);

/** An abandoned room is kept around briefly so a player who dropped can rejoin it. */
const ROOM_TTL_MS = 10 * 60 * 1000;
const ROOM_SWEEP_INTERVAL_MS = 60 * 1000;
/** Two-character codes give ~1000 combinations; refuse cleanly rather than spin forever. */
const MAX_ROOM_CODE_ATTEMPTS = 200;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

const rooms = new Map<string, Room>();
const connections = new Map<WebSocket, { roomCode: string; playerId: PlayerId }>();
/**
 * Seat credentials. Reloading the page kills the socket but not the seat, so the client
 * keeps this token and presents it to reclaim the exact same seat instead of having to
 * re-enter the room code (and risk landing in the other seat).
 */
const sessions = new Map<string, { roomCode: string; playerId: PlayerId }>();

function issueSession(roomCode: string, playerId: PlayerId): string {
  const token = randomUUID();
  sessions.set(token, { roomCode, playerId });
  return token;
}

// packages/server/src/index.ts (or dist/index.js) -> packages/web/dist, same relative depth either way.
const webDist = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Resolves a request path inside webDist, or null if it would escape it (`../`, encoded or not). */
function resolveWithinDist(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const resolved = path.resolve(webDist, `.${path.posix.normalize(`/${decoded}`)}`);
  const root = path.resolve(webDist);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

async function serveStatic(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<boolean> {
  if (!existsSync(webDist)) return false;
  const url = new URL(req.url ?? '/', 'http://localhost');
  const requested = resolveWithinDist(url.pathname);
  if (!requested) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }

  let filePath = requested;
  const info = await stat(filePath).catch(() => null);
  // Unknown path or a directory: fall back to the SPA entry point so client-side
  // routes still resolve.
  if (!info || info.isDirectory()) filePath = path.join(webDist, 'index.html');

  const finalInfo = await stat(filePath).catch(() => null);
  if (!finalInfo) return false;
  res.writeHead(200, { 'content-type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
  return true;
}

const httpServer = createServer((req, res) => {
  serveStatic(req, res)
    .then((served) => {
      if (served) return;
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Card game engine server is running.\n');
    })
    .catch(() => {
      if (res.headersSent) return;
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Internal error');
    });
});

const wss = new WebSocketServer({ server: httpServer });

function sendMessage(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function sendError(socket: WebSocket, message: string): void {
  sendMessage(socket, { type: 'error', message });
}

/**
 * Messages arrive as untrusted JSON: a client (or anything else that can open a socket)
 * can send any shape at all. Validate the envelope here so a malformed payload becomes a
 * clean error instead of an exception deep inside the match.
 */
function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const message = raw as Record<string, unknown>;
  const isString = (value: unknown): value is string => typeof value === 'string';

  switch (message['type']) {
    case 'create-room':
      return isString(message['playerName']) ? (message as unknown as ClientMessage) : null;
    case 'join-room':
      return isString(message['playerName']) && isString(message['roomCode'])
        ? (message as unknown as ClientMessage)
        : null;
    case 'resume-session':
      return isString(message['sessionToken']) ? (message as unknown as ClientMessage) : null;
    case 'action': {
      const action = message['action'];
      if (!action || typeof action !== 'object') return null;
      return isString((action as Record<string, unknown>)['kind']) ? (message as unknown as ClientMessage) : null;
    }
    case 'answer-choice': {
      const answer = message['answer'];
      if (!isString(message['choiceId']) || !answer || typeof answer !== 'object') return null;
      return isString((answer as Record<string, unknown>)['kind']) ? (message as unknown as ClientMessage) : null;
    }
    default:
      return null;
  }
}

interface TrackedSocket extends WebSocket {
  isAlive?: boolean;
}

wss.on('connection', (socket: TrackedSocket) => {
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      sendError(socket, 'Malformed message');
      return;
    }

    const message = parseClientMessage(parsed);
    if (!message) {
      sendError(socket, 'Unsupported or malformed message');
      return;
    }

    try {
      handleMessage(socket, message);
    } catch (err) {
      sendError(socket, `Server error: ${(err as Error).message}`);
    }
  });

  socket.on('error', () => socket.terminate());

  socket.on('close', () => {
    const conn = connections.get(socket);
    if (!conn) return;
    connections.delete(socket);
    const room = rooms.get(conn.roomCode);
    room?.detachPlayer(conn.playerId, socket);
  });
});

function handleMessage(socket: WebSocket, message: ClientMessage): void {
  switch (message.type) {
    case 'create-room': {
      if (connections.has(socket)) return sendError(socket, 'Already in a room');
      if (message.roster) {
        const check = validateRoster(message.roster);
        if (!check.ok) return sendError(socket, check.error);
      }
      let code = generateRoomCode();
      let attempts = 0;
      while (rooms.has(code)) {
        if (++attempts > MAX_ROOM_CODE_ATTEMPTS) {
          return sendError(socket, 'Serveur saturé : aucun code de salon disponible, réessayez plus tard.');
        }
        code = generateRoomCode();
      }
      const room = new Room(code);
      rooms.set(code, room);
      const playerId = room.addPlayer(socket, message.playerName, message.roster);
      connections.set(socket, { roomCode: code, playerId });
      const sessionToken = issueSession(code, playerId);
      sendMessage(socket, { type: 'room-created', roomCode: code, you: playerId, sessionToken });
      return;
    }
    case 'join-room': {
      if (connections.has(socket)) return sendError(socket, 'Already in a room');
      if (message.roster) {
        const check = validateRoster(message.roster);
        if (!check.ok) return sendError(socket, check.error);
      }
      const room = rooms.get(message.roomCode.trim().toUpperCase());
      if (!room) {
        sendError(socket, `Salon "${message.roomCode}" introuvable`);
        return;
      }
      if (room.isFull) {
        sendError(socket, 'Ce salon est déjà complet');
        return;
      }
      const playerId = room.addPlayer(socket, message.playerName, message.roster);
      connections.set(socket, { roomCode: room.code, playerId });
      const sessionToken = issueSession(room.code, playerId);
      sendMessage(socket, { type: 'joined', roomCode: room.code, you: playerId, sessionToken });
      return;
    }
    case 'resume-session': {
      if (connections.has(socket)) return sendError(socket, 'Already in a room');
      const session = sessions.get(message.sessionToken);
      const room = session ? rooms.get(session.roomCode) : undefined;
      if (!session || !room) {
        // The room was reaped (or the server restarted): tell the client to forget the
        // token and go back to the lobby rather than leaving it stuck "connecting".
        sessions.delete(message.sessionToken);
        sendMessage(socket, { type: 'session-expired' });
        return;
      }
      room.resumePlayer(session.playerId, socket);
      connections.set(socket, { roomCode: session.roomCode, playerId: session.playerId });
      sendMessage(socket, {
        type: 'joined',
        roomCode: session.roomCode,
        you: session.playerId,
        sessionToken: message.sessionToken,
      });
      return;
    }
    case 'action': {
      const conn = connections.get(socket);
      if (!conn) return sendError(socket, 'Not in a room');
      rooms.get(conn.roomCode)?.handleAction(conn.playerId, message.action);
      return;
    }
    case 'answer-choice': {
      const conn = connections.get(socket);
      if (!conn) return sendError(socket, 'Not in a room');
      rooms.get(conn.roomCode)?.handleAnswerChoice(conn.playerId, message.choiceId, message.answer);
      return;
    }
  }
}

// Rooms are in-memory and were previously never removed: every finished game leaked its
// full match state, and with only ~1000 possible codes the generator would eventually
// never find a free one.
const roomSweeper = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.isAbandoned && now - room.lastActivityAt > ROOM_TTL_MS) {
      room.dispose();
      rooms.delete(code);
      // The seat credentials die with the room they point at.
      for (const [token, session] of sessions) {
        if (session.roomCode === code) sessions.delete(token);
      }
    }
  }
}, ROOM_SWEEP_INTERVAL_MS);
roomSweeper.unref?.();

// Half-open TCP connections (laptop lid closed, network dropped) never fire 'close', so
// their seat would stay occupied forever. Ping every client and drop the silent ones.
const heartbeat = setInterval(() => {
  for (const client of wss.clients as Set<TrackedSocket>) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, HEARTBEAT_INTERVAL_MS);
heartbeat.unref?.();

httpServer.listen(PORT, () => {
  console.log(`Card game server listening on http://localhost:${PORT}`);
});
