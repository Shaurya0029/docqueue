import { env } from "../env";

/**
 * Travel time from the patient to the clinic, behind a provider interface.
 *
 * - straight-line (default, free, no key): great-circle distance x 1.4 road
 *   factor at an assumed 20 km/h city speed.
 * - osrm (TRAVEL_PROVIDER=osrm): driving time from an OSRM server
 *   (OSRM_URL; the public demo server needs no key but is not for heavy use).
 *
 * Any failure or a slow answer falls back to straight-line. Coordinates are
 * only ever held in memory here: never stored, and never written to logs.
 */
export interface Point {
  latitude: number;
  longitude: number;
}

export interface TravelTimeProvider {
  readonly name: string;
  minutes(from: Point, to: Point): Promise<number>;
}

export const ROAD_FACTOR = 1.4;
export const CITY_SPEED_KMH = 20;
export const PROVIDER_TIMEOUT_MS = 3000;

export function distanceKm(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export const straightLineProvider: TravelTimeProvider = {
  name: "straight-line",
  async minutes(from, to) {
    const roadKm = distanceKm(from, to) * ROAD_FACTOR;
    return Math.max(1, Math.ceil((roadKm / CITY_SPEED_KMH) * 60));
  },
};

export function osrmProvider(baseUrl: string): TravelTimeProvider {
  return {
    name: "osrm",
    async minutes(from, to) {
      const coords = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/route/v1/driving/${coords}?overview=false`, {
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`OSRM answered ${res.status}`);
      const body = (await res.json()) as { code?: string; routes?: { duration: number }[] };
      const seconds = body.routes?.[0]?.duration;
      if (body.code !== "Ok" || typeof seconds !== "number") throw new Error(`OSRM gave no route (${body.code})`);
      return Math.max(1, Math.ceil(seconds / 60));
    },
  };
}

function configuredProvider(): TravelTimeProvider {
  return env.travelProvider === "osrm" ? osrmProvider(env.osrmUrl) : straightLineProvider;
}

/** Travel minutes and which provider produced them; never throws. */
export async function travelMinutes(
  from: Point,
  to: Point,
  provider: TravelTimeProvider = configuredProvider(),
  timeoutMs = PROVIDER_TIMEOUT_MS
): Promise<{ minutes: number; provider: string }> {
  if (provider !== straightLineProvider) {
    try {
      const minutes = await Promise.race([
        provider.minutes(from, to),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs).unref()),
      ]);
      if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("invalid minutes");
      return { minutes: Math.ceil(minutes), provider: provider.name };
    } catch (err) {
      // The error message never contains the coordinates.
      console.warn(`travel provider ${provider.name} failed, using straight-line: ${err instanceof Error ? err.message.slice(0, 40) : "error"}`);
    }
  }
  return { minutes: await straightLineProvider.minutes(from, to), provider: straightLineProvider.name };
}
