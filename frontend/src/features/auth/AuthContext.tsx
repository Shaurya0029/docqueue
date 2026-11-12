import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { clearSession, getRefreshToken, getUser, onUnauthorized, setSession } from "../../lib/session";
import type { AuthResponse, AuthUser } from "../../types/api";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** consent: true only when the patient ticked the consent box (new accounts). */
  loginWithOtp: (phoneNumber: string, code: string, fullName?: string, consent?: boolean) => Promise<void>;
  loginStaff: (phoneNumber: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onUnauthorized(() => setUser(null));
    // We only persist the refresh token + user profile; the access token is
    // re-minted on load via the interceptor's first 401, or immediately here.
    const existing = getUser();
    const refreshToken = getRefreshToken();
    if (existing && refreshToken) {
      api
        .post("/auth/refresh", { refreshToken })
        .then((res) => {
          setSession(res.data.accessToken, refreshToken, existing);
          setUser(existing);
        })
        .catch(() => {
          clearSession();
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const applyAuth = useCallback((data: AuthResponse) => {
    setSession(data.accessToken, data.refreshToken, data.user);
    setUser(data.user);
  }, []);

  const loginWithOtp = useCallback(
    async (phoneNumber: string, code: string, fullName?: string, consent?: boolean) => {
      const res = await api.post<AuthResponse>("/auth/otp/verify", { phoneNumber, code, fullName, ...(consent ? { consent: true } : {}) });
      applyAuth(res.data);
    },
    [applyAuth]
  );

  const loginStaff = useCallback(
    async (phoneNumber: string, password: string) => {
      const res = await api.post<AuthResponse>("/auth/staff/login", { phoneNumber, password });
      applyAuth(res.data);
    },
    [applyAuth]
  );

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, loginWithOtp, loginStaff, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
