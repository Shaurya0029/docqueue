/**
 * Outbound SMS. Every message (OTPs and patient notifications) goes through
 * this interface, so a real provider (MSG91, Twilio, ...) is one new class
 * plus a case in getSmsProvider().
 */
export interface SmsProvider {
  readonly name: string;
  /** Sends one SMS. `to` is E.164, e.g. +919800000004. Throws on failure. */
  send(to: string, message: string): Promise<void>;
}
