import { env } from "../env";
import type { SmsProvider } from "./provider";
import { ConsoleSmsProvider } from "./consoleProvider";

export type { SmsProvider } from "./provider";
export { ConsoleSmsProvider } from "./consoleProvider";

function createProvider(): SmsProvider {
  if (env.smsMode === "stub") return new ConsoleSmsProvider(env.nodeEnv);
  switch (env.smsProvider) {
    // Add the real provider here once chosen, e.g.
    // case "msg91": return new Msg91SmsProvider(env.smsApiKey);
    default:
      throw new Error(`SMS_MODE=live but SMS_PROVIDER "${env.smsProvider}" is not implemented yet`);
  }
}

let provider: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  provider ??= createProvider();
  return provider;
}

/** Tests only: swap in a provider (for example one that fails). */
export function setSmsProviderForTests(p: SmsProvider | null): void {
  provider = p;
}
