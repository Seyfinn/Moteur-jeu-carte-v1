import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { registerDemoCards, type ClientMessage, type PlayerId } from 'engine';
import { generateRoomCode, Room } from './room.js';

registerDemoCards();

const PORT = Number(process.env.PORT ?? 8787);

const rooms = new Map<string, Room>();
const connections = new Map<WebSocket, { roomCode: string; playerId: PlayerId }>();

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

async function serveStatic(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<boolean> {
  if (!existsSync(webDist)) return false;
  const url = new URL(req.url ?? '/', 'http://localhost');
  let filePath = path.join(webDist, decodeURIComponent(url.pathname));
  const info = await stat(filePath).catch(() => null);
  if (!info || info.isDirectory()) {
    filePath = path.join(webDist, 'index.html');
  }
  const finalInfo = await stat(filePath).catch(() => null);
  if (!finalInfo) return false;
  res.writeHead(200, { 'content-type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
  return true;
}

const httpServer = createServer((req, res) => {
  serveStatic(req, res).then((served) => {
    if (served) return;
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Card game engine server is running.\n');
  });
});

const wss = new WebSocketServer({ server: httpServer });

function sendError(socket: WebSocket, message: string): void {
  socket.send(JSON.stringify({ type: 'error', message }));
}

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      sendError(socket, 'Malformed message');
      return;
    }

    try {
      handleMessage(socket, message);
    } catch (err) {
      sendError(socket, `Server error: ${(err as Error).message}`);
    }
  });

  socket.on('close', () => {
    const conn = connections.get(socket);
    if (!conn) return;
    connections.delete(socket);
    const room = rooms.get(conn.roomCode);
    room?.removePlayer(conn.playerId);
  });
});

function handleMessage(socket: WebSocket, message: ClientMessage): void {
  switch (message.type) {
    case 'create-room': {
      let code = generateRoomCode();
      while (rooms.has(code)) code = generateRoomCode();
      const room = new Room(code);
      rooms.set(code, room);
      const playerId = room.addPlayer(socket, message.playerName);
      connections.set(socket, { roomCode: code, playerId });
      socket.send(JSON.stringify({ type: 'room-created', roomCode: code, you: playerId }));
      return;
    }
    case 'join-room': {
      const room = rooms.get(message.roomCode.toUpperCase());
      if (!room) {
        sendError(socket, `Room "${message.roomCode}" not found`);
        return;
      }
      if (room.isFull) {
        sendError(socket, 'Room is already full');
        return;
      }
      const playerId = room.addPlayer(socket, message.playerName);
      connections.set(socket, { roomCode: room.code, playerId });
      socket.send(JSON.stringify({ type: 'joined', roomCode: room.code, you: playerId }));
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

httpServer.listen(PORT, () => {
  console.log(`Card game server listening on http://localhost:${PORT}`);
});
