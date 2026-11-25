import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getAccessToken } from "./session";

import { WS_URL } from "./wsUrl";

/**
 * Opens a WebSocket subscribed to one doctor's queue channel and invalidates
 * the relevant TanStack Query caches on every event, so screens refetch and
 * re-render automatically. Reconnects with exponential backoff; if the
 * socket can't stay up, falls back to polling every 10s (PRD section 9).
 */
export function useQueueSocket(doctorId: string | null): { connected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const retryRef = useRef(0);

  useEffect(() => {
    if (!doctorId) return;
    const activeDoctorId = doctorId;
    let cancelled = false;
    let ws: WebSocket | null = null;
    let pollInterval: number | undefined;
    let reconnectTimer: number | undefined;

    function invalidate() {
      queryClient.invalidateQueries({ queryKey: ["doctor-queue", activeDoctorId] });
      queryClient.invalidateQueries({ queryKey: ["queue-status"] });
      // The patient's ticket shows the appointment's own status (Booked, In
      // consultation, Completed), so refresh it too.
      queryClient.invalidateQueries({ queryKey: ["appointment"] });
      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["doctor-appointments", activeDoctorId] });
    }

    function startPolling() {
      if (pollInterval) return;
      pollInterval = window.setInterval(invalidate, 10000);
    }

    function stopPolling() {
      if (pollInterval) {
        window.clearInterval(pollInterval);
        pollInterval = undefined;
      }
    }

    function connect() {
      const token = getAccessToken();
      if (!token || cancelled) return;
      const url = `${WS_URL}?token=${encodeURIComponent(token)}&doctorId=${encodeURIComponent(activeDoctorId)}`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        setConnected(true);
        retryRef.current = 0;
        stopPolling();
      };
      ws.onmessage = () => invalidate();
      ws.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        startPolling();
        retryRef.current += 1;
        const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
        reconnectTimer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    }

    connect();
    return () => {
      cancelled = true;
      ws?.close();
      stopPolling();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
    };
  }, [doctorId, queryClient]);

  return { connected };
}
