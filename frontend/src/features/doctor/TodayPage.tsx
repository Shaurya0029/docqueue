import { ErrorState, PageHeader, Spinner } from "../../components/ui";
import { QueueBoard } from "../../components/QueueBoard";
import { useQueueSocket } from "../../lib/useQueueSocket";
import { intlLocale } from "../../lib/locale";
import { useCallNext, useDoctorQueue, useMarkComplete, useMarkNoShow, useMyDoctorProfile } from "./hooks";
import { useT } from "../../lib/i18n";

export function TodayPage() {
  const t = useT();
  const { data: profile } = useMyDoctorProfile();
  const doctorId = profile?.id ?? null;
  const { data: queue, isLoading, isError, refetch } = useDoctorQueue(doctorId);
  const callNext = useCallNext(doctorId);
  const markComplete = useMarkComplete(doctorId);
  const markNoShow = useMarkNoShow(doctorId);
  const { connected } = useQueueSocket(doctorId);

  if (isLoading || !doctorId) return <Spinner />;
  if (isError || !queue) return <ErrorState message={t("Could not load today's queue")} onRetry={() => refetch()} />;

  const waiting = queue.queue.filter((e) => e.status === "CHECKED_IN").length;

  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString(intlLocale(), { weekday: "long", day: "numeric", month: "short" })}
        title={t("Today's queue")}
        subtitle={waiting === 1 ? t("1 patient checked in and waiting") : t("{n} patients checked in and waiting", { n: waiting })}
      />
      <QueueBoard
        queue={queue}
        connected={connected}
        onCallNext={() => callNext.mutateAsync()}
        callNextPending={callNext.isPending}
        callNextDisabled={waiting === 0}
        onComplete={(id) => markComplete.mutateAsync(id)}
        onNoShow={(id) => markNoShow.mutateAsync(id)}
      />
    </>
  );
}
