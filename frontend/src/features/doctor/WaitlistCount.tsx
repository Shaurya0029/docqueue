import { useQuery } from "@tanstack/react-query";
import { Icon } from "../../components/icons";
import { api } from "../../lib/api";
import { useT } from "../../lib/i18n";

/**
 * How many patients are waiting for a freed slot on this day. Staff only
 * ever get the number, never who is waiting (each view is audit-logged).
 */
export function WaitlistCount({ doctorId, date }: { doctorId: string | null; date: string }) {
  const t = useT();
  const { data } = useQuery({
    queryKey: ["waitlist-count", doctorId, date],
    queryFn: async () => (await api.get<{ date: string; waiting: number }>(`/doctors/${doctorId}/waitlist`, { params: { date } })).data.waiting,
    enabled: !!doctorId,
    refetchInterval: 60_000,
  });
  if (!data) return null;
  return (
    <p className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700 ring-1 ring-brand-100" data-testid="waitlist-count">
      <Icon name="users" className="h-4 w-4" />
      {t("{n} on the waitlist", { n: data })}
    </p>
  );
}
