/**
 * Razorpay Checkout, loaded from Razorpay's CDN only when a patient pays
 * (no npm dependency). The checkout's success callback is NOT proof of
 * payment: the booking is confirmed only when the backend receives
 * Razorpay's signed webhook, so callers wait for the appointment to turn
 * BOOKED (see waitForBooking in BookingPaymentPage).
 */
const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", handler: (response: { error?: { description?: string } }) => void): void;
}
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

let loading: Promise<RazorpayConstructor> | null = null;

function loadCheckout(): Promise<RazorpayConstructor> {
  const existing = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => {
      const ctor = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
      if (ctor) resolve(ctor);
      else reject(new Error("Payment window failed to load"));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Could not reach the payment gateway. Check your connection and try again."));
    };
    document.body.appendChild(script);
  });
  return loading;
}

export class CheckoutDismissedError extends Error {
  constructor() {
    super("Payment cancelled");
  }
}

export async function openRazorpayCheckout(options: {
  keyId: string;
  orderId: string;
  amount: number; // paise
  description: string;
  contact?: string;
}): Promise<void> {
  const Razorpay = await loadCheckout();
  await new Promise<void>((resolve, reject) => {
    const checkout = new Razorpay({
      key: options.keyId,
      order_id: options.orderId,
      amount: options.amount,
      currency: "INR",
      name: "MEDORA",
      description: options.description,
      prefill: options.contact ? { contact: options.contact } : undefined,
      theme: { color: "#0d9488" },
      handler: () => resolve(),
      modal: { ondismiss: () => reject(new CheckoutDismissedError()) },
    });
    checkout.on("payment.failed", (response) => reject(new Error(response.error?.description ?? "Payment failed")));
    checkout.open();
  });
}
