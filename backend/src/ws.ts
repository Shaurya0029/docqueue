import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { URL } from "url";
import { verifyAccessToken, type JwtPayload } from "./lib/jwt";
import { prisma } from "./lib/prisma";
import { redisSub, queueChannel } from "./lib/redis";
import { assertDoctorAccess } from "./lib/scope";
import { isRevoked } from "./lib/revocation";
import { ownedByAccount } from "./lib/family";
import { DISPLAY_REVOKED_CHANNEL, boardSnapshot, logSafe } from "./lib/displayLinks";
import { boardAccess, pickBoard } from "./routes/display";

/** Signed-in sockets (staff, patients): they get the doctor's queue events as published. */
const channelSockets = new Map<string, Set<WebSocket>>();

/**
 * Waiting-room board sockets (no login, a display link). They never see the
 * raw queue events (those carry appointment ids): on any event for their
 * doctor they get a freshly built, whitelisted board instead.
 */
interface BoardSocket {
  socket: WebSocket;
  linkId: string;
}
const boardSockets = new Map<string, Set<BoardSocket>>(); // channel -> boards

redisSub.subscribe(DISPLAY_REVOKED_CHANNEL).catch((err) => console.error("redis subscribe failed", err));

redisSub.on("message", (channel: string, message: string) => {
  if (channel === DISPLAY_REVOKED_CHANNEL) {
    // A link was regenerated or revoked: its boards go dark at once, on every API instance.
    for (const boards of boardSockets.values()) {
      for (const b of boards) if (b.linkId === message) b.socket.close(4004, "Not found");
    }
    return;
  }
  for (const socket of channelSockets.get(channel) ?? []) {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
  const boards = boardSockets.get(channel);
  if (boards && boards.size > 0) {
    const doctorId = channel.slice(queueChannel("").length);
    boardSnapshot(doctorId)
      .then((board) => {
        const payload = JSON.stringify({ type: "BOARD", board: pickBoard(board) });
        for (const b of boards) if (b.socket.readyState === WebSocket.OPEN) b.socket.send(payload);
      })
      .catch((err) => console.error("board update failed", err instanceof Error ? err.message : err));
  }
});

function listeners(channel: string): number {
  return (channelSockets.get(channel)?.size ?? 0) + (boardSockets.get(channel)?.size ?? 0);
}

function ensureRedis(channel: string): void {
  if (listeners(channel) === 1) redisSub.subscribe(channel).catch((err) => console.error("redis subscribe failed", err));
}

function releaseRedis(channel: string): void {
  if (listeners(channel) === 0) {
    channelSockets.delete(channel);
    boardSockets.delete(channel);
    redisSub.unsubscribe(channel).catch((err) => console.error("redis unsubscribe failed", err));
  }
}

function subscribe(doctorId: string, socket: WebSocket): void {
  const channel = queueChannel(doctorId);
  let sockets = channelSockets.get(channel);
  if (!sockets) channelSockets.set(channel, (sockets = new Set()));
  sockets.add(socket);
  ensureRedis(channel);
}

function unsubscribe(doctorId: string, socket: WebSocket): void {
  const channel = queueChannel(doctorId);
  channelSockets.get(channel)?.delete(socket);
  releaseRedis(channel);
}

function subscribeBoard(doctorId: string, board: BoardSocket): void {
  const channel = queueChannel(doctorId);
  let boards = boardSockets.get(channel);
  if (!boards) boardSockets.set(channel, (boards = new Set()));
  boards.add(board);
  ensureRedis(channel);
}

function unsubscribeBoard(doctorId: string, board: BoardSocket): void {
  const channel = queueChannel(doctorId);
  boardSockets.get(channel)?.delete(board);
  releaseRedis(channel);
}

/** A board connects with ?display=<token>: scoped to that link's one doctor, nothing else. */
async function connectBoard(socket: WebSocket, token: string, ip: string): Promise<void> {
  const access = await boardAccess(token, ip);
  if (access.status !== "ok") {
    socket.close(access.status === "limited" ? 4029 : 4004, access.status === "limited" ? "Too many requests" : "Not found");
    return;
  }
  const { link } = access;
  if (socket.readyState !== WebSocket.OPEN) return; // the TV went away during the lookup
  const board: BoardSocket = { socket, linkId: link.id };
  subscribeBoard(link.doctorId, board);
  socket.on("close", () => unsubscribeBoard(link.doctorId, board));
  try {
    socket.send(JSON.stringify({ type: "BOARD", board: pickBoard(await boardSnapshot(link.doctorId)) }));
  } catch (err) {
    console.error(`display socket ${logSafe(token)} failed`, err instanceof Error ? err.message : err);
    socket.close(1011, "Error");
  }
}

async function resolveAllowedDoctorId(
  auth: JwtPayload,
  requestedDoctorId: string | null
): Promise<string> {
  if (auth.role === "DOCTOR") return auth.profileId;

  if (!requestedDoctorId) throw new Error("doctorId query param required for this role");

  if (auth.role === "ASSOCIATE") {
    await assertDoctorAccess(auth, requestedDoctorId);
    return requestedDoctorId;
  }

  if (auth.role === "PATIENT") {
    const appointment = await prisma.appointment.findFirst({
      // Only while the patient (or a family member they manage) has a live booking with this doctor.
      where: { ...ownedByAccount(auth.profileId), doctorId: requestedDoctorId, status: { in: ["BOOKED", "CHECKED_IN", "IN_CONSULTATION"] } },
    });
    if (!appointment) throw new Error("No appointment with this doctor");
    return requestedDoctorId;
  }

  throw new Error("Role not allowed on this socket");
}

export { resolveAllowedDoctorId };

export function attachWebSocketServer(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", async (socket, request) => {
    const url = new URL(request.url ?? "", "http://localhost");
    const display = url.searchParams.get("display");
    if (display !== null) {
      await connectBoard(socket, display, request.socket.remoteAddress ?? "unknown");
      return;
    }
    const token = url.searchParams.get("token");
    const requestedDoctorId = url.searchParams.get("doctorId");

    if (!token) {
      socket.close(4001, "Missing token");
      return;
    }

    let auth;
    try {
      auth = verifyAccessToken(token);
    } catch {
      socket.close(4001, "Invalid token");
      return;
    }

    if (await isRevoked(auth.userId)) {
      socket.close(4001, "Account no longer active");
      return;
    }

    let doctorId: string;
    try {
      doctorId = await resolveAllowedDoctorId(auth, requestedDoctorId);
    } catch (err) {
      socket.close(4003, err instanceof Error ? err.message : "Forbidden");
      return;
    }

    subscribe(doctorId, socket);
    socket.send(JSON.stringify({ type: "CONNECTED", doctorId }));

    socket.on("close", () => unsubscribe(doctorId, socket));
  });
}
