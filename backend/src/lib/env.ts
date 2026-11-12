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

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv,
  isProduction,
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL", "redis://localhost:6379"),
  jwtSecret: required("JWT_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
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
