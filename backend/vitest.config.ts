import { defineConfig } from "vitest/config";

// Tests run against their own database so `vitest run` never truncates the
// dev data a running `npm run dev` + `npm run seed` session depends on.
process.env.DATABASE_URL = "postgresql://docqueue:docqueue@localhost:5433/docqueue_test";

export default defineConfig({
  test: {
    setupFiles: ["./src/tests/setup.ts"],
    fileParallelism: false, // all tests share one Postgres instance
    testTimeout: 15000,
  },
});
