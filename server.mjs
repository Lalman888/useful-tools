import { createServer } from "node:http";
import { parse } from "node:url";
import crypto from "node:crypto";
import next from "next";
import { WebSocketServer } from "ws";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

// Tells the app that this process serves /ws/p2p, so the direct-transfer page
// knows whether peer signalling is actually reachable. It is absent when Next
// is served without this custom server, as on serverless hosting.
process.env.HAS_SIGNALING = "1";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

/* ---------------------------- P2P signalling ----------------------------- */

/**
 * Rooms exist only to introduce two browsers to each other. Once the WebRTC
 * data channel is open the file bytes flow directly between them and never
 * touch this server, which is what makes P2P transfers unbounded in size.
 */
const rooms = new Map(); // code -> { peers: Set<WebSocket>, createdAt: number }

const ROOM_TTL_MS = 60 * 60 * 1000;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I

function makeCode() {
  let code;
  do {
    code = Array.from(
      crypto.randomBytes(6),
      (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function leaveRoom(socket) {
  const code = socket.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  room.peers.delete(socket);
  for (const peer of room.peers) send(peer, { type: "peer-left" });
  if (room.peers.size === 0) rooms.delete(code);
  socket.roomCode = null;
}

function handleMessage(socket, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return send(socket, { type: "error", error: "Malformed message." });
  }

  switch (message.type) {
    case "create": {
      leaveRoom(socket);
      const code = makeCode();
      rooms.set(code, { peers: new Set([socket]), createdAt: Date.now() });
      socket.roomCode = code;
      send(socket, { type: "created", code });
      break;
    }
    case "join": {
      const code = String(message.code ?? "").toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(socket, { type: "error", error: "No transfer with that code." });
      if (room.peers.size >= 2) {
        return send(socket, { type: "error", error: "That transfer already has two people." });
      }
      leaveRoom(socket);
      room.peers.add(socket);
      socket.roomCode = code;
      send(socket, { type: "joined", code });
      for (const peer of room.peers) {
        if (peer !== socket) send(peer, { type: "peer-joined" });
      }
      break;
    }
    case "signal": {
      const room = rooms.get(socket.roomCode);
      if (!room) return;
      // Relay the offer/answer/ICE candidate verbatim to the other peer.
      for (const peer of room.peers) {
        if (peer !== socket) send(peer, { type: "signal", payload: message.payload });
      }
      break;
    }
    case "bye": {
      leaveRoom(socket);
      break;
    }
    default:
      send(socket, { type: "error", error: "Unknown message type." });
  }
}

/* -------------------------------- bootstrap ------------------------------- */

await app.prepare();

const server = createServer((req, res) => {
  handle(req, res, parse(req.url, true));
});

// Uploads and downloads can legitimately run for a long time on large files.
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.timeout = 0;

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

server.on("upgrade", (request, socket, head) => {
  const { pathname } = parse(request.url);
  if (pathname !== "/ws/p2p") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws));
});

wss.on("connection", (socket) => {
  socket.roomCode = null;
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });
  socket.on("message", (data) => handleMessage(socket, data.toString()));
  socket.on("close", () => leaveRoom(socket));
  socket.on("error", () => leaveRoom(socket));
});

// Drop peers that vanished without closing cleanly, and expire stale rooms.
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [code, room] of rooms) {
    if (room.createdAt < cutoff) {
      for (const peer of room.peers) send(peer, { type: "error", error: "Transfer expired." });
      rooms.delete(code);
    }
  }
}, 30_000);
heartbeat.unref();

server.listen(port, hostname, () => {
  console.log(`useful-tools listening on http://${hostname}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(heartbeat);
    server.close(() => process.exit(0));
  });
}
