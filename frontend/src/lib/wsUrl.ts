const raw = import.meta.env.VITE_WS_URL ?? "ws://localhost:4000/ws";

/** Websocket base URL; a path like "/ws" resolves against the current page (ws/wss to match http/https). */
export const WS_URL = raw.startsWith("/")
  ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${raw}`
  : raw;
