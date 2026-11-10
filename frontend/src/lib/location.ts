import { useCallback, useState } from "react";

/** The patient's chosen area for doctor search. Stored per device. */
export type PatientLocation =
  | { source: "auto" | "manual"; city: string; area?: string }
  | { source: "all" }; // user explicitly chose "all locations"

const STORAGE_KEY = "medora.location";

function read(): PatientLocation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PatientLocation) : null;
  } catch {
    return null;
  }
}

function write(loc: PatientLocation | null) {
  try {
    if (loc) localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — keep it in memory only */
  }
}

export function usePatientLocation() {
  const [location, setState] = useState<PatientLocation | null>(read);
  const setLocation = useCallback((loc: PatientLocation | null) => {
    write(loc);
    setState(loc);
  }, []);
  return { location, setLocation };
}

/** City to filter by, or undefined for all locations / not chosen yet. */
export const cityOf = (loc: PatientLocation | null) => (loc && loc.source !== "all" ? loc.city : undefined);

/* ───────── detection ───────── */

export type DetectErrorCode = "unsupported" | "denied" | "unavailable" | "timeout" | "lookup";
export class DetectError extends Error {
  code: DetectErrorCode;
  constructor(code: DetectErrorCode) {
    super(code);
    this.code = code;
  }
}

/** Common old/new spellings, normalised to the name most addresses use today. */
const CANONICAL: Record<string, string> = {
  bangalore: "Bengaluru",
  bombay: "Mumbai",
  calcutta: "Kolkata",
  madras: "Chennai",
  gurgaon: "Gurugram",
  "new delhi": "Delhi",
};
export const normaliseCity = (name: string) => CANONICAL[name.trim().toLowerCase()] ?? name.trim();

/** True when the browser already has location permission (so we can detect without a prompt). */
export async function hasLocationPermission(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    return status?.state === "granted";
  } catch {
    return false;
  }
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new DetectError("unsupported"));
    navigator.geolocation.getCurrentPosition(resolve, (err) => {
      const code: DetectErrorCode = err.code === err.PERMISSION_DENIED ? "denied" : err.code === err.TIMEOUT ? "timeout" : "unavailable";
      reject(new DetectError(code));
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 });
  });
}

/**
 * Detects the user's city: browser geolocation, then a reverse-geocoding lookup
 * (BigDataCloud's free client-side endpoint). Only the resulting city/area is kept.
 */
export async function detectLocation(): Promise<{ city: string; area?: string }> {
  const { coords } = await getPosition();
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${coords.latitude}&longitude=${coords.longitude}&localityLanguage=en`;
  let data: { city?: string; locality?: string; principalSubdivision?: string };
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    throw new DetectError("lookup");
  }
  const city = data.city || data.locality || data.principalSubdivision;
  if (!city) throw new DetectError("lookup");
  const area = data.locality && data.locality !== data.city ? data.locality : undefined;
  return { city: normaliseCity(city), area };
}

export const POPULAR_CITIES = ["Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Chennai", "Pune", "Kolkata", "Ahmedabad", "Jaipur", "Lucknow", "Gurugram", "Noida"];

/** Manual entry validation: 2–60 chars, letters (any script), spaces, and . , ' - */
export const isValidPlace = (s: string) => /^[\p{L}\p{M} .,'-]{2,60}$/u.test(s.trim());
