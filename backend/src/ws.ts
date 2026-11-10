import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { URL } from "url";
import { verifyAccessToken, type JwtPayload } from "./lib/jwt";
import { prisma } from "./lib/prisma";
import { redisSub, queueChannel } from "./lib/redis";
import { assertDoctorAccess } from "./lib/scope";

const channelSockets = new Map<string, Set<WebSocket>>();

redisSub.on("message", (channel: string, message: string) => {
  const sockets = channelSockets.get(channel);
  if (!sockets) return;
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
});

function subscribe(doctorId: string, socket: WebSocket): void {
  const channel = queueChannel(doctorId);
  let sockets = channelSockets.get(channel);
  if (!sockets) {
    sockets = new Set();
    channelSockets.set(channel, sockets);
    redisSub.subscribe(channel).catch((err) => console.error("redis subscribe failed", err));
  }
  sockets.add(socket);
}

function unsubscribe(doctorId: string, socket: WebSocket): void {
  const channel = queueChannel(doctorId);
  const sockets = channelSockets.get(channel);
  if (!sockets) return;
  sockets.delete(socket);
  if (sockets.size === 0) {
    channelSockets.delete(channel);
    redisSub.unsubscribe(channel).catch((err) => console.error("redis unsubscribe failed", err));
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
      where: { patientId: auth.profileId, doctorId: requestedDoctorId, status: { not: "CANCELLED" } },
    });
    if (!appointment) throw new Error("No appointment with this doctor");
    return requestedDoctorId;
  }

  throw new Error("Role not allowed on this socket");
}

export function attachWebSocketServer(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", async (socket, request) => {
    const url = new URL(request.url ?? "", "http://localhost");
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
