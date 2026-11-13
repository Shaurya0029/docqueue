import { spawnSync } from "child_process";
import { describe, it, expect } from "vitest";

/** Loads env.ts in a fresh process with production settings and the given BOARD_LINK_KEY. */
function loadEnv(boardLinkKey: string) {
  return spawnSync(process.execPath, ["--import", "tsx", "-e", "import('./src/lib/env.ts').then(() => console.log('started'))"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PAYMENTS_MODE: "razorpay",
      SMS_MODE: "live",
      // Placeholders so only BOARD_LINK_KEY decides whether production starts.
      RAZORPAY_KEY_ID: "rzp_test_placeholder",
      RAZORPAY_KEY_SECRET: "placeholder",
      RAZORPAY_WEBHOOK_SECRET: "placeholder",
      BOARD_LINK_KEY: boardLinkKey, // set (even empty) so backend/.env cannot fill it in
    },
  });
}

describe("BOARD_LINK_KEY", () => {
  it("is required in production: the API refuses to start without it", () => {
    const run = loadEnv("");
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("Missing required env var BOARD_LINK_KEY");
  });

  it("must be 32 bytes, base64", () => {
    const run = loadEnv(Buffer.from("too short").toString("base64"));
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("BOARD_LINK_KEY must be 32 bytes");
  });

  it("starts with a valid key", () => {
    const run = loadEnv(Buffer.alloc(32, 7).toString("base64"));
    expect(run.stdout).toContain("started");
  });
});
