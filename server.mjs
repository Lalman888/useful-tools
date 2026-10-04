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

/* ---------------------------- live text relay ----------------------------- */

/**
 * Live text sessions. One sharer types; everybody holding the link watches.
 *
 * The relay keeps only what it needs to fan a message out: who is in the room
 * and the latest text, so somebody arriving mid-sentence sees the current state
 * rather than waiting for the next keystroke. Durable storage is the Next API's
 * job, and the sharer's browser writes a snapshot there on its own schedule —
 * this process never decides where a session lives or whether a token is good.
 */
const textRooms = new Map(); // id -> { host: WebSocket|null, watchers: Set, text: string, touchedAt: number }

const TEXT_ROOM_TTL_MS = 26 * 60 * 60 * 1000; // outlives the 24h default link

function textRoom(id) {
  let room = textRooms.get(id);
  if (!room) {
    room = { host: null, watchers: new Set(), text: "", touchedAt: Date.now() };
    textRooms.set(id, room);
  }
  room.touchedAt = Date.now();
  return room;
}

function watcherCount(room) {
  return room.watchers.size;
}

function announceWatchers(room) {
  if (room.host) send(room.host, { type: "watchers", count: watcherCount(room) });
}

function leaveTextRoom(socket) {
  const id = socket.textId;
  if (!id) return;
  const room = textRooms.get(id);
  socket.textId = null;
  if (!room) return;

  if (room.host === socket) {
    room.host = null;
    // Watchers keep the last text on screen; they are told the sharer went
    // away rather than being left to wonder why it stopped updating.
    for (const watcher of room.watchers) send(watcher, { type: "host-left" });
  } else {
    room.watchers.delete(socket);
    announceWatchers(room);
  }
  if (!room.host && room.watchers.size === 0) textRooms.delete(id);
}

/**
 * Checks an edit token against the session store, by asking the API in this
 * same process. Loopback, and only once per sharer per connection.
 */
async function verifyTextToken(id, token) {
  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/text/${encodeURIComponent(id)}/verify?token=${encodeURIComponent(token)}`
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

const ID_RE = /^[0-9abcdefghijkmnpqrstuvwxyz]{16}$/;

async function handleTextMessage(socket, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return send(socket, { type: "error", error: "Malformed message." });
  }

  switch (message.type) {
    case "host": {
      const id = String(message.id ?? "");
      if (!ID_RE.test(id)) return send(socket, { type: "error", error: "Unknown session." });
      const verified = await verifyTextToken(id, String(message.token ?? ""));
      if (!verified?.ok) {
        return send(socket, { type: "error", error: "Not your session." });
      }
      leaveTextRoom(socket);
      const room = textRoom(id);
      // A second connection claiming the same session takes over — the usual
      // cause is the sharer reloading the page, and refusing would strand them.
      if (room.host && room.host !== socket) send(room.host, { type: "taken-over" });
      room.host = socket;
      if (!room.text) room.text = verified.text ?? "";
      socket.textId = id;
      send(socket, { type: "hosting", watchers: watcherCount(room) });
      break;
    }
    case "watch": {
      const id = String(message.id ?? "");
      if (!ID_RE.test(id)) return send(socket, { type: "error", error: "Unknown session." });
      leaveTextRoom(socket);
      const room = textRoom(id);
      room.watchers.add(socket);
      socket.textId = id;
      // Send what the room already holds, so a viewer who joins mid-session is
      // not staring at an empty screen until the next keystroke.
      send(socket, { type: "text", text: room.text, live: Boolean(room.host) });
      announceWatchers(room);
      break;
    }
    case "update": {
      const room = textRooms.get(socket.textId);
      // Only the socket that proved it holds the edit token may write; a
      // watcher sending this is ignored rather than trusted.
      if (!room || room.host !== socket) return;
      const text = String(message.text ?? "");
      room.text = text;
      room.touchedAt = Date.now();
      for (const watcher of room.watchers) send(watcher, { type: "text", text, live: true });
      break;
    }
    case "stop": {
      const room = textRooms.get(socket.textId);
      if (!room || room.host !== socket) return;
      for (const watcher of room.watchers) send(watcher, { type: "stopped" });
      room.text = "";
      break;
    }
    case "bye": {
      leaveTextRoom(socket);
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

// The cap also bounds a live text update, which is why MAX_SHARED_TEXT must
// stay comfortably below it.
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

const CHANNELS = { "/ws/p2p": "p2p", "/ws/text": "text" };

server.on("upgrade", (request, socket, head) => {
  const { pathname } = parse(request.url);
  const channel = CHANNELS[pathname];
  if (!channel) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    ws.channel = channel;
    wss.emit("connection", ws);
  });
});

wss.on("connection", (socket) => {
  socket.roomCode = null;
  socket.textId = null;
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });
  socket.on("message", (data) => {
    if (socket.channel === "text") {
      // Async, and a rejection here must not take the process down.
      void handleTextMessage(socket, data.toString()).catch(() => {
        send(socket, { type: "error", error: "Could not handle that." });
      });
    } else {
      handleMessage(socket, data.toString());
    }
  });
  const cleanUp = () => {
    leaveRoom(socket);
    leaveTextRoom(socket);
  };
  socket.on("close", cleanUp);
  socket.on("error", cleanUp);
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
  // Text rooms are held open by whoever is still connected; drop the ones
  // nobody has touched, so an abandoned session cannot pin its text in memory.
  const textCutoff = Date.now() - TEXT_ROOM_TTL_MS;
  for (const [id, room] of textRooms) {
    if (room.touchedAt < textCutoff && !room.host && room.watchers.size === 0) {
      textRooms.delete(id);
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
