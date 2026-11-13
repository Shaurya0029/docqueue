import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing required env var ${name}`);
  return v;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

/** A dev-only default, refused in production so a real deploy must set the value. */
function devDefault(name: string, fallback: string): string {
  return isProduction ? required(name) : required(name, fallback);
}

// "live" was the old name for the real gateway; keep accepting it.
const rawPaymentsMode = process.env.PAYMENTS_MODE ?? "stub";
const paymentsMode: "stub" | "razorpay" = rawPaymentsMode === "stub" ? "stub" : "razorpay";
if (isProduction && paymentsMode === "stub") {
  throw new Error("PAYMENTS_MODE=stub is not allowed when NODE_ENV=production");
}

const smsMode: "stub" | "live" = process.env.SMS_MODE === "live" ? "live" : "stub";
if (isProduction && smsMode === "stub") {
  throw new Error("SMS_MODE=stub is not allowed when NODE_ENV=production");
}

/**
 * Key for the waiting-room board links' stored (encrypted) copy: 32 bytes,
 * base64 (`openssl rand -base64 32`). Required in production; a fixed
 * dev-only key is used otherwise. Changing it makes saved links unreadable
 * in Settings (they still work on the TV until regenerated).
 */
const DEV_BOARD_LINK_KEY = "ZGV2LW9ubHktYm9hcmQtbGluay1rZXktMzItYnl0ZXM="; // "dev-only-board-link-key-32-bytes"
function boardLinkKey(): Buffer {
  const raw = devDefault("BOARD_LINK_KEY", DEV_BOARD_LINK_KEY);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("BOARD_LINK_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  return key;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv,
  isProduction,
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL", "redis://localhost:6379"),
  jwtSecret: required("JWT_SECRET"),
  boardLinkKey: boardLinkKey(),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // "Leave now" travel time: straight-line (default, no key) or osrm.
  travelProvider: (process.env.TRAVEL_PROVIDER === "osrm" ? "osrm" : "straight-line") as "osrm" | "straight-line",
  osrmUrl: process.env.OSRM_URL ?? "https://router.project-osrm.org",
  // Number of reverse proxies in front of the API (0 = none). Needed so
  // per-IP rate limits see the client's IP, not the load balancer's.
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  paymentsMode,
  smsMode,
  smsProvider: process.env.SMS_PROVIDER ?? "",
  smsApiKey: process.env.SMS_API_KEY ?? "",
  razorpayKeyId: paymentsMode === "razorpay" ? required("RAZORPAY_KEY_ID") : process.env.RAZORPAY_KEY_ID ?? "",
  razorpayKeySecret: paymentsMode === "razorpay" ? required("RAZORPAY_KEY_SECRET") : process.env.RAZORPAY_KEY_SECRET ?? "",
  razorpayWebhookSecret:
    paymentsMode === "razorpay" ? required("RAZORPAY_WEBHOOK_SECRET") : devDefault("RAZORPAY_WEBHOOK_SECRET", "dev_webhook_secret"),
};
