export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10); // yyyy-mm-dd, always UTC-based for consistency
}

export function todayKey(): string {
  return toDateKey(new Date());
}
