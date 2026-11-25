import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { translate, type Vars } from "../../lib/i18n";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
import { WS_URL } from "../../lib/wsUrl";
/** Poll this often while the live connection is down, and once a minute anyway as a safety net. */
const POLL_DISCONNECTED_MS = 10_000;
const POLL_CONNECTED_MS = 60_000;
/** No update for this long and the board says so, even if the socket looks open. */
const STALE_AFTER_MS = 90_000;

/** Exactly what the API sends: nothing about any patient. */
interface Board {
  clinicName: string;
  doctorName: string;
  state: "SERVING" | "PAUSED" | "NOT_IN";
  nowServing: number | null;
  next: number[];
  updatedAt: string;
}

/** Sets noindex and no-referrer on this page only, and a plain title. */
function usePrivatePageMeta(title: string) {
  useEffect(() => {
    const added = [
      Object.assign(document.createElement("meta"), { name: "robots", content: "noindex, nofollow" }),
      Object.assign(document.createElement("meta"), { name: "referrer", content: "no-referrer" }),
    ];
    added.forEach((m) => document.head.appendChild(m));
    const previous = document.title;
    document.title = title;
    return () => {
      added.forEach((m) => m.remove());
      document.title = previous;
    };
  }, [title]);
}

/** A short two-note chime, made in the browser (no sound file). */
function playChime(ctx: AudioContext) {
  const now = ctx.currentTime;
  [880, 660].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.0001, now + i * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.4, now + i * 0.35 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.35 + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + i * 0.35);
    osc.stop(now + i * 0.35 + 0.65);
  });
}

/**
 * Waiting-room TV board for one doctor, opened by a display link (no login).
 * Live over the WebSocket, polling as a fallback; while the connection is
 * down it says "Reconnecting…" and dims the numbers so an out-of-date board
 * never looks current. ?lang=hi for Hindi, ?theme=light for a light board.
 */
export function DisplayBoardPage() {
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const lang = params.get("lang") === "hi" ? "hi" : "en";
  const light = params.get("theme") === "light";
  const t = useCallback((text: string, vars?: Vars) => translate(lang, text, vars), [lang]);

  const [board, setBoard] = useState<Board | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [live, setLive] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [soundOn, setSoundOn] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const lastServingRef = useRef<number | null | undefined>(undefined);

  usePrivatePageMeta(t("Now serving"));

  const accept = useCallback((next: Board) => {
    setBoard(next);
    setLastUpdated(Date.now());
    const before = lastServingRef.current;
    lastServingRef.current = next.nowServing;
    if (before !== undefined && next.nowServing !== null && next.nowServing !== before && audioRef.current) playChime(audioRef.current);
  }, []);

  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/display/${encodeURIComponent(token)}`, { referrerPolicy: "no-referrer", cache: "no-store" });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) return; // rate-limited or a hiccup: keep showing the last board, marked by its age
      accept(((await res.json()) as { board: Board }).board);
    } catch {
      /* offline: the reconnecting state and the age of the data show it */
    }
  }, [token, accept]);

  // Live updates with automatic reconnect (backoff) and polling while disconnected.
  useEffect(() => {
    if (notFound) return;
    let cancelled = false;
    let ws: WebSocket | null = null;
    let retry = 0;
    let reconnectTimer: number | undefined;
    let pollTimer: number | undefined;

    const schedulePoll = (ms: number) => {
      window.clearInterval(pollTimer);
      pollTimer = window.setInterval(() => void fetchBoard(), ms);
    };

    function connect() {
      if (cancelled) return;
      ws = new WebSocket(`${WS_URL}?display=${encodeURIComponent(token)}`);
      ws.onopen = () => {
        retry = 0;
        setLive(true);
        schedulePoll(POLL_CONNECTED_MS);
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as { type?: string; board?: Board };
          if (msg.type === "BOARD" && msg.board) accept(msg.board);
        } catch {
          /* ignore anything unexpected */
        }
      };
      ws.onclose = (event) => {
        setLive(false);
        if (cancelled) return;
        if (event.code === 4004) {
          setNotFound(true); // revoked or regenerated: this link is dead
          return;
        }
        schedulePoll(POLL_DISCONNECTED_MS);
        void fetchBoard();
        reconnectTimer = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
      };
    }

    const first = window.setTimeout(() => void fetchBoard(), 0);
    schedulePoll(POLL_DISCONNECTED_MS);
    connect();
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearTimeout(reconnectTimer);
      window.clearInterval(pollTimer);
      ws?.close();
    };
  }, [token, notFound, fetchBoard, accept]);

  // A clock for "last updated" and for spotting a board that has gone quiet.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  async function enableSound() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioRef.current ??= new Ctx();
    await audioRef.current.resume();
    playChime(audioRef.current); // confirms it works
    setSoundOn(true);
  }
  function disableSound() {
    void audioRef.current?.suspend();
    audioRef.current = null;
    setSoundOn(false);
  }

  const stale = !lastUpdated || now - lastUpdated > STALE_AFTER_MS;
  const reconnecting = !live || stale;
  const timeFmt = (ms: number) =>
    new Date(ms).toLocaleTimeString(lang === "hi" ? "hi-IN" : "en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "Asia/Kolkata" });

  const shell = light ? "bg-white text-slate-950" : "bg-slate-950 text-white";
  const muted = light ? "text-slate-600" : "text-slate-300";
  const accent = light ? "text-emerald-700" : "text-emerald-300";
  const panel = light ? "bg-slate-100 ring-slate-300" : "bg-slate-900 ring-slate-700";

  if (notFound) {
    return (
      <main lang={lang} className={`fixed inset-0 grid place-items-center overflow-hidden p-6 text-center ${shell}`} data-testid="board-not-found">
        <div>
          <p className="text-[clamp(1.75rem,6vmin,4rem)] font-extrabold">{t("This display link is not valid")}</p>
          <p className={`mt-3 text-[clamp(1rem,3vmin,2rem)] ${muted}`}>{t("Ask the clinic for a new link.")}</p>
        </div>
      </main>
    );
  }

  return (
    <main lang={lang} className={`fixed inset-0 flex flex-col overflow-hidden ${shell}`} data-testid="board">
      {/* Header: who this board is for, connection and sound */}
      <header className="flex items-start justify-between gap-4 px-[4vmin] pt-[3vmin]">
        <div className="min-w-0">
          <p className={`truncate text-[clamp(0.9rem,3vmin,2.25rem)] font-semibold ${muted}`}>{board?.clinicName ?? " "}</p>
          <h1 className={`truncate text-[clamp(1.5rem,6vmin,5rem)] font-extrabold leading-tight ${light ? "text-slate-950" : "text-white"}`} data-testid="board-doctor">
            {board?.doctorName ?? t("Loading…")}
          </h1>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <p
            className={`rounded-full px-[2vmin] py-[0.6vmin] text-[clamp(0.8rem,2.2vmin,1.5rem)] font-bold ${reconnecting ? "bg-amber-400 text-slate-950" : light ? "bg-emerald-100 text-emerald-800" : "bg-emerald-900 text-emerald-200"}`}
            role="status"
            data-testid="board-connection"
          >
            {reconnecting ? t("Reconnecting…") : t("Live")}
          </p>
          <p className={`text-[clamp(0.75rem,2vmin,1.25rem)] ${muted}`} data-testid="board-updated">
            {lastUpdated ? t("Last updated {time}", { time: timeFmt(lastUpdated) }) : " "}
          </p>
          {soundOn ? (
            <button type="button" onClick={disableSound} className={`rounded-full px-3 py-1 text-[clamp(0.75rem,1.8vmin,1.1rem)] font-semibold ring-1 ${panel}`}>
              {t("Sound on")}
            </button>
          ) : (
            <button type="button" onClick={() => void enableSound()} className={`rounded-full px-3 py-1 text-[clamp(0.75rem,1.8vmin,1.1rem)] font-semibold ring-1 ${panel}`} data-testid="board-sound">
              {t("Enable sound")}
            </button>
          )}
        </div>
      </header>

      {reconnecting && board && (
        <p className="mx-[4vmin] mt-[2vmin] rounded-xl bg-amber-400 px-4 py-2 text-center text-[clamp(0.9rem,2.6vmin,1.75rem)] font-bold text-slate-950">
          {t("Numbers may be out of date until the connection is back.")}
        </p>
      )}

      {/* Body */}
      {board?.state === "NOT_IN" ? (
        <section className="grid flex-1 place-items-center p-[4vmin] text-center" data-testid="board-not-in">
          <div>
            <p className="text-[clamp(2rem,10vmin,8rem)] font-extrabold leading-tight">{t("Doctor not in")}</p>
            <p className={`mt-[2vmin] text-[clamp(1rem,3.5vmin,2.5rem)] ${muted}`}>{t("There is no clinic with this doctor right now.")}</p>
          </div>
        </section>
      ) : (
        <section className={`grid min-h-0 flex-1 gap-[3vmin] p-[4vmin] landscape:grid-cols-[3fr_2fr] portrait:grid-rows-[3fr_2fr] ${reconnecting ? "opacity-50" : ""}`}>
          <div className={`flex min-h-0 flex-col items-center justify-center rounded-[3vmin] ring-2 ${panel}`}>
            <p className={`text-[clamp(1.25rem,5vmin,4rem)] font-bold uppercase tracking-wide ${muted}`}>{t("Now serving")}</p>
            {board?.nowServing != null ? (
              <p className={`font-black leading-none tabular-nums ${accent} text-[clamp(5rem,32vmin,26rem)]`} data-testid="board-now-serving">
                {board.nowServing}
              </p>
            ) : (
              <p className={`my-[4vmin] text-center text-[clamp(1.5rem,7vmin,5.5rem)] font-extrabold ${accent}`}>{t("Waiting to start")}</p>
            )}
            {board?.state === "PAUSED" && (
              <p className="mt-[1vmin] rounded-xl bg-amber-400 px-[3vmin] py-[1vmin] text-[clamp(1.25rem,5vmin,4rem)] font-extrabold text-slate-950" data-testid="board-paused">
                {t("Queue paused")}
              </p>
            )}
          </div>
          <div className={`flex min-h-0 flex-col rounded-[3vmin] p-[3vmin] ring-2 ${panel}`}>
            <p className={`text-[clamp(1.25rem,5vmin,4rem)] font-bold uppercase tracking-wide ${muted}`}>{t("Next")}</p>
            {board && board.next.length > 0 ? (
              <ol className="flex flex-1 flex-col justify-around portrait:flex-row portrait:items-center" data-testid="board-next">
                {board.next.map((n) => (
                  <li key={n} className="text-center text-[clamp(2.5rem,13vmin,10rem)] font-extrabold leading-none tabular-nums">
                    {n}
                  </li>
                ))}
              </ol>
            ) : (
              <p className={`flex flex-1 items-center justify-center text-[clamp(1rem,4vmin,3rem)] ${muted}`}>{t("No one waiting")}</p>
            )}
          </div>
        </section>
      )}
      <footer className={`px-[4vmin] pb-[2vmin] text-center text-[clamp(0.8rem,2.2vmin,1.5rem)] ${muted}`}>{t("Please wait for your token number to be shown.")}</footer>
    </main>
  );
}
