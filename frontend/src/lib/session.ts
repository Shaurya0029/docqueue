import type { AuthUser, Role } from "../types/api";

interface SessionState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
}

const STORAGE_KEY = "docqueue.session";

function load(): SessionState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { accessToken: null, refreshToken: null, user: null };
    const parsed = JSON.parse(raw) as { refreshToken: string; user: AuthUser };
    return { accessToken: null, refreshToken: parsed.refreshToken, user: parsed.user };
  } catch {
    return { accessToken: null, refreshToken: null, user: null };
  }
}

let state: SessionState = load();
let unauthorizedHandler: (() => void) | null = null;

export function getAccessToken(): string | null {
  return state.accessToken;
}

export function getRefreshToken(): string | null {
  return state.refreshToken;
}

export function getUser(): AuthUser | null {
  return state.user;
}

export function getRole(): Role | null {
  return state.user?.role ?? null;
}

export function setSession(accessToken: string, refreshToken: string, user: AuthUser): void {
  state = { accessToken, refreshToken, user };
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ refreshToken, user }));
}

export function setAccessToken(accessToken: string): void {
  state = { ...state, accessToken };
}

export function clearSession(): void {
  state = { accessToken: null, refreshToken: null, user: null };
  localStorage.removeItem(STORAGE_KEY);
}

export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

export function triggerUnauthorized(): void {
  clearSession();
  unauthorizedHandler?.();
}
