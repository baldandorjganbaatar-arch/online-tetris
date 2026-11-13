"use strict";

const http = require("http");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const MAX_PLAYERS = 10;
const HEARTBEAT_MS = 25000;
const clients = new Map(); // ws -> { id, name, roomId, alive }
const rooms = new Map();

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, service: "online-tetris", players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0) }));
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Online Tetris WebSocket server is running.\n");
});

const wss = new WebSocketServer({ server, path: "/ws" });

function send(ws, type, data = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
}
function broadcast(room, type, data = {}, except = null) {
  for (const ws of room.players.values()) if (ws !== except) send(ws, type, data);
  for (const ws of room.waiting.values()) if (ws !== except) send(ws, type, data);
}
function publicRoom(room) {
  return {
    roomId: room.id,
    maxPlayers: MAX_PLAYERS,
    phase: room.phase,
    hostId: room.hostId,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, connected: true,
      ready: room.ready.has(p.id), rematch: room.rematch.has(p.id)
    })),
    waiting: [...room.waiting.values()].map(p => ({ id: p.id, name: p.name })),
    state: room.state
  };
}
function emitRoom(room) {
  broadcast(room, "room:update", { room: publicRoom(room) });
}
function getRoom(id = "global") {
  let room = rooms.get(id);
  if (!room) {
    room = {
      id, phase: "lobby", hostId: null,
      players: new Map(), waiting: new Map(),
      ready: new Set(), rematch: new Set(),
      state: null, updatedAt: Date.now()
    };
    rooms.set(id, room);
  }
  return room;
}
function assignHost(room) {
  if (room.hostId && room.players.has(room.hostId)) return;
  room.hostId = room.players.keys().next().value || null;
  if (room.hostId) {
    const ws = [...room.players.entries()].find(([, p]) => p.id === room.hostId)?.[0];
    if (ws) send(ws, "host:assigned", { hostId: room.hostId, state: room.state });
  }
}
function promoteWaiting(room) {
  while (room.waiting.size && room.players.size < MAX_PLAYERS) {
    const [ws, p] = room.waiting.entries().next().value;
    room.waiting.delete(ws);
    room.players.set(ws, p);
    send(ws, "lobby:joined", { playerId: p.id, hostId: room.hostId, room: publicRoom(room) });
  }
}
function removeClient(ws) {
  const client = clients.get(ws);
  if (!client) return;
  clients.delete(ws);
  const room = rooms.get(client.roomId);
  if (!room) return;
  if (room.waiting.has(ws)) room.waiting.delete(ws);
  if (room.players.has(ws)) {
    const wasHost = room.hostId === client.id;
    room.players.delete(ws);
    room.ready.delete(client.id);
    room.rematch.delete(client.id);
    if (wasHost) assignHost(room);
  }
  if (!room.players.size && !room.waiting.size) {
    rooms.delete(room.id);
    return;
  }
  if (room.phase === "playing" && room.players.size === 0) room.phase = "lobby";
  emitRoom(room);
}

wss.on("connection", (ws) => {
  const id = crypto.randomUUID();
  const client = { id, name: "Player", roomId: "global", alive: true };
  clients.set(ws, client);
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  send(ws, "connected", { clientId: id, maxPlayers: MAX_PLAYERS });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, "error", { message: "Invalid JSON" }); }
    const room = getRoom(client.roomId);

    if (msg.type === "join") {
      if (client.roomJoined) return send(ws, "error", { message: "Already joined" });
      const name = String(msg.name || "Player").trim().slice(0, 24) || "Player";
      client.name = name;
      client.roomJoined = true;
      const player = { id, name };
      if (room.phase === "playing" && room.players.size >= MAX_PLAYERS) {
        return send(ws, "error", { message: "Одоогийн тоглолт болон дараалал дүүрсэн." });
      }
      if (room.phase === "playing") {
        room.waiting.set(ws, player);
        clients.get(ws).waiting = true;
        send(ws, "lobby:waiting", { playerId: id, message: "Дараагийн тоглолтод бүртгэгдлээ." });
      } else if (room.players.size < MAX_PLAYERS) {
        room.players.set(ws, player);
        if (!room.hostId) assignHost(room);
        send(ws, "lobby:joined", { playerId: id, hostId: room.hostId, room: publicRoom(room) });
      } else {
        return send(ws, "error", { message: "Нийтлэг тоглолт 10 хүнээр дүүрсэн." });
      }
      emitRoom(room);
      return;
    }

    if (!client.roomJoined) return send(ws, "error", { message: "Join the lobby first." });

    if (msg.type === "ready") {
      if (room.phase !== "lobby" && room.phase !== "finished") return;
      room.ready.add(id);
      emitRoom(room);
      if (room.players.size >= 2 && [...room.players.values()].every(p => room.ready.has(p.id))) {
        room.phase = "countdown";
        broadcast(room, "game:countdown", { seconds: 3 });
        emitRoom(room);
      }
      return;
    }

    if (msg.type === "game:start") {
      if (id !== room.hostId) return send(ws, "error", { message: "Only host can start the round." });
      room.phase = "playing";
      room.ready.clear();
      room.rematch.clear();
      room.state = msg.state ?? null;
      broadcast(room, "game:start", { state: room.state });
      emitRoom(room);
      return;
    }

    if (msg.type === "game:state") {
      if (id !== room.hostId || room.phase !== "playing") return;
      room.state = msg.state ?? null;
      broadcast(room, "game:state", { state: room.state }, ws);
      return;
    }

    if (msg.type === "game:action") {
      if (room.phase !== "playing") return;
      // Relay player input to the current host; the server controls membership and host identity.
      const hostSocket = [...room.players.entries()].find(([, p]) => p.id === room.hostId)?.[0];
      if (hostSocket) send(hostSocket, "game:action", { playerId: id, action: String(msg.action || "") });
      return;
    }

    if (msg.type === "game:finished") {
      if (id !== room.hostId) return;
      room.phase = "finished";
      room.state = msg.state ?? room.state;
      broadcast(room, "game:finished", { state: room.state, results: msg.results || [] });
      emitRoom(room);
      return;
    }

    if (msg.type === "rematch") {
      if (room.phase !== "finished") return;
      room.rematch.add(id);
      emitRoom(room);
      if (room.players.size >= 2 && [...room.players.values()].every(p => room.rematch.has(p.id))) {
        room.phase = "lobby";
        room.ready.clear();
        room.rematch.clear();
        room.state = null;
        promoteWaiting(room);
        broadcast(room, "game:rematch");
        emitRoom(room);
      }
      return;
    }

    if (msg.type === "chat") {
      const text = String(msg.text || "").trim().slice(0, 180);
      if (text) broadcast(room, "chat", { playerId: id, name: client.name, text, at: Date.now() });
      return;
    }

    if (msg.type === "ping") send(ws, "pong", { at: Date.now() });
  });

  ws.on("close", () => removeClient(ws));
  ws.on("error", () => removeClient(ws));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Online Tetris server listening on ${PORT}`);
});

process.on("SIGTERM", () => {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, "Server shutting down");
  server.close(() => process.exit(0));
});
