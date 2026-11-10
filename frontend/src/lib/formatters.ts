import { intlLocale } from "./locale";

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(intlLocale(), { weekday: "short", day: "numeric", month: "short" });
}

export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
