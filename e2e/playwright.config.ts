import { defineConfig, devices } from "@playwright/test";

/**
 * The journey runs against its own stack so it never touches dev data:
 * API on :4100 and frontend on :5174, backed by the docqueue_e2e database,
 * which is reset and seeded every time the API server starts.
 * Postgres and Redis come from the repo's docker-compose (or CI services).
 */
const API_PORT = 4100;
const WEB_PORT = 5174;
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://docqueue:docqueue@localhost:5433/docqueue_e2e";
const REDIS_URL = process.env.E2E_REDIS_URL ?? "redis://localhost:6380/1";

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    // The clinic's patients use phones; the journey is checked at 360 px.
    ...devices["Desktop Chrome"],
    viewport: { width: 360, height: 800 },
    timezoneId: "UTC", // times must still show in IST
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      cwd: "../backend",
      command:
        "npx prisma migrate reset --force --skip-seed --skip-generate && npx tsx prisma/e2e-seed.ts && npx tsx src/server.ts",
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL,
        REDIS_URL,
        PORT: String(API_PORT),
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        NODE_ENV: "test",
        PAYMENTS_MODE: "stub",
        SMS_MODE: "stub",
        JWT_SECRET: process.env.JWT_SECRET ?? "e2e-jwt-secret",
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? "e2e-refresh-secret",
        RAZORPAY_WEBHOOK_SECRET: "e2e_webhook_secret",
      },
    },
    {
      cwd: "../frontend",
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_API_URL: `http://localhost:${API_PORT}`,
        VITE_WS_URL: `ws://localhost:${API_PORT}/ws`,
      },
    },
  ],
});
