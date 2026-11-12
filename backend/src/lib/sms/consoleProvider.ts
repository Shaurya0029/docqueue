import type { SmsProvider } from "./provider";

/**
 * Development and test provider: prints messages instead of sending them and
 * keeps the most recent ones in memory for tests. Refuses to exist when
 * NODE_ENV=production, so a misconfigured deploy fails at startup instead of
 * silently not texting patients.
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  readonly sent: { to: string; message: string; at: Date }[] = [];

  constructor(nodeEnv: string) {
    if (nodeEnv === "production") throw new Error("The console SMS provider cannot be used in production");
  }

  async send(to: string, message: string): Promise<void> {
    this.sent.push({ to, message, at: new Date() });
    if (this.sent.length > 200) this.sent.shift();
    if (process.env.VITEST !== "true") console.log(`[sms:console] to ${to}: ${message}`);
  }
}
