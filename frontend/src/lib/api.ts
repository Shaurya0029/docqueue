import axios, { type AxiosError } from "axios";
import { getAccessToken, getRefreshToken, setAccessToken, triggerUnauthorized } from "./session";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:4000",
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await axios.post(`${api.defaults.baseURL}/auth/refresh`, { refreshToken });
    const token = res.data.accessToken as string;
    setAccessToken(token);
    return token;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config;
    if (error.response?.status === 401 && original && !(original as { _retried?: boolean })._retried) {
      (original as { _retried?: boolean })._retried = true;
      refreshInFlight = refreshInFlight ?? refreshAccessToken();
      const token = await refreshInFlight;
      refreshInFlight = null;
      if (token) {
        original.headers = original.headers ?? {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${token}`;
        return api.request(original);
      }
      triggerUnauthorized();
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string } | undefined;
    if (data?.error) return data.error;
    if (err.message) return err.message;
  }
  return "Something went wrong";
}
