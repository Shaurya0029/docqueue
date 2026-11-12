import { defineConfig } from "vitest/config";

// Tests run against their own database so `vitest run` never truncates the
// dev data a running `npm run dev` + `npm run seed` session depends on.
process.env.DATABASE_URL = "postgresql://docqueue:docqueue@localhost:5433/docqueue_test";
// Redis database 2 is the tests' own; setup.ts empties it before each test.
process.env.REDIS_URL = "redis://localhost:6380/2";
process.env.NODE_ENV = "test";
process.env.SMS_MODE = "stub";
process.env.PAYMENTS_MODE = "stub";
process.env.TRUST_PROXY = "1";

export default defineConfig({
  test: {
    setupFiles: ["./src/tests/setup.ts"],
    fileParallelism: false, // all tests share one Postgres instance
    testTimeout: 15000,
  },
});
